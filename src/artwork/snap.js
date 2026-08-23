import {
  closestPointOnArc,
  getArcAngles,
  getDielineSegments,
} from '../model/dieline.js';

const GEOMETRY_EPSILON = 1e-7;
const SELECTION_TIE_EPSILON = 1e-4;
const TARGET_PRIORITY = {
  intersection: 0,
  endpoint: 1,
  'panel-center': 2,
  'panel-boundary': 3,
  'legacy-line': 4,
  'legacy-arc': 4,
  'dieline-center': 4,
};
function finitePoint(point) {
  return Boolean(
    point
    && Number.isFinite(Number(point.x))
    && Number.isFinite(Number(point.y)),
  );
}

function clonePoint(point) {
  return { x: Number(point.x), y: Number(point.y) };
}

function isArcSegment(segment) {
  return Boolean(
    segment
    && (segment.kind === 'ARC'
      || segment.geometryKind === 'ARC'
      || (finitePoint(segment.center) && Number.isFinite(Number(segment.radius)))),
  );
}

function cloneSegment(segment) {
  if (!segment || !finitePoint(segment.start) || !finitePoint(segment.end)) return null;
  const clone = {
    ...segment,
    start: clonePoint(segment.start),
    end: clonePoint(segment.end),
  };
  if (isArcSegment(segment)) {
    if (!finitePoint(segment.center) || !Number.isFinite(Number(segment.radius)) || Number(segment.radius) <= 0) return null;
    clone.center = clonePoint(segment.center);
    clone.radius = Number(segment.radius);
    clone.clockwise = Boolean(segment.clockwise);
  }
  return clone;
}

function stableNumber(value) {
  return Number(value).toFixed(7);
}

function pointKey(point) {
  return `${stableNumber(point.x)},${stableNumber(point.y)}`;
}

