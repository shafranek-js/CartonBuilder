export function invertMatrix(matrix) {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

export function transformRect(rect, matrix) {
  const [a, b, c, d, e, f] = matrix;
  const x0 = rect.x0 ?? rect[0];
  const y0 = rect.y0 ?? rect[1];
  const x1 = rect.x1 ?? rect[2];
  const y1 = rect.y1 ?? rect[3];
  const px = (x, y) => a * x + c * y + e;
  const py = (x, y) => b * x + d * y + f;
  const xs = [px(x0, y0), px(x1, y0), px(x0, y1), px(x1, y1)];
  const ys = [py(x0, y0), py(x1, y0), py(x0, y1), py(x1, y1)];
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

export function snapRect(rect) {
  return {
    x0: Math.round(rect.x0),
    y0: Math.round(rect.y0),
    x1: Math.round(rect.x1),
    y1: Math.round(rect.y1),
  };
}

export function planTiles(bounds, tileEdge) {
  const width = bounds.x1 - bounds.x0;
  const height = bounds.y1 - bounds.y0;
  const cols = Math.max(1, Math.ceil(width / tileEdge));
  const rows = Math.max(1, Math.ceil(height / tileEdge));
  const tw = Math.ceil(width / cols);
  const th = Math.ceil(height / rows);
  const tiles = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      tiles.push({
        x0: bounds.x0 + c * tw,
        y0: bounds.y0 + r * th,
        x1: Math.min(bounds.x1, bounds.x0 + (c + 1) * tw),
        y1: Math.min(bounds.y1, bounds.y0 + (r + 1) * th),
      });
    }
  }
  return tiles;
}
