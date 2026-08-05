import { renderPdfWithLayers } from './fileLoader.js';

export const ARTWORK_QUALITY_DPI = Object.freeze([150, 300, 600, 1200, 2400]);
export const ARTWORK_INTERACTIVE_QUALITY_DPI = Object.freeze([150, 300, 600]);
export const ARTWORK_RASTER_LIMITS = Object.freeze({
  maxEdge: 8192,
  maxPixels: 24_000_000,
});

function finitePositive(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createCanvas(width, height, documentRef = globalThis.document) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = documentRef?.createElement?.('canvas');
  if (!canvas) throw new Error('A canvas context is required to rasterize artwork.');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type = 'image/png') {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode rasterized artwork.'));
    }, type);
  });
}

function getRequiredDpi({ targetDpi, targetWidthMm, fallback = 300 } = {}) {
  const dpi = Number(targetDpi);
  return Number.isFinite(dpi) && dpi > 0 ? dpi : fallback;
}

export function resolveArtworkDpi(quality, {
  purpose = 'preview',
  requiredDpi = 300,
} = {}) {
  const numeric = Number(quality);
  const interactive = purpose === 'preview' || purpose === 'render-screen';
  if (Number.isFinite(numeric) && numeric > 0) {
    return interactive ? Math.min(numeric, 600) : numeric;
  }
  const required = Math.max(1, Number(requiredDpi) || 300);
  if (purpose === 'raster-export' || purpose === 'render-export') return required;
  const tier = ARTWORK_INTERACTIVE_QUALITY_DPI.find((value) => value >= required);
  return tier || ARTWORK_INTERACTIVE_QUALITY_DPI[ARTWORK_INTERACTIVE_QUALITY_DPI.length - 1];
}

