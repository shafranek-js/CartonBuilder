import { describe, expect, it } from 'vitest';

import * as mupdf from 'mupdf';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

import { invertMatrix, planTiles, snapRect, transformRect } from '../../src/pdf-renderer/tileMath.js';

async function buildPdf(rotation = 0, { width = 400, height = 200 } = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([width, height]);
  if (rotation) page.node.set(PDFName.of('Rotate'), PDFNumber.of(rotation));
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(new TextEncoder().encode([
    '1 0 0 0 k 0 0 200 100 re f',
    '0 1 0 0 k 200 0 200 100 re f',
    '0 0 1 0 k 0 100 200 100 re f',
    '0 0 0 1 k 200 100 200 100 re f',
  ].join(' ')))));
  return new Uint8Array(await pdf.save());
}

function referenceRender(document, scale, rotation) {
  const page = document.loadPage(0);
  const matrix = rotation
    ? mupdf.Matrix.concat(mupdf.Matrix.scale(scale, scale), mupdf.Matrix.rotate(-rotation))
    : mupdf.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true, 'Print', 'CropBox');
  const pixels = new Uint8Array(pixmap.getPixels());
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  pixmap.destroy();
  page.destroy();
  return { pixels, width, height };
}

function tiledRender(document, scale, rotation, tileEdge) {
  const page = document.loadPage(0);
  const matrix = rotation
    ? mupdf.Matrix.concat(mupdf.Matrix.scale(scale, scale), mupdf.Matrix.rotate(-rotation))
    : mupdf.Matrix.scale(scale, scale);
  const pageCtm = page.getTransform();
  const rotatedBox = page.getBounds('CropBox');
  const unrotatedBox = transformRect(rotatedBox, invertMatrix(pageCtm));
  const bounds = snapRect(transformRect(unrotatedBox, mupdf.Matrix.concat(pageCtm, matrix)));
  const width = bounds.x1 - bounds.x0;
  const height = bounds.y1 - bounds.y0;
  const out = new Uint8Array(width * height * 3);
  const overscan = 1;
  for (const tile of planTiles(bounds, tileEdge)) {
    const tileWidth = tile.x1 - tile.x0;
    const tileHeight = tile.y1 - tile.y0;
    const x0 = Math.max(bounds.x0, tile.x0 - overscan);
    const y0 = Math.max(bounds.y0, tile.y0 - overscan);
    const x1 = Math.min(bounds.x1, tile.x1 + overscan);
    const y1 = Math.min(bounds.y1, tile.y1 + overscan);
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [x0, y0, x1, y1], false);
    pixmap.clear(255);
    const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
    page.run(device, matrix);
    device.destroy();
    const pixels = pixmap.getPixels();
    const stride = pixmap.getStride();
    const offsetX = tile.x0 - x0;
    const offsetY = tile.y0 - y0;
    const bufCol = tile.x0 - bounds.x0;
    const bufRow = tile.y0 - bounds.y0;
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        const source = (y + offsetY) * stride + (x + offsetX) * 3;
        const target = ((bufRow + y) * width + (bufCol + x)) * 3;
        out[target] = pixels[source];
        out[target + 1] = pixels[source + 1];
        out[target + 2] = pixels[source + 2];
      }
    }
    pixmap.destroy();
  }
  page.destroy();
  return { pixels: out, width, height };
}

function countDiff(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff += 1;
  }
  return diff;
}

describe('tileMath', () => {
  it('inverts and transforms rectangles', () => {
    const identity = [1, 0, 0, 1, 0, 0];
    const rect = { x0: 0, y0: 0, x1: 400, y1: 200 };
    expect(transformRect(rect, identity)).toEqual(rect);
    const flip = [1, 0, 0, -1, 0, 200];
    expect(transformRect(rect, flip)).toEqual({ x0: 0, y0: 0, x1: 400, y1: 200 });
    expect(transformRect(rect, invertMatrix(flip))).toEqual(rect);
  });

  it('plans a tile grid within the tile edge', () => {
    const tiles = planTiles({ x0: 0, y0: -200, x1: 400, y1: 0 }, 2048);
    expect(tiles).toHaveLength(1);
    const split = planTiles({ x0: 0, y0: 0, x1: 3000, y1: 1500 }, 1024);
    expect(split.length).toBeGreaterThan(1);
    for (const tile of split) {
      expect(tile.x1 - tile.x0).toBeLessThanOrEqual(1024);
      expect(tile.y1 - tile.y0).toBeLessThanOrEqual(1024);
    }
    expect(split[split.length - 1].x1).toBe(3000);
    expect(split[split.length - 1].y1).toBe(1500);
  });
});

describe('mupdf tiled rendering', () => {
  for (const rotation of [0, 90]) {
    it(`matches the single render for rotation ${rotation}`, async () => {
      const bytes = await buildPdf(rotation);
      const document = mupdf.Document.openDocument(bytes, 'application/pdf');
      try {
        const reference = referenceRender(document, 1, rotation);
        const tiled = tiledRender(document, 1, rotation, 2048);
        expect(tiled.width).toBe(reference.width);
        expect(tiled.height).toBe(reference.height);
        expect(countDiff(tiled.pixels, reference.pixels)).toBe(0);
      } finally {
        document.destroy();
      }
    });
  }

  it('renders a large page with tiles of at most 2048 px', async () => {
    const bytes = await buildPdf(0, { width: 4000, height: 2000 });
    const document = mupdf.Document.openDocument(bytes, 'application/pdf');
    try {
      const reference = referenceRender(document, 1, 0);
      const tiled = tiledRender(document, 1, 0, 2048);
      expect(tiled.width).toBe(4000);
      expect(tiled.height).toBe(2000);
      expect(countDiff(tiled.pixels, reference.pixels)).toBe(0);
    } finally {
      document.destroy();
    }
  });
});
