import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

async function generateProofScreenshots() {
  console.log('Generating Proof Screenshots...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    await page.goto('http://127.0.0.1:5174/');
    console.log('Opened app');

    // Step 1: Create Box Net
    await page.getByRole('button', { name: 'Add Base Panel to the bottom edge of Front Panel' }).click();
    await page.getByRole('button', { name: 'Add Top Panel to the top edge of Front Panel' }).click();
    await page.getByRole('button', { name: 'Add Back Panel to the top edge of Top Panel' }).click();
    await page.getByRole('button', { name: 'Add Left Panel to the left edge of Front Panel' }).click();
    await page.getByRole('button', { name: 'Add Right Panel to the right edge of Back Panel' }).click();
    console.log('Built carton box net');

    // Step 2: Place Artwork
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

    console.log('Uploaded videoplayback.mp4');
    await page.waitForTimeout(2000);

    // Save 2D canvas screenshot to artifact directory
    const shot2dPath = 'C:/Users/pavel/.gemini/antigravity/brain/bb131d43-ac44-4c98-a199-5b7164488680/2d_canvas_proof.png';
    await page.screenshot({ path: shot2dPath });
    console.log('Saved 2D canvas proof:', shot2dPath);

    // Step 3: Preview 3D
    await page.locator('.step[data-step-target="preview"]').click();
    await page.waitForSelector('#previewStep', { state: 'visible' });
    await page.waitForTimeout(2500);

    // Save 3D preview screenshot to artifact directory
    const shot3dPath = 'C:/Users/pavel/.gemini/antigravity/brain/bb131d43-ac44-4c98-a199-5b7164488680/3d_preview_proof.png';
    await page.screenshot({ path: shot3dPath });
    console.log('Saved 3D preview proof:', shot3dPath);

    console.log('Screenshot generation finished successfully!');
  } catch (error) {
    console.error('Screenshot generation error:', error);
  } finally {
    await browser.close();
  }
}

generateProofScreenshots();
