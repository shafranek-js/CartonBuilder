import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#262b33" />
      <stop offset="100%" stop-color="#15181d" />
    </linearGradient>
    <linearGradient id="topFace" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#afd035" />
      <stop offset="100%" stop-color="#c9ea4c" />
    </linearGradient>
    <linearGradient id="leftFace" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8fa928" />
      <stop offset="100%" stop-color="#73891d" />
    </linearGradient>
    <linearGradient id="rightFace" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6e8419" />
      <stop offset="100%" stop-color="#556710" />
    </linearGradient>
  </defs>

  <!-- Squircle rounded background -->
  <rect x="1" y="1" width="62" height="62" rx="15" fill="url(#bgGrad)" stroke="#383e4a" stroke-width="1.5" />

  <!-- 3D Isometric Carton Box -->
  <!-- Top Face -->
  <path d="M32 13 L49 22.8 L32 32.6 L15 22.8 Z" fill="url(#topFace)" />

  <!-- Left Face -->
  <path d="M15 22.8 L32 32.6 L32 51 L15 41.2 Z" fill="url(#leftFace)" />

  <!-- Right Face -->
  <path d="M32 32.6 L49 22.8 L49 41.2 L32 51 Z" fill="url(#rightFace)" />

  <!-- Center Crease Highlight -->
  <path d="M32 13 L32 32.6" stroke="rgba(255, 255, 255, 0.45)" stroke-width="1.2" stroke-linecap="round" />
  
  <!-- Subtle dieline fold notches / creases -->
  <path d="M15 22.8 L32 32.6 L49 22.8" stroke="rgba(255, 255, 255, 0.35)" stroke-width="1" fill="none" />
  <path d="M32 32.6 L32 51" stroke="rgba(0, 0, 0, 0.3)" stroke-width="1.2" />

  <!-- Top Flap Dieline Crease Hint -->
  <path d="M26 16.5 L38 23.4" stroke="rgba(255, 255, 255, 0.65)" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="2 1.5" />
