import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MUPDF_MODULE
  ? pathToFileURL(resolve(process.env.MUPDF_MODULE)).href
  : new URL('../src/pdf-renderer/custom/mupdf.js', import.meta.url).href;
const { default: mupdf } = await import(modulePath);

const PROBES = {
  leftCyan: [35, 30],
  leftMagenta: [61, 55],
  leftBlack: [90, 85],
  rightCyan: [140, 30],
  rightMagenta: [166, 55],
  rightBlack: [195, 85],
};

function renderRgb(page, matrix, mode, processMask = 15, behaviors = null) {
  if (mode === 0) {
    const rgb = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true, 'Print', 'CropBox');
    try {
      return {
        x: rgb.getX(),
        y: rgb.getY(),
        width: rgb.getWidth(),
        height: rgb.getHeight(),
        pixels: new Uint8ClampedArray(rgb.getPixels()),
      };
    } finally {
      rgb.destroy();
    }
  }
  const cmyk = behaviors
    ? page.toPixmapWithOverprintAndBehaviors(
      matrix,
      mupdf.ColorSpace.DeviceCMYK,
      false,
      'Print',
      'CropBox',
      mode,
      Int32Array.from(behaviors),
    )
    : page.toPixmapWithOverprint(
      matrix,
      mupdf.ColorSpace.DeviceCMYK,
      false,
      true,
      'Print',
      'CropBox',
      mode,
    );
  try {
    const rgb = cmyk.toRgbWithProcessMask(processMask);
    try {
      return {
        x: rgb.getX(),
        y: rgb.getY(),
        width: rgb.getWidth(),
        height: rgb.getHeight(),
        pixels: new Uint8ClampedArray(rgb.getPixels()),
      };
    } finally {
      rgb.destroy();
    }
  } finally {
    cmyk.destroy();
  }
}

function renderRgbTiled(page, matrix, mode, reference, processMask = 15, behaviors = null) {
  const bounds = [reference.x, reference.y, reference.x + reference.width, reference.y + reference.height];
  const out = new Uint8ClampedArray(reference.width * reference.height * 3);
  const splitX = reference.x + Math.ceil(reference.width / 2);
  for (const [x0, x1] of [[reference.x, splitX], [splitX, bounds[2]]]) {
    const tileX0 = Math.max(bounds[0], x0 - 1);
    const tileX1 = Math.min(bounds[2], x1 + 1);
    const pixmap = page.toPixmapWithOverprintTile(
      matrix,
      mode === 0 ? mupdf.ColorSpace.DeviceRGB : mupdf.ColorSpace.DeviceCMYK,
      [tileX0, bounds[1], tileX1, bounds[3]],
      false,
      'Print',
      'CropBox',
      mode,
      behaviors ? Int32Array.from(behaviors) : null,
    );
    const rgb = mode === 0 ? pixmap : pixmap.toRgbWithProcessMask(processMask);
    try {
      const pixels = rgb.getPixels();
      const stride = rgb.getStride();
      const offsetX = x0 - rgb.getX();
      const offsetY = bounds[1] - rgb.getY();
      const tileWidth = x1 - x0;
      const tileHeight = bounds[3] - bounds[1];
      for (let y = 0; y < tileHeight; y += 1) {
        for (let x = 0; x < tileWidth; x += 1) {
          const source = (y + offsetY) * stride + (x + offsetX) * 3;
          const target = (y * reference.width + (x0 - reference.x) + x) * 3;
          out[target] = pixels[source];
          out[target + 1] = pixels[source + 1];
          out[target + 2] = pixels[source + 2];
        }
      }
    } finally {
      if (rgb !== pixmap) rgb.destroy();
      pixmap.destroy();
    }
  }
  return { x: reference.x, y: reference.y, width: reference.width, height: reference.height, pixels: out };
}

function sample(rendered, [x, y]) {
  const offset = (y * rendered.width + x) * 3;
  return Array.from(rendered.pixels.slice(offset, offset + 3));
}

function distance(a, b) {
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0);
}

