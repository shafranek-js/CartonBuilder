import { describe, expect, it } from 'vitest';

import { detectArtworkType, validateArtworkFile } from '../../src/artwork/fileValidation.js';
import { processArtworkFile } from '../../src/artwork/fileProcessing.js';

describe('video texture processing', () => {
  it('detects MP4 and WebM video formats', () => {
    const mp4Bytes = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const webmBytes = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]);
    const gifBytes = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

    expect(detectArtworkType(mp4Bytes)).toBe('video/mp4');
    expect(detectArtworkType(webmBytes)).toBe('video/webm');
    expect(detectArtworkType(gifBytes)).toBe('image/gif');
  });

  it('validates video MP4 blobs', async () => {
    const mp4Blob = new Blob([
      Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    ], { type: 'video/mp4' });

    const validated = await validateArtworkFile(mp4Blob);
    expect(validated).toEqual({
      mimeType: 'video/mp4',
      extension: 'mp4',
    });
  });

  it('processes video files into artwork sources with isVideo flag', async () => {
    const mp4Blob = new File([
      Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
    ], 'promo.mp4', { type: 'video/mp4' });

    const processed = await processArtworkFile(mp4Blob);
    expect(processed.mimeType).toBe('video/mp4');
    expect(processed.extension).toBe('mp4');
    expect(processed.isVideo).toBe(true);
    expect(processed.previewBlob).toBeInstanceOf(Blob);
  });
});
