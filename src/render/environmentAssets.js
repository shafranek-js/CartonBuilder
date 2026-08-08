import { AppError } from '../errors.js';
import { sha256 } from '../artwork/fileValidation.js';

/**
 * Environment maps are intentionally kept separate from ordinary backplates.
 * They are linear-light, equirectangular assets and must never be decoded as
 * sRGB images.  The limits below are conservative so a malformed upload cannot
 * exhaust the WebGL texture budget before the loader gets a chance to reject it.
 */
// 4K equirectangular EXR files commonly exceed 80 MiB while still fitting
// inside the renderer's conservative GPU-memory budget. The 128 MiB cap
// leaves room for the bundled 4K HDR catalog and larger user maps.
export const MAX_RENDER_ENVIRONMENT_BYTES = 128 * 1024 * 1024;
export const MAX_RENDER_ENVIRONMENT_PIXELS = 4096 * 2048;
export const MAX_RENDER_ENVIRONMENT_ESTIMATED_BYTES = 256 * 1024 * 1024;
export const RENDER_ENVIRONMENT_TYPES = Object.freeze({
  'image/vnd.radiance': 'hdr',
  'image/x-hdr': 'hdr',
  'application/vnd.openexr': 'exr',
  'image/x-exr': 'exr',
  'application/octet-stream': 'hdr',
});

export const ENVIRONMENT_MAP_PRESETS = Object.freeze([
  Object.freeze({ id: 'neutral-softbox', label: 'Neutral Softbox', legacyPreset: 'studio', kind: 'procedural', source: 'built-in' }),
  Object.freeze({ id: 'high-key', label: 'High Key', legacyPreset: 'bright', kind: 'procedural', source: 'built-in' }),
  Object.freeze({ id: 'warm-studio', label: 'Warm Studio', legacyPreset: 'warm', kind: 'procedural', source: 'built-in' }),
  Object.freeze({ id: 'cool-studio', label: 'Cool Studio', legacyPreset: 'cool', kind: 'procedural', source: 'built-in' }),
  Object.freeze({ id: 'dark-studio', label: 'Dark Studio', legacyPreset: 'night', kind: 'procedural', source: 'built-in' }),
  Object.freeze({ id: 'no-reflections', label: 'No Reflections', legacyPreset: 'none', kind: 'procedural', source: 'built-in' }),
  Object.freeze({
    id: 'polyhaven-abandoned-hall-01',
    label: 'Abandoned Hall 01 · Poly Haven',
    legacyPreset: 'studio',
    kind: 'packaged',
    source: 'built-in',
    fileName: 'abandoned_hall_01_4k.hdr',
    assetUrl: '/render-environments/polyhaven/abandoned_hall_01_4k.hdr',
    mimeType: 'image/vnd.radiance',
    attribution: 'Poly Haven · CC0',
  }),
  Object.freeze({
    id: 'polyhaven-abandoned-waterworks',
    label: 'Abandoned Waterworks · Poly Haven',
    legacyPreset: 'studio',
    kind: 'packaged',
    source: 'built-in',
    fileName: 'abandoned_waterworks_4k.hdr',
    assetUrl: '/render-environments/polyhaven/abandoned_waterworks_4k.hdr',
    mimeType: 'image/vnd.radiance',
    attribution: 'Poly Haven · CC0',
  }),
  Object.freeze({
    id: 'polyhaven-empty-warehouse-01',
    label: 'Empty Warehouse 01 · Poly Haven',
    legacyPreset: 'studio',
    kind: 'packaged',
    source: 'built-in',
    fileName: 'empty_warehouse_01_4k.hdr',
    assetUrl: '/render-environments/polyhaven/empty_warehouse_01_4k.hdr',
    mimeType: 'image/vnd.radiance',
    attribution: 'Poly Haven · CC0',
  }),
  Object.freeze({
    id: 'polyhaven-abandoned-workshop',
    label: 'Abandoned Workshop · Poly Haven',
    legacyPreset: 'warm',
    kind: 'packaged',
    source: 'built-in',
    fileName: 'abandoned_workshop_4k.hdr',
    assetUrl: '/render-environments/polyhaven/abandoned_workshop_4k.hdr',
    mimeType: 'image/vnd.radiance',
    attribution: 'Poly Haven · CC0',
  }),
  Object.freeze({
    id: 'polyhaven-peppermint-powerplant',
    label: 'Peppermint Powerplant · Poly Haven',
    legacyPreset: 'warm',
    kind: 'packaged',
    source: 'built-in',
    fileName: 'peppermint_powerplant_4k.hdr',
    assetUrl: '/render-environments/polyhaven/peppermint_powerplant_4k.hdr',
    mimeType: 'image/vnd.radiance',
    attribution: 'Poly Haven · CC0',
  }),
]);

