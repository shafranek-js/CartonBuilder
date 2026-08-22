import { getMaxBoardCaliperMm, sanitizeBoardConstruction } from './BoardConstruction.js';

// Compatibility-only parser/generator for persisted Technical/legacy states.
// Quick Layout exposes manual Custom Net and must not select STE/RTE here.
export const CONSTRUCTION_TEMPLATE_IDS = Object.freeze([
  'legacy-six-panel',
  'ste',
  'rte',
]);

export const CONSTRUCTION_ROLES = Object.freeze([
  'body',
  'closure',
  'tuck-flap',
  'dust-flap',
  'glue-tab',
]);

const EPSILON = 1e-7;

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function point(x, y) {
  return { x: Number(x), y: Number(y) };
}

function rectangle(x, y, width, height) {
  return [point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height)];
}

function boundsOf(points) {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function normalizePolygon(points) {
  const result = [];
  for (const raw of points || []) {
    const next = point(raw.x, raw.y);
    const previous = result[result.length - 1];
    if (!previous || Math.abs(previous.x - next.x) > EPSILON || Math.abs(previous.y - next.y) > EPSILON) {
      result.push(next);
    }
  }
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.abs(first.x - last.x) <= EPSILON && Math.abs(first.y - last.y) <= EPSILON) result.pop();
  }
  return result;
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orient(a, b, c);
  const abD = orient(a, b, d);
  const cdA = orient(c, d, a);
  const cdB = orient(c, d, b);
  const crossing = (abC > EPSILON && abD < -EPSILON || abC < -EPSILON && abD > EPSILON)
    && (cdA > EPSILON && cdB < -EPSILON || cdA < -EPSILON && cdB > EPSILON);
  return crossing;
}

function ensureCounterClockwise(points) {
  return signedArea(points) < 0 ? points.slice().reverse() : points.slice();
}

function makeElement({
  id,
  role,
  name,
  points,
  surfaceKey = null,
  parentId = null,
  parentEdge = null,
  foldAngleDeg = 0,
  phase = [0, 1],
  overlapLayer = 0,
  hinge = null,
}) {
  const polygon = ensureCounterClockwise(normalizePolygon(points));
  const rect = boundsOf(polygon);
  return {
    id,
    faceKey: surfaceKey || id,
    faceName: name,
    name,
    role,
    surfaceKey,
    polygon,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    parentId,
    parentEdge,
    foldAngleDeg,
    phase: [...phase],
    overlapLayer,
    hinge: hinge ? {
      axis: [...hinge.axis],
      parentPoint: { ...hinge.parentPoint },
      childPoint: { ...hinge.childPoint },
    } : null,
    basis: null,
  };
}

function horizontalHinge(x, y, width, childRect, direction = 'top') {
  const parentPoint = point(x + width / 2, y);
  const childPoint = point(childRect.x + childRect.width / 2, direction === 'top'
    ? childRect.y + childRect.height
    : childRect.y);
  return { axis: [1, 0], parentPoint, childPoint };
}

function verticalHinge(x, y, height, childRect, direction = 'left') {
  const parentPoint = point(x, y + height / 2);
  const childPoint = point(direction === 'left'
    ? childRect.x + childRect.width
    : childRect.x, childRect.y + childRect.height / 2);
  return { axis: [0, 1], parentPoint, childPoint };
}

function tuckPolygon(x, y, width, depth, ear, direction) {
  const sign = direction === 'top' ? -1 : 1;
  const baseY = y;
  const tipY = y + sign * depth;
  const shoulderY = y + sign * depth * 0.55;
  const earY = y + sign * depth * 0.78;
  const points = [
    point(x, baseY),
    point(x + width, baseY),
    point(x + width, shoulderY),
    point(x + width + ear, shoulderY),
    point(x + width + ear, earY),
    point(x + width * 0.85, tipY),
    point(x + width * 0.15, tipY),
    point(x - ear, earY),
    point(x - ear, shoulderY),
    point(x, shoulderY),
  ];
  return points;
}

