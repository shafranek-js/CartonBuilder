import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

async function activate(page, label) {
  const button = page.getByRole('button', { name: label, exact: true });
  await button.focus();
  await button.press('Enter');
}

async function buildReferenceNet(page) {
  await activate(page, 'Add Base Panel to the bottom edge of Front Panel');
  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await activate(page, 'Add Back Panel to the top edge of Top Panel');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');
  await activate(page, 'Add Right Panel to the right edge of Back Panel');
}

async function loadArtwork(page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f6cf43';
    context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#2657c8';
    context.fillRect(40, 40, 520, 320);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'crop-fixture.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('artworkFileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#artworkFileName')).toHaveText('crop-fixture.png');
  await expect(page.locator('#processingOverlay')).toBeHidden();
}

async function openArtwork(page) {
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();
  await loadArtwork(page);
  await expect(page.locator('#cropSection')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('carton-builder');
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

test('shows a correctly positioned crop frame and commits it with the active button', async ({ page }) => {
  await openArtwork(page);
  const cropTools = page.locator('#cropSection .crop-tool-btn');
  await expect(cropTools).toHaveCount(3);
  const cropToolBoxes = await cropTools.evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  expect(cropToolBoxes.every((box) => Math.abs(box.y - cropToolBoxes[0].y) < 1)).toBe(true);
  expect(cropToolBoxes.every((box) => Math.abs(box.width - box.height) < 1)).toBe(true);
  // The label is intentionally visually hidden but remains available to
  // assistive technology. Assert the sr-only geometry instead of relying on
  // Playwright's visibility heuristic for clipped 1px elements.
  await expect(cropTools.nth(0).locator('span')).toHaveCSS('position', 'absolute');
  await expect(cropTools.nth(0).locator('span')).toHaveCSS('width', '1px');
  await expect(cropTools.nth(0).locator('svg')).toBeVisible();
  await expect(cropTools.nth(0)).toHaveAttribute('aria-label', 'Crop by adjusting frame handles');
  await expect(cropTools.nth(2)).toHaveAttribute('aria-label', 'Clear crop mask');
  const boxRows = page.locator('#boxDimensionsSection .box-dim-row');
  await expect(boxRows).toHaveCount(3);
  const boxRowLayout = await boxRows.evaluateAll((rows) => rows.map((row) => {
    const rowRect = row.getBoundingClientRect();
    const controlRect = row.querySelector('.box-dim-control').getBoundingClientRect();
    const icon = row.querySelector('.dimension-icon');
    return {
      y: rowRect.y,
      controlX: controlRect.x,
      iconClass: icon.className.baseVal,
    };
  }));
  expect(boxRowLayout.every((row, index) => index === 0 || row.y > boxRowLayout[index - 1].y)).toBe(true);
  expect(boxRowLayout.every((row) => row.controlX === boxRowLayout[0].controlX)).toBe(true);
  expect(boxRowLayout.map((row) => row.iconClass)).toEqual([
    'dimension-icon dim-scrubber width-icon',
    'dimension-icon dim-scrubber height-icon',
    'dimension-icon dim-scrubber depth-icon',
  ]);
  await expect(page.locator('#boxDimensionsSection #boxConstrainProportionsBtn')).toHaveCount(1);
  const before = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      centerX: model.centerXmm,
      centerY: model.centerYmm,
      width: model.unrotatedWidthMm,
      height: model.unrotatedHeightMm,
    };
  });

  await page.locator('#cropFrameButton').click();
  await expect(page.locator('#cropFrameButton')).toHaveClass(/active/);
  await expect(page.locator('#cropFrameButton span')).toHaveText('Apply');
  await expect(page.locator('#cropDrawButton span')).toHaveText('Draw');
  await expect(page.locator('.crop-frame')).toHaveCount(1);
  await expect(page.locator('.crop-handle')).toHaveCount(8);
  await expect(page.locator('.crop-side-handle')).toHaveCount(4);
  const cropHandleBox = await page.locator('.crop-handle').first().boundingBox();
  expect(cropHandleBox?.width).toBeGreaterThanOrEqual(4);
  expect(cropHandleBox?.width).toBeLessThanOrEqual(6);

  expect(Number(await page.locator('.crop-frame').getAttribute('x'))).toBeCloseTo(
    before.centerX - before.width / 2,
    5,
  );
  expect(Number(await page.locator('.crop-frame').getAttribute('y'))).toBeCloseTo(
    before.centerY - before.height / 2,
    5,
  );

  const frameBox = await page.locator('.crop-frame').boundingBox();
  if (!frameBox) throw new Error('Crop frame has no screen bounds');
  await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(frameBox.x + frameBox.width / 2 + 20, frameBox.y + frameBox.height / 2 + 10);
  await page.mouse.up();

  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.crop)).toBeNull();
  await page.locator('#cropFrameButton').click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.crop)).toMatchObject({
    width: before.width,
    height: before.height,
  });
  await expect(page.locator('.crop-frame')).toHaveCount(0);
  await expect(page.locator('.selection-frame')).toHaveCount(1);
  const resizeHandleBox = await page.locator('.resize-handle').first().boundingBox();
  expect(resizeHandleBox?.width).toBeCloseTo(cropHandleBox.width, 0);
});

