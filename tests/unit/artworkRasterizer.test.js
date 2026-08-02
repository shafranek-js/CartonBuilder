import { describe, expect, it, vi } from 'vitest';

import { ArtworkModel } from '../../src/artwork/ArtworkModel.js';
import {
  getRasterDimensions,
  rasterizeArtwork,
  resolveArtworkDpi,
} from '../../src/artwork/artworkRasterizer.js';

const bounds = { minX: 0, minY: 0, width: 100, height: 100 };

describe('artwork rasterizer', () => {
  it('resolves Auto to an interactive tier but keeps export Auto target-aware', () => {
    expect(resolveArtworkDpi('auto', { purpose: 'preview', requiredDpi: 220 })).toBe(300);
    expect(resolveArtworkDpi('auto', { purpose: 'preview', requiredDpi: 900 })).toBe(600);
    expect(resolveArtworkDpi('auto', { purpose: 'raster-export', requiredDpi: 900 })).toBe(900);
    expect(resolveArtworkDpi(2400, { purpose: 'render-screen', requiredDpi: 2400 })).toBe(600);
    expect(resolveArtworkDpi(2400, { purpose: 'render-export', requiredDpi: 2400 })).toBe(2400);
  });

  it('never upscales a raster source and reports limiting', () => {
    expect(getRasterDimensions({ widthMm: 100, heightMm: 50, dpi: 600, nativeWidth: 1000, nativeHeight: 500 }))
      .toMatchObject({ width: 1000, height: 500, limited: true });
  });

  it('passes target DPI and physical width to vector rendering', async () => {
    const model = new ArtworkModel().load({
      id: 'vector', fileName: 'art.pdf', mimeType: 'application/pdf', vector: true,
      widthPx: 1000, heightPx: 500, pageIndex: 0,
    }, bounds);
    const renderPdf = vi.fn(async (_blob, options) => ({
      previewBlob: new Blob(['png'], { type: 'image/png' }),
      previewWidthPx: 1200,
      previewHeightPx: 600,
      options,
    }));
    const entry = { model, originalBlob: new Blob(['pdf'], { type: 'application/pdf' }), previewBlob: null };
    const result = await rasterizeArtwork({ entry, purpose: 'preview', targetDpi: 600, renderPdf });

    expect(renderPdf).toHaveBeenCalledWith(entry.originalBlob, expect.objectContaining({
      dpi: 600,
      targetWidthMm: model.unrotatedWidthMm,
    }));
    expect(result).toMatchObject({ sourceKind: 'vector', width: 1200, height: 600 });
  });

  it('caps oversized vector rasterization before rendering', async () => {
    const model = new ArtworkModel().load({
      id: 'large-vector', fileName: 'large.pdf', mimeType: 'application/pdf', vector: true,
      widthPx: 1000, heightPx: 500, pageIndex: 0,
    }, { minX: 0, minY: 0, width: 10_000, height: 5_000 });
    const renderPdf = vi.fn(async (_blob, options) => ({
      previewBlob: new Blob(['png'], { type: 'image/png' }),
      previewWidthPx: 8192,
      previewHeightPx: 4096,
      options,
    }));
    const entry = { model, originalBlob: new Blob(['pdf'], { type: 'application/pdf' }) };
    await rasterizeArtwork({ entry, purpose: 'preview', targetDpi: 600, renderPdf });

    expect(renderPdf.mock.calls[0][1].dpi).toBeLessThan(600);
    expect(renderPdf.mock.calls[0][1].dpi).toBeGreaterThan(0);
  });
});
