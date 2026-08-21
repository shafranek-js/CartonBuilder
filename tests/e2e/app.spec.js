import { readFile } from 'node:fs/promises';

import {
  PDFDict,
  PDFDocument,
  PDFName,
  degrees,
  rgb,
} from 'pdf-lib';
import { expect, test } from '@playwright/test';
import { sha256 } from '../../src/artwork/fileValidation.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { createProjectArchive } from '../../src/project/projectArchive.js';

async function activate(page, label, key = 'Enter') {
  const action = page.getByRole('button', { name: label });
  await action.focus();
  await action.press(key);
}

async function buildReferenceNet(page) {
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel');
  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await activate(page, 'Add Back Panel to the top edge of Top Panel');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');
  await activate(page, 'Add Right Panel to the right edge of Back Panel');
}

async function openMenuExport(page, group, buttonSelector) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.locator('#menuExportItem').hover();
  const groupIndex = group === '3d' ? 1 : 0;
  await page.locator('#menuExportItem > .file-menu-submenu > .file-menu-submenu-anchor').nth(groupIndex).hover();
  return page.locator(buttonSelector);
}

async function openFileAction(page, buttonSelector) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#fileMenuPopover')).toBeVisible();
  return page.locator(buttonSelector);
}

async function openEditAction(page, buttonSelector) {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#editMenuPopover')).toBeVisible();
  return page.locator(buttonSelector);
}

async function openArtworkStep(page) {
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
}

async function loadGeneratedPng(page, fileName = 'sample-artwork.png') {
  await page.evaluate(async (name) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f6cf43';
    context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#2657c8';
    context.fillRect(40, 40, 520, 320);
    context.fillStyle = '#ffffff';
    context.font = 'bold 54px sans-serif';
    context.textAlign = 'center';
    context.fillText('CARTON', 300, 220);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], name, { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fileName);
  await expect(page.locator('#artworkFileName')).toHaveText(fileName);
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

async function assertTechnicalRestoreRoundTrip(page, cartonType) {
  await page.locator('label.workflow-mode-card-technical').click();
  const frame = page.frameLocator('#technicalHostFrame');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  if (cartonType !== 'RTE') {
    await frame.locator('#cartonType').selectOption(cartonType);
    await expect(page.locator('#technicalHostValidation')).toHaveText(
      'Structural VALID · Geometry VALID · Contract VALID',
    );
  }
  await expect(frame.locator('#cartonType')).toHaveValue(cartonType);
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await loadGeneratedPng(page, `technical-${cartonType}.png`);
  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  const committed = await page.evaluate(() => {
    const state = window.cartonBuilderApp.getState();
    return {
      workflowSelection: state.workflowSelection,
      modelSha256: state.cartonSource?.modelSha256,
      svgSha256: state.cartonSource?.svgSha256,
    };
  });

  await page.reload();
  await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('input[name="cartonWorkflowMode"][value="technical"]')).toBeChecked();
  await expect(frame.locator('#cartonType')).toHaveValue(cartonType, { timeout: 20_000 });
  await expect(page.locator('#artworkFileName')).toHaveText(`technical-${cartonType}.png`);
  await expect.poll(() => page.evaluate(() => {
    const state = window.cartonBuilderApp.getState();
    return {
      workflowSelection: state.workflowSelection,
      modelSha256: state.cartonSource?.modelSha256,
      svgSha256: state.cartonSource?.svgSha256,
    };
  })).toEqual(committed);

  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.locator('.step[data-step-target="box"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  expect(dialogs).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  // Headless Chromium exposes the native picker API, which does not emit a
  // Playwright download event. The browser fallback is the deterministic
  // contract exercised by these export tests.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('carton-builder', 6);
    await new Promise((resolve) => {
      request.onsuccess = () => {
        const db = request.result;
        if (db.objectStoreNames.contains('projects')) {
          const tx = db.transaction('projects', 'readwrite');
          tx.objectStore('projects').clear();
          tx.oncomplete = tx.onerror = resolve;
        } else {
          resolve();
        }
      };
      request.onerror = resolve;
    });
  });
});

test('opening one top menu closes the other', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1200);

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#fileMenuPopover')).toBeVisible();
  await expect(page.locator('#editMenuPopover')).toBeHidden();

  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  await expect(page.locator('#contactsMenuPopover')).toBeVisible();
  await expect(page.locator('#fileMenuPopover')).toBeHidden();
  await expect(page.locator('#editMenuPopover')).toBeHidden();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#editMenuPopover')).toBeVisible();
  await expect(page.locator('#fileMenuPopover')).toBeHidden();
  await expect(page.locator('#contactsMenuPopover')).toBeHidden();

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await expect(page.locator('#fileMenuPopover')).toBeVisible();
  await expect(page.locator('#editMenuPopover')).toBeHidden();
});

