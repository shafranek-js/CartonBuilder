import { expect, test } from '@playwright/test';

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

test('Wave 9A exposes persistent prepress settings and overlays', async ({ page }) => {
  await page.goto('/');
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();
  await expect(page.locator('#prepressSection')).toBeVisible();
  await page.locator('#prepressMode').selectOption('production-assist');
  await page.locator('#prepressBleed').fill('4');
  await page.locator('#prepressSafe').fill('2');
  await page.locator('#prepressRun').click();
  await expect(page.locator('#prepressStatus')).toContainText('Preflight blocked');

  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.locator('#menuPrepressOverlaybleed').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('#prepressOverlay')))).toBe(true);
  const state = await page.evaluate(() => window.cartonBuilderApp.artwork.createSnapshot().prepress);
  expect(state).toMatchObject({ mode: 'production-assist', bleedMm: 4, safeMm: 2 });
});
