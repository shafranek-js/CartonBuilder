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
  await expect(page.getByRole('heading', { name: 'Calmdownol®' })).toBeVisible();
  await expect(page.locator('#siteMusic')).toHaveAttribute('src', './assets/royal-lemur-protocol.mp3');
  const musicToggle = page.locator('#musicToggle');
  await expect(musicToggle).toHaveAttribute('aria-pressed', 'true');
  await musicToggle.click();
  await expect(musicToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(musicToggle).toContainText('Music: off');
  await expect(page.locator('#cartonViewer')).not.toHaveAttribute('src', /.+/);
  expect(viewerRequests).toHaveLength(0);

  await page.getByRole('button', { name: 'Load interactive model' }).click();
  await expect(page.locator('#cartonViewer')).toHaveAttribute('src', './viewer.html');
  await expect(page.locator('#cartonViewer')).toHaveAttribute('allowfullscreen', '');
  await expect(page.locator('#cartonViewer')).toBeVisible();
  const viewer = page.frameLocator('#cartonViewer');
  await expect(viewer.locator('canvas#viewer')).toHaveCount(1, { timeout: 30_000 });
  await expect(viewer.locator('#panel')).toBeHidden();
  await expect(viewer.locator('#panelToggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(viewer.locator('#fullscreenToggle')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#cartonViewer').scrollIntoViewIfNeeded();
  await viewer.locator('#panelToggle').dispatchEvent('click');
  await expect(viewer.locator('#panel')).toBeVisible();
  await expect(viewer.locator('#panelToggle')).toHaveAttribute('aria-expanded', 'true');
  await viewer.locator('#panelToggle').dispatchEvent('click');
  await expect(viewer.locator('#panel')).toBeHidden();
  expect(viewerRequests).toHaveLength(1);
});
