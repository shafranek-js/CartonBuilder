import { defineConfig } from '@playwright/test';

const previewPort = process.env.PLAYWRIGHT_PORT || '4173';
const previewDir = process.env.PLAYWRIGHT_OUT_DIR || 'dist';

export default defineConfig({
  testDir: './tests/e2e',
  // The visual-proof capture is a developer-only workflow that requires an
  // explicitly supplied video fixture and output directory. It must never
  // make the release browser matrix depend on a local absolute path.
  testIgnore: ['**/saveArtifactScreenshots.spec.js'],
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  fullyParallel: false,
  reporter: 'line',
  // Hosted SwiftShader renders are slower than local GPU-backed runs. Keep
  // CI assertions patient without changing the local feedback loop.
  expect: { timeout: process.env.CI ? 30_000 : 5_000 },
  timeout: process.env.CI ? 180_000 : 30_000,
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_BROWSER === 'edge' ? 'msedge' : undefined,
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-webgl'] },
    storageState: {
      cookies: [],
      origins: [{
        origin: `http://127.0.0.1:${previewPort}`,
        localStorage: [{ name: 'carton-builder-first-run-example-v1', value: 'true' }],
      }],
    },
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --outDir ${previewDir} --host 127.0.0.1 --port ${previewPort}`,
    url: `http://127.0.0.1:${previewPort}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
