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

function technicalModel(primitives, surfaces = []) {
  return {
    mode: 'technical',
    getBounds: () => ({ minX: -100, minY: -100, maxX: 100, maxY: 100 }),
    getDielinePrimitives: () => primitives,
    getArtworkSurfaces: () => surfaces,
  };
}

function line(id, start, end, classification = 'cut') {
  return { id, kind: 'LINE', start, end, classification };
}

function arc(id, center, start, end, clockwise = false, classification = 'cut') {
  return {
    id,
    kind: 'ARC',
    center,
    start,
    end,
    radius: Math.hypot(start.x - center.x, start.y - center.y),
    clockwise,
    classification,
  };
}

function semanticKinds(targets) {
  return targets.semanticTargets.map(({ kind, point, sourceIds }) => ({
    kind,
    point,
    sourceIds,
  }));
}

describe('semantic snap target construction', () => {
  it('deduplicates shared endpoints and orders targets independently of primitive order', () => {
    const primitives = [
      line('diagonal-a', { x: 0, y: 0 }, { x: 10, y: 10 }),
      line('diagonal-b', { x: 0, y: 10 }, { x: 10, y: 0 }),
      line('shared-edge', { x: 10, y: 10 }, { x: 20, y: 10 }),
    ];
    const first = buildSnapTargets(technicalModel(primitives));
    const second = buildSnapTargets(technicalModel([...primitives].reverse()));
    expect(semanticKinds(first)).toEqual(semanticKinds(second));
    expect(first.intersections).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'intersection', point: { x: 5, y: 5 } }),
    ]));
    const shared = first.intersections.find((target) => target.point.x === 10 && target.point.y === 10);
    expect(shared?.sourceIds).toEqual(expect.arrayContaining(['diagonal-a', 'shared-edge']));
  });

  it('computes finite LINE-LINE intersections and rejects parallel, coincident and out-of-range lines', () => {
    const result = buildSnapTargets(technicalModel([
      line('cross-a', { x: 0, y: 0 }, { x: 10, y: 10 }),
      line('cross-b', { x: 0, y: 10 }, { x: 10, y: 0 }),
      line('parallel', { x: 0, y: 20 }, { x: 10, y: 30 }),
      line('coincident', { x: 2, y: 2 }, { x: 8, y: 8 }),
      line('out-of-range', { x: 20, y: 0 }, { x: 20, y: 10 }),
    ])).intersections;
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ point: { x: 5, y: 5 } }),
    ]));
    expect(result.filter((target) => target.point.x === 2 && target.point.y === 2)).toHaveLength(0);
    expect(result.filter((target) => target.point.x === 8 && target.point.y === 8)).toHaveLength(0);
    expect(result.filter((target) => target.point.x === 20)).toHaveLength(0);
  });

  it('computes LINE-ARC zero, tangent and two-point intersections only within both finite ranges', () => {
    const quarter = arc('quarter', { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    const zero = buildSnapTargets(technicalModel([
      quarter,
      line('outside-sweep', { x: -20, y: -5 }, { x: 20, y: -5 }),
    ])).intersections;
    expect(zero).toHaveLength(0);

    const tangent = buildSnapTargets(technicalModel([
      arc('upper', { x: 0, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 }, true),
      line('tangent', { x: -20, y: 10 }, { x: 20, y: 10 }),
    ])).intersections;
    expect(tangent).toHaveLength(1);
    expect(tangent[0].point.x).toBeCloseTo(0, 7);
    expect(tangent[0].point.y).toBeCloseTo(10, 7);

    const two = buildSnapTargets(technicalModel([
      arc('lower', { x: 0, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 }),
      line('two-points', { x: -20, y: -5 }, { x: 20, y: -5 }),
    ])).intersections;
    expect(two).toHaveLength(2);
    expect(two.every((target) => target.sourceIds.includes('lower') && target.sourceIds.includes('two-points'))).toBe(true);
  });

  it('computes ARC-ARC zero, tangent and two-point intersections with sweep rejection', () => {
    const end330 = (angle) => ({ x: 10 * Math.cos(angle), y: 10 * Math.sin(angle) });
    const two = buildSnapTargets(technicalModel([
      arc('circle-a', { x: 0, y: 0 }, end330(0), end330(11 * Math.PI / 6)),
      arc('circle-b', { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 10 + 10 * Math.cos(11 * Math.PI / 6), y: 10 * Math.sin(11 * Math.PI / 6) }),
    ])).intersections;
    expect(two).toHaveLength(2);

    const tangent = buildSnapTargets(technicalModel([
      arc('tangent-a', { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 }),
      arc('tangent-b', { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 20, y: -10 }),
    ])).intersections;
    expect(tangent).toHaveLength(1);
    expect(tangent[0].point).toEqual({ x: 10, y: 0 });

    const zero = buildSnapTargets(technicalModel([
      arc('far-a', { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 }),
      arc('far-b', { x: 30, y: 0 }, { x: 40, y: 0 }, { x: 30, y: -10 }),
    ])).intersections;
    expect(zero).toHaveLength(0);
  });

  it('builds panel centers and exact contour boundaries without Technical polygon fallback', () => {
    const surface = {
      id: 'body.front',
      bounds: { minX: 10, minY: 20, maxX: 30, maxY: 60 },
      polygon: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 60 }],
      contour: {
        segments: [line('unused', { x: 10, y: 20 }, { x: 30, y: 20 })],
      },
    };
    const result = buildSnapTargets(technicalModel([], [surface, {
      id: 'body.no-contour',
      bounds: { minX: 100, minY: 100, maxX: 120, maxY: 120 },
      polygon: [{ x: 100, y: 100 }, { x: 120, y: 100 }, { x: 120, y: 120 }],
    }]));
    expect(result.panelCenters).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'panel-center', point: { x: 20, y: 40 }, surfaceId: 'body.front' }),
      expect.objectContaining({ kind: 'panel-center', point: { x: 110, y: 110 }, surfaceId: 'body.no-contour' }),
    ]));
    expect(result.panelBoundaries).toHaveLength(1);
    expect(result.panelBoundaries[0].segment).toMatchObject({ start: { x: 10, y: 20 }, end: { x: 30, y: 20 } });
  });

  it('keeps Quick targets on the legacy snapping contract', () => {
    const quick = {
      ...technicalModel([line('quick-edge', { x: 0, y: 0 }, { x: 0, y: 20 })]),
      mode: 'quick',
      getPanels: () => [{ id: 'front', x: 0, y: 0, width: 20, height: 20 }],
    };
    const result = buildSnapTargets(quick);
    expect(result.semanticTargets).toEqual([]);
    expect(result.endpoints).toEqual([]);
    expect(result.intersections).toEqual([]);
    expect(result.panelCenters).toEqual([]);
    expect(result.panelBoundaries).toEqual([]);
    expect(getSnapOffset({ x: 3, y: 10 }, { x: 2, y: 2 }, result, 5).target?.snapKind)
      .toBe('legacy-line');
  });
});

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
      clockwise: false,
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

