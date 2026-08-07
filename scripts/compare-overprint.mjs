// Side-by-side comparison of Adobe references vs stock mupdf renders for the
// overprint Capability Spike.
//
// Inputs:
//   scratch/mupdf-spike/refs/*.png        - Adobe references
//   scratch/mupdf-spike/out/*.png         - stock mupdf renders
// Outputs:
//   scratch/mupdf-spike/refs/compare/<test>-compare.png    - side-by-side grids
//   scratch/mupdf-spike/refs/compare/compare-report.json   - probe pixel table
//
// Run: node scripts/compare-overprint.mjs

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = join(HERE, '..', 'scratch', 'mupdf-spike');
const REFS = join(SPIKE, 'refs');
const OUT = join(SPIKE, 'out');
const COMPARE = join(REFS, 'compare');

const SCALE = 2; // mupdf renders are at SCALE=2 (400pt page -> 800px)

// Probe points in PDF coordinates (origin bottom-left, y up). Mirrors
// render.mjs PROBES.
const PROBES = {
  'test-00-baseline': [[50, 50], [350, 50], [50, 350], [350, 350]],
  'test-01-black-overprint': [[140, 140], [20, 20]],
  'test-02-black-knockout': [[140, 140], [20, 20]],
  'test-03-white-overprint': [[105, 200], [295, 200], [10, 390]],
  'test-04-opm-0-1': [[105, 200], [295, 200], [10, 390]],
  'test-05-spot-over-cmyk': [[200, 200], [20, 380]],
  'test-06-devicen': [[200, 200], [20, 380]],
  'test-07-transparency-spot': [[100, 100], [200, 200], [380, 380]],
  'test-08-knockout-groups': [[95, 110], [225, 110], [355, 110]],
  'test-09-pdfx1a': [[200, 200], [20, 380]],
  'test-10-pdfx4': [[200, 200], [20, 380]],
  'test-11-ai-compatible': [[140, 140], [20, 20]],
};

const EXPECTED = {
  'test-01-black-overprint': ['backdrop preserved under black (dark red), no knockout windows'],
  'test-02-black-knockout': ['black knocks out backdrop (gray, white windows)'],
  'test-03-white-overprint': ['left white rect INVISIBLE (overprint), right white (knockout)'],
  'test-04-opm-0-1': ['OPM 0 (left) and OPM 1 (right) columns DIFFER'],
};

// --- minimal PNG decoder ------------------------------------------------------

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('Not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 8;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported color type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[src];
    src += 1;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const f = raw[src + x];
      let v;
      switch (filter) {
        case 0: v = f; break;
        case 1: v = f + a; break;
        case 2: v = f + b; break;
        case 3: v = f + ((a + b) >> 1); break;
        case 4: v = f + paeth(a, b, c); break;
        default: throw new Error(`Bad filter ${filter}`);
      }
      cur[x] = v & 0xff;
    }
    src += stride;
    for (let x = 0; x < width; x += 1) {
      const o = x * channels;
      const t = (y * width + x) * 4;
      out[t] = channels > 2 ? cur[o] : cur[o];
      out[t + 1] = channels > 2 ? cur[o + 1] : cur[o];
      out[t + 2] = channels > 2 ? cur[o + 2] : cur[o];
      out[t + 3] = channels === 2 || channels === 4 ? cur[o + channels - 1] : 255;
      if (channels === 1) {
        out[t + 1] = cur[o];
        out[t + 2] = cur[o];
      }
      if (channels === 3) out[t + 3] = 255;
    }
    prev.set(cur);
  }
  return { width, height, pixels: out };
}

// --- minimal PNG encoder (labels/grids) ---------------------------------------

const CRC_TABLE = [];
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i += 1) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
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

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- helpers ------------------------------------------------------------------

async function loadImage(file) {
  try {
    const buf = await readFile(file);
    return decodePng(buf);
  } catch (error) {
    return null;
  }
}

// Sample probe in PDF coords (origin bottom-left) from a decoded image.
function sample(img, x, y) {
  const sx = Math.min(img.width - 1, Math.max(0, Math.round((x / 400) * img.width)));
  const sy = Math.min(img.height - 1, Math.max(0, Math.round(((400 - y) / 400) * img.height)));
  const o = (sy * img.width + sx) * 4;
  return [img.pixels[o], img.pixels[o + 1], img.pixels[o + 2]];
}

