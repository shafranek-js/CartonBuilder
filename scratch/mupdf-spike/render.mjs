// MuPDF overprint Capability Spike renderer.
//
// Renders every fixture from scratch/mupdf-spike/input with the stock mupdf
// package in both 'Print' and 'View' usage modes, writes PNGs to
// scratch/mupdf-spike/out/ and a report.json with probe pixels and diagnostics.
//
// Run: node scratch/mupdf-spike/render.mjs

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import * as mupdf from 'mupdf';

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT = join(HERE, 'input');
const OUT = join(HERE, 'out');

const SCALE = 2;
const USAGES = ['Print', 'View'];

// Probe points in PDF coordinates (origin bottom-left, y up).
const PROBES = {
  'test-00-baseline.pdf': [[50, 50], [350, 50], [50, 350], [350, 350]],
  'test-01-black-overprint.pdf': [[140, 140], [20, 20]],
  'test-02-black-knockout.pdf': [[140, 140], [20, 20]],
  'test-03-white-overprint.pdf': [[105, 200], [295, 200], [10, 390]],
  'test-04-opm-0-1.pdf': [[105, 200], [295, 200], [10, 390]],
  'test-05-spot-over-cmyk.pdf': [[200, 200], [20, 380]],
  'test-06-devicen.pdf': [[200, 200], [20, 380]],
  'test-07-transparency-spot.pdf': [[100, 100], [200, 200], [380, 380]],
  'test-08-knockout-groups.pdf': [[95, 110], [225, 110], [355, 110]],
  'test-09-pdfx1a.pdf': [[200, 200], [20, 380]],
  'test-10-pdfx4.pdf': [[200, 200], [20, 380]],
};

// --- minimal PNG encoder -----------------------------------------------------

const CRC_TABLE = [];
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- render ------------------------------------------------------------------

function sample(pixmap, probes) {
  const px = pixmap.getPixels();
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  const stride = pixmap.getStride();
  const components = pixmap.getNumberOfComponents();
  const pageHeight = height / SCALE;
  return probes.map(([x, y]) => {
    const sx = Math.min(width - 1, Math.max(0, Math.round(x * SCALE)));
    const sy = Math.min(height - 1, Math.max(0, Math.round((pageHeight - y) * SCALE) - 1));
    const o = sy * stride + sx * components;
    return [px[o], px[o + 1], px[o + 2]].join(',');
  });
}

const report = {
  mupdf: JSON.parse(await readFile(join(HERE, '..', '..', 'node_modules', 'mupdf', 'package.json'), 'utf8')).version,
  node: process.version,
  scale: SCALE,
  usage: USAGES,
  files: {},
};

await mkdir(OUT, { recursive: true });
const files = (await readdir(INPUT)).filter((f) => /\.(pdf|ai)$/i.test(f)).sort();

for (const file of files) {
  const base = file.replace(/\.(pdf|ai)$/i, '');
  const bytes = new Uint8Array(await readFile(join(INPUT, file)));
  const entry = { file, open: 'ok', usages: {} };

  let doc;
  try {
    doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  } catch (error) {
    entry.open = 'rejected';
    entry.error = error?.message || String(error);
    report.files[file] = entry;
    continue;
  }

  if (!doc.isPDF()) {
    entry.open = 'not-a-pdf';
    entry.isPDF = doc.isPDF();
    doc.destroy();
    report.files[file] = entry;
    continue;
  }

  entry.pageCount = doc.countPages();
  entry.isPDF = true;

  try {
    const page = doc.loadPage(0);
    try {
      for (const usage of USAGES) {
        const pixmap = page.toPixmap(
          mupdf.Matrix.scale(SCALE, SCALE),
          mupdf.ColorSpace.DeviceRGB,
          false,
          false,
          usage,
          'CropBox',
        );
        const width = pixmap.getWidth();
        const height = pixmap.getHeight();
        const png = encodePng(width, height, Buffer.from(pixmap.getPixels()));
        const fileName = `${base}-${usage}.png`;
        await writeFile(join(OUT, fileName), png);
        entry.usages[usage] = {
          width,
          height,
          components: pixmap.getNumberOfComponents(),
          png: fileName,
          probes: PROBES[file] ? sample(pixmap, PROBES[file]) : [],
        };
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }

  report.files[file] = entry;
}

await writeFile(join(HERE, 'report.json'), JSON.stringify(report, null, 2));

const rendered = Object.values(report.files).filter((f) => f.open === 'ok');
const rejected = Object.values(report.files).filter((f) => f.open === 'rejected');
console.log(`Rendered ${rendered.length}/${Object.keys(report.files).length} fixtures (${USAGES.join(', ')})`);
console.log(`Rejected (expected for test-12): ${rejected.map((f) => f.file).join(', ') || 'none'}`);
console.log(`mupdf ${report.mupdf}; report.json written`);