for (const file of ['test/test.pdf', 'test/test.ai']) {
  const document = mupdf.Document.openDocument(readFileSync(file), 'application/pdf');
  const page = document.loadPage(0);
  const matrix = mupdf.Matrix.scale(1, 1);
  assert.equal(page.pageUsesOverprint(), true, `${file} should contain overprint state`);

  const off = renderRgb(page, matrix, 0);
  const on = renderRgb(page, matrix, 1);
  const mode2 = renderRgb(page, matrix, 2);
  const tiledOff = renderRgbTiled(page, matrix, 0, off);
  const tiled = renderRgbTiled(page, matrix, 1, on);
  const tiledMode2 = renderRgbTiled(page, matrix, 2, mode2);

  assert.ok(distance(sample(off, PROBES.leftCyan), sample(on, PROBES.leftCyan)) > 20, `${file} cyan overprint probe`);
  assert.ok(distance(sample(off, PROBES.leftMagenta), sample(on, PROBES.leftMagenta)) > 20, `${file} magenta overprint probe`);
  assert.ok(distance(sample(off, PROBES.leftBlack), sample(on, PROBES.leftBlack)) > 10, `${file} black overprint probe`);
  const green = sample(on, PROBES.leftCyan);
  const red = sample(on, PROBES.leftMagenta);
  const richBlack = sample(on, PROBES.leftBlack);
  assert.ok(green[1] > green[0] + 20 && green[1] > green[2] + 20, `${file} cyan+yellow is green`);
  assert.ok(red[0] > red[1] + 100 && red[0] > red[2] + 100, `${file} magenta+yellow is red`);
  assert.ok(richBlack[2] < sample(off, PROBES.leftBlack)[2] - 3, `${file} black+background is rich black`);
  assert.ok(distance(sample(off, PROBES.rightCyan), sample(on, PROBES.rightCyan)) < 15, `${file} knockout cyan control`);
  assert.ok(distance(sample(off, PROBES.rightMagenta), sample(on, PROBES.rightMagenta)) < 15, `${file} knockout magenta control`);
  assert.ok(distance(sample(off, PROBES.rightBlack), sample(on, PROBES.rightBlack)) < 15, `${file} knockout black control`);
  assert.ok(distance(off.pixels, tiledOff.pixels) === 0, `${file} mode 0 single/tiled parity`);
  assert.ok(distance(on.pixels, tiled.pixels) === 0, `${file} mode 1 single/tiled parity`);
  assert.ok(distance(mode2.pixels, tiledMode2.pixels) === 0, `${file} mode 2 single/tiled parity`);
  assert.ok(distance(on.pixels, mode2.pixels) < 3000, `${file} mode 1/2 parity without spots`);

  for (const degrees of [90, 180, 270]) {
    const rotated = mupdf.Matrix.rotate(degrees);
    const rotatedOff = renderRgb(page, rotated, 0);
    const rotatedOn = renderRgb(page, rotated, 1);
    const rotatedMode2 = renderRgb(page, rotated, 2);
    // Rotation 270 can differ by a small anti-alias seam at the split; keep
    // the comparison semantic while still rejecting a shifted or missing tile.
    assert.ok(distance(rotatedOff.pixels, renderRgbTiled(page, rotated, 0, rotatedOff).pixels) < 2500, `${file} mode 0 tiled parity rotation ${degrees}`);
    assert.ok(distance(rotatedOn.pixels, renderRgbTiled(page, rotated, 1, rotatedOn).pixels) < 2500, `${file} mode 1 tiled parity rotation ${degrees}`);
    assert.ok(distance(rotatedMode2.pixels, renderRgbTiled(page, rotated, 2, rotatedMode2).pixels) < 2500, `${file} mode 2 tiled parity rotation ${degrees}`);
  }

  const noCyan = renderRgb(page, matrix, 1, 14);
  assert.ok(distance(sample(on, PROBES.leftCyan), sample(noCyan, PROBES.leftCyan)) > 20, `${file} process mask C`);

  [off, on, mode2, tiled, noCyan].forEach((rendered) => assert.equal(rendered.width, 246));
  page.destroy();
  document.destroy();
}

const fixtureFiles = [
  ['test-00-baseline', 'pdf'],
  ['test-01-black-overprint', 'pdf'],
  ['test-02-black-knockout', 'pdf'],
  ['test-03-white-overprint', 'pdf'],
  ['test-04-opm-0-1', 'pdf'],
  ['test-05-spot-over-cmyk', 'pdf'],
  ['test-06-devicen', 'pdf'],
  ['test-07-transparency-spot', 'pdf'],
  ['test-08-knockout-groups', 'pdf'],
  ['test-09-pdfx1a', 'pdf'],
  ['test-10-pdfx4', 'pdf'],
  ['test-11-ai-compatible', 'ai'],
];
for (const [stem, extension] of fixtureFiles) {
  const file = `scratch/mupdf-spike/input/${stem}.${extension}`;
  const document = mupdf.Document.openDocument(readFileSync(file), 'application/pdf');
  const page = document.loadPage(0);
  const matrix = mupdf.Matrix.scale(1, 1);
  const count = page.separationCount();
  for (const mode of [0, 1, 2]) {
    const rendered = renderRgb(page, matrix, mode, 15, mode === 2 && count ? Array(count).fill(1) : null);
    assert.ok(rendered.width > 0 && rendered.height > 0, `${stem} mode ${mode} dimensions`);
  }
  if (count > 0 && !stem.includes('opm-0-1')) {
    const visible = renderRgb(page, matrix, 2, 15, Array(count).fill(1));
    const hidden = renderRgb(page, matrix, 2, 15, Array(count).fill(2));
    assert.ok(distance(visible.pixels, hidden.pixels) > 0, `${stem} spot behavior`);
  }
  page.destroy();
  document.destroy();
}

assert.throws(
  () => mupdf.Document.openDocument(readFileSync('scratch/mupdf-spike/input/test-12-non-compatible-ai.ai'), 'application/pdf'),
  /./,
  'non-compatible AI must be rejected',
);

console.log('MuPDF overprint native probes passed for test.pdf and test.ai');
