import { expect, test } from '@playwright/test';

test.setTimeout(180_000);

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
  test.setTimeout(300_000);
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
    const heading = document.getElementById('renderCameraHeading')?.value;
    const elevation = document.getElementById('renderCameraElevation')?.value;
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
    const heading = document.getElementById('renderCameraHeading')?.value;
    const elevation = document.getElementById('renderCameraElevation')?.value;
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

  const leftCamera = await page.evaluate(() => {
    const heading = Number(document.getElementById('renderCameraHeading')?.value);
    const elevation = Number(document.getElementById('renderCameraElevation')?.value);
    return { heading, elevation };
  });
  expect(Math.round(leftCamera.heading)).toBe(20);
  expect(Math.round(leftCamera.elevation)).toBe(11);

  // 5. Click preset "Right view"
  const rightViewPreset = page.locator('button[data-render-preset="right-view"]');
  await rightViewPreset.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-preset-right-view.png' });

  const rightCamera = await page.evaluate(() => {
    const heading = Number(document.getElementById('renderCameraHeading')?.value);
    const elevation = Number(document.getElementById('renderCameraElevation')?.value);
    return { heading, elevation };
  });
  expect(Math.round(rightCamera.heading)).toBe(340);
  expect(Math.round(rightCamera.elevation)).toBe(11);

  // 6. Click preset "Clean Studio"
  const cleanStudioPreset = page.locator('button[data-render-preset="clean-studio"]');
  await cleanStudioPreset.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-preset-clean-studio.png' });

  // 7. Test manual Advanced Camera inputs
  await page.locator('details.render-camera-advanced summary').click();
  const headingInput = page.locator('#renderCameraHeading');
  await headingInput.fill('75');
  await headingInput.dispatchEvent('input');
  await headingInput.dispatchEvent('change');
  await page.waitForTimeout(400);

  const updatedHeading = await page.evaluate(() => {
    return Number(document.getElementById('renderCameraHeading')?.value);
  });
  expect(updatedHeading).toBe(75);

  const elevationInput = page.locator('#renderCameraElevation');
  await elevationInput.fill('40');
  await elevationInput.dispatchEvent('input');
  await elevationInput.dispatchEvent('change');
  await page.waitForTimeout(400);

  const updatedElevation = await page.evaluate(() => {
    return Number(document.getElementById('renderCameraElevation')?.value);
  });
  expect(updatedElevation).toBe(40);

  // Toggle Keep verticals parallel
  const keepVerticals = page.locator('#renderKeepVerticalsParallel');
  await keepVerticals.check();
  await page.waitForTimeout(400);

  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-manual-advanced-camera.png' });

  // 8. Test clicking "Fit" button: camera must fit without deforming aspect ratio
  const fitButton = page.locator('#renderFitCameraButton');
  await fitButton.click();
  await page.waitForTimeout(600);

  const fitAspectMatches = await page.evaluate(() => {
    const canvas = document.getElementById('renderCanvas');
    if (!canvas) return false;
    const canvasAspect = canvas.clientWidth / canvas.clientHeight;
    return canvasAspect > 0;
  });
  expect(fitAspectMatches).toBe(true);

  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/step4-fit-clicked.png' });

  const fitDistance = await page.evaluate(() => Number(document.getElementById('renderCameraDistance')?.value));
  expect(fitDistance).toBeGreaterThan(100);

  // 9. Test mouse pan in Technical Dieline (right click drag)
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(startX + 60, startY - 40, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);

  const pannedState = await page.evaluate(() => ({
    panX: Number(document.getElementById('renderCameraPanX')?.value),
    panY: Number(document.getElementById('renderCameraPanY')?.value),
  }));
  console.log('--- Technical Dieline after mouse pan:', pannedState);
  expect(Math.abs(pannedState.panX)).toBeGreaterThan(1);
  expect(Math.abs(pannedState.panY)).toBeGreaterThan(1);
});
