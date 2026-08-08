export const DEFAULT_BOARD_CONSTRUCTION = Object.freeze({
  caliperMm: 0.35,
});

const MIN_CALIPER_MM = 0.01;
const MAX_CALIPER_MM = 2;

function finiteNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function minimumDimension(source) {
  const dimensions = source?.dimensions || source;
  const values = [dimensions?.width, dimensions?.height, dimensions?.depth]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.min(...values) : Infinity;
}

export function getMaxBoardCaliperMm(source) {
  const dimensionLimit = minimumDimension(source);
  return Math.min(MAX_CALIPER_MM, Number.isFinite(dimensionLimit)
    ? Math.max(MIN_CALIPER_MM, dimensionLimit / 4)
    : MAX_CALIPER_MM);
}

export function sanitizeBoardConstruction(input = null, dimensions = null) {
  const source = input && typeof input === 'object' ? input : {};
  const maxCaliper = getMaxBoardCaliperMm(dimensions);
  return {
    caliperMm: finiteNumber(
      source.caliperMm,
      Math.min(DEFAULT_BOARD_CONSTRUCTION.caliperMm, maxCaliper),
      MIN_CALIPER_MM,
      maxCaliper,
    ),
  };
}

export function cloneBoardConstruction(value = DEFAULT_BOARD_CONSTRUCTION, dimensions = null) {
  return structuredClone(sanitizeBoardConstruction(value, dimensions));
}

export const BOARD_CALIPER_LIMITS = Object.freeze({
  min: MIN_CALIPER_MM,
  max: MAX_CALIPER_MM,
});
