import { test, expect } from '@playwright/test';

test.setTimeout(180_000);

async function activate(page, label) {
  const action = page.getByRole('button', { name: label, exact: true });
  await action.focus();
  await action.press('Enter');
}

async function buildReferenceNet(page) {
  const quick = page.locator('button[data-workflow-mode="quick"]');
  if (!(await quick.isVisible())) await page.locator('.step[data-step-target="workflow"]').click();
  if (await quick.getAttribute('aria-pressed') !== 'true' || !(await page.locator('#boxStep').isVisible())) await quick.click();
  await expect(page.locator('#boxStep')).toBeVisible();
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel');
  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await activate(page, 'Add Back Panel to the top edge of Top Panel');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');
  await activate(page, 'Add Right Panel to the right edge of Back Panel');
}

async function loadArtwork(page, fileName = 'render-fixture.png') {
  await page.evaluate(async (fileName) => {
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
    const file = new File([blob], fileName, { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileName);
  await expect(page.locator('#artworkFileName')).toHaveText(fileName);
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

test('quick layout step 4 camera presets, fit, pan and lighting parity', async ({ page }) => {
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

  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();
  await loadArtwork(page);

  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 20_000 });

  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 20_000 });
  await page.waitForTimeout(1000);

  const debug = await page.evaluate(() => {
    return {
      stateCamera: window.cartonBuilderApp?.render?.getState?.()?.camera,
      elementDistance: document.getElementById('renderCameraDistance')?.value,
    };
  });
  console.log('--- INITIAL DEBUG:', JSON.stringify(debug));

  // 1. Initial framing and distance check
  const initialStats = await page.evaluate(() => ({
    heading: document.getElementById('renderCameraHeading')?.value,
    elevation: document.getElementById('renderCameraElevation')?.value,
    distance: Number(document.getElementById('renderCameraDistance')?.value),
    panX: Number(document.getElementById('renderCameraPanX')?.value),
    panY: Number(document.getElementById('renderCameraPanY')?.value),
  }));
  console.log('--- Quick Layout initial camera:', JSON.stringify(initialStats));
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/quick-step4-initial-fixed.png' });

  // 2. Click preset "Left view"
  await page.locator('button[data-render-preset="left-view"]').click();
  await page.waitForTimeout(1000);

  const leftStats = await page.evaluate(() => ({
    heading: Number(document.getElementById('renderCameraHeading')?.value),
    elevation: Number(document.getElementById('renderCameraElevation')?.value),
    distance: Number(document.getElementById('renderCameraDistance')?.value),
    panX: Number(document.getElementById('renderCameraPanX')?.value),
    panY: Number(document.getElementById('renderCameraPanY')?.value),
  }));
  console.log('--- Quick Layout Left view camera:', JSON.stringify(leftStats));
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/quick-step4-left-view-fixed.png' });

  // Distance must NOT be 7mm or 4mm! It should be framed (> 200 mm)
  expect(leftStats.distance).toBeGreaterThan(200);
  expect(leftStats.heading).toBe(20);
  expect(leftStats.elevation).toBe(11);

  // 3. Click preset "Right view"
  await page.locator('button[data-render-preset="right-view"]').click();
  await page.waitForTimeout(1000);

  const rightStats = await page.evaluate(() => ({
    heading: Number(document.getElementById('renderCameraHeading')?.value),
    elevation: Number(document.getElementById('renderCameraElevation')?.value),
    distance: Number(document.getElementById('renderCameraDistance')?.value),
    panX: Number(document.getElementById('renderCameraPanX')?.value),
    panY: Number(document.getElementById('renderCameraPanY')?.value),
  }));
  console.log('--- Quick Layout Right view camera:', JSON.stringify(rightStats));
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/quick-step4-right-view-fixed.png' });

  expect(rightStats.distance).toBeGreaterThan(200);
  expect(rightStats.heading).toBe(340);
  expect(rightStats.elevation).toBe(11);

  // 4. Click "Fit"
  await page.locator('#renderFitCameraButton').click();
  await page.waitForTimeout(1000);

  const fitStats = await page.evaluate(() => ({
    heading: Number(document.getElementById('renderCameraHeading')?.value),
    elevation: Number(document.getElementById('renderCameraElevation')?.value),
    distance: Number(document.getElementById('renderCameraDistance')?.value),
    panX: Number(document.getElementById('renderCameraPanX')?.value),
    panY: Number(document.getElementById('renderCameraPanY')?.value),
  }));
  console.log('--- Quick Layout after Fit camera:', JSON.stringify(fitStats));
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/quick-step4-fit-fixed.png' });

  expect(fitStats.distance).toBeGreaterThan(200);
  expect(fitStats.panX).toBeCloseTo(0, 1);
  expect(fitStats.panY).toBeCloseTo(0, 1);

  // 5. Test mouse pan updates panX and panY fields
  const canvas = page.locator('#renderCanvas');
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  const advancedSummary = page.locator('#renderStep details summary', { hasText: /Advanced camera/i });
  if (await advancedSummary.isVisible()) {
    await advancedSummary.click();
  }

  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(startX + 80, startY + 60, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);

  const pannedStats = await page.evaluate(() => ({
    panX: Number(document.getElementById('renderCameraPanX')?.value),
    panY: Number(document.getElementById('renderCameraPanY')?.value),
  }));
  console.log('--- Quick Layout after mouse PAN:', JSON.stringify(pannedStats));
  expect(Math.abs(pannedStats.panX) + Math.abs(pannedStats.panY)).toBeGreaterThan(1);
});
