import { expect, test } from '@playwright/test';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';
import { validateBytes } from 'gltf-validator';
import { inflateSync } from 'node:zlib';

test.setTimeout(process.env.CI ? 360_000 : 240_000);

const FIXTURES = ['RTE', 'STE', 'TT_SL123'];
const exportDownloadTimeout = process.env.CI ? 180_000 : 60_000;
const sequenceDownloadTimeout = process.env.CI ? 300_000 : 180_000;

async function resetProject(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('carton-builder', 6);
    await new Promise((resolve) => {
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.close();
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

async function loadAsymmetricArtwork(page, fileName) {
  await page.evaluate(async (name) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f5d548';
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#1747a6';
    context.fillRect(24, 22, 380, 190);
    context.fillStyle = '#d42f45';
    context.beginPath();
    context.moveTo(640, 0);
    context.lineTo(640, 230);
    context.lineTo(430, 0);
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = 'bold 48px sans-serif';
    context.fillText('TOP LEFT', 50, 105);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], name, { type: 'image/png' }));
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileName);
  await expect(page.locator('#artworkFileName')).toHaveText(fileName);
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

async function openTechnicalArtwork(page, cartonType = 'RTE') {
  await page.locator('button[data-workflow-mode="technical"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();
  const pbd = page.frameLocator('#technicalHostFrame');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  if (cartonType !== 'RTE') {
    await pbd.locator('#cartonType').selectOption(cartonType);
    await expect(page.locator('#technicalHostValidation')).toHaveText(
      'Structural VALID · Geometry VALID · Contract VALID',
    );
  }
  await expect(pbd.locator('#cartonType')).toHaveValue(cartonType);
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await loadAsymmetricArtwork(page, `technical-render-${cartonType}.png`);
  await expect(page.locator('.step[data-step-target="render"]')).toBeEnabled();
}

async function openTechnicalRender(page, cartonType = 'RTE', { visitPreview = false } = {}) {
  await openTechnicalArtwork(page, cartonType);
  if (visitPreview) {
    await page.locator('.step[data-step-target="preview"]').click();
    await expect(page.locator('#technicalPreviewPanel')).toBeVisible();
    await expect(page.locator('#technicalViewerStatus')).toContainText(/verified|loaded/i, { timeout: 30_000 });
    await expect(page.locator('#openRenderButton')).toBeEnabled();
  }
  await page.locator('.step[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  expect(await page.evaluate(
    () => window.cartonBuilderApp.render.whenStable({ timeoutMs: 60_000 }),
  )).toBe(true);
  await expect(page.locator('#renderRecovery')).toBeHidden();
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function readGlbJson(bytes) {
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
}

function inspectPngAlpha(bytes) {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const chunks = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  expect(colorType).toBe(6);
  const inflated = inflateSync(Buffer.concat(chunks));
  const rowBytes = width * 4;
  let previous = Buffer.alloc(rowBytes);
  let cursor = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor++];
    const row = Buffer.from(inflated.subarray(cursor, cursor + rowBytes));
    cursor += rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const above = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      else if (filter === 2) row[x] = (row[x] + above) & 0xff;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft)) & 0xff;
      } else expect(filter).toBe(0);
    }
    for (let x = 3; x < rowBytes; x += 4) {
      minAlpha = Math.min(minAlpha, row[x]);
      maxAlpha = Math.max(maxAlpha, row[x]);
    }
    previous = row;
  }
  return { width, height, minAlpha, maxAlpha };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
  });
  await resetProject(page);
});

