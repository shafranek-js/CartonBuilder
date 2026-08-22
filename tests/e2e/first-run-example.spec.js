import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('keeps Step 0 hidden and non-interactive while the first-run archive restores', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__firstRunArchiveFetchStarted = false;
    window.fetch = async (input, init) => {
      const url = String(input?.url || input);
      if (url.includes('Calmdownol_template.carton')) {
        window.__firstRunArchiveFetchStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      return nativeFetch(input, init);
    };
  });

  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('carton-builder');
      request.onsuccess = request.onerror = request.onblocked = resolve;
    });
  });
  await page.reload();

  await expect.poll(() => page.evaluate(() => window.__firstRunArchiveFetchStarted)).toBe(true);
  await expect(page.locator('#workflowStep')).toBeHidden();
  await expect(page.locator('button[data-workflow-mode="quick"]')).toBeHidden();
  await expect(page.locator('#boxStep')).toBeHidden();
  await expect(page.locator('#artworkStep')).toBeHidden();
  await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });
});

test('opens the bundled example on the first application visit only', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('carton-builder');
      request.onsuccess = request.onerror = request.onblocked = resolve;
    });
  });
  await page.reload();

  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText(
    'Carton Calmdownol 1000 mg 110x70x30 outlined.ai',
  );
  await expect(page.locator('#panelCount')).toHaveText('6/6');

  await page.evaluate(async () => {
    const request = indexedDB.open('carton-builder', 6);
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
  await expect(page.locator('#workflowStep')).toBeVisible();
  await expect(page.locator('#boxStep')).toBeHidden();
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');
  expect(await page.evaluate(() => window.cartonBuilderApp.getState())).toBe(null);
  await page.locator('button[data-workflow-mode="quick"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();
});
