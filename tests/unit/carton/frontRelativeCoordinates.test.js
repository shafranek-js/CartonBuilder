import { describe, expect, it } from 'vitest';
import { ArtworkModel } from '../../../src/artwork/ArtworkModel.js';
import {
  computeFrontRelativeCoordinates,
  FRONT_SURFACE_ID,
} from '../../../src/carton/frontRelativeCoordinates.js';

const frame = {
  surfaceId: FRONT_SURFACE_ID,
  units: 'mm',
  origin: { x: 10, y: 20 },
  bounds: { minX: 10, minY: 20, maxX: 110, maxY: 220, width: 100, height: 200 },
};

describe('front-relative coordinates', () => {
  it('uses the displayed body.front top-left origin for center and corners', () => {
    expect(computeFrontRelativeCoordinates({ x: 10, y: 20 }, frame)).toEqual({ x: 0, y: 0, units: 'mm' });
    expect(computeFrontRelativeCoordinates({ x: 110, y: 220 }, frame)).toEqual({ x: 100, y: 200, units: 'mm' });
    expect(computeFrontRelativeCoordinates({ x: 60, y: 120 }, frame)).toEqual({ x: 50, y: 100, units: 'mm' });
    expect(computeFrontRelativeCoordinates({ x: 110, y: 20 }, frame)).toEqual({ x: 100, y: 0, units: 'mm' });
    expect(computeFrontRelativeCoordinates({ x: 10, y: 220 }, frame)).toEqual({ x: 0, y: 200, units: 'mm' });
  });

  it('rejects an invalid or non-technical frame without a fallback', () => {
    expect(computeFrontRelativeCoordinates({ x: 50, y: 60 }, null)).toBeNull();
    expect(computeFrontRelativeCoordinates({ x: 50, y: 60 }, { ...frame, surfaceId: 'body.back' })).toBeNull();
    expect(computeFrontRelativeCoordinates({ x: 50, y: 60 }, { ...frame, units: 'px' })).toBeNull();
    expect(computeFrontRelativeCoordinates({ x: 50, y: 60 }, {
      ...frame,
      origin: { x: Number.NaN, y: 20 },
    })).toBeNull();
    expect(computeFrontRelativeCoordinates({ x: Number.POSITIVE_INFINITY, y: 60 }, frame)).toBeNull();
    expect(computeFrontRelativeCoordinates({ x: 50, y: 60 }, {
      ...frame,
      bounds: { ...frame.bounds, width: Number.NaN },
    })).toBeNull();
  });

  it('does not mutate ArtworkModel serialization while reading its reference point', () => {
    const artwork = new ArtworkModel().load({
      id: 'front-relative-artwork',
      fileName: 'artwork.png',
      mimeType: 'image/png',
      byteLength: 100,
      widthPx: 1000,
      heightPx: 500,
    }, { minX: 0, minY: 0, width: 200, height: 100 });
    artwork.setReferencePoint('bottom-right');
    const before = artwork.toJSON();

    expect(computeFrontRelativeCoordinates(artwork.getReferencePosition(), frame)).toEqual({
      x: 190,
      y: 80,
      units: 'mm',
    });
    expect(artwork.toJSON()).toEqual(before);
  });
});