export const ENVIRONMENT_MAP_USAGES = Object.freeze(['lighting', 'background', 'both']);
export const ENVIRONMENT_MAP_RESOLUTIONS = Object.freeze([1024, 2048, 4096]);

export function getEnvironmentMapPreset(presetId) {
  return ENVIRONMENT_MAP_PRESETS.find((entry) => entry.id === presetId) || null;
}

function hasBytes(bytes, expected, offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function detectRenderEnvironmentType(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  const ascii = new TextDecoder().decode(bytes.slice(0, 128));
  if (ascii.startsWith('#?RADIANCE') || ascii.startsWith('#?RGBE')) return 'image/vnd.radiance';
  if (hasBytes(bytes, [0x76, 0x2f, 0x31, 0x01])) return 'application/vnd.openexr';
  return null;
}

function normalizeFileName(fileName, extension) {
  const base = String(fileName || 'environment')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 200) || 'environment';
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}

function inferMimeType(file, detectedType) {
  if (detectedType === 'image/vnd.radiance') return 'image/vnd.radiance';
  if (detectedType === 'application/vnd.openexr') return 'application/vnd.openexr';
  const declared = String(file?.type || '').toLowerCase();
  if (declared === 'image/x-hdr') return 'image/vnd.radiance';
  if (declared === 'image/x-exr') return 'application/vnd.openexr';
  return declared;
}

function parseRadianceDimensions(bytes) {
  const header = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 64 * 1024)));
  const match = header.match(/\n\s*[-+]Y\s+(\d+)\s+[-+]X\s+(\d+)/i);
  if (!match) return { width: 0, height: 0 };
  return { width: Number(match[2]) || 0, height: Number(match[1]) || 0 };
}

function normalizeDimensions(width, height) {
  const normalizedWidth = Math.max(0, Math.round(Number(width) || 0));
  const normalizedHeight = Math.max(0, Math.round(Number(height) || 0));
  if (normalizedWidth * normalizedHeight > MAX_RENDER_ENVIRONMENT_PIXELS) {
    throw new AppError('renderEnvironmentDimensionsTooLarge');
  }
  const estimatedBytes = normalizedWidth && normalizedHeight
    ? normalizedWidth * normalizedHeight * 16
    : 0;
  if (estimatedBytes > MAX_RENDER_ENVIRONMENT_ESTIMATED_BYTES) {
    throw new AppError('renderEnvironmentMemoryTooLarge');
  }
  return { width: normalizedWidth, height: normalizedHeight };
}

export async function validateRenderEnvironment(file) {
  if (!(file instanceof Blob)) throw new AppError('renderEnvironmentRequired');
  if (file.size === 0) throw new AppError('renderEnvironmentEmpty');
  if (file.size > MAX_RENDER_ENVIRONMENT_BYTES) throw new AppError('renderEnvironmentTooLarge');

  const header = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const detectedType = detectRenderEnvironmentType(header);
  if (!detectedType) throw new AppError('renderEnvironmentUnsupported');
  const mimeType = inferMimeType(file, detectedType);
  if (file.type && ![detectedType, mimeType, 'application/octet-stream', 'image/x-hdr', 'image/x-exr'].includes(file.type)) {
    throw new AppError('renderEnvironmentTypeMismatch');
  }
  const dimensions = detectedType === 'image/vnd.radiance'
    ? parseRadianceDimensions(header)
    : { width: 0, height: 0 };
  const normalizedDimensions = normalizeDimensions(dimensions.width, dimensions.height);
  const checksum = await sha256(file);
  const extension = detectedType === 'application/vnd.openexr' ? 'exr' : 'hdr';
  return {
    kind: 'environment',
    assetId: checksum,
    sha256: checksum,
    fileName: normalizeFileName(file.name, extension),
    mimeType,
    width: normalizedDimensions.width,
    height: normalizedDimensions.height,
    blob: new Blob([file], { type: mimeType }),
  };
}

