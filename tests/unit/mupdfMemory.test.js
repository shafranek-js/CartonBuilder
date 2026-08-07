import { describe, expect, it } from 'vitest';

import * as mupdf from 'mupdf';
import { PDFDocument } from 'pdf-lib';

async function buildPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 300]);
  page.drawRectangle({ x: 20, y: 20, width: 360, height: 260 });
  return new Uint8Array(await pdf.save());
}

function renderCycle(bytes) {
  const document = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const page = document.loadPage(0);
    try {
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(1.5, 1.5),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
        'Print',
        'CropBox',
      );
      try {
        return pixmap.getPixels().length;
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    document.destroy();
  }
}

describe('mupdf memory stability', () => {
  it('keeps JS and wasm memory bounded across 60 open/render/close cycles', async () => {
    const bytes = await buildPdf();
    for (let index = 0; index < 10; index += 1) renderCycle(bytes);

    const before = process.memoryUsage();
    let rendered = 0;
    for (let index = 0; index < 60; index += 1) {
      rendered += renderCycle(bytes);
    }
    const after = process.memoryUsage();

    expect(rendered).toBeGreaterThan(0);
    expect(after.heapUsed - before.heapUsed).toBeLessThan(32 * 1024 * 1024);
    expect(after.arrayBuffers - before.arrayBuffers).toBeLessThan(32 * 1024 * 1024);
  });
});
