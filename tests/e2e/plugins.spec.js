import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

test('loads vendored PBD with enforced CSP, error tracking and no external requests', async ({ page, baseURL }) => {
  const hostOrigin = new URL(baseURL).origin;
  const externalRequests = [];
  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
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
  expect(pageErrors).toEqual([]);
});

test('loads vendored Viewer, renders 3D WebGL viewport, and verifies offline CSP', async ({ page, baseURL }) => {
  const hostOrigin = new URL(baseURL).origin;
  const externalRequests = [];
  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== hostOrigin) externalRequests.push(request.url());
  });

  const response = await page.goto('/plugins/carton-fold-viewer/2.4.0/index.html', {
    waitUntil: 'networkidle',
  });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('body')).toBeVisible();

  // Verify brand version
  const brand = await page.locator('.brand').textContent();
  expect(brand).toContain('v2.4');

  // Verify WebGL Canvas is initialized
  await expect(page.locator('#viewport canvas')).toBeVisible();

  // Verify CSP
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("connect-src 'none'");

  // Verify UI controls and options
  await expect(page.locator('#fitBtn')).toBeVisible();
  await expect(page.locator('#displayModeSel')).toBeVisible();
  await expect(page.locator('#gridChk')).toBeChecked();

  // Toggle wireframe and display mode
  await page.locator('#wireChk').check();
  expect(await page.locator('#wireChk').isChecked()).toBe(true);

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('converts semantic SVG dieline into animated 3D foldable model in vendored Viewer', async ({ page, baseURL }) => {
  const hostOrigin = new URL(baseURL).origin;
  const externalRequests = [];
  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== hostOrigin) externalRequests.push(request.url());
  });

  await page.goto('/plugins/carton-fold-viewer/2.4.0/index.html', {
    waitUntil: 'networkidle',
  });

  const sampleSvgPath = path.resolve(
    repoRoot,
    'vendor/plugins/carton-fold-viewer/2.4.0/assets/samples/carton-rte-reference-v0.10.0.svg'
  );

  // Upload semantic SVG
  const fileInput = page.locator('#fileInput');
  await fileInput.setInputFiles(sampleSvgPath);

  // Verify converted model badge and enablements
  await expect(page.locator('#modelBadge')).toContainText('pbd.svg.v4', { timeout: 10000 });
  await expect(page.locator('#saveGlbBtn')).toBeEnabled();
  await expect(page.locator('#slider')).toBeEnabled();
  await expect(page.locator('#foldBtn')).toBeEnabled();
  await expect(page.locator('#unfoldBtn')).toBeEnabled();

  // Verify animations populated
  const clipOptions = await page.locator('#clipSelect option').allTextContents();
  expect(clipOptions.some((opt) => /assembly|simultaneous/i.test(opt))).toBe(true);

  // Interact with fold button
  await page.locator('#foldBtn').click();
  const pct = await page.locator('#pct').textContent();
  expect(pct).toBe('100.0%');

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
