import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

function buildSpotOverprintPdf() {
  const code = '{ dup 0 mul exch dup 0.91 mul exch dup 0.72 mul exch 0 mul }';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /ProcSet [/PDF] /ColorSpace << /PANTONE185C [ /Separation /PANTONE185C /DeviceCMYK 5 0 R ] >> /ExtGState << /GS << /Type /ExtGState /OP true /op true >> >> >> /Contents 4 0 R >>',
  ];
  const content = '0.5 0.5 0 0 k 0 0 200 200 re f /GS gs /PANTONE185C cs 1 scn 40 40 120 120 re f';
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  objects.push(`<< /FunctionType 4 /Domain [0 1] /Range [0 1 0 1 0 1 0 1] /Length ${code.length} >>\nstream\n${code}\nendstream`);
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function buildReferenceNet(page) {
  const activate = async (label) => {
    const action = page.getByRole('button', { name: label });
    await action.focus();
    await action.press('Enter');
  };
  await activate('Add Base Panel to the bottom edge of Front Panel');
  await activate('Add Top Panel to the top edge of Front Panel');
  await activate('Add Back Panel to the top edge of Top Panel');
  await activate('Add Left Panel to the left edge of Front Panel');
  await activate('Add Right Panel to the right edge of Back Panel');
}

async function getPreviewProbe(page, fractionX = 0.5, fractionY = 0.5) {
  return page.evaluate(async ({ fractionX: fx, fractionY: fy }) => {
    const entry = window.cartonBuilderApp.artwork.getArtworks()[0];
    if (!entry?.previewBlob) return null;
    const bitmap = await createImageBitmap(entry.previewBlob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(canvas.width * fx)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(canvas.height * fy)));
    return Array.from(context.getImageData(x, y, 1, 1).data);
  }, { fractionX, fractionY });
}

test('lets the user hide and show a spot plate in the Separations dialog', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.waitForTimeout(1200);
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();

  const stamp = Date.now();
  const pdfPath = join(tmpdir(), `spot-seps-${stamp}.pdf`);
  await writeFile(pdfPath, Buffer.from(buildSpotOverprintPdf()));
  await page.locator('#artworkFileInput').setInputFiles(pdfPath);
  await expect(page.locator('#artworkFileName')).toHaveText(`spot-seps-${stamp}.pdf`);
  await expect(page.locator('#processingOverlay')).toBeHidden();

  await page.locator('#viewMenuTriggerBtn').click();
  await page.locator('#menuSeparationsBtn').click();
  const dialog = page.locator('#separationsDialog');
  await expect(dialog).toBeVisible();
  const list = page.locator('#separationsList');
  await expect(list).toContainText('PANTONE185C');
  await expect(list).toContainText('Cyan');
  await expect(list).toContainText('Black');

  const spotToggle = page.locator('.separation-toggle').nth(4);
  await expect(page.locator('.separation-toggle')).toHaveCount(5);
  await expect(spotToggle).toBeChecked();

  const cyanToggle = page.locator('.separation-toggle').nth(0);
  const cyanBefore = await getPreviewProbe(page);
  await cyanToggle.uncheck();
  await expect.poll(async () => getPreviewProbe(page), { timeout: 30_000 }).not.toEqual(cyanBefore);
  await expect.poll(async () => page.evaluate(() => (
    window.cartonBuilderApp.artwork.artwork.pdfSeparationVisibility?.process?.[0]
  ))).toBe(false);
  const cyanOff = await getPreviewProbe(page);
  await cyanToggle.check();
  await expect.poll(async () => getPreviewProbe(page), { timeout: 30_000 }).not.toEqual(cyanOff);

  const before = await getPreviewProbe(page);
  await spotToggle.uncheck();
  await expect.poll(async () => getPreviewProbe(page), { timeout: 30_000 }).not.toEqual(before);
  const spotOff = await getPreviewProbe(page);

  const visibility = await page.evaluate(() => (
    window.cartonBuilderApp.artwork.artwork.pdfSeparationVisibility
  ));
  expect(visibility).toEqual({ process: [true, true, true, true], spots: { '0': false } });

  await spotToggle.check();
  await expect.poll(async () => getPreviewProbe(page), { timeout: 30_000 }).not.toEqual(spotOff);

  await page.evaluate(() => localStorage.setItem('carton-builder-first-run-example-v1', 'true'));
});

test('toggles Overprint Preview through the custom MuPDF renderer and re-renders the preview', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.waitForTimeout(1200);
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();

  const stamp = Date.now();
  const pdfPath = join(tmpdir(), `spot-overprint-${stamp}.pdf`);
  await writeFile(pdfPath, Buffer.from(buildSpotOverprintPdf()));
  await page.locator('#artworkFileInput').setInputFiles(pdfPath);
  await expect(page.locator('#artworkFileName')).toHaveText(`spot-overprint-${stamp}.pdf`);
  await expect(page.locator('#processingOverlay')).toBeHidden();

  const renderer = await page.evaluate(() => (
    window.cartonBuilderApp.artwork.isOverprintAvailable?.() === true
  ));
  expect(renderer).toBe(true);

  await page.locator('#viewMenuTriggerBtn').click();
  await expect(page.locator('#viewMenuPopover')).toBeVisible();
  const toggle = page.locator('#menuEnableOverprintBtn');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  const before = await getPreviewProbe(page);
  await toggle.click();
  await expect(page.locator('#viewMenuPopover')).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('carton-builder-overprint'))).toBe('1');
  await expect.poll(async () => getPreviewProbe(page), { timeout: 30_000 }).not.toEqual(before);

  await page.locator('#viewMenuTriggerBtn').click();
  await page.locator('#menuEnableOverprintBtn').click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('carton-builder-overprint'))).toBe('0');

  await page.evaluate(() => localStorage.setItem('carton-builder-first-run-example-v1', 'true'));
});
