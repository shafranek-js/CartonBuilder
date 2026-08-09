import { getDielineSegments } from '../model/dieline.js';
import { sanitizePrepressSettings } from './prepressState.js';

const EPSILON = 1e-7;

function clone(value) {
  return structuredClone(value);
}

function point(x, y) {
  return { x: Number(x), y: Number(y) };
}

function polygonArea(points) {
  return (points || []).reduce((sum, current, index) => {
    const next = points[(index + 1) % points.length];
    return sum + current.x * next.y - next.x * current.y;
  }, 0) / 2;
}

function normalizePolygon(points) {
  const normalized = [];
  for (const raw of points || []) {
    const next = point(raw.x, raw.y);
    const previous = normalized.at(-1);
    if (!previous || Math.abs(next.x - previous.x) > EPSILON || Math.abs(next.y - previous.y) > EPSILON) {
      normalized.push(next);
    }
  }
  if (normalized.length > 1) {
    const first = normalized[0];
    const last = normalized.at(-1);
    if (Math.abs(first.x - last.x) <= EPSILON && Math.abs(first.y - last.y) <= EPSILON) normalized.pop();
  }
  return polygonArea(normalized) < 0 ? normalized.reverse() : normalized;
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON));
}

function selfIntersects(points) {
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    for (let other = index + 1; other < points.length; other += 1) {
      if (index === 0 && other === points.length - 1) continue;
      if (Math.abs(index - other) === 1) continue;
      const c = points[other];
      const d = points[(other + 1) % points.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function lineIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) <= EPSILON) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  return point(a.x + t * r.x, a.y + t * r.y);
}

function offsetPolygon(points, distance) {
  const polygon = normalizePolygon(points);
  if (polygon.length < 3 || Math.abs(polygonArea(polygon)) <= EPSILON) return null;
  if (!Number(distance)) return clone(polygon);
  const lines = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) return null;
    // Counter-clockwise polygons use the right-hand normal for an outward offset.
    const nx = dy / length;
    const ny = -dx / length;
    lines.push({
      a: point(start.x + nx * distance, start.y + ny * distance),
      b: point(end.x + nx * distance, end.y + ny * distance),
    });
  }
  const result = [];
  for (let index = 0; index < lines.length; index += 1) {
    const previous = lines[(index + lines.length - 1) % lines.length];
    const current = lines[index];
    const intersection = lineIntersection(previous.a, previous.b, current.a, current.b);
    if (intersection) {
      result.push(intersection);
      continue;
    }
    result.push(point(current.a.x, current.a.y));
  }
  const normalized = normalizePolygon(result);
  return normalized.length >= 3 && !selfIntersects(normalized) ? normalized : null;
}