test('shows clickable contact links in the top menu', async ({ page }) => {
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  const popover = page.locator('#contactsMenuPopover');
  await expect(popover).toBeVisible();
  await expect(popover.locator('a')).toHaveCount(3);
  await expect(popover.locator('a').nth(0)).toHaveAttribute('href', 'mailto:pavel.p.popovic@gmail.com');
  await expect(popover.locator('a').nth(1)).toHaveAttribute('href', 'https://t.me/Grabovvski');
  await expect(popover.locator('a').nth(2)).toHaveAttribute('href', 'https://www.linkedin.com/in/grabovsky/');
  await expect(popover.locator('a').nth(1)).toHaveAttribute('target', '_blank');
  await expect(popover.locator('a').nth(2)).toHaveAttribute('rel', 'noopener noreferrer');
});

test('completes the technical workflow for RTE, STE and TT_SL123 and restores technical autosave', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.locator('label.workflow-mode-card-technical').click();
  const frame = page.frameLocator('#technicalHostFrame');
  await expect(page.locator('#technicalHostValidation')).toHaveText(
    'Structural VALID · Geometry VALID · Contract VALID',
    { timeout: 20_000 },
  );
  await expect(frame.locator('#flipHorizontalBtn')).toBeHidden();
  await expect(frame.locator('#flipVerticalBtn')).toBeHidden();
  await expect(frame.locator('#rotateCcwBtn')).toBeHidden();
  await expect(frame.locator('#rotateCwBtn')).toBeHidden();

  const types = ['RTE', 'STE', 'TT_SL123'];
  for (const [index, cartonType] of types.entries()) {
    if (index > 0) {
      await page.locator('.step[data-step-target="box"]').click();
      await expect(frame.locator('#cartonType')).toBeVisible();
      await frame.locator('#cartonType').selectOption(cartonType);
      await expect(page.locator('#technicalHostValidation')).toHaveText(
        'Structural VALID · Geometry VALID · Contract VALID',
      );
    }

    const step2 = page.locator('.step[data-step-target="artwork"]');
    await expect(step2).toBeEnabled();
    await step2.click();
    await expect(page.locator('#artworkStep')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      window.cartonBuilderApp.getState().cartonSource?.source?.cartonType
    ))).toBe(cartonType);
  }

  await loadGeneratedPng(page, 'technical-autosave.png');
  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await expect.poll(async () => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('carton-builder');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value?.snapshot?.cartonSource?.mode === 'technical'
      && value?.technicalAssets?.modelBlob instanceof Blob;
  })).toBe(true);

  const committedBeforeReload = await page.evaluate(() => {
    const source = window.cartonBuilderApp.getState().cartonSource;
    return {
      workflowSelection: window.cartonBuilderApp.getState().workflowSelection,
      modelSha256: source.modelSha256,
      svgSha256: source.svgSha256,
    };
  });
  await page.reload();
  await expect(page.locator('#artworkStep')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('input[name="cartonWorkflowMode"][value="technical"]')).toBeChecked();
  await expect(frame.locator('#cartonType')).toHaveValue('TT_SL123', { timeout: 20_000 });
  await expect(page.locator('#artworkFileName')).toHaveText('technical-autosave.png');
  await expect.poll(() => page.evaluate(() => {
    const state = window.cartonBuilderApp.getState();
    return {
      workflowSelection: state.workflowSelection,
      modelSha256: state.cartonSource?.modelSha256,
      svgSha256: state.cartonSource?.svgSha256,
    };
  })).toEqual(committedBeforeReload);

  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.locator('.step[data-step-target="box"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#artworkStep')).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(pageErrors).toEqual([]);
});

for (const cartonType of ['RTE', 'STE']) {
  test(`restores ${cartonType} technical workflow without replacing artwork`, async ({ page }) => {
    test.setTimeout(60_000);
    await assertTechnicalRestoreRoundTrip(page, cartonType);
  });
}

test('persists workflow selection independently and lets an opened Quick project override it', async ({ page }) => {
  await page.locator('label.workflow-mode-card-technical').click();
  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();
  await expect(page.locator('input[name="cartonWorkflowMode"][value="technical"]')).toBeChecked();

  const quickBox = new BoxNetModel({ width: 200, height: 100, depth: 50 });
  quickBox.addPanel('Front', 'bottom', 'Base');
  quickBox.addPanel('Front', 'top', 'Top');
  quickBox.addPanel('Top', 'top', 'Back');
  quickBox.addPanel('Front', 'left', 'Left');
  quickBox.addPanel('Back', 'right', 'Right');
  const quickArchive = await createProjectArchive({
    snapshot: {
      schemaVersion: 17,
      meta: { name: 'Quick project override' },
      workflowStep: 'box',
      workflowSelection: 'quick',
      cartonSource: { mode: 'quick', box: quickBox.toJSON() },
      artworks: [],
      activeArtworkIndex: -1,
      render: {},
      renderAppearance: {},
      prepress: {},
      view: {},
      history: { undo: [], redo: [] },
    },
    artworkBlobs: [],
  });
  await (await openFileAction(page, '#menuOpenProjectBtn')).click();
  await page.locator('#projectFileInput').setInputFiles({
    name: 'quick-override.carton',
    mimeType: 'application/zip',
    buffer: Buffer.from(await quickArchive.arrayBuffer()),
  });
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('input[name="cartonWorkflowMode"][value="quick"]')).toBeChecked();
});

