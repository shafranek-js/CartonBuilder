import { expect, test } from '@playwright/test';
import { inflateSync } from 'node:zlib';

test.setTimeout(90_000);

async function activate(page, label) {
  const action = page.getByRole('button', { name: label, exact: true });
  await action.focus();
  await action.press('Enter');
}

async function buildReferenceNet(page) {
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel');
  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await activate(page, 'Add Back Panel to the top edge of Top Panel');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');
  await activate(page, 'Add Right Panel to the right edge of Back Panel');
}

async function loadArtwork(page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2454c4';
    context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#ffffff';
    context.font = 'bold 72px sans-serif';
    context.fillText('RENDER', 90, 230);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'render-fixture.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#artworkFileName')).toHaveText('render-fixture.png');
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

function getPngPixelSummary(bytes) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const imageData = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      imageData.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  if (colorType !== 6 || !width || !height) return { varied: false, firstPixel: null };
  const inflated = inflateSync(Buffer.concat(imageData));
  const rowBytes = width * 4;
  let previous = Buffer.alloc(rowBytes);
  let firstPixel = null;
  let varied = false;
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor++];
    const row = Buffer.from(inflated.subarray(cursor, cursor + rowBytes));
    cursor += rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const above = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      else if (filter === 2) row[x] = (row[x] + above) & 0xff;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft)) & 0xff;
      } else if (filter !== 0) return { varied: false, firstPixel: null };
    }
    for (let x = 0; x < rowBytes; x += 4) {
      const pixel = row.subarray(x, x + 4).toString('hex');
      if (firstPixel == null) firstPixel = pixel;
      else if (pixel !== firstPixel) varied = true;
    }
    previous = row;
  }
  return { varied, firstPixel };
}

async function openRender(page) {
  await buildReferenceNet(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await loadArtwork(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 20_000 });
  await page.locator('#foldProgress').fill('0.35');
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#renderRecovery')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('carton-builder', 1);
    await new Promise((resolve) => {
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').clear();
        tx.oncomplete = tx.onerror = () => {
          db.close();
          resolve();
        };
      };
      request.onerror = resolve;
    });
  });
  await page.reload();
});

test('keeps Render disabled until a complete box and artwork exist', async ({ page }) => {
  await expect(page.locator('[data-step-target="render"]')).toBeDisabled();
  await buildReferenceNet(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('[data-step-target="render"]')).toBeDisabled();
  await loadArtwork(page);
  await expect(page.locator('[data-step-target="render"]')).toBeEnabled();
});

test('uses a separate closed presentation scene and persists render controls', async ({ page }) => {
  await openRender(page);
  expect(await page.evaluate(() => window.cartonBuilderApp.preview3d.getState().foldProgress)).toBe(0.35);
  expect(await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().foldProgress)).toBe(1);
  expect(await page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    presetId: 'clean-studio',
    aspect: 'square',
    longEdge: 2048,
    camera: { preset: 'isometric' },
  });

  await page.locator('#renderAspect').selectOption('wide');
  await page.locator('#renderLongEdge').selectOption('4096');
  await page.locator('#renderMaterialProfile').selectOption('gloss');
  await page.locator('#renderEnvironment').selectOption('warm');
  await page.locator('#renderBackgroundMode').selectOption('transparent');
  await page.locator('#renderShadowEnabled').uncheck();
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    aspect: 'wide',
    longEdge: 4096,
    material: { profile: 'gloss' },
    lighting: { environment: 'warm' },
    background: { mode: 'transparent' },
    shadows: { enabled: false },
  });

  await page.getByRole('button', { name: 'Back to Preview', exact: true }).click();
  await expect(page.locator('#previewStep')).toBeVisible();
  expect(await page.evaluate(() => window.cartonBuilderApp.preview3d.getState().foldProgress)).toBe(0.35);
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    aspect: 'wide',
    longEdge: 4096,
    background: { mode: 'transparent' },
  });
});

test('exports a PNG with the selected 2048 output dimensions', async ({ page }) => {
  await openRender(page);
  await page.locator('#renderAspect').selectOption('landscape');
  await page.locator('#renderLongEdge').selectOption('2048');
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('#renderPngButton').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/carton-render-.*-2048\.png$/);
  const buffer = await download.createReadStream();
  const chunks = [];
  for await (const chunk of buffer) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes.readUInt32BE(16)).toBe(2048);
  expect(bytes.readUInt32BE(20)).toBe(1536);
  expect(bytes.length).toBeGreaterThan(10_000);
  expect(getPngPixelSummary(bytes)).toMatchObject({ varied: true });
});

test('restores Render settings and workflow step through autosave', async ({ page }) => {
  await openRender(page);
  await page.locator('#renderAspect').selectOption('portrait');
  await page.locator('#renderLongEdge').selectOption('4096');
  await page.locator('#renderEnvironment').selectOption('cool');
  await page.locator('#renderBackgroundMode').selectOption('transparent');
  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());

  await page.reload();
  await expect(page.locator('#renderStep')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    aspect: 'portrait',
    longEdge: 4096,
    lighting: { environment: 'cool' },
    background: { mode: 'transparent' },
  });
});
