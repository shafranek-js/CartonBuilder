import { describe, expect, it } from 'vitest';

import { sha256 } from '../../src/artwork/fileValidation.js';
import {
  detectRenderBackgroundType,
  validateRenderAssets,
  validateRenderBackground,
} from '../../src/render/renderAssets.js';

const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('render background assets', () => {
  it('detects supported image signatures and normalizes metadata', async () => {
    expect(detectRenderBackgroundType(PNG_HEADER)).toBe('image/png');
    const file = new Blob([PNG_HEADER, Uint8Array.from([1, 2, 3])], { type: 'image/png' });
    const asset = await validateRenderBackground(file, { createImageBitmapFn: null });
    expect(asset.mimeType).toBe('image/png');
    expect(asset.fileName).toBe('background.png');
    expect(asset.assetId).toBe(await sha256(file));
  });

  it('rejects assets with a mismatched checksum', async () => {
    const blob = new Blob([PNG_HEADER, Uint8Array.from([4])], { type: 'image/png' });
    await expect(validateRenderAssets([{
      assetId: 'a'.repeat(64),
      sha256: 'a'.repeat(64),
      fileName: 'background.png',
      mimeType: 'image/png',
      blob,
    }])).rejects.toMatchObject({ code: 'projectRenderAssetChecksumMismatch' });
  });
});
