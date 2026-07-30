import { readFile } from 'node:fs/promises';

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

test('builds, completes and exports the reference net', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('Width:')).toHaveValue('150');
  await expect(page.getByLabel('Height:')).toHaveValue('90');
  await expect(page.getByLabel('Depth:')).toHaveValue('40');
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await expect(page.locator('[data-panel-id="front"]')).toHaveCount(1);

  await buildReferenceNet(page);

  await expect(page.locator('#panelCount')).toHaveText('6/6');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await expect(page.locator('.plus-action')).toHaveCount(0);
  await expect(page.locator('#announcer')).toHaveText(
    'Right Panel added. 6 of 6 panels placed. Box net complete.',
  );

  await page.evaluate(() => {
    window.__completeEvent = null;
    window.addEventListener('box-net-complete', (event) => {
      window.__completeEvent = event.detail;
    }, { once: true });
  });

  await page.getByRole('button', { name: 'Continue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Basic box created' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-describedby', 'resultDescription');
  await expect(page.getByRole('button', { name: 'Export SVG' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__completeEvent?.complete)).toBe(true);

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Back' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Export SVG' })).toBeFocused();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('box-net-150x90x40mm.svg');
  const downloadPath = await download.path();
  const content = await readFile(downloadPath, 'utf8');
  expect(content.match(/<rect /g)).toHaveLength(6);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
});

test('validates dimensions, confirms resets and dispatches cancellation', async ({ page }) => {
  await page.goto('/');

  await activate(page, 'Add Base Panel to the bottom edge of Front Panel', ' ');
  await expect(page.locator('#announcer')).toHaveText(
    'Base Panel added. 2 of 6 panels placed.',
  );

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(
      'Changing the box dimensions will reset the current panel layout. Continue?',
    );
    await dialog.accept();
  });
  await page.getByLabel('Width:').fill('200');
  await page.getByLabel('Width:').press('Enter');
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  await expect.poll(() => page.evaluate(() => window.boxNetApp.getState().dimensions.width)).toBe(200);

  await page.getByLabel('Depth:').fill('0');
  await page.getByLabel('Depth:').press('Enter');
  await expect(page.getByLabel('Depth:')).toHaveValue('40');
  await expect(page.locator('#toast')).toHaveText('depth must be a positive number.');

  await activate(page, 'Add Top Panel to the top edge of Front Panel');
  await page.evaluate(() => {
    window.__cancelled = 0;
    window.addEventListener('box-net-cancelled', () => {
      window.__cancelled += 1;
    });
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#panelCount')).toHaveText('1/6');
  await expect.poll(() => page.evaluate(() => window.__cancelled)).toBe(1);
  await expect(page.locator('#toast')).toHaveText('The box layout was reset.');
});

test('keeps the model stable when resized and works without ResizeObserver', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('/');
  await activate(page, 'Add Left Panel to the left edge of Front Panel');

  const stateBefore = await page.evaluate(() => window.boxNetApp.getState());
  await page.setViewportSize({ width: 390, height: 720 });
  await expect(page.locator('.app-shell')).toHaveCSS('border-radius', '0px');
  await expect(page.locator('#workspace')).toBeVisible();
  expect(await page.evaluate(() => window.boxNetApp.getState())).toEqual(stateBefore);
});