test('restores a complete project checkpoint including artwork and Render assets', async ({ page }) => {
  test.setTimeout(60_000);
  await openArtworkStep(page);
  await loadGeneratedPng(page, 'checkpoint-artwork.png');

  const backgroundBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2b5cff';
    context.fillRect(0, 0, 8, 8);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.locator('#renderBackgroundFile').setInputFiles({
    name: 'checkpoint-background.png',
    mimeType: 'image/png',
    buffer: Buffer.from(backgroundBytes),
  });
  await expect(page.locator('#renderBackgroundFileName')).toHaveText('checkpoint-background.png');

  const before = await page.evaluate(async () => {
    const digest = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const app = window.cartonBuilderApp;
    const renderState = app.render.getState();
    renderState.background.mode = 'image';
    renderState.background.image.fit = 'contain';
    renderState.background.image.positionX = 0.21;
    renderState.background.image.positionY = 0.72;
    app.render.applySettings({
      renderSettings: renderState,
      boardAppearance: { ...app.render.getBoardAppearance(), thicknessMm: 0.73 },
    });
    const checkpoint = await app.artwork.createProjectCheckpoint();
    if (checkpoint.snapshot.render.background.mode !== 'image') {
      throw new Error(`Checkpoint did not capture Render image mode: ${checkpoint.snapshot.render.background.mode}`);
    }
    return {
      artworkSha: await digest(app.artwork.originalBlob),
      artworkFileName: app.artwork.createSnapshot().artworks[0].artwork.source.fileName,
      renderState: app.render.getState(),
      boardAppearance: app.render.getBoardAppearance(),
      renderAssets: await Promise.all(app.render.getRenderAssets().map(async (asset) => ({
        assetId: asset.assetId,
        sha256: await digest(asset.blob),
      }))),
    };
  });
  expect(before.renderAssets).toHaveLength(1);

  await page.evaluate(() => {
    const app = window.cartonBuilderApp;
    app.artwork.clearArtworkForCartonChange();
    app.render.applySettings({
      renderSettings: { ...app.render.getState(), background: { ...app.render.getState().background, mode: 'solid' } },
      boardAppearance: { ...app.render.getBoardAppearance(), thicknessMm: 1.4 },
    });
  });
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');

  await expect.poll(() => page.evaluate(() => window.cartonBuilderApp.artwork.restoreProjectCheckpoint())).toBe(true);
  await expect(page.locator('#artworkFileName')).toHaveText('checkpoint-artwork.png');

  const after = await page.evaluate(async () => {
    const digest = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const app = window.cartonBuilderApp;
    return {
      artworkSha: await digest(app.artwork.originalBlob),
      artworkFileName: app.artwork.createSnapshot().artworks[0].artwork.source.fileName,
      renderState: app.render.getState(),
      boardAppearance: app.render.getBoardAppearance(),
      renderAssets: await Promise.all(app.render.getRenderAssets().map(async (asset) => ({
        assetId: asset.assetId,
        sha256: await digest(asset.blob),
      }))),
    };
  });

  expect(after).toEqual(before);
});

