import { describe, expect, it } from 'vitest';

import {
  MAX_ARTWORK_BYTES,
  detectArtworkType,
  validateArtworkFile,
} from '../../src/artwork/fileValidation.js';

describe('artwork file validation', () => {
  it('detects supported formats by signature', () => {
    expect(detectArtworkType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectArtworkType(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
    expect(detectArtworkType(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('application/pdf');
    expect(detectArtworkType(Uint8Array.from([1, 2, 3]))).toBeNull();
  });

  it('rejects spoofed, empty and oversized files', async () => {
    await expect(validateArtworkFile(new Blob([]))).rejects.toMatchObject({
      code: 'artworkFileEmpty',
    });
    await expect(
      validateArtworkFile(new Blob(['not a png'], { type: 'image/png' })),
    ).rejects.toMatchObject({ code: 'artworkFileUnsupported' });
    await expect(validateArtworkFile({
      size: MAX_ARTWORK_BYTES + 1,
    })).rejects.toMatchObject({ code: 'artworkFileRequired' });

    const oversized = new Proxy(new Blob(['x']), {
      get(target, property) {
        if (property === 'size') return MAX_ARTWORK_BYTES + 1;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(validateArtworkFile(oversized)).rejects.toMatchObject({
      code: 'artworkFileTooLarge',
    });
  });

  it('accepts a matching declared type', async () => {
    const blob = new Blob([
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], { type: 'image/png' });
    await expect(validateArtworkFile(blob)).resolves.toEqual({
      mimeType: 'image/png',
      extension: 'png',
    });
  });
});
