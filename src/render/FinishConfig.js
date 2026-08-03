const FINISH_ROLES = Object.freeze(['print', 'finish', 'print-and-finish']);
const FINISH_TYPES = Object.freeze(['spot-gloss', 'foil', 'emboss', 'deboss']);
const MASK_CHANNELS = Object.freeze(['auto', 'alpha', 'luminance']);

export const FINISH_OUTPUT_ROLES = FINISH_ROLES;
export const FINISH_TYPES_OPTIONS = FINISH_TYPES;
export const FINISH_MASK_CHANNELS = MASK_CHANNELS;

export const DEFAULT_FINISH_CONFIG = Object.freeze({
  type: 'spot-gloss',
  maskChannel: 'auto',
  invert: false,
  intensity: 1,
  foilColor: '#d4af37',
  foilRoughness: 0.22,
  reliefStrength: 0.35,
});

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeHex(value, fallback) {
  const hex = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : fallback;
}

export function sanitizeFinishConfig(value = null) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    type: FINISH_TYPES.includes(source.type) ? source.type : DEFAULT_FINISH_CONFIG.type,
    maskChannel: MASK_CHANNELS.includes(source.maskChannel) ? source.maskChannel : DEFAULT_FINISH_CONFIG.maskChannel,
    invert: source.invert === true,
    intensity: clamp(source.intensity, 0, 1, DEFAULT_FINISH_CONFIG.intensity),
    foilColor: normalizeHex(source.foilColor, DEFAULT_FINISH_CONFIG.foilColor),
    foilRoughness: clamp(source.foilRoughness, 0.04, 0.8, DEFAULT_FINISH_CONFIG.foilRoughness),
    reliefStrength: clamp(source.reliefStrength, 0.02, 1, DEFAULT_FINISH_CONFIG.reliefStrength),
  };
}

export function sanitizeArtworkFinish(entry = {}) {
  const sourceEntry = entry && typeof entry === 'object' ? entry : {};
  const role = FINISH_ROLES.includes(sourceEntry.outputRole) ? sourceEntry.outputRole : 'print';
  return {
    outputRole: role,
    finish: role === 'print' ? null : sanitizeFinishConfig(sourceEntry.finish),
  };
}

export function hasFinish(entry) {
  return Boolean(entry?.model?.hasArtwork && entry?.visible !== false && entry?.outputRole !== 'print');
}

export function isPrintArtwork(entry) {
  return entry?.outputRole !== 'finish';
}