test('completes the three-step artwork workflow and exports every deliverable', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const shellBounds = await page.locator('.app-shell').evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  expect(shellBounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  await expect(page.locator('.title-bar')).toHaveCount(0);

  const dimensionRowPositions = await page.locator('.dimension-row').evaluateAll((rows) =>
    rows.map((row) => {
      const { x, y } = row.getBoundingClientRect();
      return { x, y };
    }),
  );
  expect(new Set(dimensionRowPositions.map(({ y }) => y)).size).toBe(1);
  expect(dimensionRowPositions[2].x - dimensionRowPositions[0].x).toBeLessThan(500);
  await expect(page.locator('#boxWidth')).toHaveValue('150');
  await expect(page.locator('#panelCount')).toHaveText('1/6');

  await page.evaluate(() => {
    window.__completeEvent = null;
    window.addEventListener('box-net-complete', (event) => {
      window.__completeEvent = event.detail;
    }, { once: true });
  });
  await openArtworkStep(page);
  await expect.poll(() => page.evaluate(() => window.__completeEvent?.complete)).toBe(true);
  await expect(page.locator('[data-step-target="artwork"]')).toHaveAttribute('aria-current', 'step');

  await loadGeneratedPng(page);
  await expect(page.locator('#dropState')).toBeHidden();
  await expect(page.locator('#artworkWorkspace image.artwork-image')).toHaveCount(2);
  await expect(page.locator('#effectiveDpi')).not.toHaveText('—');

  const beforeX = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.centerXmm);
  await page.locator('#artworkWorkspace').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(
    () => page.evaluate(() => window.cartonBuilderApp.artwork.artwork.centerXmm),
  ).toBeCloseTo(beforeX + 0.1, 5);

  await page.getByLabel('Lock Artwork').check();
  const lockedX = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.centerXmm);
  await page.keyboard.press('Control+ArrowRight');
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.centerXmm)).toBe(lockedX);
  await expect(page.locator('#artworkWidth')).toBeDisabled();
  await (await openEditAction(page, '#menuRemoveArtworkBtn')).click();
  await expect(page.locator('#artworkFileName')).toHaveText('sample-artwork.png');
  await page.getByLabel('Lock Artwork').uncheck();

  await page.getByRole('button', { name: 'Rotate +90°' }).click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(90);
  await (await openEditAction(page, '#menuUndoBtn')).click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(0);
  await (await openEditAction(page, '#menuRedoBtn')).click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(90);

  const projectDownload = page.waitForEvent('download');
  await (await openFileAction(page, '#menuSaveProjectBtn')).click();
  const project = await projectDownload;
  expect(project.suggestedFilename()).toBe('carton-project.carton');
  const projectPath = await project.path();

  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('#preview3dPanel')).toBeVisible();

  const svgDownload = page.waitForEvent('download');
  await (await openMenuExport(page, '2d', '#menuExportSvgBtn')).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe('box-net-150x90x40mm.svg');
  expect((await readFile(await svg.path(), 'utf8')).match(/<rect /g)).toHaveLength(6);

  const pngDownload = page.waitForEvent('download');
  await (await openMenuExport(page, '2d', '#menuExportPngBtn')).click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe('carton-artwork-preview.png');
  expect((await readFile(await png.path())).subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

  const pdfDownload = page.waitForEvent('download');
  await (await openMenuExport(page, '2d', '#menuExportPdfBtn')).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toBe('carton-artwork.pdf');
  expect((await readFile(await pdf.path(), 'utf8')).slice(0, 5)).toBe('%PDF-');

  await page.locator('.step[data-step-target="artwork"]').click();
  await page.locator('#settingsTriggerBtn').click();
  const diagnosticsDownload = page.waitForEvent('download');
  await page.locator('#downloadDiagnosticsBtn').click();
  const diagnostics = JSON.parse(await readFile(await (await diagnosticsDownload).path(), 'utf8'));
  expect(diagnostics.privacy).toContain('No artwork bytes');
  expect(JSON.stringify(diagnostics)).not.toContain('sample-artwork.png');

  page.once('dialog', (dialog) => dialog.accept());
  await (await openEditAction(page, '#menuRemoveArtworkBtn')).click();
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');
  await page.locator('#projectFileInput').setInputFiles(projectPath);
  await expect(page.locator('#artworkFileName')).toHaveText('sample-artwork.png');

  await page.locator('#localePicker').selectOption('ru');
  await expect(page.getByRole('button', { name: 'Просмотр', exact: true })).toBeVisible();
  await expect(page.locator('[data-step-target="artwork"]')).toContainText('Размещение макета');

  await page.waitForTimeout(650);
  await page.reload();
  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText('sample-artwork.png');
});

test('updates artwork-step box dimensions without fitting the active artwork', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);

  const beforeArtwork = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      centerXmm: model.centerXmm,
      centerYmm: model.centerYmm,
      scaleX: model.scaleX,
      scaleY: model.scaleY,
      initialWidthMm: model.initialWidthMm,
      initialHeightMm: model.initialHeightMm,
    };
  });
  const beforeWidth = await page.evaluate(() => window.boxNetApp.getState().dimensions.width);
  const widthInput = page.locator('#artworkBoxWidth');
  await widthInput.fill(String(beforeWidth + 10));
  await widthInput.dispatchEvent('change');

  await expect.poll(() => page.evaluate(() => window.boxNetApp.getState().dimensions.width)).toBe(beforeWidth + 10);
  await expect.poll(() => page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      centerXmm: model.centerXmm,
      centerYmm: model.centerYmm,
      scaleX: model.scaleX,
      scaleY: model.scaleY,
      initialWidthMm: model.initialWidthMm,
      initialHeightMm: model.initialHeightMm,
    };
  })).toEqual(beforeArtwork);
});

