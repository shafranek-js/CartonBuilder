const IDENTITY_PRESENTATION_TRANSFORM = Object.freeze({ a: 1, b: 0, c: 0, d: 1 });

function discreteEntry(value) {
  const number = Number(value);
  const rounded = Math.round(number);
  return Number.isFinite(number) && Math.abs(number - rounded) < 1e-9 && Math.abs(rounded) <= 1
    ? rounded
    : null;
}

export function normalizePresentationTransform(value) {
  const source = value && typeof value === 'object' ? value : IDENTITY_PRESENTATION_TRANSFORM;
  const a = discreteEntry(source.a);
  const b = discreteEntry(source.b);
  const c = discreteEntry(source.c);
  const d = discreteEntry(source.d);
  if ([a, b, c, d].some((entry) => entry === null)) return { ...IDENTITY_PRESENTATION_TRANSFORM };
  const determinant = a * d - b * c;
  const orthogonal = a * a + b * b === 1 && c * c + d * d === 1 && a * c + b * d === 0;
  return Math.abs(determinant) === 1 && orthogonal
    ? { a, b, c, d }
    : { ...IDENTITY_PRESENTATION_TRANSFORM };
}

export function presentationTransformFromSvg(svgMarkup) {
  const serialized = String(svgMarkup || '')
    .match(/<svg\b[^>]*\bdata-presentation-transform="([^"]+)"/i)?.[1];
  const values = String(serialized || '1,0,0,1').split(',').map(Number);
  return normalizePresentationTransform(values.length === 4
    ? { a: values[0], b: values[1], c: values[2], d: values[3] }
    : IDENTITY_PRESENTATION_TRANSFORM);
}

function boundsOf(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Reproduce the pbd.svg.v4 presentation projection for CartonBuilder's
 * model-derived artwork geometry. The PBD model stays Cartesian/Y-up; the
 * returned points are in the exact Y-down presentation plane used by its SVG.
 */
export function createTechnicalPresentationProjection({ bounds, input, transform: value }) {
  const transform = normalizePresentationTransform(value);
  const width = Number(bounds?.width) || Number(bounds?.maxX) - Number(bounds?.minX);
  const height = Number(bounds?.height) || Number(bounds?.maxY) - Number(bounds?.minY);
  const minX = Number(bounds?.minX) || 0;
  const minY = Number(bounds?.minY) || 0;
  const maxX = Number.isFinite(Number(bounds?.maxX)) ? Number(bounds.maxX) : minX + width;
  const maxY = Number.isFinite(Number(bounds?.maxY)) ? Number(bounds.maxY) : minY + height;
  const inputWidth = Number(input?.width);
  const inputHeight = Number(input?.height);
  const marginBase = Math.min(inputWidth, inputHeight);
  const margin = Math.max(8, Number.isFinite(marginBase) ? marginBase * 0.12 : 8);
  const canvasMinX = minX - margin;
  const canvasWidth = width + margin * 2;
  const canvasHeight = height + margin * 2;
  const canvasMaxY = maxY + margin;
  const center = { x: canvasMinX + canvasWidth / 2, y: canvasHeight / 2 };
  const determinant = transform.a * transform.d - transform.b * transform.c;

  const projectPoint = (point) => {
    const screenX = Number(point?.x);
    const screenY = canvasMaxY - Number(point?.y);
    const x = screenX - center.x;
    const y = screenY - center.y;
    return {
      x: center.x + transform.a * x + transform.c * y,
      y: center.y + transform.b * x + transform.d * y,
    };
  };

  const geometryCorners = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map(projectPoint);

  return {
    transform,
    determinant,
    projectPoint,
    geometryBounds: boundsOf(geometryCorners),
    transformClockwise: (clockwise) => (determinant < 0 ? Boolean(clockwise) : !Boolean(clockwise)),
  };
}
