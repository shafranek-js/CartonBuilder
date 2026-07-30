import { readFile } from 'node:fs/promises';

import {
  PDFDict,
  PDFDocument,
  PDFName,
  degrees,
  rgb,
} from 'pdf-lib';
import { expect, test } from '@playwright/test';

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

async function openArtworkStep(page) {
  await buildReferenceNet(page);
  await page.getByRole('button', { name: 'Continue' }).click();
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

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('carton-builder');
      request.onsuccess = request.onerror = request.onblocked = resolve;
    });
  });
  await page.reload();
});

test('completes the three-step artwork workflow and exports every deliverable', async ({ page }) => {
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
  await page.getByLabel('Lock Artwork').uncheck();

  await page.getByRole('button', { name: 'Rotate +90°' }).click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(90);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.rotation)).toBe(90);

  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Project' }).click();
  const project = await projectDownload;
  expect(project.suggestedFilename()).toBe('carton-project.carton');
  const projectPath = await project.path();

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#previewStep')).toBeVisible();
  await expect(page.locator('#previewWorkspace image.artwork-image')).toHaveCount(1);

  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Dieline SVG' }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe('box-net-150x90x40mm.svg');
  expect((await readFile(await svg.path(), 'utf8')).match(/<rect /g)).toHaveLength(6);

  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  const png = await pngDownload;
  expect(png.suggestedFilename()).toBe('carton-artwork-preview.png');
  expect((await readFile(await png.path())).subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toBe('carton-artwork.pdf');
  expect((await readFile(await pdf.path(), 'utf8')).slice(0, 5)).toBe('%PDF-');

  await page.getByRole('button', { name: 'Back to edit' }).click();
  const diagnosticsDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Diagnostics' }).click();
  const diagnostics = JSON.parse(await readFile(await (await diagnosticsDownload).path(), 'utf8'));
  expect(diagnostics.privacy).toContain('No artwork bytes');
  expect(JSON.stringify(diagnostics)).not.toContain('sample-artwork.png');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove' }).click();
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

test('validates dimensions, warns once for modified artwork and preserves compatibility events', async ({ page }) => {
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel', ' ');
  await expect(page.locator('#announcer')).toHaveText('Base Panel added. 2 of 6 panels placed.');

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(
      'Changing the box dimensions will reset the current panel layout. Continue?',
    );
    await dialog.accept();
  });
  await page.locator('#boxWidth').fill('200');
  await page.locator('#boxWidth').press('Enter');
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  await expect.poll(() => page.evaluate(() => window.boxNetApp.getState().dimensions.width)).toBe(200);

  await page.locator('#boxDepth').fill('0');
  await page.locator('#boxDepth').press('Enter');
  await expect(page.locator('#boxDepth')).toHaveValue('40');
  await expect(page.locator('#toast')).toHaveText('depth must be a positive number.');

  await buildReferenceNet(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await loadGeneratedPng(page);
  await page.locator('#artworkWorkspace').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Back' }).click();

  let dialogCount = 0;
  page.once('dialog', async (dialog) => {
    dialogCount += 1;
    expect(dialog.message()).toBe(
      'Changing the box dimensions will reset the panel layout and artwork placement. Continue?',
    );
    await dialog.accept();
  });
  await page.locator('#boxHeight').fill('100');
  await page.locator('#boxHeight').press('Enter');
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  expect(dialogCount).toBe(1);

  await page.evaluate(() => {
    window.__cancelled = 0;
    window.addEventListener('box-net-cancelled', () => {
      window.__cancelled += 1;
    });
  });
  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => page.evaluate(() => window.__cancelled)).toBe(1);
});

test('handles invalid and multi-file input, PDF page selection and rotated vector export', async ({ page }) => {
  await openArtworkStep(page);

  await page.locator('#artworkFileInput').setInputFiles({
    name: 'fake.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.locator('#toast')).toHaveText('Use a PNG, JPG/JPEG or PDF file.');

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
  await expect(page.locator('#toast')).toHaveText('Drop exactly one artwork file.');

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

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
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
