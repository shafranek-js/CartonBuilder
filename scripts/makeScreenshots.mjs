import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

async function makeScreenshots() {
  console.log('Starting screenshot capture...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    await page.goto('http://127.0.0.1:5174/');
    await page.waitForTimeout(1000);

    // Step 1: Add panel
    await page.getByRole('button', { name: 'Add Base Panel to the bottom edge of Front Panel' }).click();
    await page.waitForTimeout(500);

    // Step 2: Go to Artwork
    await page.locator('.step[data-step-target="artwork"]').click();
    await page.waitForSelector('#artworkStep', { state: 'visible' });

    const videoBuffer = await readFile('videoplayback.mp4');
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#selectArtworkButton').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles([{
      name: 'videoplayback.mp4',
      mimeType: 'video/mp4',
      buffer: videoBuffer,
    }]);

    await page.waitForTimeout(2000);
    const path2d = 'C:/Users/pavel/.gemini/antigravity/brain/bb131d43-ac44-4c98-a199-5b7164488680/2d_canvas_proof.png';
    await page.screenshot({ path: path2d });
    console.log('Saved 2D proof:', path2d);

    // Step 3: Go to Preview
    await page.locator('.step[data-step-target="preview"]').click();
    await page.waitForSelector('#previewStep', { state: 'visible' });
    await page.waitForTimeout(2500);

    const path3d = 'C:/Users/pavel/.gemini/antigravity/brain/bb131d43-ac44-4c98-a199-5b7164488680/3d_preview_proof.png';
    await page.screenshot({ path: path3d });
    console.log('Saved 3D proof:', path3d);

  } catch (err) {
    console.error('Error during screenshot capture:', err);
  } finally {
    await browser.close();
  }
}

makeScreenshots();