function compareStrings(a, b) {
  return String(a).localeCompare(String(b));
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeAngle(angle) {
  const normalized = angle % (Math.PI * 2);
  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

function segmentSignature(segment) {
  const start = pointKey(segment.start);
  const end = pointKey(segment.end);
  const center = isArcSegment(segment) ? pointKey(segment.center) : '';
  return `${segment.kind || 'LINE'}:${start}:${end}:${center}:${stableNumber(segment.radius || 0)}:${segment.clockwise ? 1 : 0}`;
}

function primitiveSourceId(segment, category) {
  const explicitId = typeof segment.id === 'string' && segment.id.trim() ? segment.id.trim() : null;
  return explicitId || `${category}:${segmentSignature(segment)}`;
}

function getSegmentAxis(segment) {
  if (!finitePoint(segment?.start) || !finitePoint(segment?.end)) return null;
  if (Math.abs(segment.start.x - segment.end.x) <= GEOMETRY_EPSILON) return 'x';
  if (Math.abs(segment.start.y - segment.end.y) <= GEOMETRY_EPSILON) return 'y';
  return null;
}

function getArcPoint(arc, fraction = 0.5) {
  const angles = getArcAngles(arc);
  if (!finitePoint(angles.center) || !Number.isFinite(angles.radius) || angles.radius <= 0 || !Number.isFinite(angles.delta)) return null;
  const amount = Math.max(0, Math.min(1, fraction));
  const angle = angles.clockwise
    ? angles.startAngle - angles.delta * amount
    : angles.startAngle + angles.delta * amount;
  return {
    x: angles.center.x + angles.radius * Math.cos(angle),
    y: angles.center.y + angles.radius * Math.sin(angle),
  };
}

function isPointOnArc(point, arc) {
  if (!finitePoint(point)) return false;
  const angles = getArcAngles(arc);
  if (!finitePoint(angles.center) || !Number.isFinite(angles.radius) || angles.radius <= 0 || !Number.isFinite(angles.delta)) return false;
  const radiusError = Math.abs(Math.hypot(point.x - angles.center.x, point.y - angles.center.y) - angles.radius);
  if (radiusError > GEOMETRY_EPSILON * 100) return false;
  const angle = Math.atan2(point.y - angles.center.y, point.x - angles.center.x);
  const directed = angles.clockwise
    ? normalizeAngle(angles.startAngle - angle)
    : normalizeAngle(angle - angles.startAngle);
  return directed <= angles.delta + GEOMETRY_EPSILON;
}

function nearestPointOnSegment(point, segment) {
  if (!finitePoint(point) || !segment) return null;
  if (isArcSegment(segment)) return closestPointOnArc(point, segment);
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!Number.isFinite(lengthSquared) || lengthSquared <= GEOMETRY_EPSILON) return null;
  const t = Math.max(0, Math.min(1, ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared));
  const nearest = { x: segment.start.x + dx * t, y: segment.start.y + dy * t };
  return { point: nearest, distance: distanceBetween(point, nearest), t };
}

function lineLineIntersection(first, second) {
  const x1 = first.start.x;
  const y1 = first.start.y;
  const x2 = first.end.x;
  const y2 = first.end.y;
  const x3 = second.start.x;
  const y3 = second.start.y;
  const x4 = second.end.x;
  const y4 = second.end.y;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return [];
  const firstCross = x1 * y2 - y1 * x2;
  const secondCross = x3 * y4 - y3 * x4;
  const x = (firstCross * (x3 - x4) - (x1 - x2) * secondCross) / denominator;
  const y = (firstCross * (y3 - y4) - (y1 - y2) * secondCross) / denominator;
  const firstLength = Math.hypot(x2 - x1, y2 - y1);
  const secondLength = Math.hypot(x4 - x3, y4 - y3);
  if (!Number.isFinite(x) || !Number.isFinite(y) || firstLength <= GEOMETRY_EPSILON || secondLength <= GEOMETRY_EPSILON) return [];
  const firstT = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (firstLength * firstLength);
  const secondT = ((x - x3) * (x4 - x3) + (y - y3) * (y4 - y3)) / (secondLength * secondLength);
  if (firstT < -GEOMETRY_EPSILON || firstT > 1 + GEOMETRY_EPSILON || secondT < -GEOMETRY_EPSILON || secondT > 1 + GEOMETRY_EPSILON) return [];
  return [{ x, y }];
}

function lineArcIntersections(line, arc) {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const fx = line.start.x - arc.center.x;
  const fy = line.start.y - arc.center.y;
  const a = dx * dx + dy * dy;
  if (!Number.isFinite(a) || a <= GEOMETRY_EPSILON) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - arc.radius * arc.radius;
  const discriminant = b * b - 4 * a * c;
  if (!Number.isFinite(discriminant) || discriminant < -GEOMETRY_EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const values = [(-b - root) / (2 * a)];
  if (root > GEOMETRY_EPSILON) values.push((-b + root) / (2 * a));
  return values
    .filter((t) => t >= -GEOMETRY_EPSILON && t <= 1 + GEOMETRY_EPSILON)
    .map((t) => ({ x: line.start.x + dx * t, y: line.start.y + dy * t }))
    .filter((point) => isPointOnArc(point, arc));
}

function arcArcIntersections(first, second) {
  const dx = second.center.x - first.center.x;
  const dy = second.center.y - first.center.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= GEOMETRY_EPSILON) return [];
  if (distance > first.radius + second.radius + GEOMETRY_EPSILON
    || distance < Math.abs(first.radius - second.radius) - GEOMETRY_EPSILON) return [];
  const a = (first.radius ** 2 - second.radius ** 2 + distance ** 2) / (2 * distance);
  const heightSquared = first.radius ** 2 - a ** 2;
  if (heightSquared < -GEOMETRY_EPSILON) return [];
  const height = Math.sqrt(Math.max(0, heightSquared));
  const base = {
    x: first.center.x + (a * dx) / distance,
    y: first.center.y + (a * dy) / distance,
  };
  const offset = { x: (-dy * height) / distance, y: (dx * height) / distance };
  const points = [{ x: base.x + offset.x, y: base.y + offset.y }];
  if (height > GEOMETRY_EPSILON) points.push({ x: base.x - offset.x, y: base.y - offset.y });
  return points.filter((point) => isPointOnArc(point, first) && isPointOnArc(point, second));
}

function intersections(first, second) {
  if (first.kind === 'LINE' && second.kind === 'LINE') return lineLineIntersection(first, second);
  if (first.kind === 'LINE' && second.kind === 'ARC') return lineArcIntersections(first, second);
  if (first.kind === 'ARC' && second.kind === 'LINE') return lineArcIntersections(second, first);
  if (first.kind === 'ARC' && second.kind === 'ARC') return arcArcIntersections(first, second);
  return [];
}

function targetPriority(target) {
  return TARGET_PRIORITY[target?.snapKind || target?.kind] ?? 5;
}

function targetId(target) {
  return String(target?.id || `${target?.kind || 'target'}:${pointKey(target?.point || { x: 0, y: 0 })}`);
}

function targetMatches(activeTarget, target) {
  if (!activeTarget || !target) return false;
  if (activeTarget.id && target.id) return activeTarget.id === target.id;
  if (activeTarget.axis != null && target.axis != null) {
    return activeTarget.axis === target.axis && Math.abs(Number(activeTarget.coordinate) - Number(target.coordinate)) <= GEOMETRY_EPSILON;
  }
  if (activeTarget.kind && target.kind) return activeTarget.kind === target.kind;
  return false;
}

function targetAllowedThreshold(target, activeTarget, threshold, releaseThreshold) {
  return targetMatches(activeTarget, target) ? releaseThreshold : threshold;
}

function compareCandidate(next, current) {
  if (!current) return true;
  if (next.distance < current.distance - SELECTION_TIE_EPSILON) return true;
  if (Math.abs(next.distance - current.distance) > SELECTION_TIE_EPSILON) return false;
  const nextPriority = targetPriority(next.target);
  const currentPriority = targetPriority(current.target);
  if (nextPriority !== currentPriority) return nextPriority < currentPriority;
  return compareStrings(targetId(next.target), targetId(current.target)) < 0;
}

function isActiveCandidate(candidate, activeTarget, releaseThreshold) {
  return Boolean(
    candidate
    && targetMatches(activeTarget, candidate.target)
    && (candidate.activeDistance ?? candidate.distance) <= releaseThreshold,
  );
}

function chooseSegment(segments, axis, coordinate, point = null) {
  const candidates = (segments?.[axis] || []).filter((segment) => segment.coordinate === coordinate);
  if (!candidates.length) return null;
  if (!point) return candidates[0];
  const along = axis === 'x' ? point.y : point.x;
  return candidates.reduce((best, segment) => {
    const bestStart = Math.min(best.start[axis === 'x' ? 'y' : 'x'], best.end[axis === 'x' ? 'y' : 'x']);
    const bestEnd = Math.max(best.start[axis === 'x' ? 'y' : 'x'], best.end[axis === 'x' ? 'y' : 'x']);
    const start = Math.min(segment.start[axis === 'x' ? 'y' : 'x'], segment.end[axis === 'x' ? 'y' : 'x']);
    const end = Math.max(segment.start[axis === 'x' ? 'y' : 'x'], segment.end[axis === 'x' ? 'y' : 'x']);
    const bestDistance = along < bestStart ? bestStart - along : along > bestEnd ? along - bestEnd : 0;
    const distance = along < start ? start - along : along > end ? along - end : 0;
    return distance < bestDistance ? segment : best;
  });
}

function targetForLine(targets, axis, coordinate, point = null) {
  const segment = chooseSegment(targets.segments, axis, coordinate, point);
  return {
    id: `legacy-line-${axis}-${stableNumber(coordinate)}-${segment?.id || 'dieline'}`,
    axis,
    coordinate,
    kind: segment?.kind || 'dieline',
    snapKind: 'legacy-line',
    sourceIds: segment?.id ? [segment.id] : [],
    segment: segment || null,
  };
}

function targetForArc(arc) {
  return {
    id: `legacy-arc-${arc?.id || segmentSignature(arc?.segment || arc)}`,
    axis: null,
    coordinate: null,
    kind: arc?.kind || 'dieline',
    snapKind: 'legacy-arc',
    sourceIds: arc?.id ? [arc.id] : [],
    segment: arc?.segment || arc || null,
  };
}

function closestArcSnap(candidateCenter, halfExtents, targets, threshold, activeTarget = null, releaseThreshold = threshold * 1.5) {
  let best = null;
  let activeBest = null;
  const arcs = targets?.arcs || [];
  const candidates = [
    candidateCenter,
    { x: candidateCenter.x, y: candidateCenter.y - halfExtents.y },
    { x: candidateCenter.x + halfExtents.x, y: candidateCenter.y },
    { x: candidateCenter.x, y: candidateCenter.y + halfExtents.y },
    { x: candidateCenter.x - halfExtents.x, y: candidateCenter.y },
    { x: candidateCenter.x - halfExtents.x, y: candidateCenter.y - halfExtents.y },
    { x: candidateCenter.x + halfExtents.x, y: candidateCenter.y - halfExtents.y },
    { x: candidateCenter.x + halfExtents.x, y: candidateCenter.y + halfExtents.y },
    { x: candidateCenter.x - halfExtents.x, y: candidateCenter.y + halfExtents.y },
  ];
  for (const arc of arcs) {
    for (const candidate of candidates) {
      const nearest = closestPointOnArc(candidate, arc);
      const target = targetForArc(arc);
      const allowed = targetMatches(activeTarget, target) ? releaseThreshold : threshold;
      if (!nearest || nearest.distance > allowed) continue;
      const dx = nearest.point.x - candidate.x;
      const dy = nearest.point.y - candidate.y;
      const distance = Math.hypot(dx, dy);
      const candidateResult = { dx, dy, distance, target, targets: [target] };
      if (compareCandidate(candidateResult, best)) {
        best = candidateResult;
      }
      if (isActiveCandidate(candidateResult, activeTarget, releaseThreshold)
        && compareCandidate(candidateResult, activeBest)) {
        activeBest = candidateResult;
      }
    }
  }
  return activeBest || best;
}

function getTargetPoint(target, candidate) {
  if (!target) return null;
  if (target.kind === 'panel-boundary' && target.segment) {
    return nearestPointOnSegment(candidate, target.segment)?.point || null;
  }
  if (target.segment && target.snapKind === 'legacy-arc') {
    return closestPointOnArc(candidate, target.segment)?.point || null;
  }
  return finitePoint(target.point) ? target.point : null;
}

function moveAnchors(candidateCenter, halfExtents) {
  return [
    { key: 'center', point: { ...candidateCenter } },
    { key: 'nw', point: { x: candidateCenter.x - halfExtents.x, y: candidateCenter.y - halfExtents.y } },
    { key: 'ne', point: { x: candidateCenter.x + halfExtents.x, y: candidateCenter.y - halfExtents.y } },
    { key: 'se', point: { x: candidateCenter.x + halfExtents.x, y: candidateCenter.y + halfExtents.y } },
    { key: 'sw', point: { x: candidateCenter.x - halfExtents.x, y: candidateCenter.y + halfExtents.y } },
    { key: 'n', point: { x: candidateCenter.x, y: candidateCenter.y - halfExtents.y } },
    { key: 'e', point: { x: candidateCenter.x + halfExtents.x, y: candidateCenter.y } },
    { key: 's', point: { x: candidateCenter.x, y: candidateCenter.y + halfExtents.y } },
    { key: 'w', point: { x: candidateCenter.x - halfExtents.x, y: candidateCenter.y } },
  ];
}

function axisSnapCandidate(candidate, halfExtent, lineTargets, centerTargets, targets, axis, threshold, activeTarget, releaseThreshold) {
  let best = null;
  let activeBest = null;
  const consider = (coordinate, anchor, target) => {
    const delta = coordinate - anchor;
    const allowed = targetAllowedThreshold(target, activeTarget, threshold, releaseThreshold);
    if (Math.abs(delta) > allowed) return;
    const result = { distance: Math.abs(delta), delta, target };
    if (compareCandidate(result, best)) best = result;
    if (isActiveCandidate(result, activeTarget, releaseThreshold)
      && compareCandidate(result, activeBest)) {
      activeBest = result;
    }
  };
  for (const coordinate of lineTargets || []) {
    const target = targetForLine(targets || {}, axis, coordinate);
    consider(coordinate, candidate - halfExtent, target);
    consider(coordinate, candidate + halfExtent, target);
  }
  for (const coordinate of centerTargets || []) {
    const target = {
      id: `legacy-center-${axis}-${stableNumber(coordinate)}`,
      axis,
      coordinate,
      kind: 'dieline-center',
      snapKind: 'dieline-center',
      sourceIds: [],
      segment: null,
    };
    consider(coordinate, candidate, target);
  }
  return activeBest || best;
}

function closestSemanticMoveSnap(candidateCenter, halfExtents, targets, threshold, activeTarget, releaseThreshold) {
  let best = null;
  let activeBest = null;
  for (const target of targets?.semanticTargets || targets?.targets || []) {
    if (!target?.point && !target?.segment) continue;
    for (const anchor of moveAnchors(candidateCenter, halfExtents)) {
      const point = getTargetPoint(target, anchor.point);
      if (!point) continue;
      const distance = distanceBetween(point, anchor.point);
      const allowed = targetAllowedThreshold(target, activeTarget, threshold, releaseThreshold);
      if (distance > allowed) continue;
      const result = {
        dx: point.x - anchor.point.x,
        dy: point.y - anchor.point.y,
        distance,
        target,
        targets: [target],
        anchor: anchor.key,
      };
      if (compareCandidate(result, best)) best = result;
      if (isActiveCandidate(result, activeTarget, releaseThreshold)
        && compareCandidate(result, activeBest)) {
        activeBest = result;
      }
    }
  }
  return activeBest || best;
}

function makeTargetId(kind, point, sourceIds, surfaceId = '') {
  return `${kind}:${surfaceId || '-'}:${pointKey(point)}:${[...sourceIds].sort(compareStrings).join('|')}`;
}

function createPointTarget(kind, point, sourceIds, { surfaceId = null, segment = null } = {}) {
  if (!finitePoint(point) || !sourceIds?.length) return null;
  const normalizedSourceIds = [...new Set(sourceIds.map(String))].sort(compareStrings);
  return {
    id: makeTargetId(kind, point, normalizedSourceIds, surfaceId),
    kind,
    snapKind: kind,
    point: clonePoint(point),
    sourceIds: normalizedSourceIds,
    surfaceId: surfaceId || null,
    segment: segment ? cloneSegment(segment) : null,
  };
}

function mergePointTargets(candidates) {
  const groups = [];
  const ordered = [...candidates].filter(Boolean).sort((first, second) => {
    if (Math.abs(first.point.x - second.point.x) > GEOMETRY_EPSILON) return first.point.x - second.point.x;
    if (Math.abs(first.point.y - second.point.y) > GEOMETRY_EPSILON) return first.point.y - second.point.y;
    const priority = targetPriority(first) - targetPriority(second);
    if (priority) return priority;
    return compareStrings(targetId(first), targetId(second));
  });
  for (const candidate of ordered) {
    let group = groups.find((entry) => distanceBetween(entry.point, candidate.point) <= GEOMETRY_EPSILON);
    if (!group) {
      group = {
        point: clonePoint(candidate.point),
        candidates: [],
      };
      groups.push(group);
    }
    group.candidates.push(candidate);
  }
  return groups.map((group) => {
    const winner = group.candidates.slice().sort((first, second) => {
      const priority = targetPriority(first) - targetPriority(second);
      if (priority) return priority;
      return compareStrings(targetId(first), targetId(second));
    })[0];
    const sourceIds = [...new Set(group.candidates.flatMap((candidate) => candidate.sourceIds || []))].sort(compareStrings);
    const surfaceId = [...new Set(group.candidates.map((candidate) => candidate.surfaceId).filter(Boolean))].sort(compareStrings)[0] || null;
    return {
      ...winner,
      id: makeTargetId(winner.kind, group.point, sourceIds, surfaceId),
      point: group.point,
      sourceIds,
      surfaceId,
    };
  });
}

function getSurfaceBounds(surface, segments) {
  const bounds = surface?.bounds;
  const numericBounds = bounds
    ? [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].map(Number)
    : null;
  if (numericBounds && numericBounds.every(Number.isFinite)
    && numericBounds[2] >= numericBounds[0] && numericBounds[3] >= numericBounds[1]) {
    return {
      minX: numericBounds[0],
      minY: numericBounds[1],
      maxX: numericBounds[2],
      maxY: numericBounds[3],
    };
  }
  const points = [];
  for (const segment of segments || []) {
    const safe = cloneSegment(segment);
    if (!safe) continue;
    points.push(safe.start, safe.end);
    if (isArcSegment(safe)) {
      const angles = getArcAngles(safe);
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const point = {
          x: angles.center.x + angles.radius * Math.cos(angle),
          y: angles.center.y + angles.radius * Math.sin(angle),
        };
        if (isPointOnArc(point, safe)) points.push(point);
      }
    }
  }
  if (!points.length || points.some((point) => !finitePoint(point))) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function buildSnapTargets(boxModel) {
  const bounds = boxModel?.getBounds?.() || {};
  const { cut, fold } = getDielineSegments(boxModel);
  const xSet = new Set();
  const ySet = new Set();
  const segments = { x: [], y: [] };
  const arcs = [];
  const primitiveRecords = [];
  for (const [category, sourceSegments] of [['cut', cut], ['fold', fold]]) {
    for (const sourceSegment of sourceSegments || []) {
      const segment = cloneSegment(sourceSegment);
      if (!segment || !['LINE', 'ARC'].includes(segment.kind || 'LINE')) continue;
      const sourceId = primitiveSourceId(sourceSegment, category);
      primitiveRecords.push({ category, sourceId, segment });
    }
  }
  primitiveRecords.sort((first, second) => compareStrings(first.sourceId, second.sourceId));
  for (const { category: kind, sourceId, segment } of primitiveRecords) {
    const axis = getSegmentAxis(segment);
    if (isArcSegment(segment)) {
      arcs.push({
        ...segment,
        id: sourceId,
        kind,
        geometryKind: 'ARC',
        sourceIds: [sourceId],
      });
      continue;
    }
    if (!axis) continue;
    const coordinate = axis === 'x' ? segment.start.x : segment.start.y;
    const alongStart = axis === 'x' ? segment.start.y : segment.start.x;
    const alongEnd = axis === 'x' ? segment.end.y : segment.end.x;
    const metadata = {
      id: sourceId,
      axis,
      coordinate,
      kind,
      sourceIds: [sourceId],
      start: { ...segment.start },
      end: { ...segment.end },
      midpoint: (alongStart + alongEnd) / 2,
    };
    segments[axis].push(metadata);
    if (axis === 'x') xSet.add(coordinate);
    else ySet.add(coordinate);
  }
  const technical = boxModel?.mode === 'technical';
  const pointCandidates = [];
  if (technical) {
    for (const { sourceId, segment } of primitiveRecords) {
      pointCandidates.push(createPointTarget('endpoint', segment.start, [sourceId], { segment }));
      pointCandidates.push(createPointTarget('endpoint', segment.end, [sourceId], { segment }));
    }
    for (let firstIndex = 0; firstIndex < primitiveRecords.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < primitiveRecords.length; secondIndex += 1) {
        const first = primitiveRecords[firstIndex];
        const second = primitiveRecords[secondIndex];
        for (const point of intersections(first.segment, second.segment)) {
          pointCandidates.push(createPointTarget('intersection', point, [first.sourceId, second.sourceId]));
        }
      }
    }
  }

  const surfaces = technical && typeof boxModel?.getArtworkSurfaces === 'function'
    ? boxModel.getArtworkSurfaces()
    : technical && typeof boxModel?.getPanels === 'function' ? boxModel.getPanels() : [];
  const boundaryTargets = [];
  for (const surface of [...(surfaces || [])].sort((first, second) => compareStrings(first?.id, second?.id))) {
    const exactContour = Array.isArray(surface?.contour?.segments) && surface.contour.segments.length > 0;
    const contour = exactContour ? surface.contour.segments : [];
    const safeContour = (contour || []).map(cloneSegment).filter(Boolean);
    const surfaceId = typeof surface?.id === 'string' ? surface.id : null;
    const surfaceBounds = getSurfaceBounds(surface, safeContour);
    if (surfaceId && surfaceBounds) {
      pointCandidates.push(createPointTarget(
        'panel-center',
        { x: (surfaceBounds.minX + surfaceBounds.maxX) / 2, y: (surfaceBounds.minY + surfaceBounds.maxY) / 2 },
        [surfaceId],
        { surfaceId },
      ));
    }
    if (!surfaceId || (technical && !exactContour)) continue;
    safeContour.forEach((segment, index) => {
      const sourceId = `${surfaceId}:boundary:${index}:${segmentSignature(segment)}`;
      const point = isArcSegment(segment) ? getArcPoint(segment) : {
        x: (segment.start.x + segment.end.x) / 2,
        y: (segment.start.y + segment.end.y) / 2,
      };
      if (!point) return;
      boundaryTargets.push({
        id: `panel-boundary:${surfaceId}:${index}:${pointKey(point)}`,
        kind: 'panel-boundary',
        snapKind: 'panel-boundary',
        point,
        sourceIds: [sourceId],
        surfaceId,
        segment: { ...segment, id: sourceId },
      });
    });
  }
  const semanticPointTargets = mergePointTargets(pointCandidates);
  const semanticTargets = [...semanticPointTargets, ...boundaryTargets]
    .sort((first, second) => {
      const priority = targetPriority(first) - targetPriority(second);
      if (priority) return priority;
      return compareStrings(targetId(first), targetId(second));
    });
  const validBounds = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
    && bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY;
  const centers = validBounds
    ? { x: [(bounds.minX + bounds.maxX) / 2], y: [(bounds.minY + bounds.maxY) / 2] }
    : { x: [], y: [] };
  const byKind = (kind) => semanticTargets.filter((target) => target.kind === kind);
  return {
    lines: {
      x: [...xSet].filter(Number.isFinite).sort((a, b) => a - b),
      y: [...ySet].filter(Number.isFinite).sort((a, b) => a - b),
    },
    centers,
    segments: {
      x: segments.x.sort((first, second) => compareStrings(first.id, second.id)),
      y: segments.y.sort((first, second) => compareStrings(first.id, second.id)),
    },
    arcs: arcs.sort((first, second) => compareStrings(first.id, second.id)),
    targets: semanticTargets,
    semanticTargets,
    endpoints: byKind('endpoint'),
    intersections: byKind('intersection'),
    panelCenters: byKind('panel-center'),
    panelBoundaries: byKind('panel-boundary'),
  };
}

