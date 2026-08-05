import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

async function activate(page, label) {
  const action = page.getByRole('button', { name: label });
  await action.focus();
  await action.press('Enter');
}

test('saves visual proof screenshots to artifacts directory', async ({ page }) => {
  const videoBuffer = await readFile('videoplayback.mp4');

  await page.goto('/');

  // Step 1: Build box net
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel');
  await activate(page, 'Add Top Panel to the top edge of Front Panel');

  // Step 2: Place Artwork
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#selectArtworkButton').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles([{
    name: 'videoplayback.mp4',
    mimeType: 'video/mp4',
    buffer: videoBuffer,
  }]);

  await page.waitForTimeout(2000);

  // Save 2D canvas proof screenshot via node:fs/promises
  const buffer2d = await page.screenshot();
  await writeFile('C:/Users/pavel/.gemini/antigravity/brain/bb131d43-ac44-4c98-a199-5b7164488680/2d_canvas_proof.png', buffer2d);

  // Step 3: Go to 3D Preview
  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();

  await page.waitForTimeout(2500);

  // Save 3D preview proof screenshot via node:fs/promises
  const buffer3d = await page.screenshot();
  await writeFile('C:/Users/pavel/.gemini/antigravity/brain/bb131d43-ac44-4c98-a199-5b7164488680/3d_preview_proof.png', buffer3d);
});
