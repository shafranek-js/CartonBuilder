import { expect, test } from '@playwright/test';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { validateBytes } from 'gltf-validator';
import { inflateSync } from 'node:zlib';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

test.setTimeout(process.env.CI ? 180_000 : 90_000);

const exportDownloadTimeout = process.env.CI ? 180_000 : 30_000;
const sequenceDownloadTimeout = process.env.CI ? 300_000 : 120_000;

async function activate(page, label) {
  const action = page.getByRole('button', { name: label, exact: true });
  await action.focus();
  await action.press('Enter');
}

async function buildReferenceNet(page) {
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel');
  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await activate(page, 'Add Back Panel to the top edge of Top Panel');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');
  await activate(page, 'Add Right Panel to the right edge of Back Panel');
}

async function loadArtwork(page, fileName = 'render-fixture.png') {
  await page.evaluate(async (fileName) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2454c4';
    context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#ffffff';
    context.font = 'bold 72px sans-serif';
    context.fillText('RENDER', 90, 230);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], fileName, { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileName);
  await expect(page.locator('#artworkFileName')).toHaveText(fileName);
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

async function loadVectorArtwork(page, fileName = 'render-vector-fixture.pdf') {
  const source = await PDFDocument.create();
  const pdfPage = source.addPage([1200, 800]);
  pdfPage.drawRectangle({ x: 0, y: 0, width: 1200, height: 800, color: rgb(0.96, 0.96, 0.96) });
  for (let index = 0; index < 480; index += 1) {
    const x = 14 + index * 2.45;
    pdfPage.drawLine({
      start: { x, y: 18 },
      end: { x, y: 782 },
      thickness: index % 2 === 0 ? 0.35 : 1.15,
      color: index % 3 === 0 ? rgb(0.08, 0.24, 0.58) : rgb(0.78, 0.18, 0.08),
    });
  }
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 160; index += 1) {
    pdfPage.drawText(`Q${index % 10}`, {
      x: 24 + (index % 20) * 58,
      y: 46 + Math.floor(index / 20) * 88,
      size: 3.5,
      font,
      color: rgb(0.02, 0.02, 0.02),
    });
  }
  const sourceBytes = await source.save();
  await page.locator('#artworkFileInput').setInputFiles({
    name: fileName,
    mimeType: 'application/pdf',
    buffer: Buffer.from(sourceBytes),
  });
  await expect(page.locator('#artworkFileName')).toHaveText(fileName);
  await expect(page.locator('#processingOverlay')).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (
    window.cartonBuilderApp.artwork.getArtworks()[0]?.model?.source?.vector === true
  ))).toBe(true);
}

function getPngPixelSummary(bytes) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const imageData = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      imageData.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bytesPerPixel || !width || !height) return { varied: false, firstPixel: null };
  const inflated = inflateSync(Buffer.concat(imageData));
  const rowBytes = width * bytesPerPixel;
  let previous = Buffer.alloc(rowBytes);
  let firstPixel = null;
  let varied = false;
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor++];
    const row = Buffer.from(inflated.subarray(cursor, cursor + rowBytes));
    cursor += rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      else if (filter === 2) row[x] = (row[x] + above) & 0xff;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft)) & 0xff;
      } else if (filter !== 0) return { varied: false, firstPixel: null };
    }
    for (let x = 0; x < rowBytes; x += bytesPerPixel) {
      const pixel = row.subarray(x, x + bytesPerPixel).toString('hex');
      if (firstPixel == null) firstPixel = pixel;
      else if (pixel !== firstPixel) varied = true;
    }
    previous = row;
  }
  return { varied, firstPixel };
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function openRender(page, fileName) {
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();
  await loadArtwork(page, fileName);
  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 20_000 });
  await page.locator('#foldProgress').fill('0.35');
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#renderRecovery')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
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
        tx.oncomplete = tx.onerror = () => {
          db.close();
          resolve();
        };
      };
      request.onerror = resolve;
    });
  });
  await page.reload();
});

test('keeps Render disabled until a complete box and artwork exist', async ({ page }) => {
  await expect(page.locator('[data-step-target="render"]')).toBeDisabled();
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('[data-step-target="render"]')).toBeDisabled();
  await loadArtwork(page);
  await expect(page.locator('[data-step-target="render"]')).toBeEnabled();
});

