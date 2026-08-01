import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  rgb,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { ArtworkModel } from '../../src/artwork/ArtworkModel.js';
import { createPdfExport } from '../../src/export/artworkExport.js';
import { getExportWarnings } from '../../src/export/exportChecks.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';

function completeBox() {
  const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

async function createSourcePdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 400]);
  page.drawRectangle({ x: 10, y: 10, width: 580, height: 380, color: rgb(1, 0, 0) });
  return document.save();
}

describe('artwork export', () => {
  it('reports non-blocking resolution, coverage and overflow warnings', () => {
    const box = completeBox();
    const artwork = new ArtworkModel().load({
      id: 'raster',
      fileName: 'small.png',
      mimeType: 'image/png',
      byteLength: 100,
      widthPx: 100,
      heightPx: 100,
    }, box.getBounds());
    artwork.setScale(0.5);
    artwork.moveBy(-200, 0);

    const warnings = getExportWarnings(box, artwork);
    expect(warnings.some((warning) => warning.includes('DPI'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('not fully covered'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('outside'))).toBe(true);
  });

  it('creates a physical-size PDF with vector artwork and a Dieline OCG', async () => {
    const box = completeBox();
    const sourceBytes = await createSourcePdf();
    const sourceBlob = new Blob([sourceBytes], { type: 'application/pdf' });
    const artwork = new ArtworkModel().load({
      id: 'pdf',
      fileName: 'vector.pdf',
      mimeType: 'application/pdf',
      byteLength: sourceBlob.size,
      widthPx: 600,
      heightPx: 400,
      pageIndex: 0,
      pageCount: 1,
      vector: true,
      pdfPageRotation: 0,
    }, box.getBounds());

    const exported = await createPdfExport({
      boxModel: box,
      artworks: [{ model: artwork, visible: true, originalBlob: sourceBlob }],
    });
    const bytes = new Uint8Array(await exported.arrayBuffer());
    const document = await PDFDocument.load(bytes);
    const page = document.getPage(0);
    const bounds = box.getBounds();
    const pointsPerMm = 72 / 25.4;

    expect(page.getWidth()).toBeCloseTo(bounds.width * pointsPerMm, 4);
    expect(page.getHeight()).toBeCloseTo(bounds.height * pointsPerMm, 4);
    const ocProperties = document.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    expect(ocProperties).toBeInstanceOf(PDFDict);

    const resources = page.node.Resources();
    const properties = resources.lookup(PDFName.of('Properties'), PDFDict);
    expect(properties.has(PDFName.of('Dieline'))).toBe(true);
    const colorSpaces = resources.lookup(PDFName.of('ColorSpace'), PDFDict);
    const separation = colorSpaces.lookup(PDFName.of('CutContourCS'), PDFArray);
    expect(separation.lookup(0, PDFName).asString()).toBe('/Separation');
    expect(separation.lookup(1, PDFName).asString()).toBe('/CutContour');
  });
});
