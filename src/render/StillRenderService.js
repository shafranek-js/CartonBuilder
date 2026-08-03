import { getRenderOutputDimensions, sanitizeRenderSettings } from './RenderSettings.js';

function createCanvas(width, height, documentRef) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = documentRef.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode render image.'));
    }, type, quality);
  });
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException('Render export aborted.', 'AbortError');
}

function copyFlippedPixels(pixels, width, height, context) {
  const imageData = context.createImageData(width, height);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = (height - 1 - y) * rowBytes;
    const targetOffset = y * rowBytes;
    imageData.data.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), targetOffset);
  }
  context.putImageData(imageData, 0, 0);
}

export async function renderStill({
  renderer,
  settings,
  format = 'png',
  width: requestedWidth,
  height: requestedHeight,
  documentRef = globalThis.document,
  signal,
}) {
  const renderSettings = sanitizeRenderSettings(settings);
  const calculatedDimensions = getRenderOutputDimensions(renderSettings);
  const dimensions = Number.isFinite(Number(requestedWidth)) && Number.isFinite(Number(requestedHeight))
    ? { width: Math.max(1, Math.floor(Number(requestedWidth))), height: Math.max(1, Math.floor(Number(requestedHeight))) }
    : calculatedDimensions;
  const normalizedFormat = format === 'jpeg' || format === 'jpg' ? 'jpeg' : 'png';
  const mimeType = normalizedFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  assertNotAborted(signal);

  const diagnostics = renderer?.getDiagnostics?.() || {};
  const maxDimension = Math.min(
    Number.isFinite(diagnostics.maxTextureSize) ? diagnostics.maxTextureSize : Infinity,
    Number.isFinite(diagnostics.maxRenderbufferSize) ? diagnostics.maxRenderbufferSize : Infinity,
  );
  if (Math.max(dimensions.width, dimensions.height) > maxDimension) {
    throw new Error(
      `Render target ${dimensions.width}×${dimensions.height} exceeds this device's `
      + `GPU limit (${maxDimension}px). Choose 2048 or a smaller frame.`,
    );
  }

  const result = await renderer.renderToPixels({
    width: dimensions.width,
    height: dimensions.height,
    backgroundMode: normalizedFormat === 'jpeg' ? 'solid' : renderSettings.background.mode,
    backgroundColor: renderSettings.background.color,
    includeShadow: renderSettings.shadows.enabled
      && (renderSettings.background.mode !== 'transparent'
        || renderSettings.shadows.includeInTransparentExport),
    includeReflection: renderSettings.floor.reflection.enabled
      && (renderSettings.background.mode !== 'transparent'
        || renderSettings.floor.reflection.includeInTransparentExport),
    signal,
  });
  assertNotAborted(signal);

  const pixelCanvas = createCanvas(result.width, result.height, documentRef);
  const pixelContext = pixelCanvas.getContext('2d', { alpha: true });
  copyFlippedPixels(result.pixels, result.width, result.height, pixelContext);

  const outputCanvas = createCanvas(result.width, result.height, documentRef);
  const outputContext = outputCanvas.getContext('2d', { alpha: normalizedFormat === 'png' });
  if (normalizedFormat === 'jpeg') {
    outputContext.fillStyle = renderSettings.background.color;
    outputContext.fillRect(0, 0, result.width, result.height);
  }
  outputContext.drawImage(pixelCanvas, 0, 0);
  return canvasToBlob(
    outputCanvas,
    mimeType,
    normalizedFormat === 'jpeg' ? renderSettings.output.jpegQuality : undefined,
  );
}
