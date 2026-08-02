import { test, expect } from '@playwright/test';

test('exposes the Calmdownol showcase link from the app', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#previewShowcaseLink')).toHaveAttribute('href', './showcase/calmdownol/index.html');
  await expect(page.locator('#previewShowcaseLink')).toHaveAttribute('target', '_blank');
});

test('serves the showcase and lazy-loads the interactive viewer', async ({ page }) => {
  const viewerRequests = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/showcase/calmdownol/viewer.html')) viewerRequests.push(request.url());
  });

  await page.goto('/showcase/calmdownol/index.html');
  await expect(page.getByRole('heading', { name: 'Calm downol®' })).toBeVisible();
  await expect(page.locator('#cartonViewer')).not.toHaveAttribute('src', /.+/);
  expect(viewerRequests).toHaveLength(0);

  await page.getByRole('button', { name: 'Load interactive model' }).click();
  await expect(page.locator('#cartonViewer')).toHaveAttribute('src', './viewer.html');
  await expect(page.locator('#cartonViewer')).toBeVisible();
  await expect(page.frameLocator('#cartonViewer').locator('canvas#viewer')).toHaveCount(1, { timeout: 30_000 });
  expect(viewerRequests).toHaveLength(1);
});
