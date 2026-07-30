export const EDGES = Object.freeze(['top', 'right', 'bottom', 'left']);

export const OPPOSITE_EDGE = Object.freeze({
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
});

export const FACE_BY_NORMAL = Object.freeze({
  '0,0,1': Object.freeze({ key: 'front', name: 'Front Panel' }),
  '0,0,-1': Object.freeze({ key: 'back', name: 'Back Panel' }),
  '0,1,0': Object.freeze({ key: 'top', name: 'Top Panel' }),
  '0,-1,0': Object.freeze({ key: 'bottom', name: 'Base Panel' }),
  '-1,0,0': Object.freeze({ key: 'left', name: 'Left Panel' }),
  '1,0,0': Object.freeze({ key: 'right', name: 'Right Panel' }),
});

export function vectorKey(vector) {
  return vector.join(',');
}

export function negate(vector) {
  return vector.map((value) => (value === 0 ? 0 : -value));
}

export function cloneVector(vector) {
  return vector.slice();
}

export function getAxisDimension(vector, dimensions) {
  if (Math.abs(vector[0]) === 1) return dimensions.width;
  if (Math.abs(vector[1]) === 1) return dimensions.height;
  if (Math.abs(vector[2]) === 1) return dimensions.depth;
  throw new Error(`Invalid axis vector: ${vectorKey(vector)}`);
}

export function getAdjacentBasis(panel, edge) {
  const { normal, up, right } = panel.basis;

  switch (edge) {
    case 'top':
      return {
        normal: cloneVector(up),
        up: negate(normal),
        right: cloneVector(right),
      };
    case 'bottom':
      return {
        normal: negate(up),
        up: cloneVector(normal),
        right: cloneVector(right),
      };
    case 'right':
      return {
        normal: cloneVector(right),
        up: cloneVector(up),
        right: negate(normal),
      };
    case 'left':
      return {
        normal: negate(right),
        up: cloneVector(up),
        right: cloneVector(normal),
      };
    default:
      throw new Error(`Unknown edge: ${edge}`);
  }
}

export function getPlacedRectangle(panel, edge, width, height) {
  switch (edge) {
    case 'top':
      return { x: panel.x, y: panel.y - height, width, height };
    case 'right':
      return { x: panel.x + panel.width, y: panel.y, width, height };
    case 'bottom':
      return { x: panel.x, y: panel.y + panel.height, width, height };
    case 'left':
      return { x: panel.x - width, y: panel.y, width, height };
    default:
      throw new Error(`Unknown edge: ${edge}`);
  }
}

export function rectanglesOverlap(a, b, epsilon = 1e-7) {
  return (
    a.x < b.x + b.width - epsilon
    && a.x + a.width > b.x + epsilon
    && a.y < b.y + b.height - epsilon
    && a.y + a.height > b.y + epsilon
  );
}

export function normalizeDimensions(dimensions) {
  const result = {
    width: Number(dimensions.width),
    height: Number(dimensions.height),
    depth: Number(dimensions.depth),
  };

  for (const [name, value] of Object.entries(result)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number.`);
    }
    if (value > 100000) {
      throw new Error(`${name} is too large.`);
    }
  }

  return result;
}
