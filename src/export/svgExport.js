export function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function getExportFilename(dimensions) {
  const { width, height, depth } = dimensions;
  return `box-net-${formatNumber(width)}x${formatNumber(height)}x${formatNumber(depth)}mm.svg`;
}

export function createExportSvg(model) {
  const bounds = model.getBounds();
  const padding = Math.max(5, Math.max(bounds.width, bounds.height) * 0.03);
  const x = bounds.minX - padding;
  const y = bounds.minY - padding;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;
  const strokeWidth = Math.max(0.2, Math.max(bounds.width, bounds.height) / 900);
  const fontSize = Math.max(3, Math.max(bounds.width, bounds.height) / 32);

  const panelMarkup = model.getPanels().map((panel) => {
    const fill = panel.faceKey === 'front'
      ? '#b7dcef'
      : panel.faceKey === 'bottom'
        ? '#efa6ec'
        : '#ffffff';
    const label = panel.faceKey === 'front' || panel.faceKey === 'bottom'
      ? `<text x="${panel.x + panel.width / 2}" y="${panel.y + panel.height / 2}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle" fill="#101010">${panel.faceName}</text>`
      : '';

    return `<g><title>${panel.faceName}: ${formatNumber(panel.width)} × ${formatNumber(panel.height)} mm</title><rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" fill="${fill}" stroke="#101010" stroke-width="${strokeWidth}"/>${label}</g>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}mm" height="${height}mm">${panelMarkup}</svg>`;
}
