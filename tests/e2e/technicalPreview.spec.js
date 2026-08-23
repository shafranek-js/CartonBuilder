import { expect, test } from '@playwright/test';

const TECHNICAL_TYPES = ['RTE', 'STE', 'TT_SL123'];

async function resetProject(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('carton-builder', 6);
    await new Promise((resolve) => {
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) {
          resolve();
          return;
        }
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').clear();
        tx.oncomplete = tx.onerror = resolve;
      };
      request.onerror = resolve;
    });
    localStorage.setItem('carton-builder-first-run-example-v1', 'true');
  });
  await page.reload();
  await expect(page.locator('#workflowStep')).toBeVisible();
}

async function chooseTechnical(page, cartonType) {
  const card = page.locator('button[data-workflow-mode="technical"]');
  if (!(await card.isVisible())) {
    await page.locator('.step[data-step-target="workflow"]').click();
    await expect(page.locator('#workflowStep')).toBeVisible();
  }
  await card.click();
  await expect(page.locator('#boxStep')).toBeVisible();
  const pbd = page.frameLocator('#technicalHostFrame');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  if (cartonType !== 'RTE') {
    await pbd.locator('#cartonType').selectOption(cartonType);
    await expect(page.locator('#technicalHostValidation')).toHaveText(
      'Structural VALID · Geometry VALID · Contract VALID',
    );
  }
  await expect(pbd.locator('#cartonType')).toHaveValue(cartonType);
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await page.evaluate(async (type) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f6cf43';
    context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#2657c8';
    context.fillRect(40, 40, 520, 320);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], `technical-preview-${type}.png`, { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, cartonType);
  await expect(page.locator('#artworkFileName')).toHaveText(`technical-preview-${cartonType}.png`);
  await expect(page.locator('#processingOverlay')).toBeHidden();
  await expect(page.locator('.step[data-step-target="preview"]')).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
  });
  await resetProject(page);
});

test('loads RTE, STE and TT_SL123 in the separate Technical Preview viewer', async ({ page }) => {
  const viewerExternalRequests = [];
  page.on('request', (request) => {
    const frame = request.frame();
    if (frame?.url().includes('/plugins/carton-fold-viewer/2.4.0/')) {
      const url = new URL(request.url());
      if (url.origin !== new URL(page.url()).origin) viewerExternalRequests.push(request.url());
    }
  });

  for (const cartonType of TECHNICAL_TYPES) {
    if (cartonType !== TECHNICAL_TYPES[0]) {
      await page.locator('.step[data-step-target="workflow"]').click();
      await expect(page.locator('#workflowStep')).toBeVisible();
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('button[data-workflow-mode="quick"]').click();
      await expect(page.locator('#boxStep')).toBeVisible();
    }
    await chooseTechnical(page, cartonType);
    expect(await page.locator('#technicalViewerFrame').getAttribute('src')).toBeNull();

    await page.locator('.step[data-step-target="preview"]').click();
    await expect(page.locator('#previewStep')).toBeVisible();
    await expect(page.locator('#technicalPreviewPanel')).toBeVisible();
    await expect(page.locator('#quickPreviewContent')).toBeHidden();
    await expect(page.locator('#quickPreviewActions')).toBeHidden();
    await expect(page.locator('#openRenderButton')).toBeDisabled();
    await expect(page.locator('#technicalViewerFrame')).toHaveAttribute(
      'sandbox',
      'allow-scripts',
    );
    await expect(page.locator('#technicalViewerFrame')).toHaveAttribute(
      'src',
      './plugins/carton-fold-viewer/2.4.0/index.html',
    );

    const viewer = page.frameLocator('#technicalViewerFrame');
    await expect(viewer.locator('#modelBadge')).toContainText('pbd.svg.v4', { timeout: 30_000 });
    await expect(viewer.locator('#modelBadge')).not.toContainText('default GLB');
    await expect(viewer.locator('#clipInfo')).toContainText('s');
    await expect(page.locator('#technicalViewerModelInfo')).toContainText(`${cartonType} ·`);
    await expect(page.locator('#technicalViewerStatus')).toContainText(/verified|loaded/i);
    await expect(page.locator('[data-step-target="render"]')).toBeDisabled();
    await expect(viewer.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.technicalPreview.getState()))
      .toEqual(expect.objectContaining({ started: true, initialized: true, pendingLoad: false }));
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.technicalPreview.getState()))
      .toEqual(expect.objectContaining({ viewerState: expect.objectContaining({ foldProgress: 0 }) }));
    await viewer.locator('#slider').fill('375');
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.technicalPreview.getState().viewerState.foldProgress))
      .toBeCloseTo(0.375, 2);
    const persistedState = await page.evaluate(() => window.cartonBuilderApp.getState().technicalViewer);
    expect(persistedState).toMatchObject({ version: 1, foldProgress: 0.375 });
    expect(persistedState.camera.projection).toBe('perspective');
    expect(viewerExternalRequests).toEqual([]);

    await page.locator('.step[data-step-target="box"]').click();
    await expect(page.locator('#boxStep')).toBeVisible();
    await expect(page.locator('#technicalPreviewPanel')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.technicalPreview.getState()))
      .toEqual(expect.objectContaining({ started: false, initialized: false }));
  }
});

test('keeps Quick Preview on its existing path and does not start the viewer', async ({ page }) => {
  await page.locator('button[data-workflow-mode="quick"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();
  await page.getByRole('button', { name: 'Add Base Panel to the bottom edge of Front Panel' }).press('Enter');
  await page.getByRole('button', { name: 'Add Top Panel to the top edge of Front Panel' }).press('Enter');
  await page.getByRole('button', { name: 'Add Back Panel to the top edge of Top Panel' }).press('Enter');
  await page.getByRole('button', { name: 'Add Left Panel to the left edge of Front Panel' }).press('Enter');
  await page.getByRole('button', { name: 'Add Right Panel to the right edge of Back Panel' }).press('Enter');
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 80;
    canvas.getContext('2d').fillRect(0, 0, 80, 80);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'quick-preview.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#artworkFileName')).toHaveText('quick-preview.png');
  await expect(page.locator('.step[data-step-target="preview"]')).toBeEnabled();
  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#preview3dPanel')).toBeVisible();
  await expect(page.locator('#technicalPreviewPanel')).toBeHidden();
  expect(await page.locator('#technicalViewerFrame').getAttribute('src')).toBeNull();
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 20_000 });
});
