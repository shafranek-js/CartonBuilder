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

export function flattenPdfLayers(order, getGroup) {
  const layers = [];
  function walk(items, prefix) {
    for (const item of items) {
      if (typeof item === 'string') {
        const group = getGroup?.(item) || null;
        layers.push({
          id: item,
          name: group?.name || `Layer ${item}`,
          group: prefix || null,
        });
      } else if (item && Array.isArray(item.order)) {
        const name = item.name || 'Group';
        walk(item.order, prefix ? `${prefix} / ${name}` : name);
      }
    }
  }
  walk(order || [], '');
  return layers;
}

async function openPdf(file, signal) {
  throwIfAborted(signal);
  const pdfjs = await import('pdfjs-dist');
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
    documentProxy = await loadingTask.promise;
  } catch (error) {
    signal?.removeEventListener('abort', abortLoading);
    throwIfAborted(signal);
    if (error?.name === 'PasswordException') {
      throw new AppError('pdfPasswordProtected');
    }
    throw new AppError('pdfDamaged', {}, { cause: error });
  }
  return {
    documentProxy,
    originalBytes,
    dispose() {
      signal?.removeEventListener('abort', abortLoading);
      if (documentProxy) documentProxy.destroy().catch(() => {});
      else loadingTask.destroy().catch(() => {});
    },
  };
}

async function renderPdfPageToBlob({
  page,
  pageIndex,
  originalBytes,
  optionalContentConfig,
  signal,
  dpi = null,
  targetWidthMm = null,
}) {
  throwIfAborted(signal);
  const { PDFDocument } = await import('pdf-lib');
  throwIfAborted(signal);
  const sourceDocument = await PDFDocument.load(originalBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const mediaBox = sourceDocument.getPage(pageIndex).getMediaBox();
  const mediaWidth = Math.abs(mediaBox.width);
  const mediaHeight = Math.abs(mediaBox.height);
  const baseScale = getPreviewScale(mediaWidth * 2, mediaHeight * 2) * 2;
  const requestedWidthPx = Number(dpi) > 0 && Number(targetWidthMm) > 0
    ? (Number(targetWidthMm) / 25.4) * Number(dpi)
    : Number(dpi) > 0
      ? (mediaWidth / 72) * Number(dpi)
      : null;
  const renderScale = Math.max(
    0.05,
    requestedWidthPx ? requestedWidthPx / mediaWidth : baseScale,
  );

  const cropViewport = page.getViewport({ scale: renderScale, rotation: 0 });
  const cropCanvas = createCanvas(
    Math.max(1, Math.ceil(cropViewport.width)),
    Math.max(1, Math.ceil(cropViewport.height)),
  );
  const cropContext = cropCanvas.getContext('2d', { alpha: true });
  if (!cropContext) throw new AppError('canvasContextUnavailable');
  const renderTask = page.render({
    canvasContext: cropContext,
    viewport: cropViewport,
    optionalContentConfigPromise: Promise.resolve(optionalContentConfig),
  });
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
    pdfPageRotation: ((page.rotate % 360) + 360) % 360,
    mediaBox: {
      x: mediaBox.x,
      y: mediaBox.y,
      width: mediaWidth,
      height: mediaHeight,
    },
  };
}

async function loadPdf(file, choosePage, signal) {
  throwIfAborted(signal);
  const pdf = await openPdf(file, signal);
  try {
    const { documentProxy, originalBytes } = pdf;
    throwIfAborted(signal);
    const pageIndex = documentProxy.numPages > 1
      ? await choosePage(documentProxy.numPages)
      : 0;
    throwIfAborted(signal);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= documentProxy.numPages) {
      throw new AppError('pdfPageInvalid');
    }

    const page = await documentProxy.getPage(pageIndex + 1);
    const optionalContentConfig = await documentProxy.getOptionalContentConfig();
    const pdfLayers = optionalContentConfig
      ? flattenPdfLayers(optionalContentConfig.getOrder(), (id) => optionalContentConfig.getGroup(id))
      : [];
    const pdfLayerVisibility = {};
    for (const layer of pdfLayers) {
      pdfLayerVisibility[layer.id] = optionalContentConfig.getGroup(layer.id)?.visible ?? true;
    }

    const rendered = await renderPdfPageToBlob({
      page,
      pageIndex,
      originalBytes,
      optionalContentConfig,
      signal,
    });

    return {
      ...rendered,
      pageIndex,
      pageCount: documentProxy.numPages,
      vector: true,
      pdfLayers,
      pdfLayerVisibility,
    };
  } finally {
    await pdf.dispose();
  }
}

