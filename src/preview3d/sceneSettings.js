const STORAGE_KEY = 'cartonBuilder.preview3d';

export const SCENE_FIELDS = Object.freeze([
  'foldProgress',
  'cameraProjection',
  'cameraPreset',
  'cameraFov',
  'scenePreset',
  'environment',
  'environmentIntensity',
  'lightAzimuth',
  'lightElevation',
  'lightIntensity',
  'hemisphereIntensity',
  'shadowEnabled',
  'shadowMapSize',
  'shadowBlur',
  'shadowIntensity',
  'backgroundColor',
]);

const ENUMS = Object.freeze({
  cameraProjection: ['perspective', 'orthographic'],
  cameraPreset: ['isometric', 'front', 'top', 'right'],
  scenePreset: ['technical', 'studio', 'photorealistic'],
  environment: ['none', 'studio', 'neutral', 'warm', 'cool', 'bright', 'night'],
  shadowMapSize: [512, 1024, 2048],
});

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function sanitizeSceneSettings(parsed, defaults) {
  const result = { ...defaults };
  if (!parsed || typeof parsed !== 'object') return result;

  result.foldProgress = clampNumber(parsed.foldProgress, 0, 1, defaults.foldProgress);
  result.cameraProjection = pickEnum(parsed.cameraProjection, ENUMS.cameraProjection, defaults.cameraProjection);
  result.cameraPreset = pickEnum(parsed.cameraPreset, ENUMS.cameraPreset, defaults.cameraPreset);
  result.cameraFov = clampNumber(parsed.cameraFov, 10, 120, defaults.cameraFov);
  result.scenePreset = pickEnum(parsed.scenePreset, ENUMS.scenePreset, defaults.scenePreset);
  result.environment = pickEnum(parsed.environment, ENUMS.environment, defaults.environment);
  result.environmentIntensity = clampNumber(parsed.environmentIntensity, 0, 5, defaults.environmentIntensity);
  result.lightAzimuth = clampNumber(parsed.lightAzimuth, 0, 360, defaults.lightAzimuth);
  result.lightElevation = clampNumber(parsed.lightElevation, 5, 85, defaults.lightElevation);
  result.lightIntensity = clampNumber(parsed.lightIntensity, 0, 10, defaults.lightIntensity);
  result.hemisphereIntensity = clampNumber(parsed.hemisphereIntensity, 0, 5, defaults.hemisphereIntensity);
  result.shadowEnabled = parsed.shadowEnabled !== false;
  result.shadowMapSize = pickEnum(Number(parsed.shadowMapSize), ENUMS.shadowMapSize, defaults.shadowMapSize);
  result.shadowBlur = clampNumber(parsed.shadowBlur, 0, 8, defaults.shadowBlur);
  result.shadowIntensity = clampNumber(parsed.shadowIntensity, 0, 1, defaults.shadowIntensity);
  result.backgroundColor = isHexColor(parsed.backgroundColor) ? parsed.backgroundColor : defaults.backgroundColor;
  return result;
}

export function readSceneSettings(defaults, storage = globalThis.localStorage) {
  const result = { ...defaults };
  try {
    const raw = storage?.getItem?.(STORAGE_KEY);
    if (!raw) return result;
    return sanitizeSceneSettings(JSON.parse(raw), defaults);
  } catch {
    // Malformed settings are ignored; defaults are used.
  }
  return result;
}

export function writeSceneSettings(state, storage = globalThis.localStorage) {
  const payload = {};
  for (const key of SCENE_FIELDS) payload[key] = state[key];
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Settings simply won't persist when storage is unavailable.
  }
}

export function clearSceneSettings(storage = globalThis.localStorage) {
  try {
    storage?.removeItem?.(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
