import { getRenderOutputDimensions, sanitizeRenderSettings } from './RenderSettings.js';

export const TURNTABLE_FRAME_OPTIONS = Object.freeze([24, 36, 72]);
export const TURNTABLE_LONG_EDGE_OPTIONS = Object.freeze([512, 1024, 2048]);
export const TURNTABLE_FORMAT_OPTIONS = Object.freeze(['png', 'jpg']);
export const TURNTABLE_MAX_PIXELS = 160_000_000;

export function sanitizeTurntableOptions(options = {}) {
  const frames = TURNTABLE_FRAME_OPTIONS.includes(Number(options.frames))
    ? Number(options.frames)
    : 36;
  const longEdge = TURNTABLE_LONG_EDGE_OPTIONS.includes(Number(options.longEdge))
    ? Number(options.longEdge)
    : 1024;
  return {
    frames,
    longEdge,
    format: TURNTABLE_FORMAT_OPTIONS.includes(options.format) ? options.format : 'png',
  };
}

export function getTurntableDimensions(settings, longEdge) {
  const base = getRenderOutputDimensions(sanitizeRenderSettings(settings));
  const aspect = base.width / Math.max(1, base.height);
  const edge = Math.max(1, Number(longEdge) || 1024);
  return aspect >= 1
    ? { width: edge, height: Math.max(1, Math.round(edge / aspect)) }
    : { width: Math.max(1, Math.round(edge * aspect)), height: edge };
}

export function isTurntableWithinPixelBudget({ frames, width, height }, maxPixels = TURNTABLE_MAX_PIXELS) {
  return Number(frames) * Number(width) * Number(height) <= maxPixels;
}
