import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HTML_TEXTURE_LIMITS,
  PREVIEW_TEXTURE_LIMITS,
  composeArtworkTexture,
  getTextureSize,
} from '../../src/preview3d/textureComposer.js';

class ContextMock {
  constructor({ failDraw = false } = {}) {
    this.failDraw = failDraw;
    this.globalAlpha = 1;
    this.fillStyle = '';
  }

  beginPath() {}
  rect() {}
  clip() {}
  fillRect() {}
  save() {}
  restore() {}
  scale() {}
  translate() {}
  rotate() {}

  drawImage() {
    if (this.failDraw) throw new Error('draw failed');
  }
}

class CanvasMock {
  static failDraw = false;

  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.context = new ContextMock({ failDraw: CanvasMock.failDraw });
  }

  getContext() {
    return this.context;
  }
}

function fixture() {
  const panel = {
    id: 'front',
    x: 0,
    y: 0,
    width: 150,
    height: 90,
  };
  return {
    boxModel: {
      getBounds: () => ({
        minX: 0,
        minY: 0,
        maxX: 150,
        maxY: 90,
        width: 150,
        height: 90,
      }),
      getPanels: () => [panel],
    },
    artworks: [
      {
        model: {
          hasArtwork: true,
          source: { previewWidthPx: 1200, previewHeightPx: 720 },
          centerXmm: 75,
          centerYmm: 45,
          unrotatedWidthMm: 150,
          unrotatedHeightMm: 90,
          rotation: 90,
          opacity: 0.75,
        },
        visible: true,
        previewBlob: new Blob(['preview'], { type: 'image/png' }),
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  CanvasMock.failDraw = false;
});

describe('3D texture composition', () => {
  it('keeps the texture within the edge and pixel budget', () => {
    const size = getTextureSize(
      { width: 100_000, height: 80_000 },
      [
        {
          model: {
            source: { previewWidthPx: 20_000, previewHeightPx: 16_000 },
            unrotatedWidthMm: 100_000,
            unrotatedHeightMm: 80_000,
          },
        },
      ],
    );
    expect(size.width).toBeLessThanOrEqual(PREVIEW_TEXTURE_LIMITS.maxEdge);
    expect(size.height).toBeLessThanOrEqual(PREVIEW_TEXTURE_LIMITS.maxEdge);
    expect(size.width * size.height).toBeLessThanOrEqual(PREVIEW_TEXTURE_LIMITS.maxPixels);
  });

  it('caps HTML texture resolution by native raster pixels instead of upscaling', () => {
    const size = getTextureSize(
      { width: 150, height: 90 },
      [{
        model: {
          hasArtwork: true,
          source: {
            previewWidthPx: 600,
            previewHeightPx: 360,
            widthPx: 1200,
            heightPx: 720,
          },
          unrotatedWidthMm: 150,
          unrotatedHeightMm: 90,
        },
      }],
      HTML_TEXTURE_LIMITS,
      { targetDpi: 2400, useNativeSourceResolution: true },
    );
    expect(size.width).toBe(1200);
    expect(size.height).toBe(720);
  });

  it('does not treat vector source metadata as a raster ceiling', () => {
    const size = getTextureSize(
      { width: 150, height: 90 },
      [{
        model: {
          hasArtwork: true,
          source: {
            vector: true,
            mimeType: 'application/pdf',
            previewWidthPx: 600,
            previewHeightPx: 360,
            widthPx: 600,
            heightPx: 360,
          },
          unrotatedWidthMm: 150,
          unrotatedHeightMm: 90,
        },
      }],
      HTML_TEXTURE_LIMITS,
      { targetDpi: 2400, useNativeSourceResolution: true },
    );
    expect(size.width).toBeGreaterThan(1200);
    expect(size.height).toBeGreaterThan(720);
  });

  it('closes the decoded bitmap after successful composition', async () => {
    vi.stubGlobal('OffscreenCanvas', CanvasMock);
    const bitmap = { close: vi.fn() };
    const result = await composeArtworkTexture({
      ...fixture(),
      createImageBitmapFn: vi.fn().mockResolvedValue(bitmap),
    });
    expect(result.width).toBe(1200);
    expect(result.height).toBe(720);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('closes the decoded bitmap after drawing fails', async () => {
    CanvasMock.failDraw = true;
    vi.stubGlobal('OffscreenCanvas', CanvasMock);
    const bitmap = { close: vi.fn() };
    await expect(composeArtworkTexture({
      ...fixture(),
      createImageBitmapFn: vi.fn().mockResolvedValue(bitmap),
    })).rejects.toThrow('draw failed');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('closes the decoded bitmap when the job is aborted after decode', async () => {
    vi.stubGlobal('OffscreenCanvas', CanvasMock);
    const controller = new AbortController();
    const bitmap = { close: vi.fn() };
    await expect(composeArtworkTexture({
      ...fixture(),
      signal: controller.signal,
      createImageBitmapFn: async () => {
        controller.abort();
        return bitmap;
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