export async function loadBuiltInEnvironmentAsset(presetId, fetchFn = globalThis.fetch) {
  const preset = getEnvironmentMapPreset(presetId);
  if (!preset?.assetUrl) return null;
  if (typeof fetchFn !== 'function') throw new AppError('renderEnvironmentInvalid');
  let response;
  try {
    response = await fetchFn(preset.assetUrl, { cache: 'force-cache' });
  } catch (error) {
    throw new AppError('renderEnvironmentInvalid', {}, { cause: error });
  }
  if (!response?.ok) throw new AppError('renderEnvironmentInvalid');
  const blob = await response.blob();
  Object.defineProperty(blob, 'name', { value: preset.fileName, configurable: true });
  const asset = await validateRenderEnvironment(blob);
  return {
    ...asset,
    source: 'builtin',
    presetId: preset.id,
    attribution: preset.attribution,
  };
}

export function normalizeRenderEnvironmentAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const mimeType = ['image/vnd.radiance', 'image/x-hdr', 'application/vnd.openexr', 'image/x-exr'].includes(asset.mimeType)
    ? asset.mimeType === 'image/x-hdr' ? 'image/vnd.radiance' : asset.mimeType === 'image/x-exr' ? 'application/vnd.openexr' : asset.mimeType
    : '';
  const assetId = String(asset.assetId || asset.sha256 || '').trim().slice(0, 128);
  if (!assetId || !mimeType || !(asset.blob instanceof Blob)) return null;
  return {
    kind: 'environment',
    assetId,
    sha256: String(asset.sha256 || asset.assetId || assetId),
    fileName: normalizeFileName(asset.fileName, mimeType === 'application/vnd.openexr' ? 'exr' : 'hdr'),
    mimeType,
    width: Math.max(0, Math.round(Number(asset.width) || 0)),
    height: Math.max(0, Math.round(Number(asset.height) || 0)),
    blob: new Blob([asset.blob], { type: mimeType }),
  };
}

export function sanitizeEnvironmentMap(input = null) {
  const source = input && typeof input === 'object' ? input : {};
  const presetId = typeof source.presetId === 'string' && ENVIRONMENT_MAP_PRESETS.some((entry) => entry.id === source.presetId)
    ? source.presetId
    : '';
  const assetId = typeof source.assetId === 'string' ? source.assetId.slice(0, 128) : '';
  return {
    source: ['none', 'builtin', 'custom'].includes(source.source)
      ? source.source
      : assetId ? 'custom' : presetId ? 'builtin' : 'builtin',
    presetId: presetId || 'neutral-softbox',
    assetId,
    usage: ENVIRONMENT_MAP_USAGES.includes(source.usage) ? source.usage : 'lighting',
    rotation: Math.min(360, Math.max(-360, Number.isFinite(Number(source.rotation)) ? Number(source.rotation) : 0)),
    intensity: Math.min(5, Math.max(0, Number.isFinite(Number(source.intensity)) ? Number(source.intensity) : 0.4)),
    backgroundIntensity: Math.min(5, Math.max(0, Number.isFinite(Number(source.backgroundIntensity)) ? Number(source.backgroundIntensity) : 1)),
    backgroundBlur: Math.min(1, Math.max(0, Number.isFinite(Number(source.backgroundBlur)) ? Number(source.backgroundBlur) : 0)),
    resolutionCap: ENVIRONMENT_MAP_RESOLUTIONS.includes(Number(source.resolutionCap)) ? Number(source.resolutionCap) : 2048,
  };
}