function normalizeParameters(dimensions, board, parameters = {}) {
  const { width, height, depth } = dimensions;
  const maxCaliper = getMaxBoardCaliperMm(dimensions);
  const caliper = sanitizeBoardConstruction(board, dimensions).caliperMm;
  const glueMax = Math.min(30, depth * 0.75);
  const tuckMax = Math.min(25, height / 3);
  const dustMax = width / 2;
  const glueMin = Math.min(6, glueMax);
  const tuckMin = Math.min(6, tuckMax);
  const dustMin = Math.min(6, dustMax);
  const earMax = Math.max(0, Math.min(6, width * 0.08));
  return {
    glueTabWidthMm: clamp(parameters.glueTabWidthMm ?? 15, glueMin, glueMax),
    tuckTabDepthMm: clamp(parameters.tuckTabDepthMm ?? depth * 0.45, tuckMin, tuckMax),
    dustFlapReachMm: clamp(parameters.dustFlapReachMm ?? Math.min(depth, width * 0.45), dustMin, dustMax),
    lockEarMm: clamp(parameters.lockEarMm ?? 3, 0, earMax),
    clearanceMm: clamp(caliper * 2, 0.2, 1),
    caliperMm: Math.min(caliper, maxCaliper),
  };
}

function buildConstructionElements(dimensions, board, templateId, parameters) {
  const { width: W, height: H, depth: D } = dimensions;
  const p = normalizeParameters(dimensions, board, parameters);
  const elements = [];
  const push = (entry) => elements.push(entry);

  const row = {
    left: { x: 0, y: 0, width: D, height: H },
    front: { x: D, y: 0, width: W, height: H },
    right: { x: D + W, y: 0, width: D, height: H },
    back: { x: D * 2 + W, y: 0, width: W, height: H },
  };
  for (const [id, rect] of Object.entries(row)) {
    const parentId = id === 'front' ? null : id === 'left' ? 'front' : id === 'right' ? 'front' : 'right';
    const parentEdge = id === 'left' ? 'left' : id === 'right' ? 'right' : id === 'back' ? 'right' : null;
    push(makeElement({
      id,
      role: 'body',
      name: `${id[0].toUpperCase()}${id.slice(1)} Panel`,
      surfaceKey: id,
      points: rectangle(rect.x, rect.y, rect.width, rect.height),
      parentId,
      parentEdge,
      foldAngleDeg: id === 'left' ? 90 : id === 'right' ? -90 : id === 'back' ? 90 : 0,
      phase: [0, 0.45],
      overlapLayer: 0,
      hinge: parentId ? verticalHinge(
        parentId === 'front' ? row.front.x + (id === 'left' ? 0 : W) : row.right.x + D,
        0,
        H,
        rect,
        id === 'left' ? 'left' : 'right',
      ) : null,
    }));
  }

  const glue = { x: -p.glueTabWidthMm, y: 0, width: p.glueTabWidthMm, height: H };
  push(makeElement({
    id: 'glue-tab',
    role: 'glue-tab',
    name: 'Glue Tab',
    points: rectangle(glue.x, glue.y, glue.width, glue.height),
    parentId: 'left',
    parentEdge: 'left',
    foldAngleDeg: 180,
    phase: [0.25, 0.55],
    overlapLayer: 2,
    hinge: verticalHinge(row.left.x, 0, H, glue, 'right'),
  }));

  const closureParent = {
    top: templateId === 'rte' ? 'back' : 'back',
    bottom: templateId === 'rte' ? 'front' : 'back',
  };
  const closureEdge = { top: 'top', bottom: 'bottom' };
  const closureRects = {};
  for (const direction of ['top', 'bottom']) {
    const parent = row[closureParent[direction]];
    const y = direction === 'top' ? -D : H;
    const rect = { x: parent.x, y, width: W, height: D };
    closureRects[direction] = rect;
    push(makeElement({
      id: `${direction}-closure`,
      role: 'closure',
      name: `${direction[0].toUpperCase()}${direction.slice(1)} Closure`,
      surfaceKey: direction,
      points: rectangle(rect.x, rect.y, rect.width, rect.height),
      parentId: closureParent[direction],
      parentEdge: closureEdge[direction],
      foldAngleDeg: direction === 'top' ? -90 : 90,
      phase: direction === 'top' ? [0.76, 0.94] : [0.58, 0.76],
      overlapLayer: 2,
      hinge: horizontalHinge(parent.x, direction === 'top' ? 0 : H, W, rect, direction),
    }));
  }

  for (const direction of ['top', 'bottom']) {
    const sign = direction === 'top' ? -1 : 1;
    const rect = closureRects[direction];
    const baseY = direction === 'top' ? rect.y : rect.y + rect.height;
    const tuck = tuckPolygon(rect.x, baseY, W, p.tuckTabDepthMm, p.lockEarMm, direction);
    push(makeElement({
      id: `${direction}-tuck`,
      role: 'tuck-flap',
      name: `${direction[0].toUpperCase()}${direction.slice(1)} Tuck Flap`,
      points: tuck,
      parentId: `${direction}-closure`,
      parentEdge: direction === 'top' ? 'top' : 'bottom',
      foldAngleDeg: direction === 'top' ? 90 : -90,
      phase: direction === 'top' ? [0.90, 1] : [0.72, 0.84],
      overlapLayer: 3,
      hinge: horizontalHinge(rect.x, baseY, W, boundsOf(tuck), direction),
    }));
  }

  for (const side of ['left', 'right']) {
    const rect = row[side];
    for (const direction of ['top', 'bottom']) {
      const y = direction === 'top' ? -p.dustFlapReachMm : H;
      const dust = { x: rect.x, y, width: D, height: p.dustFlapReachMm };
      push(makeElement({
        id: `${side}-${direction}-dust`,
        role: 'dust-flap',
        name: `${side[0].toUpperCase()}${side.slice(1)} ${direction[0].toUpperCase()}${direction.slice(1)} Dust Flap`,
        points: rectangle(dust.x, dust.y, dust.width, dust.height),
        parentId: side,
        parentEdge: direction,
        foldAngleDeg: direction === 'top' ? -90 : 90,
        phase: direction === 'top' ? [0.62, 0.78] : [0.45, 0.60],
        overlapLayer: 1,
        hinge: horizontalHinge(rect.x, direction === 'top' ? 0 : H, D, dust, direction),
      }));
    }
  }

  return {
    templateId,
    templateVersion: 1,
    parameters: {
      glueTabWidthMm: p.glueTabWidthMm,
      tuckTabDepthMm: p.tuckTabDepthMm,
      dustFlapReachMm: p.dustFlapReachMm,
      lockEarMm: p.lockEarMm,
    },
    elements,
  };
}

