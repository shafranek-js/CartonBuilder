import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('published index assets', () => {
  it('keeps favicon URLs compatible with a non-root GitHub Pages base path', () => {
    const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

    expect(indexHtml).toContain('href="%BASE_URL%favicon.svg"');
    expect(indexHtml).toContain('href="%BASE_URL%favicon-32x32.png"');
    expect(indexHtml).toContain('href="%BASE_URL%favicon-16x16.png"');
    expect(indexHtml).toContain('href="%BASE_URL%apple-touch-icon.png"');
    expect(indexHtml).toContain('href="%BASE_URL%favicon.ico"');
    expect(indexHtml).not.toMatch(/href="\/(?:favicon|apple-touch-icon)/);
  });
});