</svg>`;

// Write public/favicon.svg
const publicDir = path.resolve('public');
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), svgContent, 'utf8');
console.log('Saved public/favicon.svg');

function drawIcon(canvas, size) {
  const ctx = canvas.getContext('2d');
  const scale = size / 64;

  ctx.clearRect(0, 0, size, size);

  // Background squircle
  const rx = 15 * scale;
  const pad = 1 * scale;
  const w = size - 2 * pad;
  ctx.beginPath();
  ctx.roundRect(pad, pad, w, w, rx);
  const bgGrad = ctx.createLinearGradient(0, 0, size, size);
  bgGrad.addColorStop(0, '#262b33');
  bgGrad.addColorStop(1, '#15181d');
  ctx.fillStyle = bgGrad;
  ctx.fill();

  ctx.lineWidth = Math.max(1, 1.5 * scale);
  ctx.strokeStyle = '#383e4a';
  ctx.stroke();

  // Draw 3D Box
  function p(x, y) {
    return [x * scale, y * scale];
  }

  // Top Face
  ctx.beginPath();
  let [x, y] = p(32, 13);
  ctx.moveTo(x, y);
  [x, y] = p(49, 22.8); ctx.lineTo(x, y);
  [x, y] = p(32, 32.6); ctx.lineTo(x, y);
  [x, y] = p(15, 22.8); ctx.lineTo(x, y);
  ctx.closePath();
  const topGrad = ctx.createLinearGradient(15 * scale, 32.6 * scale, 49 * scale, 13 * scale);
  topGrad.addColorStop(0, '#afd035');
  topGrad.addColorStop(1, '#c9ea4c');
  ctx.fillStyle = topGrad;
  ctx.fill();

  // Left Face
  ctx.beginPath();
  [x, y] = p(15, 22.8); ctx.moveTo(x, y);
  [x, y] = p(32, 32.6); ctx.lineTo(x, y);
  [x, y] = p(32, 51); ctx.lineTo(x, y);
  [x, y] = p(15, 41.2); ctx.lineTo(x, y);
  ctx.closePath();
  const leftGrad = ctx.createLinearGradient(15 * scale, 22.8 * scale, 32 * scale, 51 * scale);
  leftGrad.addColorStop(0, '#8fa928');
  leftGrad.addColorStop(1, '#73891d');
  ctx.fillStyle = leftGrad;
  ctx.fill();

  // Right Face
  ctx.beginPath();
  [x, y] = p(32, 32.6); ctx.moveTo(x, y);
  [x, y] = p(49, 22.8); ctx.lineTo(x, y);
  [x, y] = p(49, 41.2); ctx.lineTo(x, y);
  [x, y] = p(32, 51); ctx.lineTo(x, y);
  ctx.closePath();
  const rightGrad = ctx.createLinearGradient(32 * scale, 32.6 * scale, 49 * scale, 51 * scale);
  rightGrad.addColorStop(0, '#6e8419');
  rightGrad.addColorStop(1, '#556710');
  ctx.fillStyle = rightGrad;
  ctx.fill();

  // Crease details (draw if size >= 32)
  if (size >= 24) {
    ctx.beginPath();
    [x, y] = p(32, 13); ctx.moveTo(x, y);
    [x, y] = p(32, 32.6); ctx.lineTo(x, y);
    ctx.lineWidth = Math.max(0.8, 1.2 * scale);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.stroke();

    ctx.beginPath();
    [x, y] = p(15, 22.8); ctx.moveTo(x, y);
    [x, y] = p(32, 32.6); ctx.lineTo(x, y);
    [x, y] = p(49, 22.8); ctx.lineTo(x, y);
    ctx.lineWidth = Math.max(0.6, 1 * scale);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.stroke();

    ctx.beginPath();
    [x, y] = p(32, 32.6); ctx.moveTo(x, y);
    [x, y] = p(32, 51); ctx.lineTo(x, y);
    ctx.lineWidth = Math.max(0.8, 1.2 * scale);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.stroke();
  }
}

// Generate PNGs
const sizes = [16, 32, 48, 180];
const buffers = {};

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  drawIcon(canvas, size);
  const buf = canvas.toBuffer('image/png');
  buffers[size] = buf;

  if (size === 16) fs.writeFileSync(path.join(publicDir, 'favicon-16x16.png'), buf);
  if (size === 32) fs.writeFileSync(path.join(publicDir, 'favicon-32x32.png'), buf);
  if (size === 180) fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), buf);
}
console.log('Saved PNG icons: 16x16, 32x32, apple-touch-icon');

// Build multi-size favicon.ico containing 16x16, 32x32, and 48x48
function buildIco(images) {
  // images: [{ size, buffer }]
  const count = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + count * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon type (1)
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  for (const img of images) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.buffer.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset
    dirEntries.push(entry);
    offset += img.buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...images.map(i => i.buffer)]);
}

const icoBuffer = buildIco([
  { size: 16, buffer: buffers[16] },
  { size: 32, buffer: buffers[32] },
  { size: 48, buffer: buffers[48] }
]);

fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);
console.log('Saved public/favicon.ico');

// Save preview of sizes side by side in scratch
const previewCanvas = createCanvas(400, 160);
const pCtx = previewCanvas.getContext('2d');
pCtx.fillStyle = '#0f1115';
pCtx.fillRect(0, 0, 400, 160);

// Draw 16, 32, 48, 96
pCtx.fillStyle = '#94a3b8';
pCtx.font = '12px sans-serif';
pCtx.fillText('16px', 30, 30);
pCtx.fillText('32px', 80, 30);
pCtx.fillText('48px', 150, 30);
pCtx.fillText('96px', 250, 30);

const c16 = createCanvas(16, 16); drawIcon(c16, 16);
const c32 = createCanvas(32, 32); drawIcon(c32, 32);
const c48 = createCanvas(48, 48); drawIcon(c48, 48);
const c96 = createCanvas(96, 96); drawIcon(c96, 96);

pCtx.drawImage(c16, 30, 45);
pCtx.drawImage(c32, 80, 45);
pCtx.drawImage(c48, 150, 45);
pCtx.drawImage(c96, 250, 45);

const previewDir = 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch';
if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });
fs.writeFileSync(path.join(previewDir, 'favicon-preview.png'), previewCanvas.toBuffer('image/png'));
console.log('Saved scratch/favicon-preview.png');