test('clears the Render surface and recovers when every artwork layer is hidden', async ({ page }) => {
  await openRender(page, 'all-hidden-render-fixture.png');
  const baseline = await page.locator('#renderCanvas').screenshot();
  await page.locator('.step[data-step-target="artwork"]').click();
  const visibility = page.locator('.artwork-sublayer input[type="checkbox"]').first();
  await expect(visibility).toBeChecked();
  await page.locator('.artwork-sublayer label.eye-cell').first().click();
  await expect(visibility).not.toBeChecked();
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderRecovery')).toBeVisible();
  await expect(page.locator('#renderRecoveryMessage')).toContainText('visible artwork');
  await expect(page.locator('#renderPngButton')).toBeDisabled();
  expect(await page.locator('#renderCanvas').screenshot()).not.toEqual(baseline);

  await page.locator('.step[data-step-target="artwork"]').click();
  await page.locator('.artwork-sublayer label.eye-cell').first().click();
  await expect(visibility).toBeChecked();
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderRecovery')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#renderStatus')).toContainText('Render ready', { timeout: 30_000 });
});

test('shows native raster quality in the editor and per-artwork Render quality controls', async ({ page }) => {
  await openRender(page, 'Carton Calmdownol 1000 mg 110x70x30 outlined.ai');
  await expect(page.locator('#renderArtworkQualityList select')).toHaveCount(1);
  await expect(page.locator('#renderArtworkQualityList select')).toBeDisabled();
  await expect(page.locator('#renderArtworkQualityList option[value="1200"]')).toHaveCount(1);
  await expect(page.locator('#renderArtworkQualityList option[value="2400"]')).toHaveCount(1);
  const artworkName = page.locator('.render-artwork-quality-name').first();
  await expect(artworkName).toBeVisible();
  await expect(artworkName).toHaveAttribute('title', 'Carton Calmdownol 1000 mg 110x70x30 outlined.ai');
  const qualitySelect = page.locator('#renderArtworkQualityList select');
  await expect(qualitySelect).toBeVisible();
  expect(await artworkName.evaluate((element) => getComputedStyle(element).textOverflow)).toBe('ellipsis');
  const nameBox = await artworkName.boundingBox();
  const selectBox = await qualitySelect.boundingBox();
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(selectBox.x);

  await page.locator('.step[data-step-target="preview"]').click();
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(page.locator('#artworkPreviewQuality')).toBeDisabled();
  await expect(page.locator('#artworkRenderQuality')).toBeDisabled();
  await expect(page.locator('#artworkQualitySummary')).toContainText('Raster source: native pixels');
});

test('keeps the 3D canvas rendered when Render artwork quality increases', async ({ page }) => {
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();
  await loadVectorArtwork(page);
  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 20_000 });
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 30_000 });

  const qualitySelect = page.locator('#renderArtworkQualityList select');
  await expect(qualitySelect).toBeEnabled();
  // Change quality after Render has been idle, matching a real user edit and
  // ensuring no pending activation resize can mask replacement-renderer bugs.
  await page.waitForTimeout(500);
  await qualitySelect.selectOption('150');
  await expect(qualitySelect).toBeDisabled();
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 30_000 });
  await expect(qualitySelect).toBeEnabled();
  const lowQualityCanvas = await page.locator('#renderCanvas').screenshot();

  await qualitySelect.selectOption('600');
  await expect(qualitySelect).toBeDisabled();
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 30_000 });
  await expect(qualitySelect).toBeEnabled();
  const highQualityCanvas = await page.locator('#renderCanvas').screenshot();

  await expect(qualitySelect).toHaveValue('600');
  expect(await page.evaluate(() => (
    window.cartonBuilderApp.artwork.getArtworks()[0].model.quality.render
  ))).toBe(600);
  expect(getPngPixelSummary(lowQualityCanvas).varied).toBe(true);
  expect(getPngPixelSummary(highQualityCanvas).varied).toBe(true);
  expect(lowQualityCanvas.equals(highQualityCanvas)).toBe(false);
});