test('shows side handles on the artwork selection and resizes from an edge', async ({ page }) => {
  await openArtwork(page);
  await expect(page.locator('.selection-frame')).toHaveCount(1);
  await expect(page.locator('.resize-handle')).toHaveCount(8);
  await expect(page.locator('.resize-side-handle')).toHaveCount(4);

  const before = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return { width: model.displayedWidthMm, height: model.displayedHeightMm };
  });
  await page.locator('#constrainProportionsBtn').click();
  const eastHandle = page.locator('.resize-side-handle[data-resize-side="e"]');
  const eastBox = await eastHandle.boundingBox();
  if (!eastBox) throw new Error('East artwork resize handle has no screen bounds');
  await page.mouse.move(eastBox.x + eastBox.width / 2, eastBox.y + eastBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(eastBox.x + eastBox.width / 2 - 20, eastBox.y + eastBox.height / 2);
  await page.mouse.up();

  const after = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return { width: model.displayedWidthMm, height: model.displayedHeightMm };
  });
  expect(after.width).toBeLessThan(before.width);
  expect(after.height).toBeCloseTo(before.height, 5);
});

test('allows non-proportional corner resize when proportions are unconstrained', async ({ page }) => {
  await openArtwork(page);
  const before = await page.evaluate(() => ({
    width: window.cartonBuilderApp.artwork.artwork.displayedWidthMm,
    height: window.cartonBuilderApp.artwork.artwork.displayedHeightMm,
  }));
  await page.locator('#constrainProportionsBtn').click();

  const handle = page.locator('.resize-handle[data-handle="se"]');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('Southeast artwork resize handle has no screen bounds');
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 70, startY + 6);
  await page.mouse.up();

  const after = await page.evaluate(() => ({
    width: window.cartonBuilderApp.artwork.artwork.displayedWidthMm,
    height: window.cartonBuilderApp.artwork.artwork.displayedHeightMm,
    scaleX: window.cartonBuilderApp.artwork.artwork.scaleX,
    scaleY: window.cartonBuilderApp.artwork.artwork.scaleY,
  }));
  expect(after.width).toBeGreaterThan(before.width);
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.width / before.width).not.toBeCloseTo(after.height / before.height, 2);
  expect(after.scaleX).not.toBeCloseTo(after.scaleY, 2);
});

test('snaps artwork resize to a dieline line, highlights it, and supports Ctrl bypass', async ({ page }) => {
  await openArtwork(page);
  const handle = page.locator('.resize-side-handle[data-resize-side="e"]');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('East artwork resize handle has no screen bounds');
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const targetScreen = await page.evaluate((currentY) => {
    const state = window.cartonBuilderApp.getState();
    const artwork = window.cartonBuilderApp.artwork.artwork;
    const candidates = state.box.panels.flatMap((panel) => [panel.x, panel.x + panel.width]);
    const targetX = candidates.reduce((best, value) => (
      Math.abs(value - artwork.bounds.maxX) < Math.abs(best - artwork.bounds.maxX) ? value : best
    ), candidates[0]);
    const svg = document.getElementById('artworkWorkspace');
    const point = svg.createSVGPoint();
    point.x = targetX;
    point.y = artwork.bounds.minY + artwork.bounds.height / 2;
    const screen = point.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: currentY };
  }, startY);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetScreen.x, targetScreen.y);
  await expect(page.locator('.snap-guide')).toHaveCount(1);
  await page.mouse.move(startX + 18, startY, { modifiers: ['Control'] });
  await expect(page.locator('.snap-guide')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.snap-guide')).toHaveCount(0);
});

