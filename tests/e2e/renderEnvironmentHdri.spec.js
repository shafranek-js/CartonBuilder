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
  await expect(page.locator('.step[data-step-target="render"]')).toBeEnabled();
}

test('HDRI loading and background environment mode diagnostics', async ({ page }) => {


  await resetProject(page);
  await setupTechnicalWithArtwork(page);

  await page.locator('.step[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect(page.locator('#renderStatus')).toHaveText(/ready|готов/i, { timeout: 20_000 });

  // 1. Select Poly Haven Empty Warehouse
  console.log('Selecting Empty Warehouse...');
  await page.locator('#renderEnvironmentMapPreset').selectOption('polyhaven-empty-warehouse-01');
  await page.waitForTimeout(4000);

  const diag1 = await page.evaluate(() => {
    return {
      statusText: document.getElementById('renderStatus')?.textContent,
      fileNameText: document.getElementById('renderEnvironmentMapFileName')?.textContent,
      envMapValue: document.getElementById('renderEnvironmentMapPreset')?.value,
      environmentValue: document.getElementById('renderEnvironment')?.value,
      diagnostics: window.renderApp?.renderer?.getDiagnostics?.() || 'no-diagnostics',
    };
  });
  console.log('Diag after warehouse select:', JSON.stringify(diag1, null, 2));

  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/hdri-warehouse-selected.png' });

  // 2. Change Background Mode to Environment
  console.log('Selecting Background Mode = Environment...');
  await page.locator('#renderBackgroundMode').selectOption('environment');
  await page.waitForTimeout(3000);

  const bgInfo = await page.evaluate(() => {
    const renderApp = window.cartonBuilderApp?.render;
    const renderer = renderApp?.getRenderer?.();
    const sceneController = renderer?.sceneController;
    const scene = sceneController?.renderSurface?.scene;
    const appCtrl = sceneController?.appearanceController;
    const bg = scene?.background;
    const env = scene?.environment;
    return {
      bgModeValue: document.getElementById('renderBackgroundMode')?.value,
      statusText: document.getElementById('renderStatus')?.textContent,
      fileName: document.getElementById('renderEnvironmentMapFileName')?.textContent,
      envMapUsage: document.getElementById('renderEnvironmentMapUsage')?.value,
      threeScene: {
        hasRenderer: Boolean(renderer),
        rendererConstructor: renderer?.constructor?.name,
        hasSceneController: Boolean(sceneController),
        sceneControllerConstructor: sceneController?.constructor?.name,
        hasScene: Boolean(scene),
        bgType: bg?.constructor?.name,
        bgMapping: bg?.mapping,
        bgIsTexture: bg?.isTexture,
        bgImageWidth: bg?.image?.width,
        bgImageHeight: bg?.image?.height,
        envType: env?.constructor?.name,
        envMapping: env?.mapping,
        envImageWidth: env?.image?.width,
        envImageHeight: env?.image?.height,
        appCtrlEnvTextureMapping: appCtrl?._environmentTexture?.mapping,
        appCtrlEnvEquirectMapping: appCtrl?._environmentEquirectangular?.mapping,
        appCtrlBgMode: appCtrl?._backgroundMode,
      },
    };
  });
  console.log('THREE SCENE DETAILS:', JSON.stringify(bgInfo, null, 2));

  // 3. Select Abandoned Hall 01 to verify environment changes visibly
  console.log('Selecting Abandoned Hall 01...');
  await page.locator('#renderEnvironmentMapPreset').selectOption('polyhaven-abandoned-hall-01');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/hdri-abandoned-hall.png' });

  // 4. Test Rotation slider
  console.log('Testing Rotation slider...');
  await page.locator('#renderEnvironmentMapRotation').fill('90');
  await page.locator('#renderEnvironmentMapRotation').dispatchEvent('input');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/hdri-rotated-90.png' });

  // 5. Test Background Blur slider
  console.log('Testing Background Blur slider...');
  await page.locator('#renderEnvironmentMapBackgroundBlur').fill('0.5');
  await page.locator('#renderEnvironmentMapBackgroundBlur').dispatchEvent('input');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/hdri-blurred.png' });

  // 6. Test Choose File upload
  console.log('Testing Choose File upload...');
  const filePath = 'public/render-environments/polyhaven/peppermint_powerplant_1k.hdr';
  await page.locator('#renderEnvironmentMapFile').setInputFiles(filePath);
  await page.waitForTimeout(4000);

  const fileInfo = await page.evaluate(() => {
    return {
      inputValue: document.getElementById('renderEnvironmentMapFile')?.value,
      statusText: document.getElementById('renderStatus')?.textContent,
      fileNameText: document.getElementById('renderEnvironmentMapFileName')?.textContent,
      presetValue: document.getElementById('renderEnvironmentMapPreset')?.value,
    };
  });
  console.log('Custom file upload info:', JSON.stringify(fileInfo, null, 2));
  expect(fileInfo.inputValue).toContain('peppermint_powerplant_1k.hdr');
  expect(fileInfo.statusText).toBe('Environment map loaded.');

  await page.screenshot({ path: 'C:/Users/pavel/.gemini/antigravity/brain/6229f135-b37c-4346-9486-e47042c6a94e/scratch/hdri-custom-file.png' });

  // 7. Test Reset to neutral button
  console.log('Testing Reset to neutral button...');
  await page.locator('#renderClearEnvironmentMapButton').click();
  await page.waitForTimeout(1000);

  const resetInfo = await page.evaluate(() => {
    return {
      inputValue: document.getElementById('renderEnvironmentMapFile')?.value,
      presetValue: document.getElementById('renderEnvironmentMapPreset')?.value,
      fileNameText: document.getElementById('renderEnvironmentMapFileName')?.textContent,
    };
  });
  console.log('Reset info:', JSON.stringify(resetInfo, null, 2));
  expect(resetInfo.inputValue).toBe('');
  expect(resetInfo.presetValue).toBe('neutral-softbox');
});
