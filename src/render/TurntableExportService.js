import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';

import { cameraPositionFromHeading } from './cameraState.js';
import { sanitizeRenderSettings } from './RenderSettings.js';
import { renderStill } from './StillRenderService.js';
export {
  getTurntableDimensions,
  isTurntableWithinPixelBudget,
  sanitizeTurntableOptions,
  TURNTABLE_FRAME_OPTIONS,
  TURNTABLE_LONG_EDGE_OPTIONS,
  TURNTABLE_FORMAT_OPTIONS,
  TURNTABLE_MAX_PIXELS,
} from './turntableOptions.js';
import {
  getTurntableDimensions,
  isTurntableWithinPixelBudget,
  sanitizeTurntableOptions,
} from './turntableOptions.js';

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException('Turntable export aborted.', 'AbortError');
}

function frameFileName(index, format) {
  return `frame-${String(index + 1).padStart(3, '0')}.${format}`;
}

function currentCameraState(renderer) {
  const camera = renderer?.getCameraState?.();
  if (!camera) throw new Error('A live Render camera is required for turntable export.');
  return structuredClone(camera);
}

/**
 * Renders a full heading rotation into a streamed ZIP. The live camera is
 * restored even when encoding or downloading is cancelled.
 */
export async function exportTurntable({
  renderer,
  settings,
  options = {},
  documentRef = globalThis.document,
  signal,
  onProgress = () => {},
  renderStillFn = renderStill,
} = {}) {
  if (!renderer) throw new Error('A live Render renderer is required for turntable export.');
  const normalizedSettings = sanitizeRenderSettings(settings);
  const normalized = sanitizeTurntableOptions({
    ...normalizedSettings.output.sequence,
    ...options,
  });
  const dimensions = getTurntableDimensions(normalizedSettings, normalized.longEdge);
  if (!isTurntableWithinPixelBudget({ ...normalized, ...dimensions })) {
    throw new Error('Turntable export is too large for this browser. Reduce frames or resolution.');
  }
  assertNotAborted(signal);
  const originalCamera = currentCameraState(renderer);
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  let closed = false;
  try {
    for (let index = 0; index < normalized.frames; index += 1) {
      assertNotAborted(signal);
      const angle = (360 * index) / normalized.frames;
      const heading = Number(originalCamera.heading || 0) + angle;
      renderer.setCameraState?.({
        ...originalCamera,
        preset: 'custom',
        heading,
        position: cameraPositionFromHeading({
          heading,
          elevation: originalCamera.elevation,
          distance: originalCamera.cameraDistance,
          target: originalCamera.target,
        }),
      });
      const blob = await renderStillFn({
        renderer,
        settings: normalizedSettings,
        format: normalized.format,
        width: dimensions.width,
        height: dimensions.height,
        documentRef,
        signal,
      });
      assertNotAborted(signal);
      await zip.add(frameFileName(index, normalized.format), new BlobReader(blob));
      onProgress((index + 1) / normalized.frames);
    }
    const result = await zip.close();
    closed = true;
    return result;
  } finally {
    renderer.setCameraState?.(originalCamera);
    if (!closed) {
      try {
        await zip.close();
      } catch {
        // Abort/error cleanup is best effort; no partial Blob is published.
      }
    }
  }
}
