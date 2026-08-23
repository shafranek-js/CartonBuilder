import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

test('loads vendored PBD with enforced CSP, error tracking and no external requests', async ({
  page,
  baseURL,
}) => {
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
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("form-action 'none'");
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('loads vendored Viewer in declared sandboxed iframe, renders 3D WebGL viewport, and verifies offline CSP', async ({
  page,
  baseURL,
}) => {
  const hostOrigin = new URL(baseURL).origin;
  const externalRequests = [];
  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== hostOrigin) externalRequests.push(request.url());
  });

  await page.setContent(`
    <!doctype html>
    <html>
    <head><title>Viewer Sandbox Test Harness</title></head>
    <body style="margin:0;padding:0;overflow:hidden;">
      <iframe
        id="viewerFrame"
        src="${baseURL}/plugins/carton-fold-viewer/2.4.0/index.html"
        sandbox="allow-scripts"
        style="width:100vw;height:100vh;border:none;"
      ></iframe>
    </body>
    </html>
  `);

  const frame = page.frameLocator('#viewerFrame');

  // Verify brand version
  await expect(frame.locator('.brand')).toContainText('v2.4', { timeout: 10000 });

  // Verify WebGL Canvas is initialized
  await expect(frame.locator('#viewport canvas')).toBeVisible();

  // Verify CSP in iframe
  const csp = await frame
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("form-action 'none'");

  // Embedded mode waits for host:init and hides standalone-only controls.
  await expect(frame.locator('.fileBtn')).toBeHidden();
  await expect(frame.locator('#fitBtn')).toBeHidden();
  await expect(frame.locator('#saveGlbBtn')).toBeHidden();
  await expect(frame.locator('#displayModeSel')).toBeVisible();
  await expect(frame.locator('#gridChk')).toBeChecked();

  // Toggle wireframe and display mode
  await frame.locator('#wireChk').check();
  expect(await frame.locator('#wireChk').isChecked()).toBe(true);

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('converts semantic SVGs (RTE, STE, TT_SL123/A55) into animated 3D foldable models in Viewer sandboxed iframe', async ({
  page,
  baseURL,
}) => {
  const hostOrigin = new URL(baseURL).origin;
  const externalRequests = [];
  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== hostOrigin) externalRequests.push(request.url());
  });

  await page.setContent(`
    <!doctype html>
    <html>
    <head><title>Viewer Multi-Model Sandbox Test Harness</title></head>
    <body style="margin:0;padding:0;overflow:hidden;">
      <iframe
        id="viewerFrame"
        src="${baseURL}/plugins/carton-fold-viewer/2.4.0/index.html"
        sandbox="allow-scripts"
        style="width:100vw;height:100vh;border:none;"
      ></iframe>
    </body>
    </html>
  `);

  const frame = page.frameLocator('#viewerFrame');
  await expect(frame.locator('#viewport canvas')).toBeVisible({ timeout: 10000 });

  const fixturesDir = path.resolve(
    repoRoot,
    'vendor/plugins/packaging-box-designer/1.2.0/contract/fixtures'
  );

  const testCases = [
    {
      name: 'RTE',
      file: 'rte-workflow.v1.json',
      expectedClipPattern: /assembly|simultaneous/i,
    },
    {
      name: 'STE',
      file: 'ste-workflow.v1.json',
      expectedClipPattern: /assembly|simultaneous/i,
    },
    {
      name: 'TT_SL123_A55',
      file: 'tt_sl123-workflow.v1.json',
      expectedClipPattern: /assembly|simultaneous/i,
    },
  ];

  for (const tc of testCases) {
    const fixturePath = path.join(fixturesDir, tc.file);
    const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const svgMarkup = fixtureData.semanticSvg?.markup;
    expect(svgMarkup).toBeTruthy();

    const fileInput = frame.locator('#fileInput');
    await fileInput.setInputFiles({
      name: `${tc.name}.svg`,
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(svgMarkup, 'utf8'),
    });

    // Verify converted model badge and enablements
    await expect(frame.locator('#modelBadge')).toContainText('pbd.svg.v4', { timeout: 10000 });
    await expect(frame.locator('#saveGlbBtn')).toBeEnabled();
    await expect(frame.locator('#slider')).toBeEnabled();
    await expect(frame.locator('#foldBtn')).toBeEnabled();
    await expect(frame.locator('#unfoldBtn')).toBeEnabled();

    // Verify positive node and mesh counts
    const nodeCountText = await frame.locator('#nodeInfo').textContent();
    const meshCountText = await frame.locator('#meshInfo').textContent();
    expect(parseInt(nodeCountText, 10)).toBeGreaterThan(0);
    expect(parseInt(meshCountText, 10)).toBeGreaterThan(0);

    // Verify animations populated
    const clipOptions = await frame.locator('#clipSelect option').allTextContents();
    expect(clipOptions.length).toBeGreaterThan(0);
    expect(clipOptions.some((opt) => tc.expectedClipPattern.test(opt))).toBe(true);

    // Interact with fold button
    await frame.locator('#foldBtn').click();
    await expect(frame.locator('#pct')).toHaveText('100.0%');

    // Interact with unfold button
    await frame.locator('#unfoldBtn').click();
    await expect(frame.locator('#pct')).toHaveText('0.0%');
  }

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
