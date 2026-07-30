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

import { getDielineSegments } from '../model/dieline.js';

const POINTS_PER_MM = 72 / 25.4;
const EXPORT_DPI = 300;
const MAX_RASTER_EDGE = 32767;
const MAX_RASTER_PIXELS = 64_000_000;

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
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode preview.'))), type, quality);
  });
}

export async function createPreviewBlob({
  boxModel,
  artwork,
  originalBlob,
  previewBlob,
  type = 'image/png',
  dpi = EXPORT_DPI,
  showDieline = true,
}) {
  if (!artwork.hasArtwork || !previewBlob) throw new Error('Artwork is required.');
  const bounds = boxModel.getBounds();
  const pixelsPerMm = dpi / 25.4;
  const width = Math.max(1, Math.round(bounds.width * pixelsPerMm));
  const height = Math.max(1, Math.round(bounds.height * pixelsPerMm));
  if (
    width > MAX_RASTER_EDGE
    || height > MAX_RASTER_EDGE
    || width * height > MAX_RASTER_PIXELS
  ) {
    throw new Error('The 300 DPI raster export is too large for this browser.');
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
  for (const panel of boxModel.getPanels()) {
    context.rect(panel.x, panel.y, panel.width, panel.height);
  }
  context.clip();

  const renderBlob = artwork.source.mimeType === 'application/pdf'
    ? previewBlob
    : originalBlob || previewBlob;
  const bitmap = await createImageBitmap(renderBlob, { imageOrientation: 'from-image' });
  context.globalAlpha = artwork.opacity;
  context.translate(artwork.centerXmm, artwork.centerYmm);
  context.rotate(artwork.rotation * Math.PI / 180);
  context.drawImage(
    bitmap,
    -artwork.unrotatedWidthMm / 2,
    -artwork.unrotatedHeightMm / 2,
    artwork.unrotatedWidthMm,
    artwork.unrotatedHeightMm,
  );
  bitmap.close();
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
  for (const panel of boxModel.getPanels()) {
    page.pushOperators(rectangle(
      (panel.x - bounds.minX) * POINTS_PER_MM,
      (bounds.maxY - panel.y - panel.height) * POINTS_PER_MM,
      panel.width * POINTS_PER_MM,
      panel.height * POINTS_PER_MM,
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
  artwork,
  originalBlob,
  previewBlob,
}) {
  if (!artwork.hasArtwork || !originalBlob) throw new Error('Artwork is required.');
  const pdfDocument = await PDFDocument.create();
  const bounds = boxModel.getBounds();
  const pageWidth = bounds.width * POINTS_PER_MM;
  const pageHeight = bounds.height * POINTS_PER_MM;
  const page = pdfDocument.addPage([pageWidth, pageHeight]);

  addPanelClip(page, boxModel, bounds);
  const centerX = (artwork.centerXmm - bounds.minX) * POINTS_PER_MM;
  const centerY = (bounds.maxY - artwork.centerYmm) * POINTS_PER_MM;
  const width = artwork.unrotatedWidthMm * POINTS_PER_MM;
  const height = artwork.unrotatedHeightMm * POINTS_PER_MM;
  const pdfRotation = -artwork.rotation;
  const origin = rotatedOrigin(centerX, centerY, width, height, pdfRotation);

  if (artwork.source.mimeType === 'application/pdf') {
    const [embeddedPage] = await pdfDocument.embedPdf(
      await originalBlob.arrayBuffer(),
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
      ? await pdfDocument.embedPng(await originalBlob.arrayBuffer())
      : await pdfDocument.embedJpg(await originalBlob.arrayBuffer());
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
  addDielineLayer(pdfDocument, page, boxModel, bounds);

  const bytes = await pdfDocument.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
