import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BOARD_APPEARANCE,
  sanitizeBoardAppearance,
} from '../../src/render/BoardAppearance.js';

describe('BoardAppearance', () => {
  it('returns safe defaults and clamps presentation values', () => {
    expect(sanitizeBoardAppearance()).toEqual(DEFAULT_BOARD_APPEARANCE);
    expect(sanitizeBoardAppearance({
      thicknessMm: 99,
      bevelRadiusMm: 99,
      interiorColor: 'red',
      edgeColor: '#ABCDEF',
    })).toEqual({
      thicknessMm: 2,
      bevelRadiusMm: 0.5,
      interiorColor: DEFAULT_BOARD_APPEARANCE.interiorColor,
      edgeColor: '#abcdef',
    });
  });

  it('limits bevel to the supplied panel dimensions', () => {
    expect(sanitizeBoardAppearance({ bevelRadiusMm: 0.5 }, { width: 1, height: 0.8 }).bevelRadiusMm)
      .toBe(0.1);
  });
});
