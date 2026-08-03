import { rasterizeArtwork } from '../artwork/artworkRasterizer.js';

export const PREVIEW_TEXTURE_LIMITS = Object.freeze({
  maxEdge: 4096,
  maxPixels: 16_000_000,
  bleedPixels: 2,
});

export const HTML_TEXTURE_LIMITS = Object.freeze({
  maxEdge: 8192,
  maxPixels: 24_000_000,
  bleedPixels: 4,
});

function finitePositive(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function getTextureSize(
  bounds,
  artworks,
  limits = PREVIEW_TEXTURE_LIMITS,
  { targetDpi = null, useNativeSourceResolution = false } = {},
) {
  const widthMm = finitePositive(bounds.width);
  const heightMm = finitePositive(bounds.height);
  const edgeScale = Math.min(limits.maxEdge / widthMm, limits.maxEdge / heightMm);
  const areaScale = Math.sqrt(limits.maxPixels / (widthMm * heightMm));
  let sourceScale = Infinity;
  for (const entry of artworks || []) {
    const artwork = entry?.model || entry;
    if (!artwork?.hasArtwork) continue;
    const previewWidth = finitePositive(artwork?.source?.previewWidthPx);
    const previewHeight = finitePositive(artwork?.source?.previewHeightPx);
    const sourceWidth = useNativeSourceResolution
      ? finitePositive(artwork?.source?.widthPx, previewWidth)
      : previewWidth;
    const sourceHeight = useNativeSourceResolution
      ? finitePositive(artwork?.source?.heightPx, previewHeight)
      : previewHeight;
    const artworkWidth = finitePositive(artwork?.unrotatedWidthMm);
    const artworkHeight = finitePositive(artwork?.unrotatedHeightMm);
    const isVector = artwork?.source?.vector || artwork?.source?.mimeType === 'application/pdf';
    if (useNativeSourceResolution && isVector) continue;
    sourceScale = Math.min(
      sourceScale,
      Math.min(sourceWidth / artworkWidth, sourceHeight / artworkHeight),
    );
  }
  if (!Number.isFinite(sourceScale)) sourceScale = Infinity;
  const requestedScale = Number(targetDpi) > 0
    ? Math.min(Number(targetDpi) / 25.4, useNativeSourceResolution ? sourceScale : Infinity)
    : sourceScale;
  const pixelsPerMm = Math.max(0.01, Math.min(edgeScale, areaScale, requestedScale));
  const width = Math.max(1, Math.floor(widthMm * pixelsPerMm));
  const height = Math.max(1, Math.floor(heightMm * pixelsPerMm));
  return { width, height, pixelsPerMm };
}

function createCanvas(width, height, documentRef) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = documentRef.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Texture composition aborted.', 'AbortError');
}

function drawPanelUnion(context, panels) {
  context.beginPath();
  for (const panel of panels) {
    context.rect(panel.x, panel.y, panel.width, panel.height);
  }
}

function drawPanelBleed(source, target, panels, bounds, pixelsPerMm, bleedPixels) {
  for (const panel of panels) {
    const sourceX = Math.max(0, Math.floor((panel.x - bounds.minX) * pixelsPerMm));
    const sourceY = Math.max(0, Math.floor((panel.y - bounds.minY) * pixelsPerMm));
    const sourceWidth = Math.max(1, Math.ceil(panel.width * pixelsPerMm));
    const sourceHeight = Math.max(1, Math.ceil(panel.height * pixelsPerMm));
    target.drawImage(
      source,
      sourceX,
      sourceY,
      Math.min(sourceWidth, source.width - sourceX),
      Math.min(sourceHeight, source.height - sourceY),
      sourceX - bleedPixels,
      sourceY - bleedPixels,
      sourceWidth + bleedPixels * 2,
      sourceHeight + bleedPixels * 2,
    );
  }
}

