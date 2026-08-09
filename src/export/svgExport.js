import { getDielineSegments } from '../model/dieline.js';

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

  const isStructural = model.construction?.templateId && model.construction.templateId !== 'legacy-six-panel';
  const elements = isStructural ? (model.getElements?.() || model.getPanels()) : model.getPanels();
  const panelMarkup = elements.map((panel) => {
    const fill = panel.faceKey === 'front'
      ? '#b7dcef'
      : panel.faceKey === 'bottom'
        ? '#efa6ec'
        : '#ffffff';
    const label = !Array.isArray(panel.polygon) && (panel.faceKey === 'front' || panel.faceKey === 'bottom')
      ? `<text x="${panel.x + panel.width / 2}" y="${panel.y + panel.height / 2}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle" fill="#101010">${panel.faceName}</text>`
      : '';
    const points = Array.isArray(panel.polygon) && panel.polygon.length >= 3
      ? panel.polygon.map(({ x: px, y: py }, index) => `${index ? 'L' : 'M'}${px} ${py}`).join('') + 'Z'
      : null;
    const shape = points
      ? `<path d="${points}" fill="${fill}" stroke="#101010" stroke-width="${strokeWidth}"/>`
      : `<rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" fill="${fill}" stroke="#101010" stroke-width="${strokeWidth}"/>`;
    return `<g><title>${panel.faceName}: ${formatNumber(panel.width)} × ${formatNumber(panel.height)} mm</title>${shape}${label}</g>`;
  }).join('');

  const dieline = isStructural
    ? (() => {
        const segments = getDielineSegments(model);
        const line = (segment) => `<line x1="${segment.start.x}" y1="${segment.start.y}" x2="${segment.end.x}" y2="${segment.end.y}"/>`;
        return `<g fill="none" stroke="#111" stroke-width="${strokeWidth}">${segments.cut.map(line).join('')}</g><g fill="none" stroke="#3157d5" stroke-width="${strokeWidth}" stroke-dasharray="2,1.5">${segments.fold.map(line).join('')}</g>`;
      })()
    : '';

  const disclaimer = isStructural
    ? '<text x="' + x + '" y="' + (y + height - padding / 2) + '" font-family="Arial, Helvetica, sans-serif" font-size="' + Math.max(3, fontSize / 2) + '" fill="#555">Structural mockup — production allowances not applied</text>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}mm" height="${height}mm">${panelMarkup}${dieline}${disclaimer}</svg>`;
}