export function getSnapOffset(candidateCenter, halfExtents, targets, threshold, options = {}) {
  const activeTarget = options?.activeTarget || null;
  const releaseThreshold = Number(options?.releaseThreshold ?? Number(threshold) * 1.5);
  const semantic = closestSemanticMoveSnap(
    candidateCenter,
    halfExtents,
    targets,
    threshold,
    activeTarget,
    releaseThreshold,
  );
  const xSnap = axisSnapCandidate(
    candidateCenter.x,
    halfExtents.x,
    targets?.lines?.x,
    targets?.centers?.x,
    targets,
    'x',
    threshold,
    activeTarget,
    releaseThreshold,
  );
  const ySnap = axisSnapCandidate(
    candidateCenter.y,
    halfExtents.y,
    targets?.lines?.y,
    targets?.centers?.y,
    targets,
    'y',
    threshold,
    activeTarget,
    releaseThreshold,
  );
  const lineTargets = [xSnap, ySnap].filter(Boolean).map((snap) => ({
    dx: xSnap?.delta || 0,
    dy: ySnap?.delta || 0,
    distance: Math.hypot(xSnap?.delta || 0, ySnap?.delta || 0),
    activeDistance: Math.abs(snap.delta),
    target: snap.target,
    targets: [xSnap?.target, ySnap?.target].filter(Boolean),
  }));
  const arcOffset = closestArcSnap(candidateCenter, halfExtents, targets, threshold, activeTarget, releaseThreshold);
  const candidates = [semantic, ...lineTargets, arcOffset].filter(Boolean);
  const activeCandidates = candidates.filter((candidate) => isActiveCandidate(
    candidate,
    activeTarget,
    releaseThreshold,
  ));
  const chooseBest = (entries) => entries.reduce(
    (best, candidate) => (compareCandidate(candidate, best) ? candidate : best),
    null,
  );
  const result = chooseBest(activeCandidates) || chooseBest(candidates) || {
    dx: 0,
    dy: 0,
    distance: 0,
    target: null,
    targets: [],
  };
  return {
    dx: result.dx || 0,
    dy: result.dy || 0,
    distance: result.distance || 0,
    target: result.target || null,
    targets: result.targets || (result.target ? [result.target] : []),
  };
}