function boundsOf(polygons) {
  const points = polygons.flat();
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const minX = Math.min(...points.map((entry) => entry.x));
  const minY = Math.min(...points.map((entry) => entry.y));
  const maxX = Math.max(...points.map((entry) => entry.x));
  const maxY = Math.max(...points.map((entry) => entry.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function segmentId(segment, prefix) {
  const normalize = (entry) => `${Number(entry.x).toFixed(4)},${Number(entry.y).toFixed(4)}`;
  const a = normalize(segment.start);
  const b = normalize(segment.end);
  return `${prefix}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;
}

function shiftSegment(segment, distance, prefix) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON || !distance) return { ...clone(segment), id: segmentId(segment, prefix) };
  const nx = dy / length;
  const ny = -dx / length;
  return {
    ...clone(segment),
    id: segmentId(segment, prefix),
    start: point(segment.start.x + nx * distance, segment.start.y + ny * distance),
    end: point(segment.end.x + nx * distance, segment.end.y + ny * distance),
  };
}

function getElements(model) {
  return typeof model.getElements === 'function' ? model.getElements() : model.getPanels();
}

function stableSegmentId(segment, prefix, templateId, index) {
  const owner = Array.isArray(segment.panelIds) && segment.panelIds.length
    ? segment.panelIds.slice().sort().join('+')
    : `segment-${index}`;
  return `${templateId}:${prefix}:${owner}:${segmentId(segment, prefix)}`;
}

function applySegmentOverrides(segments, fallback, overrides, prefix, templateId) {
  return segments.map((segment, index) => {
    const id = stableSegmentId(segment, prefix, templateId, index);
    const legacyId = segmentId(segment, prefix);
    const distance = Number(overrides[id] ?? overrides[legacyId] ?? fallback) || 0;
    const shifted = shiftSegment({ ...segment, id }, distance, prefix);
    return { ...shifted, edgeId: id, hingeId: prefix === 'fold' ? id : null };
  });
}

export function buildProductionDieline(model, settings = null) {
  if (!model) throw new Error('A valid box model is required for a production dieline.');
  const prepress = sanitizePrepressSettings(settings);
  const elements = getElements(model).map((element) => ({
    ...clone(element),
    polygon: normalizePolygon(element.polygon || [
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
      { x: element.x, y: element.y + element.height },
    ]),
  }));
  const trimPolygons = elements.map((element) => element.polygon);
  const bleedPolygons = trimPolygons.map((polygon) => offsetPolygon(polygon, prepress.bleedMm)).filter(Boolean);
  const safeDistance = -prepress.safeMm;
  const safePolygons = trimPolygons.map((polygon) => offsetPolygon(polygon, safeDistance)).filter(Boolean);
  const rawSegments = getDielineSegments(model);
  const allowances = prepress.allowances;
  const templateId = model.construction?.templateId || 'legacy-six-panel';
  const productionCut = applySegmentOverrides(
    rawSegments.cut,
    allowances.cutOffsetMm,
    {},
    'cut',
    templateId,
  );
  const productionFold = applySegmentOverrides(
    rawSegments.fold,
    allowances.creaseOffsetMm,
    allowances.hingeOverrides,
    'fold',
    templateId,
  );
  const trimBounds = boundsOf(trimPolygons);
  const bleedBounds = boundsOf(bleedPolygons.length ? bleedPolygons : trimPolygons);
  const mediaBounds = {
    minX: bleedBounds.minX - prepress.slugMm,
    minY: bleedBounds.minY - prepress.slugMm,
    maxX: bleedBounds.maxX + prepress.slugMm,
    maxY: bleedBounds.maxY + prepress.slugMm,
    width: bleedBounds.width + prepress.slugMm * 2,
    height: bleedBounds.height + prepress.slugMm * 2,
  };
  const diagnostics = {
    mode: prepress.mode,
    profileId: prepress.profileId,
    templateId,
    trimBounds,
    bleedBounds,
    mediaBounds,
    elementCount: elements.length,
    cutCount: productionCut.length,
    foldCount: productionFold.length,
    allowancesApplied: prepress.mode === 'production-assist',
    legacyAllowanceWarning: model.construction?.templateId === 'legacy-six-panel'
      && prepress.mode === 'production-assist',
  };
  const invalidPolygon = elements.find((element) => element.polygon.length < 3 || selfIntersects(element.polygon));
  if (invalidPolygon || !bleedPolygons.length && trimPolygons.length) {
    diagnostics.valid = false;
    diagnostics.invalidElement = invalidPolygon?.id || null;
  } else {
    diagnostics.valid = true;
    diagnostics.invalidElement = null;
  }
  return {
    settings: prepress,
    elements,
    trimPolygons,
    bleedPolygons,
    safePolygons,
    cut: productionCut,
    fold: productionFold,
    // `bounds` is the production trim contour for callers that only need the
    // primary page box. The expanded bleed contour is explicit above.
    bounds: trimBounds,
    trimBounds,
    bleedBounds,
    mediaBounds,
    diagnostics,
  };
}

export function getArtworkCorners(artwork) {
  if (!artwork?.hasArtwork && !artwork?.source) return [];
  const width = Number(artwork.unrotatedWidthMm) || 0;
  const height = Number(artwork.unrotatedHeightMm) || 0;
  const angle = Number(artwork.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]]
    .map(([x, y]) => point(
      artwork.centerXmm + x * cos - y * sin,
      artwork.centerYmm + x * sin + y * cos,
    ));
}

export function getPolygonBounds(polygons) {
  return boundsOf(polygons.filter((polygon) => Array.isArray(polygon) && polygon.length));
}

export function offsetPolygonForPrepress(points, distance) {
  return offsetPolygon(points, distance);
}

export const prepressGeometryInternals = Object.freeze({ polygonArea, selfIntersects, segmentId });
