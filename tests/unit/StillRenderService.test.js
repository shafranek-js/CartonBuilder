import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import { renderStill } from '../../src/render/StillRenderService.js';

class ContextMock {
  constructor(canvas) {
    this.canvas = canvas;
    this.imageData = null;
    this.fillStyle = '';
  }

  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }

  putImageData(imageData) {
    this.imageData = imageData;
  }

  drawImage(source) {
    this.source = source;
  }

  fillRect() {}
}

class CanvasMock {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.context = new ContextMock(this);
  }

  getContext() {
    return this.context;
  }

  convertToBlob({ type, quality } = {}) {
    this.type = type;
    this.quality = quality;
    return Promise.resolve(new Blob(['encoded'], { type }));
  }
}

const documentRef = {
  createElement: vi.fn(() => new CanvasMock(1, 1)),
};

function renderer({ pixels = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]), diagnostics = {} } = {}) {
  return {
    getDiagnostics: () => diagnostics,
    renderToPixels: vi.fn(async ({ width, height, signal }) => {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return { width, height, pixels: pixels.length === width * height * 4 ? pixels : new Uint8Array(width * height * 4) };
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StillRenderService', () => {
  it('renders PNG with exact frame dimensions and flips WebGL rows', async () => {
    vi.stubGlobal('OffscreenCanvas', CanvasMock);
    const serviceRenderer = renderer();
    const blob = await renderStill({
      renderer: serviceRenderer,
      settings: { ...DEFAULT_RENDER_SETTINGS, aspect: 'landscape', longEdge: 2048 },
      format: 'png',
      documentRef,
    });

    expect(blob.type).toBe('image/png');
    expect(serviceRenderer.renderToPixels).toHaveBeenCalledWith(expect.objectContaining({
      width: 2048,
      height: 1536,
      backgroundMode: 'solid',
      includeShadow: true,
    }));
  });

  it('forces opaque background for JPEG and uses quality 0.94', async () => {
    vi.stubGlobal('OffscreenCanvas', CanvasMock);
    const blob = await renderStill({
      renderer: renderer(),
      settings: { ...DEFAULT_RENDER_SETTINGS, background: { mode: 'transparent', color: '#ffffff' } },
      format: 'jpg',
      documentRef,
    });
    expect(blob.type).toBe('image/jpeg');
  });

  it('accepts an explicit export target for the renderer contract', async () => {
    vi.stubGlobal('OffscreenCanvas', CanvasMock);
    const serviceRenderer = renderer();
    await renderStill({
      renderer: serviceRenderer,
      settings: DEFAULT_RENDER_SETTINGS,
      width: 640,
      height: 480,
      documentRef,
    });
    expect(serviceRenderer.renderToPixels).toHaveBeenCalledWith(expect.objectContaining({
      width: 640,
      height: 480,
    }));
  });

  it('rejects targets over the reported GPU limit before allocating a render target', async () => {
    vi.stubGlobal('OffscreenCanvas', CanvasMock);
    const serviceRenderer = renderer({ diagnostics: { maxTextureSize: 1024, maxRenderbufferSize: 1024 } });
    await expect(renderStill({
      renderer: serviceRenderer,
      settings: DEFAULT_RENDER_SETTINGS,
      documentRef,
    })).rejects.toThrow(/GPU limit/);
    expect(serviceRenderer.renderToPixels).not.toHaveBeenCalled();
  });

  it('honours abort before starting export', async () => {
    const controller = new AbortController();
    controller.abort();
    const serviceRenderer = renderer();
    await expect(renderStill({
      renderer: serviceRenderer,
      settings: DEFAULT_RENDER_SETTINGS,
      documentRef,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(serviceRenderer.renderToPixels).not.toHaveBeenCalled();
  });
});