test('persists an artwork finish and warns before Basic GLB export', async ({ page }) => {
  await openRender(page);
  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();

  await page.locator('#artworkFinishRole').selectOption('finish');
  await page.locator('#artworkFinishType').selectOption('foil');
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.artwork.getArtworks()[0])).toMatchObject({
    outputRole: 'finish',
    finish: { type: 'foil' },
  });

  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 20_000 });
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#renderFinishSummary')).toContainText('foil');

  await page.locator('#renderPngButton').click();
  await expect(page.locator('#renderExportDialog')).toBeVisible();
  await page.locator('#renderExportKind').selectOption('glb');
  await page.locator('#renderExportGlbMaterialMode').selectOption('basic-compatibility');
  await expect(page.locator('#renderExportGlbWarning')).toBeVisible();
});

test('uses a separate closed presentation scene and persists render controls', async ({ page }) => {
  await openRender(page);
  expect(await page.evaluate(() => window.cartonBuilderApp.preview3d.getState().foldProgress)).toBe(0.35);
  expect(await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().foldProgress)).toBe(1);
  expect(await page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    presetId: 'clean-studio',
    aspect: 'square',
    longEdge: 2048,
    camera: { preset: 'isometric' },
  });

  await page.locator('#renderAspect').selectOption('wide');
  await page.locator('#renderLongEdge').selectOption('4096');
  await page.locator('#renderMaterialProfile').selectOption('gloss');
  await page.locator('#renderEnvironment').selectOption('warm');
  await page.locator('#renderBackgroundMode').selectOption('transparent');
  await page.locator('#renderShadowEnabled').uncheck();
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    aspect: 'wide',
    longEdge: 4096,
    material: { profile: 'gloss' },
    lighting: { environment: 'warm' },
    background: { mode: 'transparent' },
    shadows: { enabled: false },
  });
  await expect(page.locator('#renderViewportSummary')).toHaveText('Export viewport: 4096 × 2304px (16:9)');

  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  expect(await page.evaluate(() => window.cartonBuilderApp.preview3d.getState().foldProgress)).toBe(0.35);
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    aspect: 'wide',
    longEdge: 4096,
    background: { mode: 'transparent' },
  });
  await expect(page.locator('#renderViewportSummary')).toHaveText('Export viewport: 4096 × 2304px (16:9)');
});

test('applies built-in IBL controls live without losing the Render viewport', async ({ page }) => {
  await openRender(page);
  const initialCanvas = await page.locator('#renderCanvas').screenshot();

  await page.locator('#renderEnvironmentMapPreset').selectOption('warm-studio');
  await page.locator('#renderEnvironmentMapUsage').selectOption('both');
  await page.locator('#renderBackgroundMode').selectOption('environment');
  await page.locator('#renderEnvironmentMapRotation').fill('120');
  await page.locator('#renderEnvironmentMapBackgroundIntensity').fill('0.65');
  await page.locator('#renderEnvironmentMapBackgroundBlur').fill('0.2');

  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    background: { mode: 'environment' },
    lighting: {
      environmentMap: {
        source: 'builtin',
        presetId: 'warm-studio',
        usage: 'both',
        rotation: 120,
        backgroundIntensity: 0.65,
        backgroundBlur: 0.2,
      },
    },
  });
  await expect(page.locator('#renderRecovery')).toBeHidden();
  await expect(page.locator('#renderBusy')).toBeHidden();
  const updatedCanvas = await page.locator('#renderCanvas').screenshot();
  expect(updatedCanvas.equals(initialCanvas)).toBe(false);
});

test('loads a bundled Poly Haven HDRI lazily into the live Render viewport', async ({ page }) => {
  await openRender(page);
  const requests = [];
  page.on('request', (request) => {
    if (request.url().includes('/render-environments/polyhaven/')) requests.push(request.url());
  });
  const initialCanvas = await page.locator('#renderCanvas').screenshot();

  await page.locator('#renderEnvironmentMapPreset').selectOption('polyhaven-abandoned-hall-01');
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    lighting: {
      environmentMap: {
        source: 'builtin',
        presetId: 'polyhaven-abandoned-hall-01',
      },
    },
  });
  await expect(page.locator('#renderEnvironmentMapFileName')).toContainText('abandoned_hall_01_4k.hdr', { timeout: 30_000 });
  await expect(page.locator('#renderRecovery')).toBeHidden();
  await expect(page.locator('#renderBusy')).toBeHidden();
  expect(requests.some((url) => url.endsWith('/abandoned_hall_01_4k.hdr'))).toBe(true);

  const updatedCanvas = await page.locator('#renderCanvas').screenshot();
  expect(updatedCanvas.equals(initialCanvas)).toBe(false);
});

