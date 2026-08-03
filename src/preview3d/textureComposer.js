import { rasterizeArtwork } from '../artwork/artworkRasterizer.js';
import { sanitizeArtworkFinish } from '../render/FinishConfig.js';

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

function drawArtwork(context, entry, bitmap, { includeOpacity = true } = {}) {
  const artwork = entry.model;
  context.save();
  context.globalAlpha = includeOpacity ? artwork.opacity : 1;
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

function isPrintEntry(entry) {
  return entry?.outputRole !== 'finish';
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex) {
  const value = String(hex || '#d4af37').slice(1);
  return [
    Number.parseInt(value.slice(0, 2), 16) || 0,
    Number.parseInt(value.slice(2, 4), 16) || 0,
    Number.parseInt(value.slice(4, 6), 16) || 0,
  ];
}

function baseRoughnessForProfile(profile) {
  return profile === 'uncoated' ? 0.94 : profile === 'matte' ? 0.82 : profile === 'gloss' ? 0.46 : 0.86;
}

function drawTransformedArtwork(context, entry, bitmap, bounds, pixelsPerMm, panels, { includeOpacity = false } = {}) {
  context.save();
  context.scale(pixelsPerMm, pixelsPerMm);
  context.translate(-bounds.minX, -bounds.minY);
  drawPanelUnion(context, panels);
  context.clip();
  drawArtwork(context, entry, bitmap, { includeOpacity });
  context.restore();
}

function readMaskPixels({ entry, bitmap, width, height, bounds, pixelsPerMm, panels, documentRef }) {
  const canvas = createCanvas(width, height, documentRef);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context?.getImageData) return null;
  context.clearRect?.(0, 0, width, height);
  drawTransformedArtwork(context, entry, bitmap, bounds, pixelsPerMm, panels);
  const image = context.getImageData(0, 0, width, height).data;
  const { maskChannel, invert } = sanitizeArtworkFinish(entry).finish;
  const values = new Uint8Array(width * height);
  for (let index = 0, pixel = 0; index < image.length; index += 4, pixel += 1) {
    const alpha = image[index + 3] / 255;
    const luminance = (image[index] * 0.2126 + image[index + 1] * 0.7152 + image[index + 2] * 0.0722) / 255;
    const useAlpha = maskChannel === 'alpha' || (maskChannel === 'auto' && alpha < 0.999);
    const value = useAlpha ? alpha : luminance * alpha;
    // Inversion applies inside the artwork mask only. Transparent pixels are
    // outside the supplied finish layer and must stay zero, otherwise an
    // inverted mask would coat the entire dieline/background.
    const normalized = alpha <= 0 ? 0 : invert ? 1 - value : value;
    values[pixel] = clampByte(normalized * 255);
  }
  canvas.width = 1;
  canvas.height = 1;
  return values;
}

function writeMapCanvas(values, width, height, documentRef, panels, bounds, pixelsPerMm, bleedPixels, channels = 1) {
  const rawCanvas = createCanvas(width, height, documentRef);
  const rawContext = rawCanvas.getContext('2d', { alpha: false });
  if (!rawContext?.putImageData) return rawCanvas;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = values[index];
    const offset = index * 4;
    if (channels === 3) {
      data[offset] = value[0];
      data[offset + 1] = value[1];
      data[offset + 2] = value[2];
    } else {
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
    data[offset + 3] = 255;
  }
  const imageData = rawContext.createImageData
    ? rawContext.createImageData(width, height)
    : typeof ImageData === 'function' ? new ImageData(data, width, height) : null;
  if (!imageData) return rawCanvas;
  imageData.data.set(data);
  rawContext.putImageData(imageData, 0, 0);
  const outputCanvas = createCanvas(width, height, documentRef);
  const outputContext = outputCanvas.getContext('2d', { alpha: false });
  drawPanelBleed(rawCanvas, outputContext, panels, bounds, pixelsPerMm, bleedPixels);
  outputContext.drawImage(rawCanvas, 0, 0);
  return outputCanvas;
}

