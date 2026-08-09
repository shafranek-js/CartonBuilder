import { expect, test } from '@playwright/test';

test('STE and RTE construction library builds polygon assembly without blank preview', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await page.waitForTimeout(1200);
  await page.selectOption('#constructionTemplate', 'ste');
  await expect(page.locator('#constructionStatus')).toContainText('STE');
  await expect(page.locator('#panelCount')).toHaveText('6/6 · 13');
  await expect(page.locator('#workspace .polygon-element')).toHaveCount(13);
  await page.selectOption('#constructionTemplate', 'rte');
  await expect(page.locator('#constructionStatus')).toContainText('RTE');
  await expect(page.locator('#workspace .polygon-element')).toHaveCount(13);

  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    context.fillStyle = '#d8ef79';
    context.fillRect(0, 0, 120, 80);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const input = document.getElementById('artworkFileInput');
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'construction.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#artworkFileName')).toHaveText('construction.png');
  await expect(page.locator('#processingOverlay')).toBeHidden();
  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('#assemblyStage')).toContainText('Closed');
  await page.evaluate(() => {
    const slider = document.getElementById('foldProgress');
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#assemblyStage')).not.toHaveText('');
  await expect(page.locator('#preview3dCanvas')).toBeVisible();
  await expect(page.locator('#preview3dRecovery')).toBeHidden({ timeout: 15000 });
  await page.locator('#openRenderButton').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect(page.locator('#renderCanvas')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
