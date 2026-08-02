import { getDielineSegments } from '../model/dieline.js';

function axisSnap(candidate, halfExtent, lineTargets, centerTargets, threshold) {
  let best = 0;
  let bestDistance = Infinity;
  const consider = (delta) => {
    const distance = Math.abs(delta);
    if (distance <= threshold && distance < bestDistance) {
      best = delta;
      bestDistance = distance;
    }
  };
  for (const target of lineTargets) {
    consider(target - (candidate - halfExtent));
    consider(target - (candidate + halfExtent));
  }
  for (const target of centerTargets) {
    consider(target - candidate);
  }
  return best;
}

function getSegmentAxis(segment) {
  if (segment.start.x === segment.end.x) return 'x';
  if (segment.start.y === segment.end.y) return 'y';
  return null;
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
    axis,
    coordinate,
    kind: segment?.kind || 'dieline',
    segment: segment || null,
  };
}

export function buildSnapTargets(boxModel) {
  const bounds = boxModel.getBounds();
  const { cut, fold } = getDielineSegments(boxModel);
  const xSet = new Set();
  const ySet = new Set();
  const segments = { x: [], y: [] };
  for (const segment of [...cut, ...fold]) {
    const axis = getSegmentAxis(segment);
    if (!axis) continue;
    const coordinate = axis === 'x' ? segment.start.x : segment.start.y;
    const alongStart = axis === 'x' ? segment.start.y : segment.start.x;
    const alongEnd = axis === 'x' ? segment.end.y : segment.end.x;
    const kind = cut.includes(segment) ? 'cut' : 'fold';
    const metadata = {
      id: `${kind}-${axis}-${coordinate}-${alongStart}-${alongEnd}`,
      axis,
      coordinate,
      kind,
      start: { ...segment.start },
      end: { ...segment.end },
      midpoint: (alongStart + alongEnd) / 2,
    };
    segments[axis].push(metadata);
    if (axis === 'x') xSet.add(coordinate);
    else ySet.add(coordinate);
  }
  return {
    lines: {
      x: [...xSet],
      y: [...ySet],
    },
    centers: {
      x: [(bounds.minX + bounds.maxX) / 2],
      y: [(bounds.minY + bounds.maxY) / 2],
    },
    segments,
  };
}

export function getSnapOffset(candidateCenter, halfExtents, targets, threshold) {
  return {
    dx: axisSnap(
      candidateCenter.x,
      halfExtents.x,
      targets.lines.x,
      targets.centers.x,
      threshold,
    ),
    dy: axisSnap(
      candidateCenter.y,
      halfExtents.y,
      targets.lines.y,
      targets.centers.y,
      threshold,
    ),
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
  if (!Number.isFinite(candidateFactor) || !vector || Math.abs(vector[axis]) < 1e-9) {
    return { factor: candidateFactor, target: null };
  }
  const candidateValue = anchor[axis] + vector[axis] * candidateFactor;
  let bestFactor = candidateFactor;
  let bestTarget = null;
  let bestDistance = Infinity;
  const activeCoordinate = activeTarget?.axis === axis ? activeTarget.coordinate : null;
  for (const coordinate of targets?.lines?.[axis] || []) {
    const distance = Math.abs(candidateValue - coordinate);
    const allowed = coordinate === activeCoordinate ? releaseThreshold : threshold;
    if (distance > allowed) continue;
    const factor = (coordinate - anchor[axis]) / vector[axis];
    if (!Number.isFinite(factor) || factor < minFactor || factor > maxFactor) continue;
    const scaleDistance = Math.abs(factor - candidateFactor);
    if (scaleDistance >= bestDistance) continue;
    bestDistance = scaleDistance;
    bestFactor = factor;
    bestTarget = targetForLine(targets, axis, coordinate, point);
  }
  return { factor: bestFactor, target: bestTarget };
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
  let bestScale = candidateScale;
  let bestTarget = null;
  let bestDistance = Infinity;
  const consider = (scale, axis, coordinate, candidateValue) => {
    if (!Number.isFinite(scale) || scale < minScale || scale > maxScale) return;
    const activeCoordinate = activeTarget?.axis === axis ? activeTarget.coordinate : null;
    const allowed = coordinate === activeCoordinate ? releaseThreshold : threshold;
    if (Math.abs(candidateValue - coordinate) > allowed) return;
    const distance = Math.abs(scale - candidateScale);
    if (distance < bestDistance) {
      bestScale = scale;
      bestTarget = targetForLine(targets, axis, coordinate, {
        x: axis === 'x' ? candidateValue : anchor.x,
        y: axis === 'y' ? candidateValue : anchor.y,
      });
      bestDistance = distance;
    }
  };
  const edgeRight = (scale) => anchor.x + (1 - fraction.x) * halfW * scale;
  const edgeLeft = (scale) => anchor.x - (fraction.x + 1) * halfW * scale;
  const edgeBottom = (scale) => anchor.y + (1 - fraction.y) * halfH * scale;
  const edgeTop = (scale) => anchor.y - (fraction.y + 1) * halfH * scale;
  if (fraction.x < 1) for (const coordinate of targets.lines.x) {
    consider((coordinate - anchor.x) / ((1 - fraction.x) * halfW), 'x', coordinate, edgeRight(candidateScale));
  }
  if (fraction.x > -1) for (const coordinate of targets.lines.x) {
    consider((anchor.x - coordinate) / ((fraction.x + 1) * halfW), 'x', coordinate, edgeLeft(candidateScale));
  }
  if (fraction.y < 1) for (const coordinate of targets.lines.y) {
    consider((coordinate - anchor.y) / ((1 - fraction.y) * halfH), 'y', coordinate, edgeBottom(candidateScale));
  }
  if (fraction.y > -1) for (const coordinate of targets.lines.y) {
    consider((anchor.y - coordinate) / ((fraction.y + 1) * halfH), 'y', coordinate, edgeTop(candidateScale));
  }
  return { scale: bestScale, target: bestTarget };
}