test('applies HDRI runtime caps and keeps all bundled maps usable', async ({ page }) => {
  test.setTimeout(process.env.CI ? 360_000 : 240_000);
  await openRender(page);
  const preset = page.locator('#renderEnvironmentMapPreset');
  const presets = [
    'polyhaven-abandoned-hall-01',
    'polyhaven-abandoned-waterworks',
    'polyhaven-empty-warehouse-01',
    'polyhaven-abandoned-workshop',
    'polyhaven-peppermint-powerplant',
  ];
  await page.locator('#renderEnvironmentResolution').selectOption('1024');
  for (const presetId of presets) {
    await preset.selectOption(presetId);
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState().lighting.environmentMap.presetId), { timeout: 45_000 })
      .toBe(presetId);
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().environmentMap), { timeout: 45_000 })
      .toMatchObject({ presetId, source: 'builtin', effectiveResolution: expect.any(Number), fallbackReason: null });
  }
  let lowResolutionCanvas = null;
  for (const resolution of ['1024', '2048', '4096']) {
    await page.locator('#renderEnvironmentResolution').selectOption(resolution);
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().environmentMap.requestedResolution), { timeout: 45_000 })
      .toBe(Number(resolution));
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().environmentMap.effectiveResolution), { timeout: 45_000 })
      .toBeLessThanOrEqual(Number(resolution));
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().environmentMap.cacheEntries), { timeout: 45_000 })
      .toBeLessThanOrEqual(2);
    const canvas = await page.locator('#renderCanvas').screenshot({ animations: 'disabled' });
    if (resolution === '1024') lowResolutionCanvas = canvas;
    if (resolution === '4096' && lowResolutionCanvas) expect(canvas.equals(lowResolutionCanvas)).toBe(false);
  }
  await expect(page.locator('#renderRecovery')).toBeHidden();
  expect(await page.locator('#renderCanvas').screenshot()).not.toEqual(Buffer.alloc(0));
});

test('loads a custom HDRI and exposes bounded runtime diagnostics', async ({ page }) => {
  await openRender(page);
  const response = await page.request.get('/render-environments/polyhaven/abandoned_hall_01_4k.hdr');
  expect(response.ok()).toBe(true);
  await page.locator('#renderEnvironmentMapFile').setInputFiles({
    name: 'custom-environment.hdr',
    mimeType: 'image/vnd.radiance',
    buffer: await response.body(),
  });
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState().lighting.environmentMap.source), { timeout: 45_000 })
    .toBe('custom');
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().environmentMap), { timeout: 45_000 })
    .toMatchObject({ source: 'custom', effectiveResolution: expect.any(Number), cacheEntries: expect.any(Number) });
  await page.locator('#renderEnvironmentMapUsage').selectOption('both');
  await page.locator('#renderBackgroundMode').selectOption('environment');
  await expect(page.locator('#renderRecovery')).toBeHidden();
});

test('captures a stable bundled HDRI 2K both baseline', async ({ page }) => {
  await openRender(page, 'wave7b-hdri-baseline-fixture.png');
  await page.locator('#renderEnvironmentMapPreset').selectOption('polyhaven-abandoned-hall-01');
  await page.locator('#renderEnvironmentResolution').selectOption('2048');
  await page.locator('#renderEnvironmentMapUsage').selectOption('both');
  await page.locator('#renderBackgroundMode').selectOption('environment');
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().environmentMap), { timeout: 60_000 })
    .toMatchObject({ presetId: 'polyhaven-abandoned-hall-01', effectiveResolution: 2048, fallbackReason: null });
  await expect(page.locator('#renderRecovery')).toBeHidden();
  expect(await page.locator('#renderCanvas').screenshot({ animations: 'disabled' })).toMatchSnapshot('wave7b-hdri-both.png', {
    threshold: 0.15,
    maxDiffPixelRatio: process.env.CI ? 0.02 : 0.01,
  });
});


