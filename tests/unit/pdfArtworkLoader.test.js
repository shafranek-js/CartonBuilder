import { describe, expect, it } from 'vitest';

import {
  computeRenderScale,
  DEFAULT_PAGE_BOX,
  getFileKind,
  getPreviewScale,
  pageBoxDims,
  PAGE_BOXES,
} from '../../src/artwork/pdfArtworkLoader.js';

describe('pdfArtworkLoader helpers', () => {
  it('exposes the supported page boxes', () => {
    expect(PAGE_BOXES).toEqual(['MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox']);
    expect(DEFAULT_PAGE_BOX).toBe('CropBox');
  });

  it('derives the artwork kind from the file extension', () => {
    expect(getFileKind({ name: 'artwork.pdf' })).toBe('pdf');
    expect(getFileKind({ name: 'artwork.ai' })).toBe('ai');
    expect(getFileKind({ name: 'ARTWORK.AI' })).toBe('ai');
    expect(getFileKind({})).toBe('pdf');
  });

  it('normalizes page box dimensions', () => {
    expect(pageBoxDims(null)).toEqual({ width: 0, height: 0 });
    expect(pageBoxDims({ width: -400, height: 200 })).toEqual({ width: 400, height: 200 });
  });

  it('caps previews to the shared preview limits', () => {
    expect(getPreviewScale(4096, 4096)).toBeCloseTo(0.9765625, 4);
    expect(getPreviewScale(8192, 2048)).toBeCloseTo(0.5);
    expect(getPreviewScale(8000, 8000)).toBeCloseTo(0.5);
    expect(getPreviewScale(1000, 500)).toBe(1);
  });

  it('uses the rotated dimensions when computing the scale', () => {
    const portrait = computeRenderScale({ width: 400, height: 200, rotation: 0 });
    const rotated = computeRenderScale({ width: 400, height: 200, rotation: 90 });
    expect(rotated).toBeCloseTo(portrait, 6);
  });

  it('honours a requested DPI and target width over the preview cap', () => {
    const scale = computeRenderScale({
      width: 400,
      height: 400,
      rotation: 0,
      dpi: 600,
      targetWidthMm: 100,
    });
    const expected = (100 / 25.4) * 600 / 400;
    expect(scale).toBeCloseTo(expected, 6);
  });
});
