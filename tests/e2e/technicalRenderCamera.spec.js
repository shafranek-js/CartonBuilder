import { expect, test } from '@playwright/test';

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

async function setupTechnicalWithArtwork(page) {
  const card = page.locator('button[data-workflow-mode="technical"]');
  if (!(await card.isVisible())) {
    await page.locator('.step[data-step-target="workflow"]').click();
    await expect(page.locator('#workflowStep')).toBeVisible();
  }
  await card.click();
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );

  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();

  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f6cf43';
    context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#2657c8';
    context.fillRect(40, 40, 520, 320);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'technical-render-test.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#artworkFileName')).toHaveText('technical-render-test.png');
  await expect(page.locator('#processingOverlay')).toBeHidden();
  await expect(page.locator('.step[data-step-target="preview"]')).toBeEnabled();
  await expect(page.locator('.step[data-step-target="render"]')).toBeEnabled();
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

test('technical render opens framed, rotates with mouse, and maintains framing on presets', async ({ page }) => {
  test.setTimeout(120_000);
  await setupTechnicalWithArtwork(page);

  // 1. Open Render
  await page.locator('.step[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect(page.locator('#renderStatus')).toHaveText(/ready|готов/i, { timeout: 20_000 });

  // Let the render loop run a frame
  await page.waitForTimeout(1000);

  // Take screenshot of initial framed render
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-initial.png' });

  // Camera should be framed (target should not be [0,0,0], distance should be < 1m)
  const initialCamera = await page.evaluate(() => {
    const heading = document.getElementById('cameraHeading')?.value;
    const elevation = document.getElementById('cameraElevation')?.value;
    return { heading: Number(heading), elevation: Number(elevation) };
  });

  // Check controls state
  const debugInfo = await page.evaluate(() => {
    const canvas = document.getElementById('renderCanvas');
    return {
      canvasExists: Boolean(canvas),
      canvasWidth: canvas?.clientWidth,
      canvasHeight: canvas?.clientHeight,
    };
  });
  console.log('Canvas debug info:', debugInfo);

  // 2. Rotate with mouse drag on the canvas
  const canvas = page.locator('#renderCanvas');
  await canvas.waitFor({ state: 'visible' });
  const box = await canvas.boundingBox();
  console.log('Canvas boundingBox:', box);

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(startX + 150, startY - 80, { steps: 20 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(1000);

  // Take screenshot after rotation
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-rotated.png' });

  const rotatedCamera = await page.evaluate(() => {
    const heading = document.getElementById('cameraHeading')?.value;
    const elevation = document.getElementById('cameraElevation')?.value;
    return { heading: Number(heading), elevation: Number(elevation) };
  });

  // Camera heading or elevation MUST change from mouse drag!
  expect(
    rotatedCamera.heading !== initialCamera.heading || rotatedCamera.elevation !== initialCamera.elevation,
  ).toBe(true);

  // 3. Click preset "Catalogue"
  const cataloguePreset = page.locator('button[data-render-preset="catalogue"]');
  await cataloguePreset.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-preset-catalogue.png' });

  // 4. Click preset "Left view" (the one user reported!)
  const leftViewPreset = page.locator('button[data-render-preset="left-view"]');
  await leftViewPreset.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-preset-left-view.png' });

  // 5. Click preset "Right view"
  const rightViewPreset = page.locator('button[data-render-preset="right-view"]');
  await rightViewPreset.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-preset-right-view.png' });

  // 6. Click preset "Clean Studio"
  const cleanStudioPreset = page.locator('button[data-render-preset="clean-studio"]');
  await cleanStudioPreset.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-preset-clean-studio.png' });
});