export function sanitizeConstruction(input, dimensions, board) {
  const source = input && typeof input === 'object' ? input : {};
  const templateId = CONSTRUCTION_TEMPLATE_IDS.includes(source.templateId)
    ? source.templateId
    : 'legacy-six-panel';
  if (templateId === 'legacy-six-panel') {
    return {
      templateId,
      templateVersion: 1,
      parameters: {},
    };
  }
  return {
    templateId,
    templateVersion: 1,
    parameters: normalizeParameters(dimensions, board, source.parameters),
  };
}

export function buildConstructionTemplate(templateId, dimensions, board, parameters = {}) {
  if (!['ste', 'rte'].includes(templateId)) throw new Error(`Unknown carton construction: ${templateId}`);
  return buildConstructionElements(dimensions, board, templateId, parameters);
}

export function validateConstructionElements(elements) {
  if (!Array.isArray(elements) || elements.length !== 13) return { valid: false, reason: 'element-count' };
  const ids = new Set();
  for (const element of elements) {
    if (!element?.id || ids.has(element.id) || !CONSTRUCTION_ROLES.includes(element.role)) {
      return { valid: false, reason: 'element-identity' };
    }
    ids.add(element.id);
    const polygon = normalizePolygon(element.polygon);
    if (polygon.length < 3 || Math.abs(signedArea(polygon)) <= EPSILON) return { valid: false, reason: 'polygon' };
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      for (let other = index + 1; other < polygon.length; other += 1) {
        const c = polygon[other];
        const d = polygon[(other + 1) % polygon.length];
        if (index === 0 && other === polygon.length - 1) continue;
        if (segmentsIntersect(a, b, c, d)) return { valid: false, reason: 'self-intersection', elementId: element.id };
      }
    }
  }
  return { valid: true, reason: null };
}

export function getConstructionDefaults(templateId, dimensions, board) {
  return sanitizeConstruction({ templateId }, dimensions, board);
}