export function getDisplayedReferenceFraction(rotation, fraction) {
  const quarter = ((Number(rotation) % 360) + 360) % 360;
  const { x: fx, y: fy } = fraction;
  switch (quarter) {
    case 90:
      return { x: -fy, y: fx };
    case 180:
      return { x: -fx, y: -fy };
    case 270:
      return { x: fy, y: -fx };
    default:
      return { x: fx, y: fy };
  }
}

function getTrajectoryIntersections(target, anchor, vector, minFactor, maxFactor) {
  if (!target?.segment || !finitePoint(anchor) || !finitePoint(vector)) return [];
  const trajectory = {
    kind: 'LINE',
    start: {
      x: anchor.x + vector.x * minFactor,
      y: anchor.y + vector.y * minFactor,
    },
    end: {
      x: anchor.x + vector.x * maxFactor,
      y: anchor.y + vector.y * maxFactor,
    },
  };
  if (isArcSegment(target.segment)) {
    return lineArcIntersections(trajectory, target.segment);
  }
  return lineLineIntersection(trajectory, target.segment);
}

function getTrajectoryFactor(point, anchor, vector) {
  const directionLengthSquared = vector.x * vector.x + vector.y * vector.y;
  if (!finitePoint(point) || directionLengthSquared <= GEOMETRY_EPSILON) return null;
  const factor = ((point.x - anchor.x) * vector.x + (point.y - anchor.y) * vector.y) / directionLengthSquared;
  return Number.isFinite(factor) ? factor : null;
}

