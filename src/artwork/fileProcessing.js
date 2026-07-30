import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { AppError } from '../errors.js';
import { sha256, validateArtworkFile } from './fileValidation.js';

const MAX_PREVIEW_EDGE = 4096;
const MAX_PREVIEW_PIXELS = 16_000_000;

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Artwork processing was cancelled.', 'AbortError');
  }
}

export function getPreviewScale(width, height) {
  return Math.min(
    1,
    MAX_PREVIEW_EDGE / Math.max(width, height),
    Math.sqrt(MAX_PREVIEW_PIXELS / (width * height)),
  );
}

async function canvasToBlob(canvas, type = 'image/png', quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (
      blob ? resolve(blob) : reject(new AppError('previewCreateFailed'))
    ), type, quality);
  });
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new AppError('canvasContextUnavailable');
}

async function loadImage(file, signal) {
  throwIfAborted(signal);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    throwIfAborted(signal);
    const scale = getPreviewScale(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new AppError('canvasContextUnavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    throwIfAborted(signal);

    return {
      // The project archive contract names this resource artwork.png.
      // Always normalise editor previews to PNG; original bytes remain untouched.
      previewBlob: await canvasToBlob(canvas, 'image/png'),
      widthPx: width / scale,
      heightPx: height / scale,
      previewWidthPx: width,
      previewHeightPx: height,
      pageIndex: null,
      pageCount: null,
      vector: false,
      pdfPageRotation: 0,
      mediaBox: null,
    };
  } finally {
    bitmap?.close();
  }
}

function isWorkerContext() {
  return typeof WorkerGlobalScope !== 'undefined'
    && typeof self !== 'undefined'
    && self instanceof WorkerGlobalScope;
}

async function loadPdf(file, choosePage, signal) {
  throwIfAborted(signal);
  const pdfjs = await import('pdfjs-dist');
  const { PDFDocument } = await import('pdf-lib');
  throwIfAborted(signal);
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data: originalBytes.slice(),
    disableWorker: isWorkerContext(),
  });
  const abortLoading = () => loadingTask.destroy();
  signal?.addEventListener('abort', abortLoading, { once: true });
  let documentProxy;

  try {
    try {
      documentProxy = await loadingTask.promise;
    } catch (error) {
      throwIfAborted(signal);
      if (error?.name === 'PasswordException') {
        throw new AppError('pdfPasswordProtected');
      }
      throw new AppError('pdfDamaged', {}, { cause: error });
    }

    throwIfAborted(signal);
    const pageIndex = documentProxy.numPages > 1
      ? await choosePage(documentProxy.numPages)
      : 0;
    throwIfAborted(signal);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= documentProxy.numPages) {
      throw new AppError('pdfPageInvalid');
    }

    const page = await documentProxy.getPage(pageIndex + 1);
    const sourceDocument = await PDFDocument.load(originalBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const mediaBox = sourceDocument.getPage(pageIndex).getMediaBox();
    const mediaWidth = Math.abs(mediaBox.width);
    const mediaHeight = Math.abs(mediaBox.height);
    const baseScale = getPreviewScale(mediaWidth * 2, mediaHeight * 2) * 2;
    const renderScale = Math.max(0.05, baseScale);

    const cropViewport = page.getViewport({ scale: renderScale, rotation: 0 });
    const cropCanvas = createCanvas(
      Math.max(1, Math.ceil(cropViewport.width)),
      Math.max(1, Math.ceil(cropViewport.height)),
    );
    const cropContext = cropCanvas.getContext('2d', { alpha: true });
    if (!cropContext) throw new AppError('canvasContextUnavailable');
    const renderTask = page.render({ canvasContext: cropContext, viewport: cropViewport });
    const abortRender = () => renderTask.cancel();
    signal?.addEventListener('abort', abortRender, { once: true });
    try {
      await renderTask.promise;
    } finally {
      signal?.removeEventListener('abort', abortRender);
    }
    throwIfAborted(signal);

    const mediaCanvas = createCanvas(
      Math.max(1, Math.ceil(mediaWidth * renderScale)),
      Math.max(1, Math.ceil(mediaHeight * renderScale)),
    );
    const mediaContext = mediaCanvas.getContext('2d', { alpha: true });
    if (!mediaContext) throw new AppError('canvasContextUnavailable');
    const [cropMinX, , , cropMaxY] = page.view;
    const mediaMaxY = mediaBox.y + mediaHeight;
    mediaContext.drawImage(
      cropCanvas,
      (cropMinX - mediaBox.x) * renderScale,
      (mediaMaxY - cropMaxY) * renderScale,
    );

    return {
      previewBlob: await canvasToBlob(mediaCanvas, 'image/png'),
      widthPx: Math.ceil(mediaWidth * renderScale),
      heightPx: Math.ceil(mediaHeight * renderScale),
      previewWidthPx: Math.ceil(mediaWidth * renderScale),
      previewHeightPx: Math.ceil(mediaHeight * renderScale),
      pageIndex,
      pageCount: documentProxy.numPages,
      vector: true,
      pdfPageRotation: ((page.rotate % 360) + 360) % 360,
      mediaBox: {
        x: mediaBox.x,
        y: mediaBox.y,
        width: mediaWidth,
        height: mediaHeight,
      },
    };
  } finally {
    signal?.removeEventListener('abort', abortLoading);
    if (documentProxy) await documentProxy.destroy().catch(() => {});
    else await loadingTask.destroy().catch(() => {});
  }
}

export async function processArtworkFile(file, {
  choosePage = async () => 0,
  signal,
} = {}) {
  throwIfAborted(signal);
  const { mimeType, extension } = await validateArtworkFile(file);
  const loaded = mimeType === 'application/pdf'
    ? await loadPdf(file, choosePage, signal)
    : await loadImage(file, signal);
  throwIfAborted(signal);
  const sourceHash = await sha256(file);
  throwIfAborted(signal);

  return {
    ...loaded,
    mimeType,
    extension,
    sha256: sourceHash,
  };
}

export const PREVIEW_LIMITS = Object.freeze({
  maxEdge: MAX_PREVIEW_EDGE,
  maxPixels: MAX_PREVIEW_PIXELS,
});
