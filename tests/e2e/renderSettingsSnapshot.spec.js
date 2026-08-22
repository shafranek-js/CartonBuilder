import { expect, test } from '@playwright/test';

test.setTimeout(process.env.CI ? 180_000 : 90_000);

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

async function loadArtwork(page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2454c4';
    context.fillRect(0, 0, 600, 400);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'snapshot-fixture.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#artworkFileName')).toHaveText('snapshot-fixture.png');
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

async function openRender(page) {
  await expect(page.locator('#processingOverlay')).toBeHidden({ timeout: 30_000 });
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await loadArtwork(page);
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#renderRecovery')).toBeHidden();
}

test('Settings export/import round-trips full render settings', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('carton-builder', 6);
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
  await openRender(page);

  await page.locator('#renderCameraPreset').selectOption('front-right');
  await page.locator('#renderAspect').selectOption('wide');
  await page.locator('#renderLongEdge').selectOption('4096');
  await page.locator('#renderEnvironment').selectOption('warm');
  await page.locator('#renderBoardThickness').fill('0.8');
  await page.locator('#renderBoardBevel').fill('0.25');
  await page.locator('#renderBoardInteriorColor').fill('#abcdef');
  await page.locator('#renderBoardEdgeColor').fill('#123456');
  await page.locator('#renderEffectsDof').check();
  await page.locator('#renderShadowMapSize').selectOption('2048');
  await page.locator('#renderQualityExport').selectOption('high');
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 20_000 });

  const before = await page.evaluate(() => ({
    settings: window.cartonBuilderApp.render.getState(),
    board: window.cartonBuilderApp.render.getBoardAppearance(),
  }));

  const exported = await page.evaluate(async () => {
    const snapshot = {
      renderSettings: window.cartonBuilderApp.render.getState(),
      boardAppearance: window.cartonBuilderApp.render.getBoardAppearance(),
    };
    return JSON.stringify(snapshot, null, 2);
  });

  await page.evaluate(async (json) => {
    const parsed = JSON.parse(json);
    window.cartonBuilderApp.render.applySettings({
      renderSettings: parsed.renderSettings,
      boardAppearance: parsed.boardAppearance,
    });
  }, exported);

  const after = await page.evaluate(() => ({
    settings: window.cartonBuilderApp.render.getState(),
    board: window.cartonBuilderApp.render.getBoardAppearance(),
  }));
  expect(after.settings).toEqual(before.settings);
  expect(after.board).toEqual(before.board);

  await expect(page.locator('#renderAspect')).toHaveValue('wide');
  await expect(page.locator('#renderLongEdge')).toHaveValue('4096');
  await expect(page.locator('#renderEnvironment')).toHaveValue('warm');
  await expect(page.locator('#renderBoardThickness')).toHaveValue('0.8');
  await expect(page.locator('#renderBoardBevel')).toHaveValue('0.25');
  await expect(page.locator('#renderBoardInteriorColor')).toHaveValue('#abcdef');
  await expect(page.locator('#renderBoardEdgeColor')).toHaveValue('#123456');
  await expect(page.locator('#renderEffectsDof')).toBeChecked();
  await expect(page.locator('#renderShadowMapSize')).toHaveValue('2048');
  await expect(page.locator('#renderQualityExport')).toHaveValue('high');
});