export function getRasterDimensions({ widthMm, heightMm, dpi, nativeWidth, nativeHeight } = {}) {
  const targetWidth = Math.max(1, Math.ceil(finitePositive(widthMm) / 25.4 * finitePositive(dpi)));
  const targetHeight = Math.max(1, Math.ceil(finitePositive(heightMm) / 25.4 * finitePositive(dpi)));
  const width = Number.isFinite(Number(nativeWidth)) && Number(nativeWidth) > 0
    ? Math.min(targetWidth, Math.floor(Number(nativeWidth)))
    : targetWidth;
  const height = Number.isFinite(Number(nativeHeight)) && Number(nativeHeight) > 0
    ? Math.min(targetHeight, Math.floor(Number(nativeHeight)))
    : targetHeight;
  const scale = Math.min(
    1,
    ARTWORK_RASTER_LIMITS.maxEdge / width,
    ARTWORK_RASTER_LIMITS.maxEdge / height,
    Math.sqrt(ARTWORK_RASTER_LIMITS.maxPixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    limited: scale < 1 || width < targetWidth || height < targetHeight,
  };
}

function getSafeDpi(widthMm, heightMm, requestedDpi) {
  const dimensions = getRasterDimensions({ widthMm, heightMm, dpi: requestedDpi });
  const widthDpi = dimensions.width / (finitePositive(widthMm) / 25.4);
  const heightDpi = dimensions.height / (finitePositive(heightMm) / 25.4);
  return {
    dpi: Math.max(1, Math.min(requestedDpi, widthDpi, heightDpi)),
    limited: dimensions.limited,
  };
}

async function rasterizeImageBlob(blob, {
  widthMm,
  heightMm,
  dpi,
  signal,
  createImageBitmapFn = globalThis.createImageBitmap,
  documentRef = globalThis.document,
} = {}) {
  if (signal?.aborted) throw new DOMException('Artwork rasterization aborted.', 'AbortError');
  if (typeof createImageBitmapFn !== 'function') {
    return { blob, width: null, height: null, actualDpi: null, limited: false };
  }
  let bitmap;
  try {
    bitmap = await createImageBitmapFn(blob, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmapFn(blob);
  }
  try {
    if (signal?.aborted) throw new DOMException('Artwork rasterization aborted.', 'AbortError');
    const dimensions = getRasterDimensions({
      widthMm,
      heightMm,
      dpi,
      nativeWidth: bitmap.width,
      nativeHeight: bitmap.height,
    });
    const canvas = createCanvas(dimensions.width, dimensions.height, documentRef);
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('A 2D context is required to rasterize artwork.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const output = await canvasToBlob(canvas, 'image/png');
    const actualDpi = Math.min(
      dimensions.width / (finitePositive(widthMm) / 25.4),
      dimensions.height / (finitePositive(heightMm) / 25.4),
    );
    return {
      blob: output,
      width: dimensions.width,
      height: dimensions.height,
      actualDpi,
      limited: dimensions.limited,
    };
  } finally {
    bitmap.close?.();
  }
}

export async function rasterizeArtwork({
  entry,
  purpose = 'preview',
  requiredDpi = 300,
  targetDpi = null,
  signal,
  documentRef = globalThis.document,
  createImageBitmapFn = globalThis.createImageBitmap,
  renderPdf = renderPdfWithLayers,
} = {}) {
  const artwork = entry?.model || entry;
  if (!artwork?.hasArtwork || !artwork.source) throw new Error('Artwork source is required.');
  const widthMm = finitePositive(artwork.unrotatedWidthMm);
  const heightMm = finitePositive(artwork.unrotatedHeightMm);
  const dpi = getRequiredDpi({
    targetDpi: targetDpi || resolveArtworkDpi(artwork.quality?.[purpose === 'preview' ? 'preview' : 'render'], {
      purpose,
      requiredDpi,
    }),
    targetWidthMm: widthMm,
  });
  const safeRequest = getSafeDpi(widthMm, heightMm, dpi);
  const safeDpi = safeRequest.dpi;

  if ((artwork.source.vector || artwork.source.mimeType === 'application/pdf') && entry.originalBlob) {
    const rendered = await renderPdf(entry.originalBlob, {
      pageIndex: artwork.source.pageIndex || 0,
      visibility: artwork.pdfLayerVisibility,
      dpi: safeDpi,
      targetWidthMm: widthMm,
      signal,
    });
    return {
      blob: rendered.previewBlob,
      width: rendered.previewWidthPx,
      height: rendered.previewHeightPx,
      limited: safeRequest.limited,
      sourceKind: 'vector',
      requestedDpi: dpi,
      actualDpi: Math.min(
        rendered.previewWidthPx / (widthMm / 25.4),
        rendered.previewHeightPx / (heightMm / 25.4),
      ),
    };
  }

  const isVideo = Boolean(artwork.source?.isVideo || artwork.source?.mimeType?.startsWith('video/'));
  const sourceBlob = (isVideo ? entry.previewBlob : entry.originalBlob) || entry.previewBlob || entry.originalBlob;
  if (!sourceBlob) throw new Error('Artwork raster source is required.');
  const rendered = await rasterizeImageBlob(sourceBlob, {
    widthMm,
    heightMm,
    dpi: safeDpi,
    signal,
    createImageBitmapFn,
    documentRef,
  });
  return {
    ...rendered,
    sourceKind: 'raster',
    requestedDpi: dpi,
  };
}

export function getArtworkRasterSignature(entry, purpose = 'preview') {
  const artwork = entry?.model || entry;
  const source = artwork?.source || {};
  const quality = artwork?.quality?.[purpose === 'preview' ? 'preview' : 'render'] || 'auto';
  return JSON.stringify({
    id: source.id || '',
    sha256: source.sha256 || '',
    pageIndex: source.pageIndex || 0,
    visibility: artwork?.pdfLayerVisibility || null,
    widthMm: artwork?.unrotatedWidthMm || 0,
    heightMm: artwork?.unrotatedHeightMm || 0,
    quality,
    purpose,
  });
}