export async function renderPdfPreview(file, {
  pageIndex = 0,
  visibility = null,
  dpi = null,
  targetWidthMm = null,
  signal,
} = {}) {
  throwIfAborted(signal);
  const pdf = await openPdf(file, signal);
  try {
    const { documentProxy, originalBytes } = pdf;
    throwIfAborted(signal);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= documentProxy.numPages) {
      throw new AppError('pdfPageInvalid');
    }
    const page = await documentProxy.getPage(pageIndex + 1);
    const optionalContentConfig = await documentProxy.getOptionalContentConfig();
    if (optionalContentConfig && visibility) {
      for (const id of Object.keys(visibility)) {
        optionalContentConfig.setVisibility(id, Boolean(visibility[id]));
      }
    }
    const rendered = await renderPdfPageToBlob({
      page,
      pageIndex,
      originalBytes,
      optionalContentConfig,
      signal,
      dpi,
      targetWidthMm,
    });
    return {
      previewBlob: rendered.previewBlob,
      previewWidthPx: rendered.previewWidthPx,
      previewHeightPx: rendered.previewHeightPx,
      widthPx: rendered.widthPx,
      heightPx: rendered.heightPx,
    };
  } finally {
    await pdf.dispose();
  }
}

const MINIMAL_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function createMinimalPngBlob() {
  return new Blob([MINIMAL_PNG_BYTES], { type: 'image/png' });
}

async function loadVideo(file, signal) {
  throwIfAborted(signal);
  if (typeof document === 'undefined') {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = getPreviewScale(bitmap.width, bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d', { alpha: true });
      if (context) context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      return {
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
        isVideo: true,
      };
    } catch {
      return {
        previewBlob: createMinimalPngBlob(),
        widthPx: 1280,
        heightPx: 720,
        previewWidthPx: 1280,
        previewHeightPx: 720,
        pageIndex: null,
        pageCount: null,
        vector: false,
        pdfPageRotation: 0,
        mediaBox: null,
        isVideo: true,
      };
    }
  }

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let settled = false;
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      video.remove();
    };

    const captureFrame = async () => {
      if (settled) return;
      settled = true;
      try {
        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        const scale = getPreviewScale(width, height);
        const previewWidth = Math.max(1, Math.round(width * scale));
        const previewHeight = Math.max(1, Math.round(height * scale));

        const canvas = createCanvas(previewWidth, previewHeight);
        const context = canvas.getContext('2d', { alpha: true });
        if (context) context.drawImage(video, 0, 0, previewWidth, previewHeight);

        let previewBlob = await canvasToBlob(canvas, 'image/png');
        if (!previewBlob || previewBlob.size === 0) {
          previewBlob = createMinimalPngBlob();
        }
        cleanup();
        resolve({
          previewBlob,
          widthPx: width,
          heightPx: height,
          previewWidthPx: previewWidth,
          previewHeightPx: previewHeight,
          pageIndex: null,
          pageCount: null,
          vector: false,
          pdfPageRotation: 0,
          mediaBox: null,
          isVideo: true,
        });
      } catch {
        cleanup();
        resolve({
          previewBlob: createMinimalPngBlob(),
          widthPx: 1280,
          heightPx: 720,
          previewWidthPx: 1280,
          previewHeightPx: 720,
          pageIndex: null,
          pageCount: null,
          vector: false,
          pdfPageRotation: 0,
          mediaBox: null,
          isVideo: true,
        });
      }
    };

    video.onseeked = captureFrame;
    video.onloadeddata = () => {
      try {
        video.currentTime = 0.01;
      } catch {
        captureFrame();
      }
    };
    video.onerror = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({
          previewBlob: createMinimalPngBlob(),
          widthPx: 1280,
          heightPx: 720,
          previewWidthPx: 1280,
          previewHeightPx: 720,
          pageIndex: null,
          pageCount: null,
          vector: false,
          pdfPageRotation: 0,
          mediaBox: null,
          isVideo: true,
        });
      }
    };

    timeoutId = setTimeout(() => {
      if (!settled) captureFrame();
    }, 1500);
  });
}

export async function processArtworkFile(file, {
  choosePage = async () => 0,
  signal,
} = {}) {
  throwIfAborted(signal);
  const { mimeType, extension } = await validateArtworkFile(file);
  const loaded = mimeType === 'application/pdf'
    ? await loadPdf(file, choosePage, signal)
    : (mimeType.startsWith('video/') || mimeType === 'image/gif')
      ? await loadVideo(file, signal)
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
