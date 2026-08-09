import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  clip,
  degrees,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setDashPattern,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from 'pdf-lib';

import { AppError } from '../errors.js';
import { getDielineSegments } from '../model/dieline.js';
import { rasterizeArtwork, resolveArtworkDpi } from '../artwork/artworkRasterizer.js';

const POINTS_PER_MM = 72 / 25.4;
const EXPORT_DPI = 300;
const MAX_RASTER_EDGE = 32767;
const MAX_RASTER_PIXELS = 64_000_000;

function panelPoints(panel) {
  return Array.isArray(panel.polygon) && panel.polygon.length >= 3
    ? panel.polygon
    : [
        { x: panel.x, y: panel.y },
        { x: panel.x + panel.width, y: panel.y },
        { x: panel.x + panel.width, y: panel.y + panel.height },
        { x: panel.x, y: panel.y + panel.height },
      ];
}

function tracePanelPath(context, panel) {
  const points = panelPoints(panel);
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (
      blob ? resolve(blob) : reject(new AppError('previewCreateFailed'))
    ), type, quality);
  });
}

export async function createPreviewBlob({
  boxModel,
  artworks,
  type = 'image/png',
  dpi = EXPORT_DPI,
  showDieline = true,
  rasterize = rasterizeArtwork,
}) {
  const entries = (artworks || [])
    .filter((entry) => entry?.model?.hasArtwork && (entry.visible !== false) && (entry.previewBlob || entry.originalBlob));
  if (!entries.length) throw new AppError('artworkRequired');
  const bounds = boxModel.getBounds();
  const pixelsPerMm = dpi / 25.4;
  const width = Math.max(1, Math.round(bounds.width * pixelsPerMm));
  const height = Math.max(1, Math.round(bounds.height * pixelsPerMm));
  if (
    width > MAX_RASTER_EDGE
    || height > MAX_RASTER_EDGE
    || width * height > MAX_RASTER_PIXELS
  ) {
    throw new AppError('rasterExportTooLarge');
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: type === 'image/png' });

  if (type === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }

  context.save();
  context.scale(pixelsPerMm, pixelsPerMm);
  context.translate(-bounds.minX, -bounds.minY);
  context.beginPath();
  for (const panel of boxModel.getElements?.() || boxModel.getPanels()) tracePanelPath(context, panel);
  context.clip();

  const bitmaps = [];
  try {
    for (const entry of entries) {
      const targetDpi = resolveArtworkDpi(entry.model.quality?.render, {
        purpose: 'raster-export',
        requiredDpi: dpi,
      });
      const rendered = await rasterize({
        entry,
        purpose: 'raster-export',
        targetDpi,
        requiredDpi: dpi,
      });
      const renderBlob = rendered.blob || entry.originalBlob || entry.previewBlob;
      const bitmap = await createImageBitmap(renderBlob, { imageOrientation: 'from-image' });
      bitmaps.push(bitmap);
      context.save();
      context.globalAlpha = entry.model.opacity;
      context.translate(entry.model.centerXmm, entry.model.centerYmm);
      context.rotate(entry.model.rotation * Math.PI / 180);
      context.scale(entry.model.flipX ? -1 : 1, entry.model.flipY ? -1 : 1);
      if (entry.model.crop) {
        context.beginPath();
        context.rect(
          -entry.model.unrotatedWidthMm / 2 + entry.model.crop.x,
          -entry.model.unrotatedHeightMm / 2 + entry.model.crop.y,
          entry.model.crop.width,
          entry.model.crop.height,
        );
        context.clip();
      }
      context.drawImage(
        bitmap,
        -entry.model.unrotatedWidthMm / 2,
        -entry.model.unrotatedHeightMm / 2,
        entry.model.unrotatedWidthMm,
        entry.model.unrotatedHeightMm,
      );
      context.restore();
    }
  } finally {
    for (const bitmap of bitmaps) bitmap?.close?.();
  }
  context.restore();

  if (showDieline) {
    const { cut, fold } = getDielineSegments(boxModel);
    context.save();
    context.scale(pixelsPerMm, pixelsPerMm);
    context.translate(-bounds.minX, -bounds.minY);
    context.lineWidth = 0.25;
    context.strokeStyle = '#111111';
    context.beginPath();
    for (const segment of cut) {
      context.moveTo(segment.start.x, segment.start.y);
      context.lineTo(segment.end.x, segment.end.y);
    }
    context.stroke();
    context.strokeStyle = '#3157d5';
    context.setLineDash([2, 1.5]);
    context.beginPath();
    for (const segment of fold) {
      context.moveTo(segment.start.x, segment.start.y);
      context.lineTo(segment.end.x, segment.end.y);
    }
    context.stroke();
    context.restore();
  }

  return canvasToBlob(canvas, type, type === 'image/jpeg' ? 0.94 : undefined);
}