function resolveTargetFactor({ target, candidateFactor, anchor, vector, threshold, releaseThreshold, minFactor, maxFactor, point, activeTarget = null }) {
  const directionLengthSquared = vector.x * vector.x + vector.y * vector.y;
  if (!target || directionLengthSquared <= GEOMETRY_EPSILON) return null;
  const candidatePoint = finitePoint(point) ? point : {
    x: anchor.x + vector.x * candidateFactor,
    y: anchor.y + vector.y * candidateFactor,
  };
  const allowed = targetAllowedThreshold(target, activeTarget, threshold, releaseThreshold);

  // A panel boundary is a finite geometry target. Resolve it by intersecting
  // the finite handle trajectory with the finite LINE/ARC, never by snapping
  // to the nearest point on the infinite extension.
  if (target.snapKind === 'panel-boundary' && target.segment) {
    const exactHits = getTrajectoryIntersections(target, anchor, vector, minFactor, maxFactor)
      .map((hit) => ({
        point: hit,
        factor: getTrajectoryFactor(hit, anchor, vector),
      }))
      .filter((hit) => Number.isFinite(hit.factor)
        && hit.factor >= minFactor - GEOMETRY_EPSILON
        && hit.factor <= maxFactor + GEOMETRY_EPSILON)
      .sort((first, second) => Math.abs(first.factor - candidateFactor) - Math.abs(second.factor - candidateFactor));
    const exact = exactHits[0];
    if (exact) {
      const nearest = getTargetPoint(target, candidatePoint);
      const candidateDistance = nearest
        ? distanceBetween(candidatePoint, nearest)
        : distanceBetween(candidatePoint, exact.point);
      if (candidateDistance > allowed) return null;
      return {
        factor: exact.factor,
        actualDistance: candidateDistance,
      };
    }

    // Once active, keep the target through the release band even when the
    // current trajectory is parallel to the boundary and has no exact hit.
    if (!targetMatches(activeTarget, target)) return null;
  }

  const nearest = getTargetPoint(target, candidatePoint);
  if (!nearest) return null;
  const candidateDistance = distanceBetween(candidatePoint, nearest);
  if (candidateDistance > allowed) return null;
  const factor = getTrajectoryFactor(nearest, anchor, vector);
  if (!Number.isFinite(factor) || factor < minFactor || factor > maxFactor) return null;
  const finalPoint = {
    x: anchor.x + vector.x * factor,
    y: anchor.y + vector.y * factor,
  };
  const finalTargetPoint = getTargetPoint(target, finalPoint) || nearest;
  const finalDistance = distanceBetween(finalPoint, finalTargetPoint);
  if (finalDistance > allowed) return null;
  return {
    factor,
    actualDistance: candidateDistance,
  };
}

