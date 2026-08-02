import { serializeAppError } from '../errors.js';
import { processArtworkFile, renderPdfPreview } from './fileProcessing.js';

let activeJob = null;

function requestPage(jobId, count) {
  postMessage({
    type: 'page-selection-required',
    jobId,
    pageCount: count,
  });
  return new Promise((resolve, reject) => {
    activeJob.resolvePage = resolve;
    activeJob.rejectPage = reject;
  });
}

async function startJob(jobId, file) {
  activeJob?.controller.abort();
  const controller = new AbortController();
  activeJob = {
    jobId,
    controller,
    resolvePage: null,
    rejectPage: null,
  };

  try {
    const result = await processArtworkFile(file, {
      signal: controller.signal,
      choosePage: (count) => requestPage(jobId, count),
    });
    if (activeJob?.jobId !== jobId) return;
    postMessage({ type: 'complete', jobId, result });
  } catch (error) {
    if (activeJob?.jobId !== jobId || error?.name === 'AbortError') return;
    postMessage({
      type: 'error',
      jobId,
      error: serializeAppError(error, 'artworkLoadFailed'),
    });
  } finally {
    if (activeJob?.jobId === jobId) activeJob = null;
  }
}

async function startRenderJob(jobId, file, { pageIndex, visibility, dpi, targetWidthMm }) {
  activeJob?.controller.abort();
  const controller = new AbortController();
  activeJob = {
    jobId,
    controller,
    resolvePage: null,
    rejectPage: null,
  };

  try {
    const result = await renderPdfPreview(file, {
      pageIndex,
      visibility,
      dpi,
      targetWidthMm,
      signal: controller.signal,
    });
    if (activeJob?.jobId !== jobId) return;
    postMessage({ type: 'render-complete', jobId, result });
  } catch (error) {
    if (activeJob?.jobId !== jobId || error?.name === 'AbortError') return;
    postMessage({
      type: 'error',
      jobId,
      error: serializeAppError(error, 'artworkLoadFailed'),
    });
  } finally {
    if (activeJob?.jobId === jobId) activeJob = null;
  }
}

self.addEventListener('message', (event) => {
  const { type, jobId } = event.data || {};
  if (type === 'load' && jobId && event.data.file instanceof Blob) {
    startJob(jobId, event.data.file);
    return;
  }
  if (type === 'render-pdf' && jobId && event.data.file instanceof Blob) {
    startRenderJob(jobId, event.data.file, event.data);
    return;
  }
  if (type === 'select-page' && activeJob?.jobId === jobId && activeJob.resolvePage) {
    const resolve = activeJob.resolvePage;
    activeJob.resolvePage = null;
    activeJob.rejectPage = null;
    resolve(event.data.pageIndex);
  }
});
