const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const DEFAULT_BOARD_APPEARANCE = Object.freeze({
  thicknessMm: 0.35,
  bevelRadiusMm: 0.12,
  interiorColor: '#f4f2ec',
  edgeColor: '#c8c1b5',
});

function finiteNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : fallback;
}

export function sanitizeBoardAppearance(input = null, panel = null) {
  const source = input && typeof input === 'object' ? input : {};
  const minimumDimension = Math.min(
    Number(panel?.width) || Infinity,
    Number(panel?.height) || Infinity,
  );
  const maxBevel = Number.isFinite(minimumDimension)
    ? Math.min(0.5, minimumDimension / 8)
    : 0.5;

  return {
    thicknessMm: finiteNumber(
      source.thicknessMm,
      DEFAULT_BOARD_APPEARANCE.thicknessMm,
      0.01,
      2,
    ),
    bevelRadiusMm: finiteNumber(
      source.bevelRadiusMm,
      DEFAULT_BOARD_APPEARANCE.bevelRadiusMm,
      0,
      maxBevel,
    ),
    interiorColor: safeColor(source.interiorColor, DEFAULT_BOARD_APPEARANCE.interiorColor),
    edgeColor: safeColor(source.edgeColor, DEFAULT_BOARD_APPEARANCE.edgeColor),
  };
}

export function cloneBoardAppearance(value = DEFAULT_BOARD_APPEARANCE) {
  return structuredClone(sanitizeBoardAppearance(value));
}

export function isBoardAppearance(value) {
  if (!value || typeof value !== 'object') return false;
  return JSON.stringify(sanitizeBoardAppearance(value)) === JSON.stringify(value);
}
