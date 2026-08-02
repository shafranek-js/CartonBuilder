import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('opens the bundled example on the first application visit only', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText(
    'Carton Calmdownol 1000 mg 110x70x30 outlined.ai',
  );
  await expect(page.locator('#panelCount')).toHaveText('6/6');

  await page.evaluate(async () => {
    const request = indexedDB.open('carton-builder', 4);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readwrite');
      transaction.objectStore('projects').clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');
});
