import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import {
  getArtworkRasterExportDpi,
  getCenteredPreviewViewportRect,
  getPreviewExportViewportInfo,
} from '../../src/preview3d/previewExportViewport.js';

function createBox() {
  return new BoxNetModel({ width: 150, height: 90, depth: 40 });
}

describe('preview export viewport', () => {
  it('uses the same Render frame dimensions as presentation exports', () => {
    const info = getPreviewExportViewportInfo({
      boxModel: createBox(),
      renderSettings: { aspect: 'wide', longEdge: 4096 },
    });

    expect(info.render).toMatchObject({
      width: 4096,
      height: 2304,
      aspectLabel: '16:9',
      longEdge: 4096,
    });
  });

  it('reports flat artwork export dimensions and the effective source DPI', () => {
    const info = getPreviewExportViewportInfo({
      boxModel: createBox(),
      artworks: [
        { visible: true, model: { hasArtwork: true, quality: { render: '600' } } },
        { visible: true, model: { hasArtwork: true, quality: { render: 'auto' } } },
      ],
    });

    expect(getArtworkRasterExportDpi([
      { visible: true, model: { hasArtwork: true, quality: { render: '600' } } },
      { visible: true, model: { hasArtwork: true, quality: { render: 'auto' } } },
    ])).toBe(600);
    expect(info.flat).toMatchObject({
      dpi: 600,
      widthMm: 150,
      heightMm: 90,
    });
    expect(info.flat.width).toBe(Math.round(150 * 600 / 25.4));
    expect(info.flat.height).toBe(Math.round(90 * 600 / 25.4));
  });

  it('centers a frame without changing its aspect ratio', () => {
    expect(getCenteredPreviewViewportRect(1000, 600, 16 / 9)).toEqual({
      width: 1000,
      height: 562,
      left: 0,
      top: 18,
    });
    expect(getCenteredPreviewViewportRect(600, 1000, 3 / 4)).toEqual({
      width: 600,
      height: 800,
      left: 0,
      top: 100,
    });
  });
});
