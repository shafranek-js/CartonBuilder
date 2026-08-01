import { expect, test } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

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

async function loadGeneratedPng(page, fileName = 'asymmetric-3d-artwork.png') {
  await page.evaluate(async (name) => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 640;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 960, 640);
    gradient.addColorStop(0, '#f7c948');
    gradient.addColorStop(0.45, '#e94f64');
    gradient.addColorStop(1, '#2657c8');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 960, 640);
    context.fillStyle = '#ffffff';
    context.font = 'bold 90px sans-serif';
    context.fillText('FRONT →', 90, 210);
    context.fillStyle = '#16213e';
    context.fillRect(80, 320, 720, 55);
    context.fillStyle = '#ffffff';
    context.font = '42px sans-serif';
    context.fillText('continuous artwork across folds', 110, 365);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], name, { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileName);
  await expect(page.locator('#artworkFileName')).toHaveText(fileName);
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

async function openPreview(page) {
  await buildReferenceNet(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await loadGeneratedPng(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#previewStep')).toBeVisible();
}

test('lazy-loads the complete 3D workflow without mutating canonical state', async ({ page }) => {
  const preview3dRequests = [];
  page.on('request', (request) => {
    if (/Preview3DApp|three/i.test(request.url())) preview3dRequests.push(request.url());
  });
  await page.goto('/');
  await page.setViewportSize({ width: 1440, height: 900 });
  await buildReferenceNet(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await loadGeneratedPng(page);

  expect(preview3dRequests).toHaveLength(0);
  const canonicalBefore = await page.evaluate(() => ({
    box: window.boxNetApp.getState(),
    artwork: window.cartonBuilderApp.artwork.artwork.toJSON(),
  }));

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('#preview3dPanel')).toBeVisible();
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('#preview3dRecovery')).toBeHidden();
  await expect.poll(
    () => page.evaluate(() => window.cartonBuilderApp.preview3d.getResourceInfo().panels),
  ).toBe(6);
  expect(preview3dRequests.length).toBeGreaterThan(0);

  expect(await page.evaluate(() => window.cartonBuilderApp.preview3d.getState()))
    .toMatchObject({
      active: true,
      foldProgress: 1,
      cameraProjection: 'perspective',
      cameraPreset: 'isometric',
      scenePreset: 'studio',
    });

  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(
    () => page.evaluate(() => window.cartonBuilderApp.preview3d.getState().foldProgress),
  ).toBe(0);
  await page.locator('#foldProgress').fill('0.5');
  expect(await page.evaluate(
    () => window.cartonBuilderApp.preview3d.getState().foldProgress,
  )).toBe(0.5);

  await page.locator('#cameraProjection').selectOption('orthographic');
  await page.locator('#scenePreset').selectOption('technical');
  await page.getByRole('button', { name: 'Reset View' }).click();
  await expect.poll(
    () => page.evaluate(() => window.cartonBuilderApp.preview3d.getState()),
  ).toMatchObject({
    cameraProjection: 'orthographic',
    scenePreset: 'technical',
  });

  const canvas = page.locator('#preview3dCanvas');
  const canvasBox = await canvas.boundingBox();
  await canvas.click({
    position: { x: canvasBox.width / 2, y: canvasBox.height / 2 },
  });
  await expect(page.locator('#preview3dInspector')).toBeVisible();

  await page.evaluate(() => window.cartonBuilderApp.preview3d.selectPanel('front'));
  await expect(page.locator('#preview3dInspector')).toBeVisible();
  await expect(page.locator('#preview3dPanelName')).toHaveText('Front Panel');
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#preview3dInspector')).toBeHidden();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Fold', exact: true }).click();
  expect(await page.evaluate(
    () => window.cartonBuilderApp.preview3d.getState().foldProgress,
  )).toBe(1);
  await page.locator('#foldProgress').fill('0.5');

  await page.evaluate(() => {
    document.getElementById('preview3dCanvas').dispatchEvent(
      new Event('webglcontextlost', { cancelable: true }),
    );
  });
  await expect(page.locator('#preview3dRecovery')).toBeVisible();
  await page.getByRole('button', { name: 'Retry 3D' }).click();
  await expect(page.locator('#preview3dRecovery')).toBeHidden({ timeout: 15_000 });

  await page.setViewportSize({ width: 1024, height: 720 });
  expect(await page.evaluate(
    () => window.cartonBuilderApp.preview3d.getState().foldProgress,
  )).toBe(0.5);
  const canonicalAfter = await page.evaluate(() => ({
    box: window.boxNetApp.getState(),
    artwork: window.cartonBuilderApp.artwork.artwork.toJSON(),
  }));
  expect(canonicalAfter).toEqual(canonicalBefore);

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#menuExportItem')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('#localePicker').selectOption('ru');
  await expect(page.locator('#preview3dCanvas')).toHaveAttribute(
    'aria-label',
    'Интерактивный 3D-просмотр собранной коробки',
  );

  await page.reload();
  await expect(page.locator('#previewStep')).toBeVisible();
  expect(await page.evaluate(() => window.cartonBuilderApp.preview3d.getState()))
    .toMatchObject({
      active: true,
      foldProgress: 1,
      cameraProjection: 'perspective',
      scenePreset: 'studio',
    });
});

test('updates the texture after repeated artwork replacement without resource growth', async ({ page }) => {
  await page.goto('/');
  await openPreview(page);
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 15_000 });
  await expect.poll(
    () => page.evaluate(() => window.cartonBuilderApp.preview3d.getResourceInfo().panels),
  ).toBe(6);
  const initialResources = await page.evaluate(
    () => window.cartonBuilderApp.preview3d.getResourceInfo(),
  );

  await page.getByRole('button', { name: 'Back to edit' }).click();
  for (let index = 0; index < 20; index += 1) {
    await loadGeneratedPng(page, `3d-replacement-${index}.png`);
  }
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#preview3dPanel')).toBeVisible();
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 15_000 });
  const finalResources = await page.evaluate(
    () => window.cartonBuilderApp.preview3d.getResourceInfo(),
  );

  expect(finalResources.panels).toBe(6);
  expect(finalResources.geometries).toBeLessThanOrEqual(initialResources.geometries);
  expect(finalResources.textures).toBeLessThanOrEqual(initialResources.textures);
});