test.describe('Release 3 Technical Render acceptance', () => {
  test('routes RTE, STE and TT_SL123 through the canonical Technical renderer', async ({ page }) => {
    for (const cartonType of FIXTURES) {
      if (cartonType !== FIXTURES[0]) await resetProject(page);
      await openTechnicalRender(page, cartonType, { visitPreview: true });
      const result = await page.evaluate(() => ({
        diagnostics: window.cartonBuilderApp.render.getDiagnostics(),
        state: window.cartonBuilderApp.getState(),
      }));
      expect(result.diagnostics).toMatchObject({
        source: 'technical',
        built: true,
        foldProgress: 1,
        sourceUnits: 'mm',
        renderUnits: 'm',
      });
      expect(result.state.cartonSource).toMatchObject({
        source: {
          cartonType,
          referenceOnly: true,
          productionCertified: false,
        },
        capabilities: { technicalRender: true },
      });
      expect(await page.locator('#renderCanvas').screenshot({ animations: 'disabled' }))
        .not.toEqual(Buffer.alloc(0));
    }
  });

  test('preserves asymmetric artwork transforms and applies finishes, optics and appearance', async ({ page }) => {
    await openTechnicalArtwork(page);
    await page.locator('#artworkScaleX').fill('137');
    await page.locator('#artworkScaleX').dispatchEvent('change');
    await page.locator('#artworkScaleY').fill('83');
    await page.locator('#artworkScaleY').dispatchEvent('change');
    await page.getByRole('button', { name: 'Rotate +90°' }).click();
    const before = await page.evaluate(() => {
      const artwork = window.cartonBuilderApp.artwork.artwork;
      return { scaleX: artwork.scaleX, scaleY: artwork.scaleY, rotation: artwork.rotation };
    });

    await page.locator('#artworkFinishRole').selectOption('print-and-finish');
    await page.locator('#artworkFinishType').selectOption('spot-gloss');
    await loadAsymmetricArtwork(page, 'technical-foil.png');
    await page.locator('#artworkFinishRole').selectOption('print-and-finish');
    await page.locator('#artworkFinishType').selectOption('foil');
    await loadAsymmetricArtwork(page, 'technical-emboss.png');
    await page.locator('#artworkFinishRole').selectOption('print-and-finish');
    await page.locator('#artworkFinishType').selectOption('emboss');

    await page.locator('.step[data-step-target="preview"]').click();
    await expect(page.locator('#technicalViewerStatus')).toContainText(/verified|loaded/i, { timeout: 30_000 });
    expect(await page.evaluate(() => {
      const first = window.cartonBuilderApp.artwork.getArtworks().at(-1)?.model;
      return { scaleX: first.scaleX, scaleY: first.scaleY, rotation: first.rotation };
    })).toEqual(before);
    await page.locator('.step[data-step-target="render"]').click();
    await expect(page.locator('#renderStep')).toBeVisible();
    expect(await page.evaluate(
      () => window.cartonBuilderApp.render.whenStable({ timeoutMs: 60_000 }),
    )).toBe(true);

    for (const lens of ['35', '50', '85']) {
      await page.locator('#renderProjection').selectOption('perspective');
      await page.locator('#renderCameraLens').selectOption(lens);
      await expect(page.locator('#renderCameraLens')).toHaveValue(lens);
    }
    await page.locator('#renderProjection').selectOption('orthographic');
    await page.locator('#renderEnvironment').selectOption('cool');
    await page.locator('#renderBackgroundMode').selectOption('environment');
    await page.locator('#renderShadowEnabled').check();
    await page.locator('#renderFloorReflectionEnabled').check();
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState()))
      .toMatchObject({
        camera: { projection: 'orthographic', lens: '85' },
        lighting: { environment: 'cool' },
        background: { mode: 'environment' },
        shadows: { enabled: true },
        floor: { reflection: { enabled: true } },
      });
    await expect(page.locator('#renderFinishSummary')).toContainText(/spot gloss/i);
    await expect(page.locator('#renderFinishSummary')).toContainText(/foil/i);
    await expect(page.locator('#renderFinishSummary')).toContainText(/emboss/i);
  });

  test('exports a real transparent PNG with alpha', async ({ page }) => {
    await openTechnicalRender(page);
    await page.locator('#renderLongEdge').selectOption('2048');
    await page.locator('#renderBackgroundMode').selectOption('transparent');
    await page.locator('#renderTransparentShadow').uncheck();
    await page.locator('#renderPngButton').click();
    await expect(page.locator('#renderExportDialog')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: exportDownloadTimeout }),
      page.locator('#renderExportForm button[value="confirm"]').click(),
    ]);
    const summary = inspectPngAlpha(await readDownload(download));
    expect(summary).toMatchObject({ width: 2048, height: 2048, minAlpha: 0, maxAlpha: 255 });
  });

  test('exports and reopens Technical turntable and GLB payloads', async ({ page }) => {
    await openTechnicalRender(page);
    await page.locator('#renderPngButton').click();
    await page.locator('#renderExportKind').selectOption('sequence');
    await page.locator('#renderExportSequenceFrames').selectOption('24');
    await page.locator('#renderExportSequenceLongEdge').selectOption('512');
    await page.locator('#renderExportSequenceFormat').selectOption('png');
    const [turntableDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: sequenceDownloadTimeout }),
      page.locator('#renderExportForm button[value="confirm"]').click(),
    ]);
    const zip = new ZipReader(new BlobReader(new Blob([await readDownload(turntableDownload)])));
    const entries = await zip.getEntries();
    expect(entries.map((entry) => entry.filename)).toEqual(Array.from({ length: 24 }, (_, index) => (
      `frame-${String(index + 1).padStart(3, '0')}.png`
    )));
    const firstFrameBlob = await entries[0].getData(new BlobWriter('image/png'));
    const firstFrame = Buffer.from(await firstFrameBlob.arrayBuffer());
    await zip.close();
    expect(firstFrame.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    await page.locator('#renderPngButton').click();
    await page.locator('#renderExportKind').selectOption('glb');
    await page.locator('#renderExportGlbTextureSize').selectOption('1024');
    const [glbDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: exportDownloadTimeout }),
      page.locator('#renderExportForm button[value="confirm"]').click(),
    ]);
    const glb = await readDownload(glbDownload);
    const report = await validateBytes(new Uint8Array(glb), { format: 'glb' });
    expect(report.issues.numErrors).toBe(0);
    const json = readGlbJson(glb);
    expect(json.scenes[0].extras.cartonBuilder).toMatchObject({
      source: 'technical',
      cartonType: 'RTE',
      modelSchemaVersion: 'pbd.model.v1',
      svgSchemaVersion: 'pbd.svg.v4',
      referenceOnly: true,
      productionCertified: false,
    });
    expect(json.nodes.some((node) => node.extras?.panel_id)).toBe(true);
    expect(json.nodes.some((node) => node.extras?.fold_id)).toBe(true);
  });

  test('restores Technical Step 4 and keeps resources bounded across twenty lifecycle cycles', async ({ page }) => {
    await openTechnicalRender(page);
    await page.locator('#renderProjection').selectOption('orthographic');
    await page.locator('#renderEnvironment').selectOption('warm');
    await page.locator('#renderFloorReflectionEnabled').check();
    expect(await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave())).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#renderStep')).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(
      () => window.cartonBuilderApp.render.whenStable({ timeoutMs: 60_000 }),
    )).toBe(true);
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState()))
      .toMatchObject({
        camera: { projection: 'orthographic' },
        lighting: { environment: 'warm' },
        floor: { reflection: { enabled: true } },
      });
    const initial = await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics());
    for (let index = 0; index < 20; index += 1) {
      await page.locator('.step[data-step-target="artwork"]').click();
      await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 15_000 });
      await page.locator('.step[data-step-target="render"]').click();
      await expect(page.locator('#renderStep')).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(
        () => window.cartonBuilderApp.render.whenStable({ timeoutMs: 60_000 }),
      )).toBe(true);
    }
    const final = await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics());
    expect(final).toMatchObject({ source: 'technical', contextState: 'ready' });
    expect(final.geometries).toBeLessThanOrEqual(initial.geometries + 1);
    expect(final.textures).toBeLessThanOrEqual(initial.textures + 1);
    expect(final.workflowExport?.counters.orchestratorDisposals ?? 0).toBeLessThanOrEqual(20);
  });
});