test('validates dimensions, preserves the current net and emits compatibility events', async ({ page }) => {
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel', ' ');
  await expect(page.locator('#announcer')).toHaveText('Base Panel added. 2 of 6 panels placed.');

  await page.locator('#boxWidth').fill('200');
  await page.locator('#boxWidth').press('Enter');
  await expect(page.locator('#panelCount')).toHaveText('2/6');
  await expect.poll(() => page.evaluate(() => window.boxNetApp.getState().dimensions.width)).toBe(200);

  await page.locator('#boxDepth').fill('0');
  await page.locator('#boxDepth').press('Enter');
  await expect(page.locator('#boxDepth')).toHaveValue('40');
  await expect(page.locator('#toast')).toHaveText('Enter valid positive dimensions.');

  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await activate(page, 'Add Back Panel to the top edge of Top Panel');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');
  await activate(page, 'Add Right Panel to the right edge of Back Panel');
  await page.locator('.step[data-step-target="artwork"]').click();
  await loadGeneratedPng(page);
  await page.locator('#artworkWorkspace').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.locator('.step[data-step-target="box"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();

  await page.locator('#boxHeight').fill('100');
  await page.locator('#boxHeight').press('Enter');
  await expect(page.locator('#panelCount')).toHaveText('6/6');

  await page.evaluate(() => {
    window.__cancelled = 0;
    window.addEventListener('box-net-cancelled', () => {
      window.__cancelled += 1;
    });
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#cancelButton').click();
  await expect.poll(() => page.evaluate(() => window.__cancelled)).toBe(1);
});

test('handles invalid and multi-file input, PDF page selection and rotated vector export', async ({ page }) => {
  await openArtworkStep(page);

  await page.locator('#artworkFileInput').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.locator('#errorBanner')).toContainText('Use a PNG, JPG/JPEG or PDF file.');
  await expect(page.getByRole('button', { name: 'Choose another file' })).toBeVisible();

  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['a'], 'a.png', { type: 'image/png' }));
    transfer.items.add(new File(['b'], 'b.png', { type: 'image/png' }));
    document.getElementById('artworkCanvasWrap').dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }));
  });
  await expect(page.locator('#errorBanner')).toContainText('Drop exactly one artwork file.');

  const source = await PDFDocument.create();
  const first = source.addPage([300, 200]);
  first.drawRectangle({ x: 20, y: 20, width: 260, height: 160, color: rgb(1, 0, 0) });
  const second = source.addPage([400, 250]);
  second.setRotation(degrees(90));
  second.drawRectangle({ x: 20, y: 20, width: 360, height: 210, color: rgb(0, 0, 1) });
  const sourceBytes = await source.save();

  await page.locator('#artworkFileInput').setInputFiles({
    name: 'multipage.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(sourceBytes),
  });
  const dialog = page.getByRole('dialog', { name: 'Choose PDF page' });
  await expect(dialog).toBeVisible();
  await page.locator('#pdfPageNumber').fill('2');
  await page.getByRole('button', { name: 'Open page' }).click();
  await expect(page.locator('#artworkFileName')).toHaveText('multipage.pdf', { timeout: 20_000 });
  const sourceState = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.source);
  expect(sourceState.pageIndex).toBe(1);
  expect(sourceState.pageCount).toBe(2);
  expect(sourceState.pdfPageRotation).toBe(90);
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(90);

  await page.locator('.step[data-step-target="preview"]').click();
  const downloadPromise = page.waitForEvent('download');
  await (await openMenuExport(page, '2d', '#menuExportPdfBtn')).click();
  const downloaded = await downloadPromise;
  const exported = await PDFDocument.load(await readFile(await downloaded.path()));
  const exportedPage = exported.getPage(0);
  const resources = exportedPage.node.Resources();
  expect(resources.lookup(PDFName.of('Properties'), PDFDict).has(PDFName.of('Dieline'))).toBe(true);
});

test('keeps model state stable during responsive resize without ResizeObserver', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: undefined,
    });
  });
  await page.reload();
  await activate(page, 'Add Left Panel to the left edge of Front Panel');

  const stateBefore = await page.evaluate(() => window.boxNetApp.getState());
  await page.setViewportSize({ width: 390, height: 720 });
  const shellBounds = await page.locator('.app-shell').evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  expect(shellBounds).toEqual({ x: 0, y: 0, width: 390, height: 720 });
  await expect(page.locator('#workspace')).toBeVisible();
  expect(await page.evaluate(() => window.boxNetApp.getState())).toEqual(stateBefore);
});

test('restores Preview mode from validated autosave and shows the technical-proof notice', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);
  await page.locator('.step[data-step-target="preview"]').click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('.technical-proof-notice')).toContainText('not PDF/X certified');

  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('carton-builder');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value?.snapshot?.workflowStep;
  })).toBe('preview');

  await page.reload();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('[data-step-target="preview"]')).toHaveAttribute('aria-current', 'step');
});

test('localizes persistent errors and rejects a corrupt autosave without mutating the clean model', async ({ page }) => {
  await openArtworkStep(page);
  await page.locator('#localePicker').selectOption('ru');
  await expect(page.locator('#artworkWorkspace')).toHaveAttribute(
    'aria-label',
    'Холст размещения макета',
  );

  await page.locator('#artworkFileInput').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.locator('#errorBanner')).toContainText(
    'Используйте файл PNG, JPG/JPEG или PDF.',
  );
  await expect(page.getByRole('button', { name: 'Выбрать другой файл' })).toBeVisible();

  await page.locator('#projectFileInput').setInputFiles({
    name: 'broken.carton',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a project'),
  });
  await expect(page.locator('#errorBanner')).toContainText(
    'Выберите корректный проект .carton размером до 120 МБ.',
  );

  await loadGeneratedPng(page, 'autosave-source.png');
  await page.waitForTimeout(650);
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('carton-builder');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readonly');
      const request = transaction.objectStore('projects').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    record.artworkBlobs = [{ originalBlob: null, previewBlob: null }];
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('projects', 'readwrite');
      const request = transaction.objectStore('projects').put(record, 'current');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    database.close();
  });

  await page.reload();
  await expect(page.locator('#errorBanner')).toContainText(
    'Сохранённый проект не удалось восстановить. Открыт чистый проект.',
  );
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  await expect.poll(
    () => page.evaluate(() => window.cartonBuilderApp.artwork.artwork.hasArtwork),
  ).toBe(false);
});