function addPanelClip(page, boxModel, bounds) {
  page.pushOperators(pushGraphicsState());
  for (const panel of boxModel.getElements?.() || boxModel.getPanels()) {
    const points = panelPoints(panel);
    page.pushOperators(moveTo(
      (points[0].x - bounds.minX) * POINTS_PER_MM,
      (bounds.maxY - points[0].y) * POINTS_PER_MM,
    ));
    for (const point of points.slice(1)) {
      page.pushOperators(lineTo(
        (point.x - bounds.minX) * POINTS_PER_MM,
        (bounds.maxY - point.y) * POINTS_PER_MM,
      ));
    }
    page.pushOperators(lineTo(
      (points[0].x - bounds.minX) * POINTS_PER_MM,
      (bounds.maxY - points[0].y) * POINTS_PER_MM,
    ));
  }
  page.pushOperators(clip(), endPath());
}

function rotatedOrigin(centerX, centerY, width, height, angleDegrees) {
  const radians = angleDegrees * Math.PI / 180;
  const x = -width / 2;
  const y = -height / 2;
  return {
    x: centerX + x * Math.cos(radians) - y * Math.sin(radians),
    y: centerY + x * Math.sin(radians) + y * Math.cos(radians),
  };
}

function addArtworkCropClip(page, artwork, bounds) {
  if (!artwork.crop) return;
  const radians = artwork.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const left = -artwork.unrotatedWidthMm / 2 + artwork.crop.x;
  const top = -artwork.unrotatedHeightMm / 2 + artwork.crop.y;
  const right = left + artwork.crop.width;
  const bottom = top + artwork.crop.height;
  const corners = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ].map(([localX, localY]) => {
    const worldX = artwork.centerXmm + localX * cosine - localY * sine;
    const worldY = artwork.centerYmm + localX * sine + localY * cosine;
    return {
      x: (worldX - bounds.minX) * POINTS_PER_MM,
      y: (bounds.maxY - worldY) * POINTS_PER_MM,
    };
  });
  page.pushOperators(
    moveTo(corners[0].x, corners[0].y),
    lineTo(corners[1].x, corners[1].y),
    lineTo(corners[2].x, corners[2].y),
    lineTo(corners[3].x, corners[3].y),
    clip(),
    endPath(),
  );
}

function ensureResourceDictionary(page, name) {
  const resources = page.node.Resources();
  let dictionary = resources.lookupMaybe(PDFName.of(name), PDFDict);
  if (!dictionary) {
    dictionary = page.doc.context.obj({});
    resources.set(PDFName.of(name), dictionary);
  }
  return dictionary;
}

