import { describe, expect, it } from 'vitest';
import {
  getArtworkOrigin,
  getArtworkRotationTransform,
  getCropCorners,
  getCropRect,
} from '../../src/artwork/ArtworkRenderer.js';

function createArtwork(rotation = 0) {
  return {
    centerXmm: 100,
    centerYmm: 60,
    unrotatedWidthMm: 80,
    unrotatedHeightMm: 40,
    rotation,
  };
}

describe('ArtworkRenderer crop geometry', () => {
  it('maps local crop coordinates to the artwork origin in document space', () => {
    const artwork = createArtwork();
    expect(getArtworkOrigin(artwork)).toEqual({ x: 60, y: 40 });
    expect(getCropRect(artwork, { x: 10, y: 5, width: 30, height: 20 })).toEqual({
      x: 70,
      y: 45,
      width: 30,
      height: 20,
    });
  });

  it('uses one global rectangle for the frame, handles and crop mask', () => {
    const artwork = createArtwork();
    const crop = { x: 10, y: 5, width: 30, height: 20 };
    expect(getCropCorners(artwork, crop)).toEqual([
      { x: 70, y: 45 },
      { x: 100, y: 45 },
      { x: 100, y: 65 },
      { x: 70, y: 65 },
    ]);
  });

  it.each([0, 90, 180, 270])('keeps the same crop rectangle and shared rotation transform at %d degrees', (rotation) => {
    const artwork = createArtwork(rotation);
    expect(getCropRect(artwork, { x: 10, y: 5, width: 30, height: 20 })).toMatchObject({
      x: 70,
      y: 45,
      width: 30,
      height: 20,
    });
    expect(getArtworkRotationTransform(artwork)).toBe(`rotate(${rotation} 100 60)`);
  });
});
