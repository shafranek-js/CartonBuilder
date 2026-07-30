import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { sha256, validateArtworkFile } from './fileValidation.js';

const MAX_PREVIEW_EDGE = 4096;
const MAX_PREVIEW_PIXELS = 16_000_000;

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Artwork processing was cancelled.', 'AbortError');
}

function getPreviewScale(width, height) {
  return Math.min(
    1,
    MAX_PREVIEW_EDGE / Math.max(width, height),
    Math.sqrt(MAX_PREVIEW_PIXELS / (width * height)),
  );
}

async function canvasToBlob(canvas, type = 'image/png', quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create preview.'))), type, quality);
  });
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadImage(file, signal) {
  throwIfAborted(signal);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  throwIfAborted(signal);
  const scale = getPreviewScale(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: true });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  throwIfAborted(signal);

  return {
    previewBlob: await canvasToBlob(canvas, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92),
    widthPx: width / scale,
    heightPx: height / scale,
    previewWidthPx: width,
    previewHeightPx: height,
    pageIndex: null,
    pageCount: null,
    vector: false,
    rotation: 0,
  };
}

async function loadPdf(file, choosePage, signal) {
  throwIfAborted(signal);
  const pdfjs = await import('pdfjs-dist');
  const { PDFDocument } = await import('pdf-lib');
  throwIfAborted(signal);
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: originalBytes.slice() });
  const abortLoading = () => loadingTask.destroy();
  signal?.addEventListener('abort', abortLoading, { once: true });
  let documentProxy;
  try {
    documentProxy = await loadingTask.promise;
  } catch (error) {
    throwIfAborted(signal);
    if (error?.name === 'PasswordException') {
      throw new Error('Password-protected PDF files are not supported.');
    }
    throw new Error('The PDF file is damaged or cannot be opened.');
  }

  try {
    throwIfAborted(signal);
    const pageIndex = documentProxy.numPages > 1
      ? await choosePage(documentProxy.numPages)
      : 0;
    throwIfAborted(signal);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= documentProxy.numPages) {
      throw new Error('Choose a valid PDF page.');
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

    // PDF.js renders the effective CropBox. Place that render inside a
    // MediaBox-sized canvas so editor and print export share physical bounds.
    const cropViewport = page.getViewport({ scale: renderScale, rotation: 0 });
    const cropCanvas = createCanvas(
      Math.max(1, Math.ceil(cropViewport.width)),
      Math.max(1, Math.ceil(cropViewport.height)),
    );
    const cropContext = cropCanvas.getContext('2d', { alpha: true });
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
    const [cropMinX, cropMinY, cropMaxX, cropMaxY] = page.view;
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
    await documentProxy.destroy();
  }
}

export async function loadArtworkFile(file, {
  choosePage = async () => 0,
  signal,
} = {}) {
  throwIfAborted(signal);
  const { mimeType, extension } = await validateArtworkFile(file);
  const loaded = mimeType === 'application/pdf'
    ? await loadPdf(file, choosePage, signal)
    : await loadImage(file, signal);
  throwIfAborted(signal);

  return {
    originalBlob: file,
    previewBlob: loaded.previewBlob,
    source: {
      id: crypto.randomUUID(),
      fileName: file.name || `artwork.${extension}`,
      mimeType,
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
      sha256: await sha256(file),
    },
  };
}

export const PREVIEW_LIMITS = Object.freeze({
  maxEdge: MAX_PREVIEW_EDGE,
  maxPixels: MAX_PREVIEW_PIXELS,
});
