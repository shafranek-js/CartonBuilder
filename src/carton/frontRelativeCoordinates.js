const FRONT_SURFACE_ID = 'body.front';

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function isFiniteBounds(bounds) {
  return [
    bounds?.minX,
    bounds?.minY,
    bounds?.maxX,
    bounds?.maxY,
    bounds?.width,
    bounds?.height,
  ].every((value) => Number.isFinite(value))
    && bounds.maxX >= bounds.minX
    && bounds.maxY >= bounds.minY
    && bounds.width >= 0
    && bounds.height >= 0;
}

/**
 * Convert an artwork reference point from the global displayed SVG plane to
 * the read-only top-left frame of the semantic technical front surface.
 */
export function computeFrontRelativeCoordinates(referencePosition, frame) {
  if (frame?.surfaceId !== FRONT_SURFACE_ID || frame.units !== 'mm') return null;
  if (!isFinitePoint(referencePosition) || !isFinitePoint(frame.origin)) return null;
  if (!isFiniteBounds(frame.bounds)) return null;

  const x = referencePosition.x - frame.origin.x;
  const y = referencePosition.y - frame.origin.y;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, units: 'mm' } : null;
}

export { FRONT_SURFACE_ID };
