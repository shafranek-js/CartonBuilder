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
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
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
  await page.keyboard.press('Control+y');
  expect(await page.evaluate(() => window.cartonBuilderApp.artwork.artwork.crop)).not.toBeNull();

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