test('keeps exports available when WebGL 2 is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedContext(type, ...args) {
      if (type === 'webgl2') return null;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await openPreview(page);

  await expect(page.locator('#preview3dRecovery')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#preview3dRecovery')).toContainText('requires WebGL 2');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#menuExportItem')).toBeVisible();
  await page.locator('#menuExportItem').hover();
  await expect(page.locator('#menuExportItem > .file-menu-submenu')).toBeVisible();
  await expect(page.getByText('Export 2D', { exact: true })).toBeVisible();
  await expect(page.getByText('Export 3D', { exact: true })).toBeVisible();
  await page.locator('#menuExportItem > .file-menu-submenu > .file-menu-submenu-anchor').nth(0).hover();
  await expect(page.locator('#menuExportPngBtn')).toBeVisible();
  await expect(page.locator('#menuExportPdfBtn')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Back to edit' }).click();
  await expect(page.locator('#artworkStep')).toBeVisible();
});

test.describe('high-DPI 3D rendering', () => {
  test.use({
    viewport: { width: 1024, height: 720 },
    deviceScaleFactor: 2,
  });
  test('caps the drawing buffer at DPR 2 and keeps the controls usable', async ({ page }) => {
    await page.goto('/');
    await openPreview(page);
    await expect.poll(
      () => page.evaluate(() => window.cartonBuilderApp.preview3d.getResourceInfo().panels),
    ).toBe(6);

    const sizes = await page.locator('#preview3dCanvas').evaluate((canvas) => ({
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
    }));
    expect(sizes.bufferWidth).toBe(sizes.cssWidth * 2);
    expect(sizes.bufferHeight).toBe(sizes.cssHeight * 2);
    await expect(page.getByRole('button', { name: 'Reset View' })).toBeVisible();
    await expect(page.locator('#foldProgress')).toBeVisible();
  });
});

test('exports a self-contained interactive 3D HTML file', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page);
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 15_000 });

  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('#menuExportItem').hover();
  await page.locator('#menuExportItem > .file-menu-submenu > .file-menu-submenu-anchor').nth(1).hover();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#menuExport3dHtmlBtn').click(),
  ]);
  expect(download.suggestedFilename()).toBe('carton-3d.html');

  const stream = await download.createReadStream();
  let content = '';
  for await (const chunk of stream) content += chunk.toString('utf8');
  expect(content).toContain('<!doctype html>');
  expect(content).toContain('import * as THREE from \'data:text/javascript;base64,');
  expect(content).toContain('"rootId":"front"');
  expect(content).toContain('data:image/png;base64,');
  expect(content).toContain('id="viewer"');

  const viewerPage = await page.context().newPage();
  const errors = [];
  viewerPage.on('pageerror', (error) => errors.push(error.message));
  const savedPath = path.join(os.tmpdir(), `carton-3d-${Date.now()}.html`);
  await download.saveAs(savedPath);
  await viewerPage.goto(url.pathToFileURL(savedPath).href);
  await expect.poll(() => viewerPage.evaluate(async () => {
    const canvas = document.getElementById('viewer');
    if (!canvas) return false;
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const context = probe.getContext('2d');
    context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, probe.width, probe.height).data;
    let colored = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colored += 1;
    }
    return colored > 400;
  })).toBe(true);
  expect(errors).toEqual([]);
  const viewerState = await viewerPage.evaluate(() => ({
    bgValue: document.getElementById('bgColor').value,
    bgPicker: Boolean(document.getElementById('bgColor')),
  }));
  expect(viewerState.bgPicker).toBe(true);
  expect(viewerState.bgValue).toBe('#e8e8e8');
  await viewerPage.close();
});
