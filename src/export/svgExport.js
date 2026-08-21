import { contourPathData, getDielineSegments, getPanelContourSegments, segmentPathData } from '../model/dieline.js';
import { rasterizeArtwork } from '../artwork/artworkRasterizer.js';
import { buildProductionDieline } from '../prepress/productionDieline.js';
import { AppError } from '../errors.js';
import { createTechnicalSvgExport } from './technicalSvgExport.js';

const POINTS_PER_MM = 72 / 25.4;

export function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function getExportFilename(dimensions) {
  const { width, height, depth } = dimensions;
  return `box-net-${formatNumber(width)}x${formatNumber(height)}x${formatNumber(depth)}mm.svg`;
}

export function createExportSvg(model) {
  if (model?.mode === 'technical'
    || model?.construction?.templateId === 'technical-pbd'
    || model?.getCanonicalSemanticSvg?.()) {
    return createTechnicalSvgExport(model);
  }

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
    const contour = isStructural ? getPanelContourSegments(panel) : [];
    const points = Array.isArray(panel.polygon) && panel.polygon.length >= 3
      ? panel.polygon.map(({ x: px, y: py }, index) => `${index ? 'L' : 'M'}${px} ${py}`).join('') + 'Z'
      : null;
    const contourPath = contour.length ? contourPathData(contour) : points;
    const shape = contourPath
      ? `<path d="${contourPath}" fill="${fill}" stroke="#101010" stroke-width="${strokeWidth}"/>`
      : `<rect x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}" fill="${fill}" stroke="#101010" stroke-width="${strokeWidth}"/>`;
    return `<g><title>${panel.faceName}: ${formatNumber(panel.width)} × ${formatNumber(panel.height)} mm</title>${shape}${label}</g>`;
  }).join('');

  const dieline = isStructural
    ? (() => {
        const segments = getDielineSegments(model);
        const line = (segment) => segment.kind === 'ARC'
          ? `<path d="${segmentPathData(segment)}"/>`
          : `<line x1="${segment.start.x}" y1="${segment.start.y}" x2="${segment.end.x}" y2="${segment.end.y}"/>`;
        return `<g fill="none" stroke="#111" stroke-width="${strokeWidth}">${segments.cut.map(line).join('')}</g><g fill="none" stroke="#3157d5" stroke-width="${strokeWidth}" stroke-dasharray="2,1.5">${segments.fold.map(line).join('')}</g>`;
      })()
    : '';

  const disclaimer = isStructural
    ? '<text x="' + x + '" y="' + (y + height - padding / 2) + '" font-family="Arial, Helvetica, sans-serif" font-size="' + Math.max(3, fontSize / 2) + '" fill="#555">Structural mockup — production allowances not applied</text>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}mm" height="${height}mm">${panelMarkup}${dieline}${disclaimer}</svg>`;
}

function pathForPolygon(points) {
  return points.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x} ${y}`).join('') + 'Z';
}

function lineMarkup(segments) {
  return segments.map((segment) => segment.kind === 'ARC'
    ? `<path d="${segmentPathData(segment)}"/>`
    : `<line x1="${segment.start.x}" y1="${segment.start.y}" x2="${segment.end.x}" y2="${segment.end.y}"/>`).join('');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function blobToDataUri(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (typeof Buffer !== 'undefined') {
    return `data:${blob.type || 'image/png'};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

function artworkTransform(artwork) {
  const centerX = Number(artwork.centerXmm) || 0;
  const centerY = Number(artwork.centerYmm) || 0;
  const rotation = Number(artwork.rotation) || 0;
  const scaleX = artwork.flipX ? -1 : 1;
  const scaleY = artwork.flipY ? -1 : 1;
  return `translate(${centerX} ${centerY}) rotate(${rotation}) scale(${scaleX} ${scaleY}) translate(${-Number(artwork.centerXmm || 0)} ${-Number(artwork.centerYmm || 0)})`;
}

function artworkClipMarkup(artwork, id) {
  if (!artwork.crop) return '';
  const x = Number(artwork.centerXmm) - Number(artwork.unrotatedWidthMm) / 2 + Number(artwork.crop.x || 0);
  const y = Number(artwork.centerYmm) - Number(artwork.unrotatedHeightMm) / 2 + Number(artwork.crop.y || 0);
  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${Number(artwork.crop.width)}" height="${Number(artwork.crop.height)}" transform="${artworkTransform(artwork)}"/></clipPath>`;
}