function fit(img, targetWidth) {
  const h = Math.round((targetWidth * img.height) / img.width);
  const out = new Uint8Array(targetWidth * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / targetWidth));
      const sy = Math.min(img.height - 1, Math.floor((y * img.height) / h));
      const s = (sy * img.width + sx) * 4;
      const d = (y * targetWidth + x) * 4;
      out[d] = img.pixels[s];
      out[d + 1] = img.pixels[s + 1];
      out[d + 2] = img.pixels[s + 2];
      out[d + 3] = 255;
    }
  }
  return { width: targetWidth, height: h, pixels: out };
}

function drawText(rgba, width, text, x, y, scale = 1) {
  // Minimal 5x7 font, uppercase + digits + separators.
  const FONT = {
    A: [0xF8, 0x14, 0x12, 0x14, 0xF8], B: [0xFE, 0x92, 0x92, 0x92, 0x6C],
    C: [0x7C, 0x82, 0x82, 0x82, 0x44], D: [0xFE, 0x82, 0x82, 0x44, 0x38],
    E: [0xFE, 0x92, 0x92, 0x92, 0x82], F: [0xFE, 0x90, 0x90, 0x90, 0x80],
    G: [0x7C, 0x82, 0x92, 0x92, 0x6C], H: [0xFE, 0x10, 0x10, 0x10, 0xFE],
    I: [0x82, 0xFE, 0x82], J: [0x04, 0x02, 0x82, 0xFC], K: [0xFE, 0x10, 0x28, 0x44, 0x82],
    L: [0xFE, 0x02, 0x02, 0x02, 0x02], M: [0xFE, 0x40, 0x30, 0x40, 0xFE],
    N: [0xFE, 0x20, 0x10, 0x08, 0xFE], O: [0x7C, 0x82, 0x82, 0x82, 0x7C],
    P: [0xFE, 0x90, 0x90, 0x90, 0x60], Q: [0x7C, 0x82, 0x8A, 0x84, 0x7A],
    R: [0xFE, 0x90, 0x98, 0x94, 0x62], S: [0x64, 0x92, 0x92, 0x92, 0x4C],
    T: [0x80, 0x80, 0xFE, 0x80, 0x80], U: [0xFC, 0x02, 0x02, 0x02, 0xFC],
    V: [0xF8, 0x04, 0x02, 0x04, 0xF8], W: [0xFE, 0x04, 0x18, 0x04, 0xFE],
    X: [0xC6, 0x28, 0x10, 0x28, 0xC6], Y: [0xC0, 0x20, 0x1E, 0x20, 0xC0],
    Z: [0x86, 0x8A, 0x92, 0xA2, 0xC2], '0': [0x7C, 0x8A, 0x92, 0xA2, 0x7C],
    '1': [0x84, 0xFE, 0x02], '2': [0x4C, 0x92, 0x92, 0x92, 0x64],
    '3': [0x44, 0x82, 0x92, 0x92, 0x6C], '4': [0x30, 0x50, 0x90, 0xFE, 0x10],
    '5': [0xE4, 0xA2, 0xA2, 0xA2, 0x9C], '6': [0x7C, 0x92, 0x92, 0x92, 0x4C],
    '7': [0x80, 0x80, 0x8E, 0x90, 0xE0], '8': [0x6C, 0x92, 0x92, 0x92, 0x6C],
    '9': [0x64, 0x92, 0x92, 0x92, 0x7C], '-': [0x08, 0x08, 0x08, 0x08, 0x08],
    '.': [0x06, 0x06], ' ': [0x00], '/': [0x02, 0x04, 0x08, 0x10, 0x20],
    ':': [0x00, 0x6C, 0x6C, 0x00],
  };
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] || FONT[' '];
    for (let gy = 0; gy < 5; gy += 1) {
      const row = glyph[gy] || 0;
      for (let gx = 0; gx < 5; gx += 1) {
        if (row & (0x10 >> gx)) {
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              const px = cx + gx * scale + dx;
              const py = y + gy * scale + dy;
              if (px >= 0 && py >= 0 && px < width) {
                const o = (py * width + px) * 4;
                rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 0; rgba[o + 3] = 255;
              }
            }
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

// --- main ---------------------------------------------------------------------

await mkdir(COMPARE, { recursive: true });

const refFiles = (await readdir(REFS)).filter((f) => /\.png$/i.test(f) && !f.startsWith('compare'));
const mupdfFiles = (await readdir(OUT)).filter((f) => /\.png$/i.test(f));

const report = {
  generated: new Date().toISOString(),
  refs: {},
  tests: {},
};

// Group refs by test base. Accepts `-AI`, `-Acrobat`, and `-noOP` variants.
const byTest = {};
for (const f of refFiles) {
  const m = f.match(/^(test-[a-z0-9-]+?)-(ai|acrobat)(?:-(noop|no-op))?\.png$/i);
  if (!m) continue;
  const [, base, app, variant] = m;
  byTest[base] ||= {};
  const key = variant ? `${app.toLowerCase()}-${variant.toLowerCase()}` : app.toLowerCase();
  byTest[base][key] = f;
}

let built = 0;
for (const [testBase, apps] of Object.entries(byTest).sort()) {
  const probes = PROBES[testBase] || [];
  const panels = [];
  const row = { probes: probes.map(([x, y]) => `${x},${y}`) };

  const labels = [];
  for (const app of ['ai', 'ai-noop', 'acrobat']) {
    const f = apps[app];
    const img = f ? await loadImage(join(REFS, f)) : null;
    labels.push(app === 'ai-noop' ? 'AI-noOP' : app.toUpperCase());
    row[app] = img ? probes.map(([x, y]) => sample(img, x, y).join(',')) : null;
    panels.push(img ? fit(img, 400) : null);
  }
  // Show -noOP variant instead of the plain AI panel when only it exists.
  if (apps['ai-noop'] && !apps.ai) {
    panels[0] = panels[1];
    labels[0] = 'AI-noOP';
    row.ai = row['ai-noop'];
    panels[1] = null;
  }
  for (const usage of ['Print', 'View']) {
    const f = mupdfFiles.find((x) => x === `${testBase}-${usage}.png`);
    const img = f ? await loadImage(join(OUT, f)) : null;
    labels.push(`mupdf-${usage}`);
    row[usage.toLowerCase()] = img ? probes.map(([x, y]) => sample(img, x, y).join(',')) : null;
    panels.push(img ? fit(img, 400) : null);
  }

  // Build side-by-side grid: 2x2 panels + labels.
  const gap = 8;
  const labelH = 22;
  const pw = 400;
  const ph = 400;
  const gw = pw * 2 + gap * 3;
  const gh = ph * 2 + labelH * 2 + gap * 4;
  const grid = new Uint8Array(gw * gh * 4);
  grid.fill(18, 0, grid.length);
  grid.fill(255, 0, 4); // top-left pixel sentinel? no - keep gray
  for (let i = 0; i < 4; i += 1) {
    const col = i % 2;
    const line = Math.floor(i / 2);
    const ox = gap + col * (pw + gap);
    const oy = gap + line * (ph + labelH + gap);
    if (panels[i]) {
      for (let y = 0; y < panels[i].height; y += 1) {
        for (let x = 0; x < panels[i].width; x += 1) {
          const s = (y * panels[i].width + x) * 4;
          const d = ((oy + labelH + y) * gw + (ox + x)) * 4;
          grid[d] = panels[i].pixels[s];
          grid[d + 1] = panels[i].pixels[s + 1];
          grid[d + 2] = panels[i].pixels[s + 2];
          grid[d + 3] = 255;
        }
      }
    }
    drawText(grid, gw, labels[i] || '', ox, oy, 1);
  }
  const outName = `${testBase}-compare.png`;
  await writeFile(join(COMPARE, outName), encodePng(gw, gh, grid));
  report.tests[testBase] = { ...row, compare: outName, expected: EXPECTED[testBase] || null };
  built += 1;
}

// Reference manifests for tests without Adobe refs yet.
for (const testBase of Object.keys(PROBES)) {
  if (!byTest[testBase]) {
    report.tests[testBase] = {
      probes: PROBES[testBase].map(([x, y]) => `${x},${y}`),
      ai: null,
      acrobat: null,
      print: null,
      view: null,
      compare: null,
      expected: EXPECTED[testBase] || null,
    };
  }
}

await writeFile(join(COMPARE, 'compare-report.json'), JSON.stringify(report, null, 2));

console.log(`Reference files found: ${refFiles.length}`);
console.log(`Compare grids built: ${built}`);
console.log(`Report: ${join(COMPARE, 'compare-report.json')}`);

for (const [testBase, row] of Object.entries(report.tests)) {
  const head = `${testBase}`;
  const detail = row.ai ? ` AI=${row.ai.join(';')}` : ' (no AI ref)';
  console.log(`${head}${detail}`);
}
