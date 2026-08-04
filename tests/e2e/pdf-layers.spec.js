import { expect, test } from '@playwright/test';

function buildOcgPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [3 0 R 4 0 R] /D << /Order [3 0 R 4 0 R] /ON [3 0 R] /OFF [4 0 R] >> >> >>',
    '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
    '<< /Type /OCG /Name (RedLayer) >>',
    '<< /Type /OCG /Name (BlueLayer) >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /ProcSet [/PDF /Text] /Properties << /OC1 3 0 R /OC2 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const content = 'q /OC /OC1 BDC 1 0 0 rg BT /F1 24 Tf 20 160 Td (RED) Tj ET EMC Q\nq /OC /OC2 BDC 0 0 1 rg BT /F1 24 Tf 20 100 Td (BLUE) Tj ET EMC Q\n';
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);

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

async function countPreviewPixels(page) {
  return page.evaluate(async () => {
    const url = window.cartonBuilderApp.artwork.renderer.previewUrl;
    if (!url) return { red: 0, blue: 0 };
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 0 && r > 150 && g < 100 && b < 100) red += 1;
      if (a > 0 && b > 150 && r < 100 && g < 100) blue += 1;
    }
    return { red, blue };
  });
}

async function waitForPixels(page, predicate) {
  await expect.poll(async () => {
    const counts = await countPreviewPixels(page);
    return predicate(counts);
  }, { timeout: 15000 }).toBe(true);
}

test('imports a PDF-based Illustrator file with an .ai extension', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173');
  await page.waitForTimeout(1200);
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();

  await page.locator('#artworkFileInput').setInputFiles({
    name: 'artwork.ai',
    mimeType: 'application/octet-stream',
    buffer: buildOcgPdf(),
  });
  await expect(page.locator('#artworkFileName')).toHaveText('artwork.ai');
  await expect(page.locator('#processingOverlay')).toBeHidden();
  await expect(page.locator('#pdfLayersSection')).toBeVisible();
  await expect(page.locator('#pdfLayersList')).toContainText('RedLayer');
  await expect(page.locator('#pdfLayersList')).toContainText('BlueLayer');
});

test('exposes PDF optional content layers and re-renders the preview when toggled', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173');
  await page.waitForTimeout(1200);
  await buildReferenceNet(page);
  await page.locator('.step[data-step-target="artwork"]').click();

  await page.locator('#artworkFileInput').setInputFiles({
    name: 'layers.pdf',
    mimeType: 'application/pdf',
    buffer: buildOcgPdf(),
  });
  await expect(page.locator('#artworkFileName')).toHaveText('layers.pdf');
  await expect(page.locator('#processingOverlay')).toBeHidden();

  const pdfLayersSection = page.locator('#pdfLayersSection');
  await expect(pdfLayersSection).toBeVisible();
  await expect(page.locator('#pdfLayersList')).toContainText('RedLayer');
  await expect(page.locator('#pdfLayersList')).toContainText('BlueLayer');

  const state = await page.evaluate(() => {
    const artwork = window.cartonBuilderApp.artwork.artwork;
    return {
      layers: artwork.source.pdfLayers,
      visibility: artwork.pdfLayerVisibility,
    };
  });
  expect(state.layers).toEqual([
    { id: '3R', name: 'RedLayer', group: null },
    { id: '4R', name: 'BlueLayer', group: null },
  ]);
  expect(state.visibility).toEqual({ '3R': true, '4R': false });

  await waitForPixels(page, ({ red, blue }) => red > 0 && blue === 0);

  const blueCheckbox = page.locator('.pdf-layer-row input').nth(1);
  await expect(blueCheckbox).not.toBeChecked();
  await page.locator('.pdf-layer-row').nth(1).locator('.eye-cell').click();
  await waitForPixels(page, ({ red, blue }) => red > 0 && blue > 0);

  await page.locator('.pdf-layer-row').nth(0).locator('.eye-cell').click();
  await waitForPixels(page, ({ red, blue }) => red === 0 && blue > 0);
});