test('resizes the crop frame with a side handle while keeping the opposite edge fixed', async ({ page }) => {
  await openArtwork(page);
  await page.locator('#cropFrameButton').click();
  const frame = page.locator('.crop-frame');
  const before = {
    x: Number(await frame.getAttribute('x')),
    width: Number(await frame.getAttribute('width')),
  };
  const eastHandle = page.locator('.crop-side-handle[data-crop-edge="e"]');
  const eastBox = await eastHandle.boundingBox();
  if (!eastBox) throw new Error('East crop handle has no screen bounds');
  await page.mouse.move(eastBox.x + eastBox.width / 2, eastBox.y + eastBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(eastBox.x + eastBox.width / 2 - 20, eastBox.y + eastBox.height / 2);
  await page.mouse.up();

  expect(Number(await frame.getAttribute('x'))).toBeCloseTo(before.x, 5);
  expect(Number(await frame.getAttribute('width'))).toBeLessThan(before.width);
});

test('snaps crop resize handles to dieline lines and clears the transient guide', async ({ page }) => {
  await openArtwork(page);
  await page.locator('#cropFrameButton').click();
  const eastHandle = page.locator('.crop-side-handle[data-crop-edge="e"]');
  const eastBox = await eastHandle.boundingBox();
  if (!eastBox) throw new Error('East crop handle has no screen bounds');
  const startX = eastBox.x + eastBox.width / 2;
  const startY = eastBox.y + eastBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 2, startY);
  await expect(page.locator('.snap-guide')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.snap-guide')).toHaveCount(0);
});

test('pans the empty artwork canvas with a right-button drag', async ({ page }) => {
  await openArtwork(page);
  const blankPoint = await page.evaluate(() => {
    const svg = document.getElementById('artworkWorkspace');
    const rect = svg.getBoundingClientRect();
    for (let y = 8; y < rect.height - 8; y += 8) {
      for (let x = 8; x < rect.width - 8; x += 8) {
        const target = document.elementFromPoint(rect.left + x, rect.top + y);
        if (target === svg) return { x: rect.left + x, y: rect.top + y };
      }
    }
    return null;
  });
  if (!blankPoint) throw new Error('Could not find an empty canvas point');

  const before = await page.evaluate(() => ({
    view: window.cartonBuilderApp.getState().view,
    centerX: window.cartonBuilderApp.artwork.artwork.centerXmm,
    centerY: window.cartonBuilderApp.artwork.artwork.centerYmm,
  }));
  await page.mouse.move(blankPoint.x, blankPoint.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(blankPoint.x + 40, blankPoint.y - 25, { steps: 3 });
  await page.mouse.up({ button: 'right' });

  const after = await page.evaluate(() => ({
    view: window.cartonBuilderApp.getState().view,
    centerX: window.cartonBuilderApp.artwork.artwork.centerXmm,
    centerY: window.cartonBuilderApp.artwork.artwork.centerYmm,
  }));
  expect(after.view.panX).toBeCloseTo(before.view.panX + 40, 5);
  expect(after.view.panY).toBeCloseTo(before.view.panY - 25, 5);
  expect(after.centerX).toBe(before.centerX);
  expect(after.centerY).toBe(before.centerY);
});

test('draws a crop area on the artwork, applies with Enter, and supports Escape cancellation', async ({ page }) => {
  await openArtwork(page);
  const image = page.locator('#artworkWorkspace image.artwork-image').last();
  const imageBox = await image.boundingBox();
  if (!imageBox) throw new Error('Artwork image has no screen bounds');

  await page.locator('#cropDrawButton').click();
  await expect(page.locator('#cropDrawButton')).toHaveClass(/active/);
  await page.mouse.move(imageBox.x + imageBox.width * 0.25, imageBox.y + imageBox.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(imageBox.x + imageBox.width * 0.7, imageBox.y + imageBox.height * 0.75);
  await page.mouse.up();

  await expect(page.locator('.crop-frame')).toHaveCount(1);
  await expect(page.locator('.crop-drawing-rect')).toHaveCount(0);
  const preview = await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.crop);
  expect(preview).toBeNull();

  await page.keyboard.press('Enter');
  const applied = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      crop: { ...model.crop },
      originX: model.centerXmm - model.unrotatedWidthMm / 2,
      originY: model.centerYmm - model.unrotatedHeightMm / 2,
      scaleX: model.scaleX,
      scaleY: model.scaleY,
      displayedWidth: model.displayedWidthMm,
      displayedHeight: model.displayedHeightMm,
    };
  });
  expect(applied.crop).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
  });
  expect(applied.scaleX).toBe(1);
  expect(applied.scaleY).toBe(1);
  await expect(page.locator('.selection-frame')).toHaveCount(1);
  expect(Number(await page.locator('.selection-frame').getAttribute('x'))).toBeCloseTo(
    applied.originX + applied.crop.x,
    5,
  );
  expect(Number(await page.locator('.selection-frame').getAttribute('y'))).toBeCloseTo(
    applied.originY + applied.crop.y,
    5,
  );
  expect(Number(await page.locator('.selection-frame').getAttribute('width'))).toBeCloseTo(applied.crop.width, 5);
  expect(Number(await page.locator('.selection-frame').getAttribute('height'))).toBeCloseTo(applied.crop.height, 5);
  await expect(page.locator('#artworkWidth')).toHaveValue(String(Math.round(applied.displayedWidth * 100) / 100));
  await expect(page.locator('#artworkHeight')).toHaveValue(String(Math.round(applied.displayedHeight * 100) / 100));
  await expect(page.locator('#artworkScaleX')).toHaveValue('100');
  await expect(page.locator('#artworkScaleY')).toHaveValue('100');

  await page.locator('#cropDrawButton').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.crop-frame')).toHaveCount(0);
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.crop)).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
  });
});

