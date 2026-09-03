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

test.describe('Technical Dieline Swap Front/Back panel designation', () => {
  test('toggles Front and Back panel designations across Step 1 and Step 2', async ({ page }) => {
    await resetProject(page);

    // 1. Select Technical Workflow
    const card = page.locator('button[data-workflow-mode="technical"]');
    await card.click();
    await expect(page.locator('#boxStep')).toBeVisible();
    await expect(page.locator('#technicalHostValidation')).toHaveText(
      'Structural VALID · Geometry VALID · Contract VALID',
      { timeout: 25_000 },
    );

    // Verify Step 1 Swap Front/Back button is present and not swapped initially
    const technicalSwapBtn = page.locator('#technicalSwapFrontBackBtn');
    await expect(technicalSwapBtn).toBeVisible();
    await expect(technicalSwapBtn).toHaveAttribute('data-swapped', 'false');

    // 2. Navigate to Step 2 Artwork
    await page.locator('.step[data-step-target="artwork"]').click();
    await expect(page.locator('#artworkStep')).toBeVisible();

    // Add a simple test artwork
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 300;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ff6600';
      context.fillRect(0, 0, 400, 300);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], 'swap-test.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('artworkFileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Verify Front-relative coordinates section and artwork swap button are visible
    const frontRelativeCoord = page.locator('#frontRelativeCoordinates');
    await expect(frontRelativeCoord).toBeVisible();
    const artworkSwapBtn = page.locator('#artworkSwapFrontBackBtn');
    await expect(artworkSwapBtn).toBeVisible();
    await expect(artworkSwapBtn).toHaveAttribute('data-swapped', 'false');

    // Get initial Front X and Front Y
    const initialFrontX = await page.locator('#frontRelativeX').textContent();
    const initialFrontY = await page.locator('#frontRelativeY').textContent();
    expect(initialFrontX).not.toBe('—');
    expect(initialFrontY).not.toBe('—');

    // 3. Click Swap Front/Back in Step 2
    await artworkSwapBtn.click();

    // Verify button swapped states update in both Step 1 and Step 2
    await expect(artworkSwapBtn).toHaveAttribute('data-swapped', 'true');
    await expect(technicalSwapBtn).toHaveAttribute('data-swapped', 'true');

    // Front-relative coordinates should now calculate from the new Front (body.back)
    const swappedFrontX = await page.locator('#frontRelativeX').textContent();
    expect(swappedFrontX).not.toBe(initialFrontX);

    // 4. Toggle back to verify revert
    await artworkSwapBtn.click();
    await expect(artworkSwapBtn).toHaveAttribute('data-swapped', 'false');
    await expect(technicalSwapBtn).toHaveAttribute('data-swapped', 'false');

    const revertedFrontX = await page.locator('#frontRelativeX').textContent();
    expect(revertedFrontX).toBe(initialFrontX);
  });
});
