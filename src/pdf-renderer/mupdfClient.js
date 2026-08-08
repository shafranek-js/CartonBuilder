import { AppError } from '../errors.js';
import { renderCacheKey, createRenderCache } from './renderCache.js';
import { createRenderDeduper } from './renderScheduler.js';
import {
  createRequest,
  deserializeRendererError,
  RendererRequestType,
} from './protocol.js';
import { recordRenderDiagnostic } from './rendererDiagnostics.js';

function defaultWorkerFactory() {
  return new Worker(new URL('./mupdf.worker.js', import.meta.url), { type: 'module' });
}

function rgbaToPngBlob(rgba, width, height) {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new AppError('previewCreateFailed'));
    }, 'image/png');
  });
}

export function createMuPdfClient({
  workerFactory = defaultWorkerFactory,
  encodePng = rgbaToPngBlob,
  timeoutMs = 180_000,
} = {}) {
  let worker = null;
  let dead = false;
  let readyPromise = Promise.resolve();
  let readyResolve = null;
  let watchdogTimer = null;
  const pending = new Map();
  const deduper = createRenderDeduper();
  const cache = createRenderCache();
  const sessionRenders = new Map();
  let rendererVersion = 'mupdf';

  function failAll(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    stopWatchdog();
  }

  function startWatchdog() {
    if (watchdogTimer || timeoutMs <= 0) return;
    const interval = Math.max(50, Math.min(2000, timeoutMs / 2));
    watchdogTimer = setInterval(() => {
      const now = performance.now();
      for (const { startedAt } of pending.values()) {
        if (now - startedAt > timeoutMs) {
          failAll(new AppError('pdfRenderTimeout'));
          worker?.terminate();
          worker = null;
          sessionRenders.clear();
          return;
        }
      }
    }, interval);
  }

  function stopWatchdog() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function ensureWorker() {
    if (worker) return;
    worker = workerFactory();
    readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
  }

  function onError() {
    dead = true;
    failAll(new AppError('rendererUnavailable'));
    readyResolve?.();
    readyResolve = null;
    worker = null;
  }

  function onMessage(event) {
    const { id, type, result, error } = event.data || {};
    if (type === 'ready') {
      readyResolve?.();
      readyResolve = null;
      return;
    }
    const pendingRequest = pending.get(id);
    if (!pendingRequest) return;
    pending.delete(id);
    if (pending.size === 0) stopWatchdog();
    if (type === 'ok') pendingRequest.resolve(result);
    else {
      const { code, parameters } = deserializeRendererError(error);
      pendingRequest.reject(new AppError(code, parameters));
    }
  }

  async function post(message, transfer) {
    ensureWorker();
    await readyPromise;
    return new Promise((resolve, reject) => {
      pending.set(message.id, { resolve, reject, startedAt: performance.now() });
      startWatchdog();
      worker.postMessage(message, transfer || []);
    });
  }

  function postRaw(message) {
    ensureWorker();
    return readyPromise.then(() => worker.postMessage(message));
  }

  async function request(type, payload, transfer) {
    const message = createRequest(type, payload);
    return post(message, transfer);
  }

  return {
    get available() {
      return !dead;
    },

    recognize(bytes, { extension = '' } = {}) {
      return request(RendererRequestType.recognize, { bytes, extension }, [bytes.buffer]);
    },

    openDocument(bytes, docId, { extension = '' } = {}) {
      return request(RendererRequestType.open, { docId, bytes, extension }, [bytes.buffer])
        .then((result) => {
          if (result?.version) rendererVersion = result.version;
          return result;
        });
    },

    getRendererVersion() {
      return rendererVersion;
    },

    authenticate(docId, password) {
      return request(RendererRequestType.authenticate, { docId, password });
    },

    closeDocument(docId) {
      if (!docId) return Promise.resolve(false);
      return request(RendererRequestType.close, { docId });
    },

    getPageInfo(docId, pageIndex) {
      return request(RendererRequestType.info, { docId, pageIndex });
    },

    getLayers(docId) {
      return request(RendererRequestType.layers, { docId });
    },

    getSeparations(docId, pageIndex, overprintMode = 2) {
      return request(RendererRequestType.separations, { docId, pageIndex, overprintMode });
    },

    renderPage(docId, {
      pageIndex = 0,
      scale = 1,
      box = 'CropBox',
      visibility = null,
      usage = 'Print',
      overprintMode = 0,
      processMask = 15,
      spotBehaviors = null,
      separationBehaviors = null,
    } = {}, { session = null } = {}) {
      const effectiveSpotBehaviors = spotBehaviors ?? separationBehaviors;
      const cacheKey = renderCacheKey({
        docId,
        pageIndex,
        scale,
        box,
        visibility,
        usage,
        overprintMode,
        processMask,
        spotBehaviors: effectiveSpotBehaviors,
      });
      const cached = cache.get(cacheKey);
      if (cached) return Promise.resolve(cached.value);

      return deduper.run(cacheKey, async () => {
        const message = createRequest(RendererRequestType.render, {
          docId,
          pageIndex,
          scale,
          box,
          visibility,
          usage,
          overprintMode,
          processMask,
          spotBehaviors: effectiveSpotBehaviors,
        });
        if (session) {
          const previous = sessionRenders.get(session);
          if (previous) {
            postRaw(createRequest(RendererRequestType.cancel, { requestId: previous })).catch(() => {});
            const stale = pending.get(previous);
            if (stale) {
              pending.delete(previous);
              stale.reject(new DOMException('Artwork processing was cancelled.', 'AbortError'));
            }
          }
          sessionRenders.set(session, message.id);
        }
        const started = performance.now();
        const result = await post(message);
        if (session && sessionRenders.get(session) !== message.id) return undefined;
        const blob = await encodePng(result.rgba, result.width, result.height);
        recordRenderDiagnostic({
          pageIndex,
          box,
          width: result.width,
          height: result.height,
          scale,
          usage,
          durationMs: result.durationMs,
          rendererVersion,
          overprintMode,
          processMask,
          spotBehaviors: effectiveSpotBehaviors,
          separationBehaviors: effectiveSpotBehaviors,
          overprintApplied: result.overprintApplied === true,
        });
        const value = {
          blob,
          width: result.width,
          height: result.height,
          durationMs: Math.round(performance.now() - started),
          overprintApplied: result.overprintApplied === true,
        };
        cache.set(cacheKey, { value, bytes: blob.size });
        return value;
      });
    },

    close() {
      failAll(new AppError('rendererUnavailable'));
      worker?.terminate();
      worker = null;
      dead = false;
      sessionRenders.clear();
    },  };
}

let sharedClient = null;

export function getMuPdfClient() {
  sharedClient ||= createMuPdfClient();
  return sharedClient;
}
