export const PREVIEW_TEXTURE_LIMITS = Object.freeze({
  maxEdge: 4096,
  maxPixels: 16_000_000,
  bleedPixels: 2,
});

function finitePositive(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function getTextureSize(bounds, artwork, limits = PREVIEW_TEXTURE_LIMITS) {
  const widthMm = finitePositive(bounds.width);
  const heightMm = finitePositive(bounds.height);
  const edgeScale = Math.min(limits.maxEdge / widthMm, limits.maxEdge / heightMm);
  const areaScale = Math.sqrt(limits.maxPixels / (widthMm * heightMm));
  const previewWidth = finitePositive(artwork?.source?.previewWidthPx);
  const previewHeight = finitePositive(artwork?.source?.previewHeightPx);
  const artworkWidth = finitePositive(artwork?.unrotatedWidthMm);
  const artworkHeight = finitePositive(artwork?.unrotatedHeightMm);
  const sourceScale = Math.min(previewWidth / artworkWidth, previewHeight / artworkHeight);
  const pixelsPerMm = Math.max(0.01, Math.min(edgeScale, areaScale, sourceScale));
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

export async function composeArtworkTexture({
  boxModel,
  artwork,
  previewBlob,
  documentRef = globalThis.document,
  createImageBitmapFn = globalThis.createImageBitmap,
  signal,
}) {
  if (!artwork?.hasArtwork || !previewBlob) {
    throw new Error('Artwork preview is required for the 3D texture.');
  }
  throwIfAborted(signal);

  const bounds = boxModel.getBounds();
  const panels = boxModel.getPanels();
  const { width, height, pixelsPerMm } = getTextureSize(bounds, artwork);
  const rawCanvas = createCanvas(width, height, documentRef);
  const rawContext = rawCanvas.getContext('2d', { alpha: true });
  const outputCanvas = createCanvas(width, height, documentRef);
  const outputContext = outputCanvas.getContext('2d', { alpha: true });
  let bitmap;

  try {
    bitmap = await createImageBitmapFn(previewBlob, { imageOrientation: 'from-image' });
    throwIfAborted(signal);

    rawContext.save();
    rawContext.scale(pixelsPerMm, pixelsPerMm);
    rawContext.translate(-bounds.minX, -bounds.minY);
    drawPanelUnion(rawContext, panels);
    rawContext.clip();
    rawContext.fillStyle = '#ffffff';
    rawContext.fillRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
    rawContext.globalAlpha = artwork.opacity;
    rawContext.translate(artwork.centerXmm, artwork.centerYmm);
    rawContext.rotate(artwork.rotation * Math.PI / 180);
    rawContext.drawImage(
      bitmap,
      -artwork.unrotatedWidthMm / 2,
      -artwork.unrotatedHeightMm / 2,
      artwork.unrotatedWidthMm,
      artwork.unrotatedHeightMm,
    );
    rawContext.restore();
    throwIfAborted(signal);

    drawPanelBleed(
      rawCanvas,
      outputContext,
      panels,
      bounds,
      pixelsPerMm,
      PREVIEW_TEXTURE_LIMITS.bleedPixels,
    );
    outputContext.drawImage(rawCanvas, 0, 0);
    return {
      canvas: outputCanvas,
      width,
      height,
      pixelsPerMm,
    };
  } finally {
    bitmap?.close?.();
  }
}
