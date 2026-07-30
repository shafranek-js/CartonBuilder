import { AppError, deserializeAppError } from '../errors.js';
import { processArtworkFile, PREVIEW_LIMITS } from './fileProcessing.js';
import { validateArtworkFile } from './fileValidation.js';

function buildLoadResult(file, loaded) {
  return {
    originalBlob: file,
    previewBlob: loaded.previewBlob,
    source: {
      id: crypto.randomUUID(),
      fileName: file.name || `artwork.${loaded.extension}`,
      mimeType: loaded.mimeType,
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

export function loadArtworkWithWorker(file, {
  choosePage = async () => 0,
  signal,
  workerFactory = defaultWorkerFactory,
  jobId = crypto.randomUUID(),
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

    worker.postMessage({ type: 'load', jobId, file });
  });
}

export async function loadArtworkFile(file, {
  choosePage = async () => 0,
  signal,
  workerFactory = defaultWorkerFactory,
  preferWorker = true,
} = {}) {
  await validateArtworkFile(file);
  if (preferWorker && canUseWorker()) {
    try {
      return await loadArtworkWithWorker(file, { choosePage, signal, workerFactory });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (!(error instanceof AppError) || error.code !== 'workerUnavailable') throw error;
    }
  }

  const loaded = await processArtworkFile(file, { choosePage, signal });
  return buildLoadResult(file, loaded);
}

export { PREVIEW_LIMITS };