async function composeFinishMaps({
  entries,
  bitmaps,
  width,
  height,
  bounds,
  pixelsPerMm,
  panels,
  documentRef,
  textureLimits,
  materialProfile,
  signal,
}) {
  const hasFinishes = entries.some((entry) => entry.outputRole !== 'print' && entry.finish);
  if (!hasFinishes) return null;
  const pixelCount = width * height;
  const clearcoat = new Uint8Array(pixelCount);
  const clearcoatRoughness = new Uint8Array(pixelCount).fill(255);
  const metalness = new Uint8Array(pixelCount);
  const roughness = new Uint8Array(pixelCount).fill(clampByte(baseRoughnessForProfile(materialProfile) * 255));
  const heightField = new Float32Array(pixelCount);
  const foilColors = new Array(pixelCount).fill(null);
  const maskEntries = entries.map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.outputRole !== 'print' && entry.finish);

  for (const { entry, index } of maskEntries) {
    throwIfAborted(signal);
    const finish = sanitizeArtworkFinish(entry).finish;
    const mask = readMaskPixels({ entry, bitmap: bitmaps[index], width, height, bounds, pixelsPerMm, panels, documentRef });
    if (!mask) continue;
    const intensity = Number(finish.intensity) || 0;
    const foilRgb = hexToRgb(finish.foilColor);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const value = clampByte(mask[pixel] * intensity);
      if (!value) continue;
      if (finish.type === 'spot-gloss') {
        clearcoat[pixel] = Math.max(clearcoat[pixel], value);
        clearcoatRoughness[pixel] = Math.min(clearcoatRoughness[pixel], clampByte(finish.foilRoughness * 255));
      } else if (finish.type === 'foil') {
        metalness[pixel] = Math.max(metalness[pixel], value);
        roughness[pixel] = Math.min(roughness[pixel], clampByte(finish.foilRoughness * 255));
        foilColors[pixel] = [...foilRgb, value];
      } else {
        const sign = finish.type === 'deboss' ? -1 : 1;
        heightField[pixel] += sign * (value / 255) * finish.reliefStrength;
      }
    }
  }

  const normal = new Array(pixelCount);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const left = heightField[y * width + Math.max(0, x - 1)];
      const right = heightField[y * width + Math.min(width - 1, x + 1)];
      const up = heightField[Math.max(0, y - 1) * width + x];
      const down = heightField[Math.min(height - 1, y + 1) * width + x];
      normal[pixel] = [
        clampByte(128 + (left - right) * 255),
        clampByte(128 + (up - down) * 255),
        255,
      ];
    }
  }
  return {
    clearcoat: writeMapCanvas(clearcoat, width, height, documentRef, panels, bounds, pixelsPerMm, textureLimits.bleedPixels),
    clearcoatRoughness: writeMapCanvas(clearcoatRoughness, width, height, documentRef, panels, bounds, pixelsPerMm, textureLimits.bleedPixels),
    metalness: writeMapCanvas(metalness, width, height, documentRef, panels, bounds, pixelsPerMm, textureLimits.bleedPixels),
    roughness: writeMapCanvas(roughness, width, height, documentRef, panels, bounds, pixelsPerMm, textureLimits.bleedPixels),
    normal: writeMapCanvas(normal, width, height, documentRef, panels, bounds, pixelsPerMm, textureLimits.bleedPixels, 3),
    foilColors,
  };
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
  includeFinishMaps = false,
  materialProfile = 'matte',
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
      if (isPrintEntry(entries[index])) drawArtwork(rawContext, entries[index], bitmaps[index]);
    }
    rawContext.restore();
    throwIfAborted(signal);

    const materialMaps = includeFinishMaps
      ? await composeFinishMaps({
        entries,
        bitmaps,
        width,
        height,
        bounds,
        pixelsPerMm,
        panels,
        documentRef,
        textureLimits,
        materialProfile,
        signal,
      })
      : null;

    if (materialMaps?.foilColors && rawContext.getImageData && rawContext.putImageData) {
      const base = rawContext.getImageData(0, 0, width, height);
      for (let pixel = 0; pixel < materialMaps.foilColors.length; pixel += 1) {
        const foil = materialMaps.foilColors[pixel];
        if (!foil) continue;
        const offset = pixel * 4;
        const alpha = foil[3] / 255;
        base.data[offset] = clampByte(base.data[offset] * (1 - alpha) + foil[0] * alpha);
        base.data[offset + 1] = clampByte(base.data[offset + 1] * (1 - alpha) + foil[1] * alpha);
        base.data[offset + 2] = clampByte(base.data[offset + 2] * (1 - alpha) + foil[2] * alpha);
      }
      rawContext.putImageData(base, 0, 0);
    }

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
      materialMaps,
    };
  } finally {
    for (const bitmap of bitmaps) bitmap?.close?.();
  }
}