describe('semantic snap selection and hysteresis', () => {
  const semanticTarget = (kind, id, point) => ({
    kind,
    snapKind: kind,
    id,
    point,
    sourceIds: [id],
    surfaceId: null,
    segment: null,
  });

  it('selects nearest semantic target, resolves priority ties and preserves an active target', () => {
    const intersection = semanticTarget('intersection', 'intersection-z', { x: 10, y: 0 });
    const endpoint = semanticTarget('endpoint', 'endpoint-a', { x: 10, y: 0 });
    const targetsWithTie = {
      lines: { x: [], y: [] },
      centers: { x: [], y: [] },
      segments: { x: [], y: [] },
      arcs: [],
      semanticTargets: [endpoint, intersection],
    };
    expect(getSnapOffset({ x: 10, y: 0 }, { x: 0, y: 0 }, targetsWithTie, 2).target).toBe(intersection);

    const active = semanticTarget('endpoint', 'active-endpoint', { x: 10, y: 0 });
    const hysteresis = getSnapOffset(
      { x: 16, y: 0 },
      { x: 0, y: 0 },
      { ...targetsWithTie, semanticTargets: [active] },
      5,
      { activeTarget: active, releaseThreshold: 9 },
    );
    expect(hysteresis).toMatchObject({ dx: -6, dy: 0, target: active });
  });

  it('holds an active endpoint against a closer intersection within the release threshold', () => {
    const active = semanticTarget('endpoint', 'active-endpoint', { x: 10, y: 0 });
    const intersection = semanticTarget('intersection', 'closer-intersection', { x: 10.5, y: 0 });
    const resolved = getSnapOffset(
      { x: 10.5, y: 0 },
      { x: 0, y: 0 },
      { lines: { x: [], y: [] }, centers: { x: [], y: [] }, segments: { x: [], y: [] }, arcs: [], semanticTargets: [active, intersection] },
      1,
      { activeTarget: active, releaseThreshold: 1.5 },
    );
    expect(resolved.target).toBe(active);
    expect(resolved).toMatchObject({ dx: -0.5, dy: 0 });
  });

  it('holds an active legacy LINE or ARC against a closer semantic target', () => {
    const lineBase = {
      lines: { x: [10], y: [] },
      centers: { x: [], y: [] },
      segments: {
        x: [{ id: 'legacy-line-10', axis: 'x', coordinate: 10, kind: 'cut', start: { x: 10, y: -20 }, end: { x: 10, y: 20 } }],
        y: [],
      },
      arcs: [],
      semanticTargets: [],
    };
    const activeLine = getSnapOffset({ x: 10.5, y: 0 }, { x: 0, y: 0 }, lineBase, 1).target;
    const lineResolved = getSnapOffset(
      { x: 10.5, y: 0 },
      { x: 0, y: 0 },
      { ...lineBase, semanticTargets: [semanticTarget('intersection', 'line-competitor', { x: 10.5, y: 0 })] },
      1,
      { activeTarget: activeLine, releaseThreshold: 1.5 },
    );
    expect(lineResolved.target).toMatchObject({ id: activeLine.id, snapKind: 'legacy-line' });

    const arc = {
      kind: 'ARC',
      start: { x: 10, y: 0 },
      end: { x: 0, y: 10 },
      center: { x: 0, y: 0 },
      radius: 10,
      clockwise: false,
    };
    const arcBase = {
      lines: { x: [], y: [] },
      centers: { x: [], y: [] },
      segments: { x: [], y: [] },
      arcs: [{ ...arc, id: 'legacy-arc-10', kind: 'cut', geometryKind: 'ARC' }],
      semanticTargets: [],
    };
    const activeArc = getSnapOffset({ x: 10.5, y: 0 }, { x: 0, y: 0 }, arcBase, 1).target;
    const arcResolved = getSnapOffset(
      { x: 10.5, y: 0 },
      { x: 0, y: 0 },
      { ...arcBase, semanticTargets: [semanticTarget('intersection', 'arc-competitor', { x: 10.5, y: 0 })] },
      1,
      { activeTarget: activeArc, releaseThreshold: 1.5 },
    );
    expect(arcResolved.target).toMatchObject({ id: activeArc.id, snapKind: 'legacy-arc' });
  });

  it('releases an active move target after leaving the release threshold', () => {
    const base = {
      lines: { x: [10], y: [] },
      centers: { x: [], y: [] },
      segments: {
        x: [{ id: 'legacy-line-10', axis: 'x', coordinate: 10, kind: 'cut', start: { x: 10, y: -20 }, end: { x: 10, y: 20 } }],
        y: [],
      },
      arcs: [],
      semanticTargets: [],
    };
    const active = getSnapOffset({ x: 10.5, y: 0 }, { x: 0, y: 0 }, base, 1).target;
    const released = getSnapOffset(
      { x: 12, y: 0 },
      { x: 0, y: 0 },
      { ...base, semanticTargets: [semanticTarget('intersection', 'released-intersection', { x: 12, y: 0 })] },
      1,
      { activeTarget: active, releaseThreshold: 1.5 },
    );
    expect(released.target?.id).toBe('released-intersection');
    expect(released).toMatchObject({ dx: 0, dy: 0 });
  });

  it('snaps resize factors and proportional scale to semantic points and boundaries', () => {
    const pointTarget = semanticTarget('panel-center', 'center-30', { x: 30, y: 0 });
    const boundary = {
      ...semanticTarget('panel-boundary', 'boundary-y-20', { x: 50, y: 20 }),
      segment: { kind: 'LINE', start: { x: 0, y: 20 }, end: { x: 100, y: 20 } },
    };
    const resizeTargets = {
      lines: { x: [], y: [] },
      centers: { x: [], y: [] },
      segments: { x: [], y: [] },
      arcs: [],
      semanticTargets: [pointTarget, boundary],
    };
    const factor = getResizeSnapFactor({
      candidateFactor: 2.8,
      anchor: { x: 0, y: 0 },
      vector: { x: 10, y: 0 },
      axis: 'x',
      targets: resizeTargets,
      threshold: 3,
    });
    expect(factor.factor).toBeCloseTo(3, 7);
    expect(factor.target).toBe(pointTarget);

    const scale = resolveResizeSnapScale({
      candidateScale: 2.8,
      anchor: { x: 0, y: 0 },
      baseW: 20,
      baseH: 20,
      fraction: { x: 0, y: 0 },
      targets: resizeTargets,
      threshold: 3,
    });
    expect(scale.scale).toBeCloseTo(3, 7);
    expect(scale.target).toBe(pointTarget);
  });

  it('resolves a proportional diagonal handle against a finite LINE boundary', () => {
    const boundary = {
      ...semanticTarget('panel-boundary', 'boundary-x-30', { x: 30, y: 50 }),
      segment: { kind: 'LINE', start: { x: 30, y: 0 }, end: { x: 30, y: 100 } },
    };
    const resolved = getResizeSnapFactor({
      candidateFactor: 2.9,
      anchor: { x: 0, y: 0 },
      vector: { x: 10, y: 10 },
      axis: 'x',
      point: { x: 29, y: 29 },
      targets: { semanticTargets: [boundary] },
      threshold: 3,
    });
    expect(resolved.factor).toBeCloseTo(3, 7);
    expect(resolved.target).toBe(boundary);

    const proportional = resolveResizeSnapScale({
      candidateScale: 2.9,
      anchor: { x: 0, y: 0 },
      baseW: 20,
      baseH: 20,
      fraction: { x: 0, y: 0 },
      targets: { semanticTargets: [boundary] },
      threshold: 3,
    });
    expect(proportional.scale).toBeCloseTo(3, 7);
    expect(proportional.target).toBe(boundary);
  });

  it('resolves a proportional diagonal handle against a finite ARC boundary', () => {
    const boundary = {
      ...semanticTarget('panel-boundary', 'boundary-arc', { x: 21.213, y: 21.213 }),
      segment: arc('boundary-arc-segment', { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 }),
    };
    const resolved = getResizeSnapFactor({
      candidateFactor: 2.08,
      anchor: { x: 0, y: 0 },
      vector: { x: 10, y: 10 },
      axis: 'x',
      point: { x: 20.8, y: 20.8 },
      targets: { semanticTargets: [boundary] },
      threshold: 3,
    });
    expect(resolved.factor).toBeCloseTo(Math.sqrt(4.5), 6);
    expect(resolved.target).toBe(boundary);
  });

  it('ranks resize candidates by geometric distance before semantic priority', () => {
    const endpoint = semanticTarget('endpoint', 'endpoint-near', { x: 30, y: 1 });
    const intersection = semanticTarget('intersection', 'intersection-far', { x: 32, y: 0 });
    const resolved = getResizeSnapFactor({
      candidateFactor: 2.9,
      anchor: { x: 0, y: 0 },
      vector: { x: 10, y: 0 },
      axis: 'x',
      point: { x: 29, y: 0 },
      targets: { semanticTargets: [intersection, endpoint] },
      threshold: 5,
    });
    expect(resolved.target).toBe(endpoint);
    expect(resolved.factor).toBeCloseTo(3, 7);
  });

  it('holds the active resize target through the release threshold', () => {
    const active = semanticTarget('endpoint', 'active-endpoint', { x: 30, y: 0 });
    const closer = semanticTarget('intersection', 'closer-intersection', { x: 30.5, y: 0 });
    const resolved = getResizeSnapFactor({
      candidateFactor: 3.1,
      anchor: { x: 0, y: 0 },
      vector: { x: 10, y: 0 },
      axis: 'x',
      point: { x: 31, y: 0 },
      targets: { semanticTargets: [closer, active] },
      threshold: 1,
      releaseThreshold: 3,
      activeTarget: active,
    });
    expect(resolved.target).toBe(active);
    expect(resolved.factor).toBeCloseTo(3, 7);
  });

  it('keeps target generation fail-closed and does not mutate source geometry', () => {
    const modelData = {
      primitives: [
        line('valid', { x: 0, y: 0 }, { x: 10, y: 0 }),
        line('invalid', { x: Number.NaN, y: 0 }, { x: 10, y: 0 }),
      ],
      surfaces: [{
        id: 'body.front',
        bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        contour: { segments: [line('boundary', { x: 0, y: 0 }, { x: 10, y: 0 })] },
      }],
    };
    const before = structuredClone(modelData);
    const result = buildSnapTargets(technicalModel(modelData.primitives, modelData.surfaces));
    expect(result.targets.every((target) => Number.isFinite(target.point.x) && Number.isFinite(target.point.y))).toBe(true);
    expect(result.targets.some((target) => target.sourceIds.includes('invalid'))).toBe(false);
    expect(modelData).toEqual(before);
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