test('cancels worker processing and revokes superseded preview URLs', async ({ page }) => {
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    window.__objectUrlAudit = { created: [], revoked: [] };
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.__objectUrlAudit.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__objectUrlAudit.revoked.push(url);
      return revoke(url);
    };
  });
  await page.reload();
  await openArtworkStep(page);

  const source = await PDFDocument.create();
  for (let index = 0; index < 24; index += 1) {
    const pdfPage = source.addPage([1200, 800]);
    pdfPage.drawRectangle({
      x: 20,
      y: 20,
      width: 1160,
      height: 760,
      color: rgb(0.2, 0.4, 0.7),
    });
  }
  const sourceBytes = await source.save();
  await page.locator('#artworkFileInput').setInputFiles({
    name: 'large.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(sourceBytes),
  });
  await expect(page.locator('#processingOverlay')).toBeVisible();
  // PDF input opens the page picker before the worker can finish. Cancelling
  // that modal is the user-visible cancellation path and aborts processing.
  await page.getByRole('dialog', { name: 'Choose PDF page' })
    .getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#processingOverlay')).toBeHidden();
  await expect(page.locator('#artworkCanvasWrap')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.hasArtwork)).toBe(false);

  for (let index = 0; index < 20; index += 1) {
    await loadGeneratedPng(page, `replacement-${index}.png`);
  }

  const audit = await page.evaluate(() => window.__objectUrlAudit);
  const activeUrls = audit.created.filter((url) => !audit.revoked.includes(url));
  expect(activeUrls).toHaveLength(40);
  expect(new Set(audit.revoked).size).toBe(audit.created.length - 40);
});

test('allows opening a .carton project directly from Step 1 (Create Box)', async ({ page }) => {
  await expect(page.locator('#boxStep')).toBeVisible();

  const boxModel = new BoxNetModel({ width: 200, height: 100, depth: 50 });
  boxModel.addPanel('Front', 'bottom', 'Base');
  boxModel.addPanel('Front', 'top', 'Top');
  boxModel.addPanel('Top', 'top', 'Back');
  boxModel.addPanel('Front', 'left', 'Left');
  boxModel.addPanel('Back', 'right', 'Right');

  const originalBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
  ], { type: 'image/png' });
  const previewBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]),
  ], { type: 'image/png' });
  const sourceHash = await sha256(originalBlob);

  const snapshot = {
    schemaVersion: 1,
    meta: { name: 'Direct project load' },
    workflowStep: 'artwork',
    box: boxModel.toJSON(),
    artwork: {
      source: {
        id: 'asset-direct',
        fileName: 'direct-project.png',
        mimeType: 'image/png',
        byteLength: originalBlob.size,
        widthPx: 100,
        heightPx: 50,
        previewWidthPx: 100,
        previewHeightPx: 50,
        pageIndex: null,
        pageCount: null,
        vector: false,
        pdfPageRotation: 0,
        mediaBox: null,
        sha256: sourceHash,
      },
      centerXmm: 100,
      centerYmm: 50,
      initialWidthMm: 200,
      initialHeightMm: 100,
      scale: 1,
      rotation: 0,
      opacity: 1,
      modified: false,
    },
    view: {},
    history: { undo: [], redo: [] },
  };

  const archiveBlob = await createProjectArchive({
    snapshot,
    artworkBlobs: [{ originalBlob, previewBlob }],
  });
  const buffer = Buffer.from(await archiveBlob.arrayBuffer());

  await (await openFileAction(page, '#menuOpenProjectBtn')).click();
  await page.locator('#projectFileInput').setInputFiles({
    name: 'direct-test.carton',
    mimeType: 'application/zip',
    buffer,
  });

  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(page.locator('#artworkFileName')).toHaveText('direct-project.png');
});

test('persists custom box dimensions and panel layout across page reloads without artwork', async ({ page }) => {
  await expect(page.locator('#boxStep')).toBeVisible();

  await page.locator('#boxWidth').fill('210');
  await page.locator('#boxWidth').dispatchEvent('change');
  await page.locator('#boxHeight').fill('110');
  await page.locator('#boxHeight').dispatchEvent('change');

  await buildReferenceNet(page);
  await expect(page.locator('#panelCount')).toHaveText('6/6');

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();

  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#boxWidth')).toHaveValue('210');
  await expect(page.locator('#boxHeight')).toHaveValue('110');
  await expect(page.locator('#panelCount')).toHaveText('6/6');
});

test('persists box net after removing artwork and reloading without showing an error banner', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);
  await expect(page.locator('#artworkFileName')).toHaveText('sample-artwork.png');
  page.once('dialog', (dialog) => dialog.accept());
  await (await openEditAction(page, '#menuRemoveArtworkBtn')).click();
  await expect(page.locator('#artworkFileName')).toHaveText('No file selected');

  await page.locator('.step[data-step-target="box"]').click();
  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#boxStep')).toBeVisible();

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();

  await expect(page.locator('#boxStep')).toBeVisible();
  await expect(page.locator('#errorBanner')).toBeHidden();
  await expect(page.locator('#panelCount')).toHaveText('6/6');
});

