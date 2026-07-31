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

export function buildSnapTargets(boxModel) {
  const bounds = boxModel.getBounds();
  const { cut, fold } = getDielineSegments(boxModel);
  const xSet = new Set();
  const ySet = new Set();
  for (const segment of [...cut, ...fold]) {
    if (segment.start.x === segment.end.x) xSet.add(segment.start.x);
    if (segment.start.y === segment.end.y) ySet.add(segment.start.y);
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

export function getResizeSnapScale({
  candidateScale,
  anchor,
  baseW,
  baseH,
  fraction,
  targets,
  threshold,
  minScale = 0.01,
  maxScale = 20,
}) {
  const halfW = baseW / 2;
  const halfH = baseH / 2;
  let bestScale = candidateScale;
  let bestDistance = Infinity;

  const consider = (scale) => {
    if (!Number.isFinite(scale)) return;
    if (scale < minScale || scale > maxScale) return;
    const distance = Math.abs(scale - candidateScale);
    if (distance < bestDistance) {
      bestScale = scale;
      bestDistance = distance;
    }
  };

  const edgeRight = (scale) => anchor.x + (1 - fraction.x) * halfW * scale;
  const edgeLeft = (scale) => anchor.x - (fraction.x + 1) * halfW * scale;
  const edgeBottom = (scale) => anchor.y + (1 - fraction.y) * halfH * scale;
  const edgeTop = (scale) => anchor.y - (fraction.y + 1) * halfH * scale;

  if (fraction.x < 1) {
    for (const target of targets.lines.x) {
      if (Math.abs(edgeRight(candidateScale) - target) <= threshold) {
        consider((target - anchor.x) / ((1 - fraction.x) * halfW));
      }
    }
  }
  if (fraction.x > -1) {
    for (const target of targets.lines.x) {
      if (Math.abs(edgeLeft(candidateScale) - target) <= threshold) {
        consider((anchor.x - target) / ((fraction.x + 1) * halfW));
      }
    }
  }
  if (fraction.y < 1) {
    for (const target of targets.lines.y) {
      if (Math.abs(edgeBottom(candidateScale) - target) <= threshold) {
        consider((target - anchor.y) / ((1 - fraction.y) * halfH));
      }
    }
  }
  if (fraction.y > -1) {
    for (const target of targets.lines.y) {
      if (Math.abs(edgeTop(candidateScale) - target) <= threshold) {
        consider((anchor.y - target) / ((fraction.y + 1) * halfH));
      }
    }
  }

  return bestScale;
}
