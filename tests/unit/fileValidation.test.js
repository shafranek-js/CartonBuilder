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
    expect(detectArtworkType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    expect(detectArtworkType(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video/webm');
    expect(detectArtworkType(Uint8Array.from([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70]))).toBe('video/mp4');
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

  it('accepts PDF-based Illustrator files reported as octet-stream or postscript', async () => {
    const header = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const octet = new Blob([header], { type: 'application/octet-stream' });
    const postscript = new Blob([header], { type: 'application/postscript' });
    await expect(validateArtworkFile(octet)).resolves.toEqual({
      mimeType: 'application/pdf',
      extension: 'pdf',
    });
    await expect(validateArtworkFile(postscript)).resolves.toEqual({
      mimeType: 'application/pdf',
      extension: 'pdf',
    });
  });

  it('still rejects type mismatches that are not PDF aliases', async () => {
    const blob = new Blob([
      Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
    ], { type: 'image/png' });
    await expect(validateArtworkFile(blob)).rejects.toMatchObject({
      code: 'artworkFileTypeMismatch',
    });
  });
});
