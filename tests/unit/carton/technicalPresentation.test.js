import { describe, expect, it } from 'vitest';

import {
  createTechnicalPresentationProjection,
  normalizePresentationTransform,
  presentationTransformFromSvg,
} from '../../../src/carton/technicalPresentation.js';

const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50, width: 100, height: 50 };
const input = { width: 100, height: 50 };

describe('technical presentation projection', () => {
  it('reads and validates the persisted pbd.svg.v4 orthogonal transform', () => {
    expect(presentationTransformFromSvg('<svg data-presentation-transform="0,1,-1,0"></svg>'))
      .toEqual({ a: 0, b: 1, c: -1, d: 0 });
    expect(presentationTransformFromSvg('<svg data-presentation-transform="2,0,0,1"></svg>'))
      .toEqual({ a: 1, b: 0, c: 0, d: 1 });
    expect(normalizePresentationTransform({ a: -1, b: 0, c: 0, d: 1 }))
      .toEqual({ a: -1, b: 0, c: 0, d: 1 });
  });

  it('matches the PBD identity screen projection and reverses model ARC winding once', () => {
    const projection = createTechnicalPresentationProjection({
      bounds,
      input,
      transform: { a: 1, b: 0, c: 0, d: 1 },
    });

    expect(projection.projectPoint({ x: 0, y: 0 })).toEqual({ x: 0, y: 58 });
    expect(projection.projectPoint({ x: 100, y: 50 })).toEqual({ x: 100, y: 8 });
    expect(projection.geometryBounds).toEqual({ minX: 0, minY: 8, maxX: 100, maxY: 58, width: 100, height: 50 });
    expect(projection.transformClockwise(true)).toBe(false);
  });

  it('rotates the presented net clockwise, swaps bounds and preserves exact distances', () => {
    const projection = createTechnicalPresentationProjection({
      bounds,
      input,
      transform: { a: 0, b: 1, c: -1, d: 0 },
    });

    expect(projection.geometryBounds.width).toBe(50);
    expect(projection.geometryBounds.height).toBe(100);
    const start = projection.projectPoint({ x: 0, y: 0 });
    const end = projection.projectPoint({ x: 100, y: 0 });
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBe(100);
    expect(projection.transformClockwise(true)).toBe(false);
  });

  it('changes ARC winding for presentation reflections only through total determinant', () => {
    const projection = createTechnicalPresentationProjection({
      bounds,
      input,
      transform: { a: -1, b: 0, c: 0, d: 1 },
    });

    expect(projection.determinant).toBe(-1);
    expect(projection.transformClockwise(true)).toBe(true);
    expect(projection.geometryBounds).toMatchObject({ width: 100, height: 50 });
  });
});