test('crop is undoable, redoable, clearable, and remains aligned after quarter-turn rotation', async ({ page }) => {
  await openArtwork(page);
  await page.getByRole('button', { name: 'Rotate +90°', exact: true }).click();
  await page.locator('#cropFrameButton').click();
  const transform = await page.locator('#artworkWorkspace .crop-frame').evaluate((node) => node.parentElement.getAttribute('transform'));
  expect(transform).toMatch(/^rotate\(90 /);
  await page.keyboard.press('Enter');

  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.crop)).not.toBeNull();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.crop)).toBeNull();
  await expect(page.locator('#cropStatus')).toHaveText('Click Crop or Draw to start.');
  await expect(page.locator('#clearCropButton')).toBeDisabled();
  await page.keyboard.press('Control+y');
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.crop)).not.toBeNull();
  await expect(page.locator('#cropStatus')).toHaveText('Crop applied. Use Crop or Draw to adjust.');
  await expect(page.locator('#clearCropButton')).toBeEnabled();

  await page.locator('#clearCropButton').click();
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.crop)).toBeNull();
  await expect(page.locator('#artworkWorkspace .crop-frame')).toHaveCount(0);
  await expect(page.locator('#artworkWorkspace .crop-drawing-rect')).toHaveCount(0);
  await expect(page.locator('#artworkWorkspace .selection-frame')).toHaveCount(1);
});

test('uses the applied crop for numeric transforms and clear preserves the visible fragment', async ({ page }) => {
  await openArtwork(page);
  const imageBox = await page.locator('#artworkWorkspace image.artwork-image').last().boundingBox();
  if (!imageBox) throw new Error('Artwork image has no screen bounds');

  await page.locator('#cropDrawButton').click();
  await page.mouse.move(imageBox.x + imageBox.width * 0.2, imageBox.y + imageBox.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(imageBox.x + imageBox.width * 0.6, imageBox.y + imageBox.height * 0.7);
  await page.mouse.up();
  await page.keyboard.press('Enter');

  const beforeScale = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      width: model.displayedWidthMm,
      cropWidth: model.crop.width,
      reference: model.getReferencePosition(),
    };
  });
  await page.locator('#artworkWidth').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, beforeScale.width * 1.5);

  const afterScale = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      width: model.displayedWidthMm,
      cropWidth: model.crop.width,
      scaleX: model.scaleX,
      scaleY: model.scaleY,
      reference: model.getReferencePosition(),
    };
  });
  expect(afterScale.width).toBeCloseTo(beforeScale.width * 1.5, 4);
  expect(afterScale.cropWidth).toBeCloseTo(beforeScale.cropWidth * 1.5, 4);
  expect(afterScale.scaleX).toBeCloseTo(1.5, 4);
  expect(afterScale.scaleY).toBeCloseTo(1.5, 4);
  expect(afterScale.reference.x).toBeCloseTo(beforeScale.reference.x, 4);
  expect(afterScale.reference.y).toBeCloseTo(beforeScale.reference.y, 4);

  const targetX = afterScale.reference.x + 25;
  await page.locator('#artworkX').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, targetX);
  const beforeClear = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      sourceCenter: { x: model.centerXmm, y: model.centerYmm },
      visibleCenter: model.visibleCenter,
      fullWidth: model.unrotatedWidthMm,
      fullHeight: model.unrotatedHeightMm,
      reference: model.getReferencePosition(),
    };
  });
  expect(beforeClear.reference.x).toBeCloseTo(targetX, 4);

  await page.locator('#clearCropButton').click();
  const afterClear = await page.evaluate(() => {
    const model = window.cartonBuilderApp.artwork.artwork;
    return {
      crop: model.crop,
      sourceCenter: { x: model.centerXmm, y: model.centerYmm },
      visibleCenter: model.visibleCenter,
      fullWidth: model.unrotatedWidthMm,
      fullHeight: model.unrotatedHeightMm,
    };
  });
  expect(afterClear.crop).toBeNull();
  expect(afterClear.visibleCenter.x).toBeCloseTo(beforeClear.visibleCenter.x, 4);
  expect(afterClear.visibleCenter.y).toBeCloseTo(beforeClear.visibleCenter.y, 4);
  expect(afterClear.fullWidth).toBeCloseTo(beforeClear.fullWidth, 4);
  expect(afterClear.fullHeight).toBeCloseTo(beforeClear.fullHeight, 4);
  await expect(page.locator('.selection-frame')).toHaveCount(1);
});