test('applies floor reflection strength, softness and fade to the live Render scene', async ({ page }) => {
  await openRender(page);

  const reflection = page.locator('#renderFloorReflectionEnabled');
  await reflection.check();
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().floorReflection), { timeout: 30_000 })
    .toMatchObject({ enabled: true, visible: true });
  await page.waitForTimeout(500);
  const enabledCanvas = await page.locator('#renderCanvas').screenshot();

  await page.locator('#renderFloorReflectionStrength').fill('0.75');
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().floorReflection.strength), { timeout: 30_000 })
    .toBe(0.75);
  await page.waitForTimeout(500);
  const strongCanvas = await page.locator('#renderCanvas').screenshot();
  expect(strongCanvas.equals(enabledCanvas)).toBe(false);

  await page.locator('#renderFloorReflectionBlur').fill('0');
  await page.locator('#renderFloorReflectionFade').fill('4.5');
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().floorReflection), { timeout: 30_000 })
    .toMatchObject({ blur: 0, fadeDistance: 4.5 });
  await page.waitForTimeout(500);
  const sharpWideFadeCanvas = await page.locator('#renderCanvas').screenshot();
  expect(sharpWideFadeCanvas.equals(strongCanvas)).toBe(false);

  await reflection.uncheck();
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().floorReflection.visible))
    .toBe(false);
});

test('keeps canonical board caliper synchronized between Create Box, Preview and Render', async ({ page }) => {
  test.setTimeout(180_000);
  await openRender(page, 'wave8a-caliper-fixture.png');
  await expect(page.locator('#renderBoardThickness')).toHaveValue('0.35');
  await page.locator('[data-step-target="box"]').click();
  await page.locator('#boardCaliper').fill('1.2');
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.getState().box.board.caliperMm), { timeout: 30_000 }).toBe(1.2);
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderBoardThickness')).toHaveValue('1.2');

  await page.locator('#renderBoardThickness').fill('2');
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics()), { timeout: 30_000 })
    .toMatchObject({ thicknessMm: 2, geometry: { requestedCaliperMm: 2, effectiveCaliperMm: 2 } });

  await page.locator('[data-step-target="preview"]').click();
  await expect(page.locator('#preview3dBusy')).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.preview3d.getResourceInfo()), { timeout: 30_000 })
    .toMatchObject({ geometryMode: 'solid', thicknessMm: 2, geometry: { requestedCaliperMm: 2 } });

  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderBoardThickness')).toHaveValue('2');
});

test('keeps Render resources stable across 20 floor-effect updates', async ({ page }) => {
  await openRender(page);
  const initial = await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics());
  for (let index = 0; index < 20; index += 1) {
    await page.locator('#renderFloorReflectionEnabled').check();
    await page.locator('#renderFloorReflectionStrength').fill(String(Number((0.04 + (index % 8) * 0.04).toFixed(2))));
    await page.locator('#renderFloorReflectionBlur').fill(String((index % 10) / 10));
    await page.locator('#renderFloorReflectionFade').fill(String(Number((0.25 + (index % 10) * 0.25).toFixed(2))));
  }
  await page.waitForTimeout(500);
  const final = await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics());
  expect(final.geometries).toBeLessThanOrEqual(initial.geometries + 1);
  expect(final.textures).toBeLessThanOrEqual(initial.textures + 1);
  expect(final.floorReflection).toMatchObject({ enabled: true, visible: true });
});

test.describe('high-DPI Render', () => {
  test.use({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
  });

  test('caps the Render drawing buffer at DPR 2', async ({ page }) => {
    await openRender(page);
    const sizes = await page.locator('#renderCanvas').evaluate((canvas) => ({
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      bufferWidth: canvas.width,
      bufferHeight: canvas.height,
    }));
    expect(sizes.bufferWidth).toBeLessThanOrEqual(sizes.cssWidth * 2);
    expect(sizes.bufferHeight).toBeLessThanOrEqual(sizes.cssHeight * 2);
  });
});

test('exports a PNG with the selected 2048 output dimensions', async ({ page }) => {
  await openRender(page);
  await page.locator('#renderAspect').selectOption('landscape');
  await page.locator('#renderLongEdge').selectOption('2048');
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });

  await page.locator('#renderPngButton').click();
  await expect(page.locator('#renderExportDialog')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: exportDownloadTimeout }),
    page.locator('#renderExportForm button[value="confirm"]').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/carton-render-.*-2048\.png$/);
  const bytes = await readDownload(download);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(bytes.readUInt32BE(16)).toBe(2048);
  expect(bytes.readUInt32BE(20)).toBe(1536);
  expect(bytes.length).toBeGreaterThan(10_000);
  expect(getPngPixelSummary(bytes)).toMatchObject({ varied: true });
});

