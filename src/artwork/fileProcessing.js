import { AppError } from '../errors.js';
import { sha256, validateArtworkFile } from './fileValidation.js';
import { loadPdfArtwork } from './pdfArtworkLoader.js';

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

export { flattenPdfLayers } from '../pdf-renderer/pdfLayers.js';

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
    video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0.001;pointer-events:none;';
    if (typeof document !== 'undefined' && document.body) {
      document.body.appendChild(video);
    }

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
        const context = canvas.getContext('2d', { alpha: false });
        if (context) {
          context.fillStyle = '#1e1e1e';
          context.fillRect(0, 0, previewWidth, previewHeight);
          context.drawImage(video, 0, 0, previewWidth, previewHeight);
        }

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

    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(() => {
        captureFrame();
      });
    }

    video.onloadeddata = () => {
      video.play().then(() => {
        setTimeout(() => {
          video.pause();
          captureFrame();
        }, 100);
      }).catch(() => {
        try {
          video.currentTime = 0.001;
        } catch {
          captureFrame();
        }
      });
    };

    video.onseeked = () => {
      setTimeout(captureFrame, 50);
    };

    video.oncanplay = () => {
      if (!settled && video.videoWidth > 0) {
        setTimeout(captureFrame, 50);
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

    video.load();

    timeoutId = setTimeout(() => {
      if (!settled) captureFrame();
    }, 2000);
  });
}

export async function processArtworkFile(file, {
  choosePage = async () => 0,
  signal,
  overprint = false,
} = {}) {
  throwIfAborted(signal);
  const { mimeType, extension } = await validateArtworkFile(file);
  const sourceHash = await sha256(file);
  throwIfAborted(signal);
  const loaded = mimeType === 'application/pdf'
    ? await loadPdfArtwork(file, { choosePage, signal })
    : (mimeType.startsWith('video/') || mimeType === 'image/gif')
      ? await loadVideo(file, signal)
      : await loadImage(file, signal);
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
