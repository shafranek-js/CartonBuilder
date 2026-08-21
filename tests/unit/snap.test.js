import { describe, expect, it } from 'vitest';

import {
  buildSnapTargets,
  getDisplayedReferenceFraction,
  getResizeSnapFactor,
  getResizeSnapScale,
  getSnapOffset,
  resolveResizeSnapScale,
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

  it('snaps to the nearest point on an ARC without snapping outside its range', () => {
    const arc = {
      kind: 'ARC',
      start: { x: 10, y: 0 },
      end: { x: 0, y: 10 },
      center: { x: 0, y: 0 },
      radius: 10,
      clockwise: true,
    };
    const arcTargets = {
      lines: { x: [], y: [] },
      centers: { x: [], y: [] },
      segments: { x: [], y: [] },
      arcs: [{ ...arc, id: 'cut-arc-1', kind: 'cut', geometryKind: 'ARC' }],
    };

    expect(getSnapOffset({ x: 10.6, y: 0 }, { x: 0, y: 0 }, arcTargets, 1)).toMatchObject({
      dx: expect.closeTo(-0.6, 5),
      dy: expect.closeTo(0, 5),
    });
    expect(getSnapOffset({ x: 0, y: -10.5 }, { x: 0, y: 0 }, arcTargets, 1).dx).toBe(0);
    expect(getSnapOffset({ x: 0, y: -10.5 }, { x: 0, y: 0 }, arcTargets, 1).dy).toBe(0);
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

describe('resize snap details', () => {
  const detailedTargets = {
    lines: { x: [20, 40], y: [10] },
    centers: { x: [], y: [] },
    segments: {
      x: [
        { id: 'cut-x-20', axis: 'x', coordinate: 20, kind: 'cut', midpoint: 5, start: { x: 20, y: 0 }, end: { x: 20, y: 10 } },
        { id: 'fold-x-40', axis: 'x', coordinate: 40, kind: 'fold', midpoint: 15, start: { x: 40, y: 10 }, end: { x: 40, y: 20 } },
      ],
      y: [
        { id: 'fold-y-10', axis: 'y', coordinate: 10, kind: 'fold', midpoint: 20, start: { x: 0, y: 10 }, end: { x: 40, y: 10 } },
      ],
    },
  };

  it('snaps an independent resize factor and returns the active Cut/Fold segment', () => {
    const resolved = getResizeSnapFactor({
      candidateFactor: 1.9,
      anchor: { x: 0, y: 0 },
      vector: { x: 10, y: 0 },
      axis: 'x',
      targets: detailedTargets,
      threshold: 2,
      minFactor: 0.1,
      maxFactor: 5,
      point: { x: 19, y: 14 },
    });
    expect(resolved.factor).toBeCloseTo(2, 7);
    expect(resolved.target).toMatchObject({ axis: 'x', coordinate: 20, kind: 'cut' });
    expect(resolved.target.segment.id).toBe('cut-x-20');
  });

  it('keeps an active target within the hysteresis release distance', () => {
    const resolved = getResizeSnapFactor({
      candidateFactor: 2.2,
      anchor: { x: 0, y: 0 },
      vector: { x: 10, y: 0 },
      axis: 'x',
      targets: detailedTargets,
      threshold: 2,
      releaseThreshold: 3,
      activeTarget: { axis: 'x', coordinate: 20 },
      minFactor: 0.1,
      maxFactor: 5,
    });
    expect(resolved.factor).toBeCloseTo(2, 7);
  });

  it('preserves the legacy proportional API while exposing target metadata', () => {
    const options = {
      candidateScale: 1.9,
      anchor: { x: 0, y: 0 },
      baseW: 20,
      baseH: 20,
      fraction: { x: 0, y: 0 },
      targets: detailedTargets,
      threshold: 2,
    };
    expect(getResizeSnapScale(options)).toBeCloseTo(2, 7);
    expect(resolveResizeSnapScale(options)).toMatchObject({
      scale: 2,
      target: { axis: 'x', coordinate: 20, kind: 'cut' },
    });
  });

  it('keeps every CutContour and Fold line as a resize target', () => {
    const boxModel = {
      getBounds: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 80 }),
      getPanels: () => [
        { id: 'front', x: 0, y: 0, width: 50, height: 40 },
        { id: 'right', x: 50, y: 0, width: 50, height: 40 },
      ],
    };
    const targets = buildSnapTargets(boxModel);
    expect(targets.lines.x).toEqual(expect.arrayContaining([0, 50, 100]));
    expect(targets.lines.y).toEqual(expect.arrayContaining([0, 40]));
    expect(targets.segments.x.some((segment) => segment.kind === 'cut')).toBe(true);
    expect(targets.segments.x.some((segment) => segment.kind === 'fold')).toBe(true);
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
