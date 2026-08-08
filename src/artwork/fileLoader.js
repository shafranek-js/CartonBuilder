import { AppError, deserializeAppError } from '../errors.js';
import { processArtworkFile, PREVIEW_LIMITS } from './fileProcessing.js';
import { validateArtworkFile } from './fileValidation.js';
import { DEFAULT_PAGE_BOX, loadPdfArtwork, renderPdfArtwork } from './pdfArtworkLoader.js';

function buildLoadResult(file, loaded) {
  const isVideo = Boolean(
    loaded?.isVideo
    || loaded?.mimeType?.startsWith('video/')
    || file?.type?.startsWith('video/')
    || file?.name?.match(/\.(mp4|webm|ogv)$/i)
  );

  return {
    originalBlob: file,
    previewBlob: loaded.previewBlob,
    source: {
      id: crypto.randomUUID(),
      fileName: file.name || `artwork.${loaded.extension}`,
      mimeType: loaded.mimeType || file.type || 'video/mp4',
      byteLength: file.size,
      widthPx: loaded.widthPx,
      heightPx: loaded.heightPx,
      previewWidthPx: loaded.previewWidthPx,
      previewHeightPx: loaded.previewHeightPx,
      pageIndex: loaded.pageIndex,
      pageCount: loaded.pageCount,
      vector: loaded.vector,
      pdfPageRotation: loaded.pdfPageRotation || 0,
      mediaBox: loaded.mediaBox || null,
      sha256: loaded.sha256,
      pdfLayers: loaded.pdfLayers || null,
      pdfLayerVisibility: loaded.pdfLayerVisibility || null,
      hasOverprint: Boolean(loaded.hasOverprint),
      pageBox: loaded.pageBox || DEFAULT_PAGE_BOX,
      isVideo,
    },
  };
}

function defaultWorkerFactory() {
  return new Worker(new URL('./fileWorker.js', import.meta.url), { type: 'module' });
}

function canUseWorker() {
  return (
    typeof Worker === 'function'
    && typeof OffscreenCanvas === 'function'
    && typeof createImageBitmap === 'function'
  );
}

function shouldRetryOnMainThread(error) {
  return error instanceof AppError
    && (error.code === 'workerUnavailable' || error.code === 'artworkLoadFailed');
}

export function loadArtworkWithWorker(file, {
  choosePage = async () => 0,
  signal,
  workerFactory = defaultWorkerFactory,
  jobId = crypto.randomUUID(),
  overprint = false,
} = {}) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Artwork processing was cancelled.', 'AbortError'));
  }

  let worker;
  try {
    worker = workerFactory();
  } catch (error) {
    return Promise.reject(new AppError('workerUnavailable', {}, { cause: error }));
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const abort = () => {
      finish(reject, new DOMException('Artwork processing was cancelled.', 'AbortError'));
    };

    signal?.addEventListener('abort', abort, { once: true });
    worker.addEventListener('error', (event) => {
      finish(reject, new AppError('artworkLoadFailed', {}, { cause: event.error }));
    });
    worker.addEventListener('message', async (event) => {
      const message = event.data || {};
      if (settled || message.jobId !== jobId) return;

      if (message.type === 'page-selection-required') {
        try {
          const pageIndex = await choosePage(message.pageCount);
          if (!settled) worker.postMessage({ type: 'select-page', jobId, pageIndex });
        } catch (error) {
          finish(reject, error);
        }
        return;
      }
      if (message.type === 'complete') {
        finish(resolve, buildLoadResult(file, message.result));
        return;
      }
      if (message.type === 'error') {
        finish(reject, deserializeAppError(message.error, 'artworkLoadFailed'));
      }
    });

    worker.postMessage({ type: 'load', jobId, file, overprint });
  });
}

export async function loadArtworkFile(file, {
  choosePage = async () => 0,
  signal,
  workerFactory = defaultWorkerFactory,
  preferWorker = true,
  workerSupported = canUseWorker(),
  processFile = processArtworkFile,
  overprint = false,
  promptPassword = null,
  overprintMode = 0,
} = {}) {
  const validated = await validateArtworkFile(file);
  if (validated.mimeType === 'application/pdf') {
    const loaded = await loadPdfArtwork(file, {
      choosePage,
      signal,
      pageBox: DEFAULT_PAGE_BOX,
      promptPassword,
      overprintMode,
    });
    return buildLoadResult(file, loaded);
  }
  const isVideoFile = Boolean(
    file?.type?.startsWith('video/') || file?.name?.match(/\.(mp4|webm|ogv)$/i),
  );
  if (preferWorker && workerSupported && !isVideoFile) {
    try {
      return await loadArtworkWithWorker(file, { choosePage, signal, workerFactory, overprint });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (!shouldRetryOnMainThread(error)) throw error;
    }
  }

  const loaded = await processFile(file, { choosePage, signal, overprint });
  return buildLoadResult(file, loaded);
}

export async function renderPdfWithLayers(file, {
  pageIndex = 0,
  visibility = null,
  dpi = null,
  targetWidthMm = null,
  signal,
  pageBox = DEFAULT_PAGE_BOX,
  overprint = false,
  cacheKey = '',
  promptPassword = null,
  passwordKey = '',
  session = null,
  overprintMode = 0,
  processMask = 15,
  spotBehaviors = null,
  separationBehaviors = null,
} = {}) {
  if (signal?.aborted) {
    throw new DOMException('Artwork processing was cancelled.', 'AbortError');
  }
  return renderPdfArtwork(file, {
    pageIndex,
    visibility,
    dpi,
    targetWidthMm,
    signal,
    pageBox,
    promptPassword,
    passwordKey,
    session,
    overprintMode: overprintMode || (overprint ? 1 : 0),
    processMask,
    spotBehaviors: spotBehaviors ?? separationBehaviors,
  });
}

export { PREVIEW_LIMITS };