function drawArtwork(context, entry, bitmap) {
  const artwork = entry.model;
  context.save();
  context.globalAlpha = artwork.opacity;
  context.translate(artwork.centerXmm, artwork.centerYmm);
  context.rotate(artwork.rotation * Math.PI / 180);
  if (artwork.crop && artwork.crop.width > 0 && artwork.crop.height > 0) {
    context.beginPath();
    context.rect(
      -artwork.unrotatedWidthMm / 2 + (artwork.crop.x || 0),
      -artwork.unrotatedHeightMm / 2 + (artwork.crop.y || 0),
      artwork.crop.width,
      artwork.crop.height,
    );
    context.clip();
  }
  context.drawImage(
    bitmap,
    -artwork.unrotatedWidthMm / 2,
    -artwork.unrotatedHeightMm / 2,
    artwork.unrotatedWidthMm,
    artwork.unrotatedHeightMm,
  );
  context.restore();
}

export async function composeArtworkTexture({
  boxModel,
  artworks,
  documentRef = globalThis.document,
  createImageBitmapFn = globalThis.createImageBitmap,
  purpose = 'preview',
  targetDpi = null,
  textureLimits = PREVIEW_TEXTURE_LIMITS,
  useNativeSourceResolution = false,
  getEntryTargetDpi = null,
  rasterize = rasterizeArtwork,
  signal,
}) {
  const entries = (artworks || [])
    .filter((entry) => (
      entry?.model?.hasArtwork
      && entry.visible !== false
      && (entry.previewBlob || entry.originalBlob)
    ));
  if (!entries.length) {
    throw new Error('At least one artwork with a preview is required for the 3D texture.');
  }
  throwIfAborted(signal);

  const bounds = boxModel.getBounds();
  const panels = boxModel.getPanels();
  const { width, height, pixelsPerMm } = getTextureSize(
    bounds,
    entries,
    textureLimits,
    { targetDpi, useNativeSourceResolution },
  );
  const rawCanvas = createCanvas(width, height, documentRef);
  const rawContext = rawCanvas.getContext('2d', { alpha: true });
  const outputCanvas = createCanvas(width, height, documentRef);
  const outputContext = outputCanvas.getContext('2d', { alpha: true });
  const bitmaps = [];

  try {
    for (const entry of entries) {
      let renderBlob = entry.renderBlob || entry.previewBlob || entry.originalBlob;
      if (rasterize && (entry.originalBlob || entry.model?.source?.vector) && !entry.renderBlob) {
        const requestedEntryTargetDpi = typeof getEntryTargetDpi === 'function'
          ? getEntryTargetDpi(entry, pixelsPerMm * 25.4)
          : pixelsPerMm * 25.4;
        // The interactive texture cannot preserve detail beyond its own pixel
        // density. Rasterizing a large PDF above that density only creates
        // several oversized intermediate canvases and can exhaust the browser's
        // graphics memory while changing Render artwork quality.
        const entryTargetDpi = purpose === 'preview' || purpose === 'render-screen'
          ? Math.min(
            finitePositive(requestedEntryTargetDpi, pixelsPerMm * 25.4),
            pixelsPerMm * 25.4,
          )
          : requestedEntryTargetDpi;
        const rendered = await rasterize({
          entry,
          purpose,
          targetDpi: entryTargetDpi,
          requiredDpi: entryTargetDpi,
          documentRef,
          signal,
        });
        renderBlob = rendered.blob;
      }
      const bitmap = await createImageBitmapFn(renderBlob, { imageOrientation: 'from-image' });
      bitmaps.push(bitmap);
    }
    throwIfAborted(signal);

    rawContext.save();
    rawContext.scale(pixelsPerMm, pixelsPerMm);
    rawContext.translate(-bounds.minX, -bounds.minY);
    drawPanelUnion(rawContext, panels);
    rawContext.clip();
    rawContext.fillStyle = '#ffffff';
    rawContext.fillRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
    for (let index = 0; index < entries.length; index += 1) {
      drawArtwork(rawContext, entries[index], bitmaps[index]);
    }
    rawContext.restore();
    throwIfAborted(signal);

    drawPanelBleed(
      rawCanvas,
      outputContext,
      panels,
      bounds,
      pixelsPerMm,
      textureLimits.bleedPixels,
    );
    outputContext.drawImage(rawCanvas, 0, 0);
    return {
      canvas: outputCanvas,
      width,
      height,
      pixelsPerMm,
      dpi: pixelsPerMm * 25.4,
    };
  } finally {
    for (const bitmap of bitmaps) bitmap?.close?.();
  }
}
