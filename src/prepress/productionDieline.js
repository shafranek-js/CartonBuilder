import { getDielineSegments } from '../model/dieline.js';
import { sanitizePrepressSettings } from './prepressState.js';
import { AppError } from '../errors.js';

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

function boundsOfPolygon(points) {
  const xs = points.map((entry) => entry.x);
  const ys = points.map((entry) => entry.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function withPolygon(element, polygon) {
  const bounds = boundsOfPolygon(polygon);
  return {
    ...element,
    polygon,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function applyGlueDelta(element, delta) {
  if (!delta || element.role !== 'glue-tab' || !element.hinge?.childPoint) return element;
  const polygon = clone(element.polygon);
  const hinge = element.hinge;
  const vertical = Math.abs(Number(hinge.axis?.[1])) >= Math.abs(Number(hinge.axis?.[0]));
  const coordinate = vertical ? Number(hinge.childPoint.x) : Number(hinge.childPoint.y);
  const distances = polygon.map((entry) => Math.abs((vertical ? entry.x : entry.y) - coordinate));
  const width = Math.max(...distances);
  if (width <= EPSILON) return element;
  const nextWidth = Math.max(0.1, width + delta);
  const scale = nextWidth / width;
  for (const entry of polygon) {
    if (vertical) entry.x = coordinate + (entry.x - coordinate) * scale;
    else entry.y = coordinate + (entry.y - coordinate) * scale;
  }
  return withPolygon(element, normalizePolygon(polygon));
}

function applyTuckClearance(element, delta) {
  if (!delta || element.role !== 'tuck-flap' || !element.hinge?.childPoint) return element;
  const polygon = clone(element.polygon);
  const hinge = element.hinge;
  const horizontal = Math.abs(Number(hinge.axis?.[0])) >= Math.abs(Number(hinge.axis?.[1]));
  if (!horizontal) return element;
  const hingeY = Number(hinge.childPoint.y);
  const centerX = Number(hinge.childPoint.x);
  const free = polygon.filter((entry) => Math.abs(entry.y - hingeY) > EPSILON);
  if (!free.length) return element;
  const left = centerX - Math.min(...free.map((entry) => entry.x));
  const right = Math.max(...free.map((entry) => entry.x)) - centerX;
  const effective = Math.min(delta, Math.max(0, Math.min(left, right) - 0.1));
  for (const entry of polygon) {
    if (Math.abs(entry.y - hingeY) <= EPSILON) continue;
    if (entry.x < centerX - EPSILON) entry.x += effective;
    else if (entry.x > centerX + EPSILON) entry.x -= effective;
  }
  return withPolygon(element, normalizePolygon(polygon));
}

function applyElementAllowances(elements, prepress) {
  if (prepress.mode !== 'production-assist') return elements;
  return elements.map((element) => applyTuckClearance(
    applyGlueDelta(element, prepress.allowances.glueTabDeltaMm),
    prepress.allowances.tuckClearanceDeltaMm,
  ));
}

function pointKey(entry) {
  return `${Number(entry.x).toFixed(7)},${Number(entry.y).toFixed(7)}`;
}

function mergeCollinearSegments(segments) {
  const groups = new Map();
  const sourcePoints = segments.flatMap((segment) => [segment.start, segment.end]);
  for (const segment of segments) {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) continue;
    let ux = dx / length;
    let uy = dy / length;
    if (ux < -EPSILON || Math.abs(ux) <= EPSILON && uy < 0) {
      ux = -ux;
      uy = -uy;
    }
    const nx = -uy;
    const ny = ux;
    const lineOffset = nx * segment.start.x + ny * segment.start.y;
    const key = `${ux.toFixed(7)},${uy.toFixed(7)},${lineOffset.toFixed(7)}`;
    const startProjection = ux * segment.start.x + uy * segment.start.y;
    const endProjection = ux * segment.end.x + uy * segment.end.y;
    const group = groups.get(key) || { ux, uy, intervals: [] };
    group.intervals.push({
      min: Math.min(startProjection, endProjection),
      max: Math.max(startProjection, endProjection),
      minPoint: startProjection <= endProjection ? segment.start : segment.end,
      maxPoint: startProjection <= endProjection ? segment.end : segment.start,
      panelIds: segment.panelIds || [],
    });
    groups.set(key, group);
  }

  const merged = [];
  for (const group of groups.values()) {
    group.intervals.sort((a, b) => a.min - b.min);
    let current = null;
    for (const interval of group.intervals) {
      if (!current || interval.min > current.max + EPSILON) {
        if (current) merged.push(current);
        current = { ...interval, panelIds: [...new Set(interval.panelIds)] };
        continue;
      }
      if (interval.max > current.max) {
        current.max = interval.max;
        current.maxPoint = interval.maxPoint;
      }
      current.panelIds = [...new Set([...current.panelIds, ...interval.panelIds])];
    }
    if (current) merged.push(current);
  }
  const split = [];
  for (const entry of merged) {
    const start = point(entry.minPoint.x, entry.minPoint.y);
    const end = point(entry.maxPoint.x, entry.maxPoint.y);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const points = sourcePoints
      .map((candidate) => {
        const projection = ((candidate.x - start.x) * dx + (candidate.y - start.y) * dy) / lengthSquared;
        const crossDistance = (candidate.x - start.x) * dy - (candidate.y - start.y) * dx;
        return Math.abs(crossDistance) <= EPSILON && projection >= -EPSILON && projection <= 1 + EPSILON
          ? { projection, point: candidate }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.projection - b.projection);
    const unique = [];
    for (const candidate of points) {
      if (!unique.length || Math.abs(candidate.projection - unique.at(-1).projection) > EPSILON) {
        unique.push(candidate);
      }
    }
    for (let index = 1; index < unique.length; index += 1) {
      const segmentStart = unique[index - 1].point;
      const segmentEnd = unique[index].point;
      if (Math.hypot(segmentEnd.x - segmentStart.x, segmentEnd.y - segmentStart.y) > EPSILON) {
        split.push({
          start: point(segmentStart.x, segmentStart.y),
          end: point(segmentEnd.x, segmentEnd.y),
          panelIds: entry.panelIds,
        });
      }
    }
  }
  return split;
}

function buildClosedCutLoops(segments) {
  const mergedSegments = mergeCollinearSegments(segments);
  const vertices = new Map();
  mergedSegments.forEach((segment, index) => {
    for (const endpoint of [segment.start, segment.end]) {
      const key = pointKey(endpoint);
      const vertex = vertices.get(key) || { point: point(endpoint.x, endpoint.y), edges: [] };
      vertex.edges.push(index);
      vertices.set(key, vertex);
    }
  });
  if ([...vertices.values()].some((vertex) => vertex.edges.length !== 2)) return null;

  const unused = new Set(mergedSegments.map((_, index) => index));
  const loops = [];
  while (unused.size) {
    const firstIndex = unused.values().next().value;
    const first = mergedSegments[firstIndex];
    const startKey = pointKey(first.start);
    let currentKey = pointKey(first.end);
    let previousIndex = firstIndex;
    const polygon = [point(first.start.x, first.start.y), point(first.end.x, first.end.y)];
    unused.delete(firstIndex);
    while (currentKey !== startKey) {
      const vertex = vertices.get(currentKey);
      const nextIndex = vertex.edges.find((index) => index !== previousIndex && unused.has(index));
      if (nextIndex == null) return null;
      const next = mergedSegments[nextIndex];
      const nextStartKey = pointKey(next.start);
      const endpoint = nextStartKey === currentKey ? next.end : next.start;
      currentKey = pointKey(endpoint);
      polygon.push(point(endpoint.x, endpoint.y));
      previousIndex = nextIndex;
      unused.delete(nextIndex);
      if (polygon.length > mergedSegments.length + 1) return null;
    }
    polygon.pop();
    const normalized = normalizePolygon(polygon);
    if (normalized.length < 3 || selfIntersects(normalized)) return null;
    loops.push(normalized);
  }
  return loops;
}

function offsetCutSegments(segments, distance, templateId) {
  if (!distance) return { segments: applySegmentOverrides(segments, 0, {}, 'cut', templateId), valid: true };
  const loops = buildClosedCutLoops(segments);
  if (!loops) {
    const vertices = new Map();
    const shifted = segments.map((segment, index) => {
      const result = shiftSegment({ ...segment, id: `${templateId}:cut:${index}` }, distance, 'cut');
      for (const endpoint of ['start', 'end']) {
        const key = pointKey(segment[endpoint]);
        const vertex = vertices.get(key) || { original: segment[endpoint], entries: [] };
        vertex.entries.push({ result, endpoint });
        vertices.set(key, vertex);
      }
      result.edgeId = `${templateId}:cut:${index}`;
      result.hingeId = null;
      return result;
    });
    if ([...vertices.values()].some((vertex) => vertex.entries.length < 2)) {
      return { segments: [], valid: false };
    }
    for (const vertex of vertices.values()) {
      const intersections = [];
      for (let first = 0; first < vertex.entries.length; first += 1) {
        const a = vertex.entries[first].result;
        for (let second = first + 1; second < vertex.entries.length; second += 1) {
          const b = vertex.entries[second].result;
          const intersection = lineIntersection(a.start, a.end, b.start, b.end);
          if (intersection) intersections.push(intersection);
        }
      }
      const joined = intersections.length
        ? point(
            intersections.reduce((sum, entry) => sum + entry.x, 0) / intersections.length,
            intersections.reduce((sum, entry) => sum + entry.y, 0) / intersections.length,
          )
        : point(
            vertex.entries.reduce((sum, entry) => sum + entry.result[entry.endpoint].x, 0) / vertex.entries.length,
            vertex.entries.reduce((sum, entry) => sum + entry.result[entry.endpoint].y, 0) / vertex.entries.length,
          );
      for (const entry of vertex.entries) entry.result[entry.endpoint] = { ...joined };
    }
    return { segments: shifted, valid: true };
  }
  const shifted = [];
  for (let loopIndex = 0; loopIndex < loops.length; loopIndex += 1) {
    const polygon = offsetPolygon(loops[loopIndex], distance);
    if (!polygon) return { segments: [], valid: false };
    polygon.forEach((start, index) => {
      const end = polygon[(index + 1) % polygon.length];
      shifted.push({
        start: point(start.x, start.y),
        end: point(end.x, end.y),
        panelIds: [],
        id: `${templateId}:cut:loop-${loopIndex}:edge-${index}`,
        edgeId: `${templateId}:cut:loop-${loopIndex}:edge-${index}`,
        hingeId: null,
      });
    });
  }
  return { segments: shifted, valid: true };
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
  if (model.mode === 'technical') {
    throw new AppError('technicalPrepressUnavailable');
  }
  const prepress = sanitizePrepressSettings(settings);
  const baseElements = getElements(model).map((element) => ({
    ...clone(element),
    polygon: normalizePolygon(element.polygon || [
      { x: element.x, y: element.y },
      { x: element.x + element.width, y: element.y },
      { x: element.x + element.width, y: element.y + element.height },
      { x: element.x, y: element.y + element.height },
    ]),
  }));
  const elements = applyElementAllowances(baseElements, prepress);
  const trimPolygons = elements.map((element) => element.polygon);
  const bleedPolygons = trimPolygons.map((polygon) => offsetPolygon(polygon, prepress.bleedMm)).filter(Boolean);
  const safeDistance = -prepress.safeMm;
  const safePolygons = trimPolygons.map((polygon) => offsetPolygon(polygon, safeDistance)).filter(Boolean);
  const rawSegments = getDielineSegments({ getElements: () => elements });
  // Technical proof is a compatibility view: production compensation is
  // derived only in production-assist mode and never changes the legacy
  // proof geometry.
  const allowances = prepress.mode === 'production-assist'
    ? prepress.allowances
    : { cutOffsetMm: 0, creaseOffsetMm: 0, hingeOverrides: {} };
  const templateId = model.construction?.templateId || 'legacy-six-panel';
  const cutResult = offsetCutSegments(
    rawSegments.cut,
    prepress.mode === 'production-assist' ? allowances.cutOffsetMm : 0,
    templateId,
  );
  const productionCut = cutResult.segments;
  const productionFold = applySegmentOverrides(
    rawSegments.fold,
    prepress.mode === 'production-assist' ? allowances.creaseOffsetMm : 0,
    prepress.mode === 'production-assist' ? allowances.hingeOverrides : {},
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
  if (!cutResult.valid || invalidPolygon || !bleedPolygons.length && trimPolygons.length) {
    diagnostics.valid = false;
    diagnostics.invalidElement = invalidPolygon?.id || (!cutResult.valid ? 'cut-contour' : null);
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