function addDielineLayer(pdfDocument, page, boxModel, bounds) {
  const context = pdfDocument.context;
  const ocg = context.obj({
    Type: 'OCG',
    Name: 'Dieline',
  });
  const ocgRef = context.register(ocg);
  pdfDocument.catalog.set(PDFName.of('OCProperties'), context.obj({
    OCGs: [ocgRef],
    D: {
      Order: [ocgRef],
      ON: [ocgRef],
    },
  }));
  ensureResourceDictionary(page, 'Properties').set(PDFName.of('Dieline'), ocgRef);

  const tintFunctionRef = context.register(context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [0, 0, 0, 0],
    C1: [0, 1, 0, 0],
    N: 1,
  }));
  const separation = context.obj([
    PDFName.of('Separation'),
    PDFName.of('CutContour'),
    PDFName.of('DeviceCMYK'),
    tintFunctionRef,
  ]);
  ensureResourceDictionary(page, 'ColorSpace').set(PDFName.of('CutContourCS'), separation);

  const { cut, fold } = getDielineSegments(boxModel);
  page.pushOperators(
    pushGraphicsState(),
    PDFOperator.of('BDC', [PDFName.of('OC'), PDFName.of('Dieline')]),
    setLineWidth(0.25 * POINTS_PER_MM),
    PDFOperator.of('CS', [PDFName.of('CutContourCS')]),
    PDFOperator.of('SCN', [PDFNumber.of(1)]),
  );
  for (const segment of cut) {
    page.pushOperators(
      moveTo(
        (segment.start.x - bounds.minX) * POINTS_PER_MM,
        (bounds.maxY - segment.start.y) * POINTS_PER_MM,
      ),
      lineTo(
        (segment.end.x - bounds.minX) * POINTS_PER_MM,
        (bounds.maxY - segment.end.y) * POINTS_PER_MM,
      ),
      stroke(),
    );
  }
  page.pushOperators(
    setStrokingRgbColor(0.19, 0.34, 0.84),
    setDashPattern([2 * POINTS_PER_MM, 1.5 * POINTS_PER_MM], 0),
  );
  for (const segment of fold) {
    page.pushOperators(
      moveTo(
        (segment.start.x - bounds.minX) * POINTS_PER_MM,
        (bounds.maxY - segment.start.y) * POINTS_PER_MM,
      ),
      lineTo(
        (segment.end.x - bounds.minX) * POINTS_PER_MM,
        (bounds.maxY - segment.end.y) * POINTS_PER_MM,
      ),
      stroke(),
    );
  }
  page.pushOperators(
    PDFOperator.of('EMC'),
    popGraphicsState(),
  );
}

export async function createPdfExport({
  boxModel,
  artworks,
}) {
  const entries = (artworks || [])
    .filter((entry) => entry?.model?.hasArtwork && (entry.visible !== false) && entry.originalBlob);
  if (!entries.length) throw new AppError('artworkRequired');
  const pdfDocument = await PDFDocument.create();
  if (boxModel.construction?.templateId && boxModel.construction.templateId !== 'legacy-six-panel') {
    pdfDocument.setSubject('Structural mockup — production allowances not applied.');
    pdfDocument.setKeywords(['CartonBuilder', 'structural mockup', 'production allowances not applied']);
  }
  const bounds = boxModel.getBounds();
  const pageWidth = bounds.width * POINTS_PER_MM;
  const pageHeight = bounds.height * POINTS_PER_MM;
  const page = pdfDocument.addPage([pageWidth, pageHeight]);

  addPanelClip(page, boxModel, bounds);
  for (const entry of entries) {
    const artwork = entry.model;
    const centerX = (artwork.centerXmm - bounds.minX) * POINTS_PER_MM;
    const centerY = (bounds.maxY - artwork.centerYmm) * POINTS_PER_MM;
    const width = artwork.unrotatedWidthMm * POINTS_PER_MM;
    const height = artwork.unrotatedHeightMm * POINTS_PER_MM;
    const pdfRotation = -artwork.rotation;
    const origin = rotatedOrigin(centerX, centerY, width, height, pdfRotation);
    page.pushOperators(pushGraphicsState());
    addArtworkCropClip(page, artwork, bounds);

    if (artwork.source.mimeType === 'application/pdf') {
      const [embeddedPage] = await pdfDocument.embedPdf(
        await entry.originalBlob.arrayBuffer(),
        [artwork.source.pageIndex || 0],
      );
      page.drawPage(embeddedPage, {
        x: origin.x,
        y: origin.y,
        width,
        height,
        rotate: degrees(pdfRotation),
        opacity: artwork.opacity,
      });
    } else {
      const embeddedImage = artwork.source.mimeType === 'image/png'
        ? await pdfDocument.embedPng(await entry.originalBlob.arrayBuffer())
        : await pdfDocument.embedJpg(await entry.originalBlob.arrayBuffer());
      page.drawImage(embeddedImage, {
        x: origin.x,
        y: origin.y,
        width,
        height,
        rotate: degrees(pdfRotation),
        opacity: artwork.opacity,
      });
    }
    page.pushOperators(popGraphicsState());
  }
  page.pushOperators(popGraphicsState());
  addDielineLayer(pdfDocument, page, boxModel, bounds);

  const bytes = await pdfDocument.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
