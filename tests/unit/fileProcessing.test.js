import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getPreviewScale,
  processArtworkFile,
} from '../../src/artwork/fileProcessing.js';

function pngBlob() {
  return new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
  ], { type: 'image/png' });
}

class CanvasMock {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return { drawImage: vi.fn() };
  }

  async convertToBlob() {
    return pngBlob();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('artwork file processing', () => {
  it('applies the preview edge and pixel caps', () => {
    expect(getPreviewScale(8192, 2048)).toBeCloseTo(0.5);
    expect(getPreviewScale(8000, 8000)).toBeCloseTo(0.5);
    expect(getPreviewScale(1000, 500)).toBe(1);
  });

  it('normalizes raster preview to PNG and closes its bitmap', async () => {
    const bitmap = { width: 200, height: 100, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.stubGlobal('OffscreenCanvas', CanvasMock);

    const result = await processArtworkFile(pngBlob());
    expect(result.previewBlob.type).toBe('image/png');
    expect(result.previewWidthPx).toBe(200);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('closes a decoded bitmap when processing is aborted', async () => {
    const controller = new AbortController();
    const bitmap = { width: 200, height: 100, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => {
      controller.abort();
      return bitmap;
    }));
    vi.stubGlobal('OffscreenCanvas', CanvasMock);

    await expect(processArtworkFile(pngBlob(), {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
