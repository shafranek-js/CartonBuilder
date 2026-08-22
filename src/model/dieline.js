function coordinate(value) {
  return Number(value.toFixed(7));
}

function pointKey(point) {
  return `${coordinate(point.x)},${coordinate(point.y)}`;
}

function segmentKey(start, end) {
  const first = pointKey(start);
  const second = pointKey(end);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

function normalizeAngle(angle) {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

function clonePoint(point) {
  return { x: Number(point?.x), y: Number(point?.y) };
}

function arcRadius(arc) {
  return Number.isFinite(Number(arc?.radius))
    ? Number(arc.radius)
    : Math.hypot(Number(arc?.start?.x) - Number(arc?.center?.x), Number(arc?.start?.y) - Number(arc?.center?.y));
}

export function getArcAngles(arc) {
  const center = clonePoint(arc?.center);
  const start = clonePoint(arc?.start);
  const end = clonePoint(arc?.end);
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const clockwise = Boolean(arc?.clockwise);
  // PBD geometry uses a Cartesian model plane (Y points up). Keep that
  // convention here; renderers which use a Y-down plane must adapt only at
  // their output boundary.
  const delta = clockwise
    ? normalizeAngle(startAngle - endAngle)
    : normalizeAngle(endAngle - startAngle);
  return {
    center,
    start,
    end,
    radius: arcRadius(arc),
    startAngle,
    endAngle,
    delta,
    clockwise,
  };
}

export function arcPathData(arc) {
  const { start, end, radius, delta, clockwise } = getArcAngles(arc);
  if (![start.x, start.y, end.x, end.y, radius].every(Number.isFinite) || radius <= 0) {
    return `M${start.x} ${start.y}L${end.x} ${end.y}`;
  }
  const largeArc = delta > Math.PI + EPSILON ? 1 : 0;
  // SVG consumes the unprojected model coordinates in a Y-down viewport, so
  // its visual sweep is the inverse of the model's Cartesian direction.
  const sweep = clockwise ? 0 : 1;
  return `M${start.x} ${start.y}A${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`;
}

export function segmentPathData(segment) {
  if (segment?.kind === 'ARC') return arcPathData(segment);
  return `M${Number(segment?.start?.x)} ${Number(segment?.start?.y)}L${Number(segment?.end?.x)} ${Number(segment?.end?.y)}`;
}

/**
 * Convert an exact circular arc to cubic Bezier pieces.  Canvas and PDF do
 * not share an arc primitive, so exports use these pieces instead of silently
 * replacing an ARC with its chord.
 */
export function arcToCubicSegments(arc) {
  const { center, radius, startAngle, delta, clockwise } = getArcAngles(arc);
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(delta)) return [];
  const signedDelta = (clockwise ? -1 : 1) * delta;
  const pieceCount = Math.max(1, Math.ceil(Math.abs(signedDelta) / (Math.PI / 2)));
  const step = signedDelta / pieceCount;
  const pieces = [];
  for (let index = 0; index < pieceCount; index += 1) {
    const a0 = startAngle + step * index;
    const a1 = a0 + step;
    const tangent = (4 / 3) * Math.tan(step / 4);
    const p0 = { x: center.x + radius * Math.cos(a0), y: center.y + radius * Math.sin(a0) };
    const p3 = { x: center.x + radius * Math.cos(a1), y: center.y + radius * Math.sin(a1) };
    pieces.push({
      start: p0,
      control1: { x: p0.x - radius * tangent * Math.sin(a0), y: p0.y + radius * tangent * Math.cos(a0) },
      control2: { x: p3.x + radius * tangent * Math.sin(a1), y: p3.y - radius * tangent * Math.cos(a1) },
      end: p3,
    });
  }
  return pieces;
}

export function contourPathData(segments = []) {
  if (!segments.length) return '';
  const first = clonePoint(segments[0]?.start);
  let path = `M${first.x} ${first.y}`;
  for (const segment of segments) {
    if (segment?.kind === 'ARC') {
      const { end, radius, delta, clockwise } = getArcAngles(segment);
      const largeArc = delta > Math.PI + EPSILON ? 1 : 0;
      path += `A${radius} ${radius} 0 ${largeArc} ${clockwise ? 0 : 1} ${end.x} ${end.y}`;
    } else {
      const end = clonePoint(segment?.end);
      path += `L${end.x} ${end.y}`;
    }
  }
  return `${path}Z`;
}

export function getPanelContourSegments(panel) {
  if (Array.isArray(panel?.contour?.segments) && panel.contour.segments.length > 0) {
    return panel.contour.segments.map((segment) => ({
      ...segment,
      kind: segment.kind || 'LINE',
      start: clonePoint(segment.start),
      end: clonePoint(segment.end),
      ...(segment.kind === 'ARC' ? {
        center: clonePoint(segment.center),
        radius: Number(segment.radius),
        clockwise: Boolean(segment.clockwise),
      } : {}),
    }));
  }
  const points = Array.isArray(panel?.polygon) && panel.polygon.length >= 3
    ? panel.polygon
    : [
        { x: panel?.x, y: panel?.y },
        { x: Number(panel?.x) + Number(panel?.width), y: panel?.y },
        { x: Number(panel?.x) + Number(panel?.width), y: Number(panel?.y) + Number(panel?.height) },
        { x: panel?.x, y: Number(panel?.y) + Number(panel?.height) },
      ];
  return points.map((start, index) => ({
    kind: 'LINE',
    start: clonePoint(start),
    end: clonePoint(points[(index + 1) % points.length]),
  }));
}

function panelSegments(panel) {
  return getPanelContourSegments(panel);
}

function hingeSegments(elements = []) {
  return new Set(elements
    .map((element) => element.hinge)
    .filter((hinge) => hinge?.parentPoint && hinge?.childPoint)
    .map((hinge) => segmentKey(hinge.parentPoint, hinge.childPoint)));
}

export function getDielineSegments(model) {
  if (model?.mode === 'technical' && typeof model?.getDielinePrimitives === 'function') {
    const cut = [];
    const fold = [];
    for (const primitive of model.getDielinePrimitives()) {
      const segment = {
        id: primitive.id,
        kind: primitive.kind || 'LINE',
        role: primitive.role,
        semanticRole: primitive.semanticRole,
        classification: primitive.classification,
        start: { x: Number(primitive.start?.x), y: Number(primitive.start?.y) },
        end: { x: Number(primitive.end?.x), y: Number(primitive.end?.y) },
        panelIds: Array.isArray(primitive.owners) ? primitive.owners.slice() : [],
      };
      if (primitive.kind === 'ARC') {
        segment.center = { x: Number(primitive.center?.x), y: Number(primitive.center?.y) };
        segment.radius = Number(primitive.radius);
        segment.clockwise = Boolean(primitive.clockwise);
      }
      if (primitive.classification === 'fold' || primitive.role === 'FOLD_BOUNDARY') fold.push(segment);
      else cut.push(segment);
    }
    return { cut, fold };
  }
  const edges = new Map();

  const elements = typeof model.getElements === 'function' ? model.getElements() : model.getPanels();
  const explicitFolds = hingeSegments(elements);
  for (const panel of elements) {
    for (const segment of panelSegments(panel)) {
      const key = segmentKey(segment.start, segment.end);
      const entry = edges.get(key);
      if (entry) {
        entry.count += 1;
        entry.panelIds.push(panel.id);
      } else {
        edges.set(key, { ...segment, count: 1, panelIds: [panel.id] });
      }
    }
  }

  const cut = [];
  const fold = [];
  for (const edge of edges.values()) {
    const key = segmentKey(edge.start, edge.end);
    const segment = {
      kind: 'LINE',
      start: { ...edge.start },
      end: { ...edge.end },
      panelIds: edge.panelIds.slice(),
    };
    if (edge.count === 1) cut.push(segment);
    else if (edge.count === 2 || explicitFolds.has(key)) fold.push(segment);
  }

  return { cut, fold };
}

export function getPanelMaskPath(model) {
  const elements = typeof model.getElements === 'function' ? model.getElements() : model.getPanels();
  return elements
    .map((panel) => contourPathData(getPanelContourSegments(panel)))
    .join('');
}

export function getDielinePrimitives(model) {
  if (model?.mode === 'technical' && typeof model?.getDielinePrimitives === 'function') {
    return model.getDielinePrimitives().map((primitive) => ({
      ...primitive,
      kind: primitive.kind || 'LINE',
      start: clonePoint(primitive.start),
      end: clonePoint(primitive.end),
      ...(primitive.kind === 'ARC' ? {
        center: clonePoint(primitive.center),
        radius: Number(primitive.radius),
        clockwise: Boolean(primitive.clockwise),
      } : {}),
    }));
  }
  const { cut, fold } = getDielineSegments(model);
  return [
    ...cut.map((segment) => ({ ...segment, classification: 'cut', role: 'FREE_BOUNDARY', kind: 'LINE' })),
    ...fold.map((segment) => ({ ...segment, classification: 'fold', role: 'FOLD_BOUNDARY', kind: 'LINE' })),
  ];
}

export function closestPointOnArc(point, arc) {
  const { center, start, end, radius, startAngle, delta, clockwise } = getArcAngles(arc);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const candidateAngle = Math.atan2(Number(point?.y) - center.y, Number(point?.x) - center.x);
  const directed = clockwise
    ? normalizeAngle(startAngle - candidateAngle)
    : normalizeAngle(candidateAngle - startAngle);
  const clampedDirected = Math.min(delta, Math.max(0, directed));
  const angle = clockwise
    ? startAngle - clampedDirected
    : startAngle + clampedDirected;
  const closest = clampedDirected <= EPSILON
    ? start
    : delta - clampedDirected <= EPSILON
      ? end
      : {
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle),
        };
  const startDistance = Math.hypot(Number(point?.x) - start.x, Number(point?.y) - start.y);
  const endDistance = Math.hypot(Number(point?.x) - end.x, Number(point?.y) - end.y);
  const radialDistance = Math.hypot(Number(point?.x) - closest.x, Number(point?.y) - closest.y);
  if (directed > delta + EPSILON) {
    return startDistance <= endDistance
      ? { point: start, distance: startDistance, t: 0 }
      : { point: end, distance: endDistance, t: 1 };
  }
  return { point: closest, distance: radialDistance, t: delta <= EPSILON ? 0 : clampedDirected / delta };
}