test('resets custom dimensions and panel layout back to defaults with one click', async ({ page }) => {
  await expect(page.locator('#boxStep')).toBeVisible();

  await page.locator('#boxWidth').fill('240');
  await page.locator('#boxWidth').dispatchEvent('change');
  await page.locator('#boxHeight').fill('120');
  await page.locator('#boxHeight').dispatchEvent('change');
  await buildReferenceNet(page);
  await expect(page.locator('#panelCount')).toHaveText('6/6');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset Box' }).click();

  await expect(page.locator('#boxWidth')).toHaveValue('150');
  await expect(page.locator('#boxHeight')).toHaveValue('90');
  await expect(page.locator('#boxDepth')).toHaveValue('40');
  await expect(page.locator('#panelCount')).toHaveText('1/6');

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();

  await expect(page.locator('#boxWidth')).toHaveValue('150');
  await expect(page.locator('#panelCount')).toHaveText('1/6');
});

test('auto-hides unpinned dock panels and reveals them from the edge, pinning persists', async ({ page }) => {
  await openArtworkStep(page);
  const stage = page.locator('#artworkStage');

  await expect(stage).toHaveAttribute('data-left', 'pinned');
  await expect(stage).toHaveAttribute('data-right', 'pinned');
  await expect(page.locator('#panelEdgeLeft')).toBeHidden();

  await page.locator('#pinLeftPanel').click();
  await expect(stage).toHaveAttribute('data-left', 'open');
  await expect(page.locator('#pinLeftPanel')).toHaveAttribute('aria-pressed', 'false');

  await page.mouse.move(700, 360);
  await expect(stage).toHaveAttribute('data-left', 'closed');
  await expect(page.locator('#panelEdgeLeft')).toBeVisible();

  await page.waitForTimeout(400);
  await page.locator('#panelEdgeLeft').hover({ force: true });
  await expect(stage).toHaveAttribute('data-left', 'open');
  await expect(page.locator('#panelEdgeLeft')).toBeHidden();

  await page.locator('#pinLeftPanel').click();
  await expect(stage).toHaveAttribute('data-left', 'pinned');
  await expect(page.locator('#pinLeftPanel')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#pinRightPanel').click();
  await expect(stage).toHaveAttribute('data-right', 'open');
  await page.mouse.move(640, 360);
  await expect(stage).toHaveAttribute('data-right', 'closed');
  await expect(page.locator('#panelEdgeRight')).toBeVisible();

  await page.waitForTimeout(400);
  await page.locator('#panelEdgeRight').hover({ force: true });
  await expect(stage).toHaveAttribute('data-right', 'open');
  await page.locator('#pinRightPanel').click();
  await expect(stage).toHaveAttribute('data-right', 'pinned');

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();

  await expect(page.locator('#artworkStep')).toBeVisible();
  await expect(stage).toHaveAttribute('data-left', 'pinned');
  await expect(stage).toHaveAttribute('data-right', 'pinned');
});

test('reference point selector swaps X/Y without moving artwork and anchors transforms', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);

  const centerButton = page.locator('.reference-point-button[data-point="center"]');
  const topLeftButton = page.locator('.reference-point-button[data-point="top-left"]');
  await expect(centerButton).toHaveAttribute('aria-pressed', 'true');

  const centerX = Number(await page.locator('#artworkX').inputValue());
  const centerY = Number(await page.locator('#artworkY').inputValue());
  const modelCenter = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return { x: model.centerXmm, y: model.centerYmm };
  });

  await topLeftButton.click();
  await expect(topLeftButton).toHaveAttribute('aria-pressed', 'true');
  await expect(centerButton).toHaveAttribute('aria-pressed', 'false');

  const topLeftX = Number(await page.locator('#artworkX').inputValue());
  const topLeftY = Number(await page.locator('#artworkY').inputValue());
  expect(topLeftX).toBeLessThan(centerX);
  expect(topLeftY).toBeLessThan(centerY);

  const modelAfter = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return { x: model.centerXmm, y: model.centerYmm };
  });
  expect(modelAfter.x).toBeCloseTo(modelCenter.x, 5);
  expect(modelAfter.y).toBeCloseTo(modelCenter.y, 5);

  await page.locator('#artworkX').fill('0');
  await page.locator('#artworkX').dispatchEvent('change');
  await page.locator('#artworkY').fill('0');
  await page.locator('#artworkY').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => {
    const position = window.cartonBuilderApp.artwork.artwork.getReferencePosition();
    return Math.round(position.x * 100) === 0 && Math.round(position.y * 100) === 0;
  })).toBe(true);

  const anchor = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.getReferencePosition());
  await page.locator('#artworkScaleX').fill('150');
  await page.locator('#artworkScaleX').dispatchEvent('change');
  await expect.poll(() => page.evaluate(() => (
    Math.round(window.cartonBuilderApp.artwork.artwork.scaleX * 100) === 150
  ))).toBe(true);
  const anchorAfterScale = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.getReferencePosition());
  expect(anchorAfterScale.x).toBeCloseTo(anchor.x, 4);
  expect(anchorAfterScale.y).toBeCloseTo(anchor.y, 4);

  await page.getByRole('button', { name: 'Rotate +90°' }).click();
  const anchorAfterRotate = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.getReferencePosition());
  expect(anchorAfterRotate.x).toBeCloseTo(anchorAfterScale.x, 4);
  expect(anchorAfterRotate.y).toBeCloseTo(anchorAfterScale.y, 4);
});

