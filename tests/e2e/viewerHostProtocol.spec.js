import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const CONTRACT_VERSION = 'carton-workflow.v1';
const VIEWER_URL = '/plugins/carton-fold-viewer/2.4.0/index.html';
const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const fixturesDir = path.resolve(
  repoRoot,
  'vendor/plugins/packaging-box-designer/1.2.0/contract/fixtures'
);

const testCases = [
  { cartonType: 'RTE', file: 'rte-workflow.v1.json' },
  { cartonType: 'STE', file: 'ste-workflow.v1.json' },
  { cartonType: 'TT_SL123', file: 'tt_sl123-workflow.v1.json' },
];

async function waitForMessage(page, predicate, arg = undefined) {
  await page.waitForFunction(predicate, arg, { timeout: 20_000 });
}

test('embedded viewer exchanges carton-workflow.v1 messages in a sandbox with opaque origin', async ({
  page,
  baseURL,
}) => {
  const hostOrigin = new URL(baseURL).origin;
  const targetOrigin = '*';
  const externalRequests = [];
  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== hostOrigin) externalRequests.push(request.url());
  });

  await page.setContent(`
    <!doctype html>
    <html>
    <head><title>Embedded Viewer Protocol Harness</title></head>
    <body style="margin:0;padding:0;overflow:hidden;">
      <script>
        window.__viewerMessages = [];
        window.addEventListener('message', (event) => {
          const frame = document.getElementById('viewerFrame');
          if (frame && event.source === frame.contentWindow) {
            window.__viewerMessages.push({ origin: event.origin, data: event.data });
          }
        });
      </script>
      <iframe
        id="viewerFrame"
        src="${baseURL}${VIEWER_URL}"
        sandbox="allow-scripts"
        style="width:100vw;height:100vh;border:none;"
      ></iframe>
    </body>
    </html>
  `);

  const frame = page.frameLocator('#viewerFrame');
  await expect(frame.locator('#viewport canvas')).toBeVisible({ timeout: 10_000 });
  await expect(frame.locator('.fileBtn')).toBeHidden();
  await expect(frame.locator('#fitBtn')).toBeHidden();
  await expect(frame.locator('#saveGlbBtn')).toBeHidden();

  await page.evaluate(({ targetOrigin }) => {
    const frame = document.getElementById('viewerFrame');
    frame.contentWindow.postMessage({
      contractVersion: 'carton-workflow.v1',
      type: 'host:init',
      payload: {
        sessionId: 'browser-stage5d',
        contractVersion: 'carton-workflow.v1',
        allowedOrigin: 'null',
        locale: 'en',
        capabilities: { foldPreview: true, technicalRender: false },
        payloadLimits: {
          maxMessageBytes: 64 * 1024 * 1024,
          maxSvgBytes: 8 * 1024 * 1024,
          maxAssetBytes: 32 * 1024 * 1024,
          maxTotalBytes: 64 * 1024 * 1024,
          maxGlbBytes: 64 * 1024 * 1024,
        },
      },
    }, targetOrigin);
  }, { targetOrigin });

  await waitForMessage(page, () => window.__viewerMessages.some((entry) => entry.data?.type === 'plugin:ready'));
  const ready = await page.evaluate(() => window.__viewerMessages.find((entry) => entry.data?.type === 'plugin:ready'));
  expect(ready.origin).toBe('null');
  expect(ready.data.contractVersion).toBe(CONTRACT_VERSION);
  expect(ready.data.payload.pluginId).toBe('carton-fold-viewer');
  expect(ready.data.payload.payloadLimits.maxSvgBytes).toBe(8 * 1024 * 1024);

  for (const testCase of testCases) {
    const fixtureData = JSON.parse(fs.readFileSync(path.join(fixturesDir, testCase.file), 'utf8'));
    const svgText = fixtureData.semanticSvg?.markup;
    expect(svgText).toBeTruthy();
    const loadId = `browser-${testCase.cartonType}`;
    const pngBytes = Buffer.from(PNG_1X1_BASE64, 'base64');

    await page.evaluate(({ targetOrigin, svgText, loadId, svgSha256, pngBase64, pngSha256 }) => {
      const frame = document.getElementById('viewerFrame');
      const encoder = new TextEncoder();
      const fromBase64 = (value) => {
        const raw = atob(value);
        const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
        return bytes.buffer;
      };
      const descriptor = (buffer) => ({
        data: buffer,
        byteLength: buffer.byteLength,
        sha256: pngSha256,
        mimeType: 'image/png',
      });
      const atlas = fromBase64(pngBase64);
      const alpha = fromBase64(pngBase64);
      const normal = fromBase64(pngBase64);
      const payload = {
        loadId,
        name: `${loadId}.svg`,
        semanticSvg: {
          text: svgText,
          byteLength: encoder.encode(svgText).byteLength,
          sha256: svgSha256,
        },
        artworkAtlas: descriptor(atlas),
        maps: {
          alpha: descriptor(alpha),
          normal: descriptor(normal),
        },
        exportGlb: true,
      };
      frame.contentWindow.postMessage({
        contractVersion: 'carton-workflow.v1',
        type: 'viewer:load',
        sessionId: 'browser-stage5d',
        payload,
      }, targetOrigin, [atlas, alpha, normal]);
    }, {
      targetOrigin,
      svgText,
      loadId,
      svgSha256: sha256Hex(svgText),
      pngBase64: PNG_1X1_BASE64,
      pngSha256: sha256Hex(pngBytes),
    });

    await waitForMessage(page, (id) => window.__viewerMessages.some((entry) => (
      entry.data?.type === 'viewer:model-loaded' && entry.data.payload?.loadId === id
    )), loadId);
    await waitForMessage(page, (id) => window.__viewerMessages.some((entry) => (
      entry.data?.type === 'viewer:glb-exported' && entry.data.payload?.loadId === id
    )), loadId);

    const evidence = await page.evaluate((id) => {
      const entry = [...window.__viewerMessages].reverse().find((candidate) => (
        candidate.data?.type === 'viewer:glb-exported' && candidate.data.payload?.loadId === id
      ));
      const model = [...window.__viewerMessages].reverse().find((candidate) => (
        candidate.data?.type === 'viewer:model-loaded' && candidate.data.payload?.loadId === id
      ));
      const bytes = new Uint8Array(entry.data.payload.glb);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return {
        origin: entry.origin,
        contractVersion: entry.data.contractVersion,
        sessionId: entry.data.sessionId,
        modelCartonType: model.data.payload.cartonType,
        panelCount: model.data.payload.panelIds.length,
        animationNames: model.data.payload.animationNames,
        glbByteLength: entry.data.payload.glb.byteLength,
        declaredByteLength: entry.data.payload.byteLength,
        declaredSha256: entry.data.payload.sha256,
        glbBase64: btoa(binary),
        magic: new TextDecoder().decode(bytes.slice(0, 4)),
      };
    }, loadId);
    const actualSha256 = sha256Hex(Buffer.from(evidence.glbBase64, 'base64'));

    expect(evidence.origin).toBe('null');
    expect(evidence.contractVersion).toBe(CONTRACT_VERSION);
    expect(evidence.sessionId).toBe('browser-stage5d');
    expect(evidence.modelCartonType).toBe(testCase.cartonType);
    expect(evidence.panelCount).toBeGreaterThan(0);
    expect(evidence.animationNames.length).toBeGreaterThan(0);
    expect(evidence.glbByteLength).toBe(evidence.declaredByteLength);
    expect(evidence.declaredSha256).toBe(actualSha256);
    expect(evidence.magic).toBe('glTF');

    await page.evaluate(({ targetOrigin, loadId }) => {
      document.getElementById('viewerFrame').contentWindow.postMessage({
        contractVersion: 'carton-workflow.v1',
        type: 'host:cancel',
        sessionId: 'browser-stage5d',
        payload: { reason: `cancel-${loadId}` },
      }, targetOrigin);
    }, { targetOrigin, loadId });
    await waitForMessage(page, (id) => window.__viewerMessages.some((entry) => (
      entry.data?.type === 'viewer:cancelled' && entry.data.payload?.reason === `cancel-${id}`
    )), loadId);
  }

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