test('shows JPG quality only for JPG image exports', async ({ page }) => {
  await openRender(page);
  await page.locator('#renderPngButton').click();
  await expect(page.locator('#renderExportDialog')).toBeVisible();
  await expect(page.locator('#renderJpegQualityField')).toBeHidden();

  await page.locator('#renderExportFormat').selectOption('jpg');
  await expect(page.locator('#renderJpegQualityField')).toBeVisible();

  await page.locator('#renderExportKind').selectOption('glb');
  await expect(page.locator('#renderJpegQualityField')).toBeHidden();
  await page.locator('#renderExportDialog button[value="cancel"]').click();
});

test('exports a valid self-contained static GLB with the selected material profile', async ({ page }) => {
  await openRender(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.locator('#renderPngButton').click();
  await expect(page.locator('#renderExportDialog')).toBeVisible();
  await page.locator('#renderExportKind').selectOption('glb');
  await page.locator('#renderExportGlbTextureSize').selectOption('1024');
  await page.locator('#renderExportGlbMaterialMode').selectOption('basic-compatibility');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: exportDownloadTimeout }),
    page.locator('#renderExportForm button[value="confirm"]').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/carton-.*-matte\.glb$/);
  const bytes = await readDownload(download);
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.length).toBeGreaterThan(512);
  const report = await validateBytes(new Uint8Array(bytes), { format: 'glb' });
  expect(report.issues.numErrors).toBe(0);
  expect(report.info.generator).toContain('THREE.GLTFExporter');
});

test('exports a numbered turntable ZIP and restores the live Render camera', async ({ page }) => {
  test.setTimeout(process.env.CI ? 360_000 : 240_000);
  await openRender(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  const before = await page.evaluate(() => window.cartonBuilderApp.render.getState().camera);
  await page.locator('#renderPngButton').click();
  await expect(page.locator('#renderExportDialog')).toBeVisible();
  await page.locator('#renderExportKind').selectOption('sequence');
  await page.locator('#renderExportSequenceFrames').selectOption('24');
  await page.locator('#renderExportSequenceLongEdge').selectOption('512');
  await page.locator('#renderExportSequenceFormat').selectOption('jpg');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: sequenceDownloadTimeout }),
    page.locator('#renderExportForm button[value="confirm"]').click(),
  ]);
  expect(download.suggestedFilename()).toBe('carton-turntable-24f-512px.zip');
  const bytes = await readDownload(download);
  expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
  const zip = new ZipReader(new BlobReader(new Blob([bytes], { type: 'application/zip' })));
  const entries = await zip.getEntries();
  await zip.close();
  expect(entries.map((entry) => entry.filename)).toEqual(Array.from({ length: 24 }, (_, index) => (
    `frame-${String(index + 1).padStart(3, '0')}.jpg`
  )));
  const after = await page.evaluate(() => window.cartonBuilderApp.render.getState().camera);
  expect(after).toMatchObject({ heading: before.heading, elevation: before.elevation, cameraDistance: before.cameraDistance });
});