export function getResizeSnapFactor({
  candidateFactor,
  anchor,
  vector,
  axis,
  targets,
  threshold,
  releaseThreshold = threshold * 1.5,
  minFactor = 0.01,
  maxFactor = 20,
  activeTarget = null,
  point = null,
}) {
  if (!Number.isFinite(candidateFactor) || !vector || !Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)
    || Math.abs(vector[axis]) < 1e-9) {
    return { factor: candidateFactor, target: null };
  }
  const candidateValue = anchor[axis] + vector[axis] * candidateFactor;
  let best = null;
  let activeBest = null;
  const consider = (factor, target, actualDistance = 0) => {
    if (!Number.isFinite(factor) || factor < minFactor || factor > maxFactor) return;
    const result = {
      distance: actualDistance,
      actualDistance,
      target,
      factor,
    };
    if (compareCandidate(result, best)) best = result;
    if (targetMatches(activeTarget, target)
      && actualDistance <= releaseThreshold
      && compareCandidate(result, activeBest)) {
      activeBest = result;
    }
  };
  for (const coordinate of targets?.lines?.[axis] || []) {
    const target = targetForLine(targets, axis, coordinate, point);
    const allowed = targetAllowedThreshold(target, activeTarget, threshold, releaseThreshold);
    if (Math.abs(candidateValue - coordinate) > allowed) continue;
    const candidatePoint = finitePoint(point)
      ? point
      : {
        x: axis === 'x' ? candidateValue : anchor.x,
        y: axis === 'y' ? candidateValue : anchor.y,
      };
    const geometricDistance = target.segment
      ? nearestPointOnSegment(candidatePoint, target.segment)?.distance
      : null;
    consider(
      (coordinate - anchor[axis]) / vector[axis],
      target,
      Number.isFinite(geometricDistance) ? geometricDistance : Math.abs(candidateValue - coordinate),
    );
  }
  for (const arc of targets?.arcs || []) {
    const target = targetForArc({ ...arc, segment: arc });
    const resolved = resolveTargetFactor({
      target,
      candidateFactor,
      anchor,
      vector,
      threshold,
      releaseThreshold,
      minFactor,
      maxFactor,
      point,
      activeTarget,
    });
    if (resolved && targetMatches(activeTarget, target)) resolved.distance = Math.abs(resolved.factor - candidateFactor);
    if (resolved) consider(resolved.factor, target, resolved.actualDistance);
  }
  for (const target of targets?.semanticTargets || targets?.targets || []) {
    const resolved = resolveTargetFactor({
      target,
      candidateFactor,
      anchor,
      vector,
      threshold,
      releaseThreshold,
      minFactor,
      maxFactor,
      point,
      activeTarget,
    });
    if (resolved) consider(resolved.factor, target, resolved.actualDistance);
  }
  const chosen = activeBest || best;
  return chosen
    ? { factor: chosen.factor, target: chosen.target }
    : { factor: candidateFactor, target: null };
}