test('keeps transform and scale controls aligned on one parameter grid', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page);

  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    return {
      x: rect('#artworkX'),
      y: rect('#artworkY'),
      width: rect('#artworkWidth'),
      height: rect('#artworkHeight'),
      scaleX: rect('#artworkScaleX'),
      scaleY: rect('#artworkScaleY'),
      chain: rect('#constrainProportionsBtn'),
      transformUnits: [...document.querySelectorAll('.transform-fields .transform-unit')].map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, width: bounds.width };
      }),
      scaleUnits: [...document.querySelectorAll('.scale-fields .transform-unit')].map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, width: bounds.width };
      }),
    };
  });

  expect(geometry.scaleX.x).toBeCloseTo(geometry.x.x, 5);
  expect(geometry.scaleY.x).toBeCloseTo(geometry.width.x, 5);
  expect(geometry.scaleX.width).toBeCloseTo(geometry.x.width, 5);
  expect(geometry.scaleY.width).toBeCloseTo(geometry.width.width, 5);
  expect(geometry.scaleUnits[0].x).toBeCloseTo(geometry.transformUnits[0].x, 5);
  expect(geometry.scaleUnits[1].x).toBeCloseTo(geometry.transformUnits[1].x, 5);

  const widthCenter = geometry.width.y + geometry.width.height / 2;
  const heightCenter = geometry.height.y + geometry.height.height / 2;
  const chainCenter = geometry.chain.y + geometry.chain.height / 2;
  expect(chainCenter).toBeCloseTo((widthCenter + heightCenter) / 2, 5);
});

test('adds multiple artworks with named sublayers, reorders and renames them', async ({ page }) => {
  await openArtworkStep(page);
  await loadGeneratedPng(page, 'first.png');
  await loadGeneratedPng(page, 'second.png');

  const sublayers = page.locator('#artworkSublayers .artwork-sublayer');
  await expect(sublayers).toHaveCount(2);
  await expect(sublayers.nth(0)).toHaveText('second.png');
  await expect(sublayers.nth(1)).toHaveText('first.png');

  await expect(page.locator('#artworkFileName')).toHaveText('second.png');
  const state = await page.evaluate(() => window.cartonBuilderApp.artwork.createSnapshot());
  expect(state.artworks.map((entry) => entry.artwork.source.fileName)).toEqual(['second.png', 'first.png']);
  expect(state.activeArtworkIndex).toBe(0);

  await sublayers.nth(1).click();
  await expect(page.locator('#artworkFileName')).toHaveText('first.png');
  await expect(sublayers.nth(1)).toHaveClass(/active/);

  await sublayers.nth(1).locator('.layer-title').dblclick();
  const renameInput = sublayers.nth(1).locator('.layer-rename-input');
  await renameInput.fill('renamed.png');
  await renameInput.press('Enter');
  await expect(sublayers.nth(1)).toHaveText('renamed.png');
  await expect(page.locator('#artworkFileName')).toHaveText('renamed.png');

  // Verify reorder works via Ctrl+Z of rename (undo rename → verify name reverts)
  await page.keyboard.press('Control+z');
  await expect(page.locator('#artworkFileName')).toHaveText('first.png');
  await expect(sublayers.nth(1).locator('.layer-title')).toHaveText('first.png');
  // Redo rename
  await page.keyboard.press('Control+y');
  await expect(sublayers.nth(1).locator('.layer-title')).toHaveText('renamed.png');

  const secondRow = page.locator('#artworkSublayers .artwork-sublayer').nth(0);
  await secondRow.locator('.eye-cell').click();
  await expect(page.locator('#artworkSublayers .artwork-sublayer').nth(0)).toHaveText('second.png');
  const visibility = await page.evaluate(() => window.cartonBuilderApp.artwork.createSnapshot());
  expect(visibility.artworks[0].visible).toBe(false);

  await page.evaluate(() => window.cartonBuilderApp.artwork.flushPendingSave());
  await page.reload();
  await page.locator('#artworkStep').waitFor({ state: 'visible' });
  await expect(page.locator('#artworkSublayers .artwork-sublayer')).toHaveCount(2);
  await expect(page.locator('#artworkSublayers .artwork-sublayer').nth(0)).toHaveText('second.png');
  await expect(page.locator('#artworkSublayers .artwork-sublayer').nth(1)).toHaveText('renamed.png');
});