async function createPrepressArtworkMarkup({ artworks, production, rasterize }) {
  const entries = (artworks || []).filter((entry) => (
    entry?.model?.hasArtwork
    && entry.visible !== false
    && entry.outputRole !== 'finish'
    && (entry.originalBlob || entry.previewBlob)
  ));
  const defs = [];
  const images = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const artwork = entry.model;
    const rendered = await rasterize({
      entry,
      purpose: 'prepress',
      targetDpi: production.settings.requiredDpi,
      requiredDpi: production.settings.requiredDpi,
    });
    const dataUri = await blobToDataUri(rendered.blob || entry.previewBlob || entry.originalBlob);
    const clipId = `ArtworkCrop${index}`;
    defs.push(artworkClipMarkup(artwork, clipId));
    const x = Number(artwork.centerXmm) - Number(artwork.unrotatedWidthMm) / 2;
    const y = Number(artwork.centerYmm) - Number(artwork.unrotatedHeightMm) / 2;
    images.push(`<image href="${dataUri}" x="${x}" y="${y}" width="${Number(artwork.unrotatedWidthMm)}" height="${Number(artwork.unrotatedHeightMm)}" opacity="${Number(artwork.opacity ?? 1)}" preserveAspectRatio="none" transform="${artworkTransform(artwork)}"${artwork.crop ? ` clip-path="url(#${clipId})"` : ''}/>`);
  }
  return { defs: defs.filter(Boolean).join(''), images: images.join('') };
}

/** Production-assist SVG with named, independently toggleable proof groups. */
export async function createPrepressSvg({ boxModel, artworks = [], settings = null, rasterize = rasterizeArtwork }) {
  if (boxModel?.mode === 'technical') throw new AppError('technicalPrepressUnavailable');
  const production = buildProductionDieline(boxModel, settings);
  if (!production.diagnostics.valid) throw new Error('Prepress geometry is invalid.');
  const { mediaBounds: bounds, settings: prepress } = production;
  const stroke = prepress.technicalLines.strokePt / POINTS_PER_MM;
  const artwork = await createPrepressArtworkMarkup({ artworks, production, rasterize });
  const bleed = production.bleedPolygons.map((polygon) => `<path d="${pathForPolygon(polygon)}"/>`).join('');
  const safe = production.safePolygons.map((polygon) => `<path d="${pathForPolygon(polygon)}"/>`).join('');
  const marks = prepress.marks.crop || prepress.marks.registration
    ? `<g data-mark-type="crop-registration"><path d="M${bounds.minX} ${bounds.minY + prepress.slugMm / 2}h${prepress.slugMm / 2}M${bounds.minX + prepress.slugMm / 2} ${bounds.minY}v${prepress.slugMm / 2}M${bounds.maxX} ${bounds.minY + prepress.slugMm / 2}h-${prepress.slugMm / 2}M${bounds.maxX - prepress.slugMm / 2} ${bounds.minY}v${prepress.slugMm / 2}"/></g>`
    : '';
  const slug = prepress.marks.slug
    ? `<text x="${bounds.minX + prepress.slugMm / 2}" y="${bounds.maxY - prepress.slugMm / 3}" font-size="3">CartonBuilder · ${production.diagnostics.templateId} · preflight ${production.diagnostics.valid ? 'pass' : 'blocked'}</text>`
    : '';
  const width = bounds.width;
  const height = bounds.height;
  const bleedClip = production.bleedPolygons.map((polygon) => `<path d="${pathForPolygon(polygon)}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" data-prepress-mode="${prepress.mode}" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}" width="${width}mm" height="${height}mm">
<defs><clipPath id="PrepressBleedClip">${bleedClip}</clipPath>${artwork.defs}</defs>
<g id="Artwork" clip-path="url(#PrepressBleedClip)">${artwork.images}</g>
<g id="Bleed" fill="none" stroke="#f2a900" stroke-width="${stroke}" visibility="hidden">${bleed}</g>
<g id="Safe" fill="none" stroke="#00a878" stroke-width="${stroke}" stroke-dasharray="2,1" visibility="hidden">${safe}</g>
<g id="CutContour" fill="none" stroke="#d00000" stroke-width="${stroke}" data-spot="${prepress.technicalLines.cutSpotName}" style="vector-effect:non-scaling-stroke">${lineMarkup(production.cut)}</g>
<g id="Crease" fill="none" stroke="#185adb" stroke-width="${stroke}" stroke-dasharray="2,1" data-spot="${prepress.technicalLines.creaseSpotName}">${lineMarkup(production.fold)}</g>
<g id="Marks" fill="none" stroke="#111" stroke-width="${stroke}">${marks}</g>
<g id="Slug" fill="#111" font-family="Arial, sans-serif">${slug}</g>
</svg>`;
}

export function getPrepressExportFilename(dimensions) {
  const { width, height, depth } = dimensions;
  return `box-net-${formatNumber(width)}x${formatNumber(height)}x${formatNumber(depth)}mm-prepress.svg`;
}