test('restores Render settings and workflow step through autosave', async ({ page }) => {
  await openRender(page);
  await page.locator('#renderAspect').selectOption('portrait');
  await page.locator('#renderLongEdge').selectOption('4096');
  await page.locator('#renderProjection').selectOption('orthographic');
  await page.locator('#renderFov').fill('52');
  await page.locator('#renderMaterialProfile').selectOption('gloss');
  await page.locator('#renderEnvironment').selectOption('cool');
  await page.locator('#renderBackgroundMode').selectOption('transparent');
  await page.locator('#renderBoardThickness').fill('0.8');
  await page.locator('#renderBoardBevel').fill('0.2');
  await page.locator('#renderBoardInteriorColor').fill('#abcdef');
  await page.locator('#renderBoardEdgeColor').fill('#123456');
  await page.locator('#renderEffectsGtao').uncheck();
  await page.locator('#renderEffectsDof').check();

  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await page.locator('#previewExportHtmlQuality').selectOption('2400');
  await page.locator('[data-step-target="render"]').click();
  await expect(page.locator('#renderStep')).toBeVisible();
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 30_000 });
  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());

  await page.reload();
  await expect(page.locator('#renderStep')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState())).toMatchObject({
    aspect: 'portrait',
    longEdge: 4096,
    camera: { projection: 'orthographic', fov: 52 },
    material: { profile: 'gloss' },
    lighting: { environment: 'cool' },
    background: { mode: 'transparent' },
    quality: { html: 2400 },
    effects: { gtao: { enabled: false }, dof: { enabled: true } },
  });
  expect(await page.evaluate(() => window.cartonBuilderApp.render.getBoardAppearance())).toMatchObject({
    thicknessMm: 0.8,
    bevelRadiusMm: 0.2,
    interiorColor: '#abcdef',
    edgeColor: '#123456',
  });
});