export function getResizeSnapScale(options) {
  return getResizeSnapScaleWithTarget(options).scale;
}

export function resolveResizeSnapScale(options) {
  return getResizeSnapScaleWithTarget(options);
}

function getResizeSnapScaleWithTarget({
  candidateScale,
  anchor,
  baseW,
  baseH,
  fraction,
  targets,
  threshold,
  minScale = 0.01,
  maxScale = 20,
  releaseThreshold = threshold * 1.5,
  activeTarget = null,
}) {
  const halfW = baseW / 2;
  const halfH = baseH / 2;
  let best = null;
  let activeBest = null;
  const considerCandidate = (scale, target, actualDistance) => {
    if (!Number.isFinite(scale) || scale < minScale || scale > maxScale) return;
    const result = {
      distance: actualDistance,
      actualDistance,
      target,
      factor: scale,
    };
    if (compareCandidate(result, best)) best = result;
    if (targetMatches(activeTarget, target)
      && actualDistance <= releaseThreshold
      && compareCandidate(result, activeBest)) {
      activeBest = result;
    }
  };
  const consider = (scale, axis, coordinate, candidateValue) => {
    if (!Number.isFinite(scale) || scale < minScale || scale > maxScale) return;
    const target = targetForLine(targets, axis, coordinate, {
      x: axis === 'x' ? candidateValue : anchor.x,
      y: axis === 'y' ? candidateValue : anchor.y,
    });
    const distance = Math.abs(candidateValue - coordinate);
    const allowed = targetAllowedThreshold(target, activeTarget, threshold, releaseThreshold);
    if (distance > allowed) return;
    considerCandidate(scale, target, distance);
  };
  const considerSemantic = (scale, target, actualDistance = 0) => {
    considerCandidate(scale, target, actualDistance);
  };
  const edgeRight = (scale) => anchor.x + (1 - fraction.x) * halfW * scale;
  const edgeLeft = (scale) => anchor.x - (fraction.x + 1) * halfW * scale;
  const edgeBottom = (scale) => anchor.y + (1 - fraction.y) * halfH * scale;
  const edgeTop = (scale) => anchor.y - (fraction.y + 1) * halfH * scale;
  if (fraction.x < 1) for (const coordinate of targets?.lines?.x || []) {
    consider((coordinate - anchor.x) / ((1 - fraction.x) * halfW), 'x', coordinate, edgeRight(candidateScale));
  }
  if (fraction.x > -1) for (const coordinate of targets?.lines?.x || []) {
    consider((anchor.x - coordinate) / ((fraction.x + 1) * halfW), 'x', coordinate, edgeLeft(candidateScale));
  }
  if (fraction.y < 1) for (const coordinate of targets?.lines?.y || []) {
    consider((coordinate - anchor.y) / ((1 - fraction.y) * halfH), 'y', coordinate, edgeBottom(candidateScale));
  }
  if (fraction.y > -1) for (const coordinate of targets?.lines?.y || []) {
    consider((anchor.y - coordinate) / ((fraction.y + 1) * halfH), 'y', coordinate, edgeTop(candidateScale));
  }
  const semanticEdges = [
    {
      vector: { x: (1 - fraction.x) * halfW, y: 0 },
      point: { x: edgeRight(candidateScale), y: anchor.y },
    },
    {
      vector: { x: -(fraction.x + 1) * halfW, y: 0 },
      point: { x: edgeLeft(candidateScale), y: anchor.y },
    },
    {
      vector: { x: 0, y: (1 - fraction.y) * halfH },
      point: { x: anchor.x, y: edgeBottom(candidateScale) },
    },
    {
      vector: { x: 0, y: -(fraction.y + 1) * halfH },
      point: { x: anchor.x, y: edgeTop(candidateScale) },
    },
  ];
  for (const target of targets?.semanticTargets || targets?.targets || []) {
    for (const edge of semanticEdges) {
      if (Math.hypot(edge.vector.x, edge.vector.y) <= GEOMETRY_EPSILON) continue;
      const resolved = resolveTargetFactor({
        target,
        candidateFactor: candidateScale,
        anchor,
        vector: edge.vector,
        threshold,
        releaseThreshold,
        minFactor: minScale,
        maxFactor: maxScale,
        point: edge.point,
        activeTarget,
      });
      if (resolved) considerSemantic(resolved.factor, target, resolved.actualDistance);
    }
  }
  const chosen = activeBest || best;
  return { scale: chosen?.factor ?? candidateScale, target: chosen?.target || null };
}
