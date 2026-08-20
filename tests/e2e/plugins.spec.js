import { expect, test } from '@playwright/test';

test('loads vendored PBD with enforced CSP and no external requests', async ({ page, baseURL }) => {
  const hostOrigin = new URL(baseURL).origin;
  const externalRequests = [];
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== hostOrigin) externalRequests.push(request.url());
  });

  const response = await page.goto('/plugins/packaging-box-designer/1.2.0/index.html', {
    waitUntil: 'networkidle',
  });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('body')).toBeVisible();

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(externalRequests).toEqual([]);
});