test.describe('Wave 5 deterministic Render baselines', () => {
  test.use({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 1,
  });

  // SwiftShader on hosted Linux runners can vary by a small anti-aliasing
  // fringe around the same deterministic scene. Keep the local gate strict,
  // while allowing that renderer-specific fringe in CI.
  const snapshotDiffPixelRatio = process.env.CI ? 0.02 : 0.005;
  const renderStabilityTimeout = process.env.CI ? 180_000 : 60_000;
  const renderRefreshTimeout = process.env.CI ? 120_000 : 20_000;

  test('captures stable studio and transparent Render states', async ({ page }) => {
    test.setTimeout(process.env.CI ? 600_000 : 90_000);
    await openRender(page, 'wave5-visual-fixture.png');
    expect(await page.evaluate((timeoutMs) => window.cartonBuilderApp.render.whenStable({ timeoutMs }), renderStabilityTimeout)).toBe(true);
    const canvas = page.locator('#renderCanvas');
    expect(await canvas.screenshot({ animations: 'disabled', timeout: 30_000 })).toMatchSnapshot('wave5-clean-studio.png', {
      threshold: 0.15,
      maxDiffPixelRatio: snapshotDiffPixelRatio,
    });

    await page.evaluate(async () => {
      const render = window.cartonBuilderApp.render;
      const state = render.getState();
      render.restoreState({
        ...state,
        background: { ...state.background, mode: 'transparent' },
        effects: { ...state.effects, dof: { ...state.effects.dof, enabled: false } },
      });
      await render.whenStable();
    });
    expect(await page.evaluate((timeoutMs) => window.cartonBuilderApp.render.whenStable({ timeoutMs }), renderStabilityTimeout)).toBe(true);
    await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 60_000 });
    expect(await canvas.screenshot({ animations: 'disabled', timeout: 30_000 })).toMatchSnapshot('wave5-transparent.png', {
      threshold: 0.15,
      maxDiffPixelRatio: snapshotDiffPixelRatio,
    });
  });

  test('blocks impossible exports and recovers from a lost graphics context', async ({ page }) => {
    await openRender(page, 'wave5-lifecycle-fixture.png');
    await page.locator('#renderEnvironmentMapPreset').selectOption('polyhaven-abandoned-hall-01');
    await expect.poll(
      () => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics()?.environmentMap || null),
      { timeout: 60_000 },
    ).toMatchObject({ effectiveResolution: expect.any(Number) });
    await page.locator('#renderDiagnosticsDrawer').locator('summary').click();
    await expect(page.locator('#renderDiagnosticsOutput')).toContainText('health:');
    await page.locator('#renderPngButton').click();
    await expect(page.locator('#renderExportPreflight')).toContainText('Ready');
    await page.locator('#renderExportDialog button[value="cancel"]').click();
    const blocked = await page.evaluate(() => window.cartonBuilderApp.render.runExportPreflight({
      kind: 'image',
      settings: { ...window.cartonBuilderApp.render.getState(), longEdge: 4096 },
      diagnostics: { maxTextureSize: 2048, maxRenderbufferSize: 2048 },
    }));
    expect(blocked.status).toBe('blocked');
    expect(blocked.issues.map((entry) => entry.code)).toContain('gpu-limit');

    await page.evaluate(() => document.getElementById('renderCanvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    await expect(page.locator('#renderRecovery')).toBeVisible();
    await page.evaluate(() => document.getElementById('renderCanvas').dispatchEvent(new Event('webglcontextrestored')));
    await expect(page.locator('#renderRecovery')).toBeHidden({ timeout: 30_000 });
    await expect.poll(
      () => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().contextRecoveryCount),
      { timeout: 30_000 },
    ).toBeGreaterThan(0);
    expect(await page.evaluate((timeoutMs) => window.cartonBuilderApp.render.whenStable({ timeoutMs }), renderStabilityTimeout)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().environmentMap), { timeout: 45_000 })
      .toMatchObject({ source: 'builtin', effectiveResolution: expect.any(Number), fallbackReason: null });
    expect(await page.locator('#renderCanvas').screenshot()).not.toEqual(Buffer.alloc(0));
  });

  test('keeps GPU resources bounded across repeated Render refreshes', async ({ page }) => {
    // Re-compositing a 3D artwork is substantially slower on hosted
    // SwiftShader than on a local GPU. The separate Wave 6 stress suite still
    // exercises 20 updates; this reliability gate only needs a bounded sample.
    test.setTimeout(process.env.CI ? 360_000 : 180_000);
    await openRender(page, 'wave5-stress-fixture.png');
    const baseline = await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics());
    const refreshCount = process.env.CI ? 3 : 6;
    for (let index = 0; index < refreshCount; index += 1) {
      await page.evaluate(() => window.cartonBuilderApp.render.refreshArtwork());
      expect(await page.evaluate((timeoutMs) => window.cartonBuilderApp.render.whenStable({ timeoutMs }), renderRefreshTimeout)).toBe(true);
    }
    await page.waitForTimeout(750);
    const settledSamples = [];
    for (let index = 0; index < 2; index += 1) {
      await page.waitForTimeout(250);
      settledSamples.push(await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics()));
    }
    const after = await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics());
    expect(after.geometries).toBeLessThanOrEqual(baseline.geometries + 1);
    expect(settledSamples[1].textures).toBe(settledSamples[0].textures);
  });

  test('keeps HDRI runtime resources bounded across 20 map/cap switches', async ({ page }) => {
    // Hosted SwiftShader can spend roughly a minute per PMREM/map switch.
    // Keep the assertion strict while allowing the full 20-cycle resource
    // gate to finish instead of failing solely on the outer test timeout.
    test.setTimeout(process.env.CI ? 1_800_000 : 600_000);
    await openRender(page, 'wave7b-hdri-stress-fixture.png');
    const baseline = await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics());
    const presets = [
      'polyhaven-abandoned-hall-01',
      'polyhaven-abandoned-waterworks',
    ];
    const caps = ['1024', '2048', '4096'];
    for (let index = 0; index < 20; index += 1) {
      await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 60_000 });
      const presetId = presets[index % presets.length];
      await page.locator('#renderEnvironmentMapPreset').selectOption(presetId);
      await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getState().lighting.environmentMap.presetId), { timeout: 60_000 })
        .toBe(presetId);
      await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().environmentMap), { timeout: 90_000 })
        .toMatchObject({ presetId, effectiveResolution: expect.any(Number) });
      await expect(page.locator('#renderBusy')).toBeHidden({ timeout: 60_000 });
      await page.locator('#renderEnvironmentResolution').selectOption(caps[index % caps.length]);
      // A cap change can rebuild PMREM on hosted SwiftShader. Keep the
      // assertion strict, but allow the GPU-bound preparation its CI budget.
      await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics().environmentMap), {
        timeout: process.env.CI ? 180_000 : 45_000,
      })
        .toMatchObject({ effectiveResolution: expect.any(Number) });
    }
    const after = await page.evaluate(() => window.cartonBuilderApp.render.getDiagnostics());
    expect(after.environmentMap.cacheEntries).toBeLessThanOrEqual(2);
    // Each bounded PMREM entry owns a small fixed set of GPU textures; two
    // entries are therefore allowed above the procedural baseline.
    expect(after.textures).toBeLessThanOrEqual(baseline.textures + 12);
    expect(after.geometries).toBeLessThanOrEqual(baseline.geometries + 1);
    await expect(page.locator('#renderRecovery')).toBeHidden();
  });
});
