import { describe, expect, it } from 'vitest';

import {
  getDisplayedReferenceFraction,
  getResizeSnapScale,
  getSnapOffset,
} from '../../src/artwork/snap.js';

const targets = {
  lines: {
    x: [0, 50, 100],
    y: [0, 40, 80],
  },
  centers: {
    x: [50],
    y: [40],
  },
};

describe('getSnapOffset', () => {
  it('returns zero offsets when the artwork is far from any line', () => {
    const offset = getSnapOffset({ x: 500, y: 500 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dx).toBe(0);
    expect(offset.dy).toBe(0);
  });

  it('snaps the left edge to a vertical line', () => {
    const offset = getSnapOffset({ x: 13, y: 40 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dx).toBeCloseTo(-3, 7);
  });

  it('snaps the right edge to a vertical line', () => {
    const offset = getSnapOffset({ x: 37, y: 40 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dx).toBeCloseTo(3, 7);
  });

  it('snaps the top edge to a horizontal line', () => {
    const offset = getSnapOffset({ x: 30, y: 13 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dy).toBeCloseTo(-3, 7);
  });

  it('snaps the bottom edge to a horizontal line', () => {
    const offset = getSnapOffset({ x: 30, y: 67 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dy).toBeCloseTo(3, 7);
  });

  it('snaps the artwork centre to the dieline centre', () => {
    const offset = getSnapOffset({ x: 48, y: 41 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dx).toBeCloseTo(2, 7);
    expect(offset.dy).toBeCloseTo(-1, 7);
  });

  it('picks the nearest candidate when several are in range', () => {
    const offset = getSnapOffset({ x: 12, y: 40 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dx).toBeCloseTo(-2, 7);
  });

  it('does not snap outside the threshold', () => {
    const offset = getSnapOffset({ x: 19, y: 40 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dx).toBe(0);
  });

  it('snaps when the artwork overlaps a line', () => {
    const offset = getSnapOffset({ x: 6, y: 40 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dx).toBeCloseTo(4, 7);
  });

  it('re-snaps to a new edge even after another axis was snapped', () => {
    const offset = getSnapOffset({ x: 13, y: 67 }, { x: 10, y: 10 }, targets, 5);
    expect(offset.dx).toBeCloseTo(-3, 7);
    expect(offset.dy).toBeCloseTo(3, 7);
  });
});

describe('getResizeSnapScale', () => {
  const resizeTargets = {
    lines: { x: [30], y: [40] },
    centers: { x: [], y: [] },
  };

  const opts = {
    anchor: { x: 0, y: 0 },
    baseW: 20,
    baseH: 20,
    fraction: { x: 0, y: 0 },
    targets: resizeTargets,
    threshold: 5,
  };

  it('returns the candidate scale when no edge is near a line', () => {
    const scale = getResizeSnapScale({ ...opts, candidateScale: 1 });
    expect(scale).toBe(1);
  });

  it('snaps the right edge to a vertical line', () => {
    const scale = getResizeSnapScale({ ...opts, candidateScale: 2.7 });
    expect(scale).toBeCloseTo(3, 7);
  });

  it('snaps the left edge to a vertical line', () => {
    const scale = getResizeSnapScale({
      ...opts,
      anchor: { x: 30, y: 0 },
      targets: { lines: { x: [17], y: [40] }, centers: { x: [], y: [] } },
      candidateScale: 1.2,
    });
    expect(scale).toBeCloseTo(1.3, 7);
  });

  it('snaps the bottom edge to a horizontal line', () => {
    const scale = getResizeSnapScale({
      ...opts,
      anchor: { x: 0, y: 10 },
      candidateScale: 2.7,
    });
    expect(scale).toBeCloseTo(3, 7);
  });

  it('snaps the top edge to a horizontal line', () => {
    const scale = getResizeSnapScale({
      ...opts,
      anchor: { x: 0, y: 50 },
      candidateScale: 1.2,
    });
    expect(scale).toBeCloseTo(1, 7);
  });

  it('keeps the edge on the anchor axis fixed', () => {
    const scale = getResizeSnapScale({
      ...opts,
      anchor: { x: 30, y: 0 },
      fraction: { x: -1, y: 0 },
      candidateScale: 3,
    });
    expect(scale).toBe(3);
  });

  it('skips a snap whose scale is outside the allowed range', () => {
    const scale = getResizeSnapScale({
      ...opts,
      anchor: { x: 30, y: 0 },
      targets: { lines: { x: [35], y: [40] }, centers: { x: [], y: [] } },
      candidateScale: 0.3,
      minScale: 0.6,
      maxScale: 20,
    });
    expect(scale).toBe(0.3);
  });
});

describe('getDisplayedReferenceFraction', () => {
  it('keeps the fraction at rotation 0', () => {
    expect(getDisplayedReferenceFraction(0, { x: -1, y: -1 })).toEqual({ x: -1, y: -1 });
  });

  it('swaps the fraction at rotation 90', () => {
    expect(getDisplayedReferenceFraction(90, { x: -1, y: -1 })).toEqual({ x: 1, y: -1 });
  });

  it('flips the fraction at rotation 180', () => {
    expect(getDisplayedReferenceFraction(180, { x: -1, y: 1 })).toEqual({ x: 1, y: -1 });
  });

  it('swaps and flips the fraction at rotation 270', () => {
    expect(getDisplayedReferenceFraction(270, { x: -1, y: -1 })).toEqual({ x: -1, y: 1 });
  });
});
