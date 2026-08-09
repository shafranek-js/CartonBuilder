import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token.startsWith('--')) continue;
  args.set(token.slice(2), process.argv[index + 1]);
  index += 1;
}

const videoPath = args.get('video');
const outputDir = path.resolve(args.get('out-dir') || 'visual-proof');
const baseURL = args.get('base-url') || 'http://127.0.0.1:4173';
if (!videoPath) {
  throw new Error('Usage: npm run capture:visual-proof -- --video <video.mp4> [--out-dir <dir>] [--base-url <url>]');
}

await mkdir(outputDir, { recursive: true });
const videoBuffer = await readFile(videoPath);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
const context = await browser.newContext({ baseURL });
const page = await context.newPage();
const activate = async (label) => {
  const action = page.getByRole('button', { name: label });
  await action.focus();
  await action.press('Enter');
};

try {
  await page.goto('/');
  await activate('Add Base Panel to the bottom edge of Front Panel');
  await activate('Add Top Panel to the top edge of Front Panel');
  await page.locator('[data-step-target="artwork"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#selectArtworkButton').click();
  await (await chooser).setFiles({ name: path.basename(videoPath), mimeType: 'video/mp4', buffer: videoBuffer });
  await page.locator('#processingOverlay').waitFor({ state: 'hidden', timeout: 180_000 });
  await page.screenshot({ path: path.join(outputDir, '2d_canvas_proof.png'), fullPage: true });
  await page.locator('[data-step-target="preview"]').click();
  await page.locator('#preview3dBusy').waitFor({ state: 'hidden', timeout: 180_000 });
  await page.screenshot({ path: path.join(outputDir, '3d_preview_proof.png'), fullPage: true });
} finally {
  await context.close();
  await browser.close();
}
