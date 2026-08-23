import { getArcAngles } from '../model/dieline.js';

const EPSILON = 1e-7;
const CONTOUR_JOIN_TOLERANCE = 1e-5;
const ARC_MAX_ANGLE = Math.PI / 96;
const ARC_ANGLE_TOLERANCE = 1e-10;
const TWO_PI = Math.PI * 2;
const AREA_EPSILON = 1e-8;
const COVERAGE_TOLERANCE = 1e-6;

const PRINTABLE_ROLE_PATTERNS = Object.freeze([
  /^BODY\.(?:FRONT|BACK)$/,
  /^BODY\.SIDE\.[^.]+$/,
  /^CLOSURE\.(?:TOP|BOTTOM)\.MAJOR_FLAP$/,
  /^CLOSURE\.(?:TOP|BOTTOM)\.DUST_(?:LEFT|RIGHT)$/,
  /^CLOSURE\.(?:TOP|BOTTOM)\.TUCK_TONGUE$/,
]);

function finite(value) {
  return Number.isFinite(Number(value));
}

function point(value) {
  return {
    x: Number(value?.x),
    y: Number(value?.y),
  };
}

function validPoint(value) {
  return finite(value?.x) && finite(value?.y);
}

function positiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clone(value) {
  return structuredClone(value);
}

function pointsEqual(first, second, tolerance = CONTOUR_JOIN_TOLERANCE) {
  return validPoint(first) && validPoint(second)
    && Math.hypot(first.x - second.x, first.y - second.y) <= tolerance;
}

function cross(first, second, third) {
  return (second.x - first.x) * (third.y - first.y)
    - (second.y - first.y) * (third.x - first.x);
}

function pointOnSegment(value, start, end, tolerance = COVERAGE_TOLERANCE) {
  if (Math.abs(cross(start, end, value)) > tolerance) return false;
  return value.x >= Math.min(start.x, end.x) - tolerance
    && value.x <= Math.max(start.x, end.x) + tolerance
    && value.y >= Math.min(start.y, end.y) - tolerance
    && value.y <= Math.max(start.y, end.y) + tolerance;
}

function orientation(first, second, third) {
  const value = cross(first, second, third);
  if (Math.abs(value) <= EPSILON) return 0;
  return value < 0 ? -1 : 1;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);
  if (firstOrientation !== secondOrientation && thirdOrientation !== fourthOrientation) return true;
  return (firstOrientation === 0 && pointOnSegment(secondStart, firstStart, firstEnd, EPSILON))
    || (secondOrientation === 0 && pointOnSegment(secondEnd, firstStart, firstEnd, EPSILON))
    || (thirdOrientation === 0 && pointOnSegment(firstStart, secondStart, secondEnd, EPSILON))
    || (fourthOrientation === 0 && pointOnSegment(firstEnd, secondStart, secondEnd, EPSILON));
}

function polygonArea(polygon) {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function hasSelfIntersection(polygon) {
  const edgeCount = polygon.length;
  for (let first = 0; first < edgeCount; first += 1) {
    const firstStart = polygon[first];
    const firstEnd = polygon[(first + 1) % edgeCount];
    for (let second = first + 1; second < edgeCount; second += 1) {
      const adjacent = second === first + 1 || (first === 0 && second === edgeCount - 1);
      if (adjacent) continue;
      if (segmentsIntersect(firstStart, firstEnd, polygon[second], polygon[(second + 1) % edgeCount])) return true;
    }
  }
  return false;
}

function flattenArc(segment) {
  const angles = getArcAngles(segment);
  if (!validPoint(angles.center) || !validPoint(angles.start) || !validPoint(angles.end)
    || !finite(angles.radius) || angles.radius <= EPSILON
    || !finite(angles.delta) || angles.delta <= EPSILON || angles.delta > Math.PI * 2 + EPSILON) {
    return null;
  }
  if (Math.abs(Math.hypot(angles.start.x - angles.center.x, angles.start.y - angles.center.y) - angles.radius) > CONTOUR_JOIN_TOLERANCE
    || Math.abs(Math.hypot(angles.end.x - angles.center.x, angles.end.y - angles.center.y) - angles.radius) > CONTOUR_JOIN_TOLERANCE) {
    return null;
  }
  const steps = Math.max(2, Math.ceil(angles.delta / ARC_MAX_ANGLE));
  const signedDelta = (angles.clockwise ? -1 : 1) * angles.delta;
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = angles.startAngle + signedDelta * (index / steps);
    points.push({
      x: angles.center.x + angles.radius * Math.cos(angle),
      y: angles.center.y + angles.radius * Math.sin(angle),
    });
  }
  points[0] = point(segment.start);
  points[points.length - 1] = point(segment.end);
  return points;
}

function normalizeAngle(value) {
  const normalized = value % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function arcFractionForAngle(angle, angles) {
  const directionalDelta = angles.clockwise
    ? normalizeAngle(angles.startAngle - angle)
    : normalizeAngle(angle - angles.startAngle);
  if (directionalDelta > angles.delta + ARC_ANGLE_TOLERANCE) return null;
  return Math.min(1, Math.max(0, directionalDelta / angles.delta));
}

function arcPointAtFraction(angles, fraction) {
  const signedDelta = (angles.clockwise ? -1 : 1) * angles.delta;
  const angle = angles.startAngle + signedDelta * fraction;
  return {
    x: angles.center.x + angles.radius * Math.cos(angle),
    y: angles.center.y + angles.radius * Math.sin(angle),
  };
}

function circleSegmentIntersections(angles, start, end) {
  const vector = { x: end.x - start.x, y: end.y - start.y };
  const offset = { x: start.x - angles.center.x, y: start.y - angles.center.y };
  const a = vector.x * vector.x + vector.y * vector.y;
  if (a <= EPSILON) return [];
  const b = 2 * (offset.x * vector.x + offset.y * vector.y);
  const c = offset.x * offset.x + offset.y * offset.y - angles.radius * angles.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const factors = [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  const points = [];
  for (const factor of factors) {
    if (factor < -EPSILON || factor > 1 + EPSILON) continue;
    const pointOnSegment = {
      x: start.x + vector.x * Math.min(1, Math.max(0, factor)),
      y: start.y + vector.y * Math.min(1, Math.max(0, factor)),
    };
    const fraction = arcFractionForAngle(Math.atan2(
      pointOnSegment.y - angles.center.y,
      pointOnSegment.x - angles.center.x,
    ), angles);
    if (fraction != null) points.push({ fraction, point: pointOnSegment });
  }
  return points;
}

function uniqueFractions(values) {
  return [...new Set(values
    .filter((value) => Number.isFinite(value))
    .sort((first, second) => first - second)
    .map((value) => value.toFixed(12)))].map(Number);
}

function arcBoundaryCoverage(arcs, footprints) {
  for (const segment of arcs) {
    const angles = getArcAngles(segment);
    const fractions = [0, 1];
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const fraction = arcFractionForAngle(angle, angles);
      if (fraction != null) fractions.push(fraction);
    }
    for (const footprint of footprints) {
      for (let index = 0; index < footprint.polygon.length; index += 1) {
        const start = footprint.polygon[index];
        const end = footprint.polygon[(index + 1) % footprint.polygon.length];
        fractions.push(...circleSegmentIntersections(angles, start, end).map((hit) => hit.fraction));
      }
    }
    const events = uniqueFractions(fractions);
    for (const fraction of events) {
      if (!coveredAtPoint(arcPointAtFraction(angles, fraction), footprints)) return 'uncovered';
    }
    for (let index = 0; index + 1 < events.length; index += 1) {
      if (events[index + 1] - events[index] <= ARC_ANGLE_TOLERANCE) continue;
      const midpoint = (events[index] + events[index + 1]) / 2;
      if (!coveredAtPoint(arcPointAtFraction(angles, midpoint), footprints)) return 'uncovered';
    }
  }
  return 'covered';
}

function contourPolygon(surface) {
  const contour = surface?.contour;
  const segments = contour?.segments;
  if (contour?.closed === false || !Array.isArray(segments) || segments.length < 3) {
    return { polygon: null, reason: 'invalid-surface-contour' };
  }

  const polygon = [];
  const arcs = [];
  for (const segment of segments) {
    if (!['LINE', 'ARC'].includes(segment?.kind) || !validPoint(segment.start) || !validPoint(segment.end)) {
      return { polygon: null, reason: 'invalid-surface-contour' };
    }
    if (polygon.length && !pointsEqual(polygon[polygon.length - 1], segment.start)) {
      return { polygon: null, reason: 'invalid-surface-contour' };
    }
    if (!polygon.length) polygon.push(point(segment.start));
    const points = segment.kind === 'ARC' ? flattenArc(segment) : [point(segment.start), point(segment.end)];
    if (!points) return { polygon: null, reason: 'invalid-surface-contour' };
    if (segment.kind === 'ARC') arcs.push(segment);
    polygon.push(...points.slice(1));
  }

  if (!pointsEqual(polygon[polygon.length - 1], polygon[0]) || polygon.length < 4) {
    return { polygon: null, reason: 'invalid-surface-contour' };
  }
  polygon.pop();
  if (Math.abs(polygonArea(polygon)) <= AREA_EPSILON || hasSelfIntersection(polygon)) {
    return { polygon: null, reason: 'invalid-surface-contour' };
  }
  return { polygon, arcs, segments, reason: null };
}

function classifySurface(surface) {
  const role = typeof surface?.role === 'string' ? surface.role : '';
  const kind = typeof surface?.kind === 'string' ? surface.kind : '';
  if (role === 'BODY.SIDE_SEAM.GLUE_FLAP' || kind === 'GLUE_FLAP') {
    return { classification: 'excluded', reason: 'glue-surface' };
  }
  if (/^CLOSURE\.[^.]+\.SNAP_LOCK(?:\.|$)/.test(role)) {
    return { classification: 'excluded', reason: 'locking-surface' };
  }
  if (PRINTABLE_ROLE_PATTERNS.some((pattern) => pattern.test(role))) {
    return { classification: 'printable', reason: null };
  }
  return { classification: 'unknown', reason: 'unknown-semantic-surface' };
}

function modelDimensions(model) {
  const width = Number(model?.unrotatedWidthMm ?? Number(model?.initialWidthMm) * Number(model?.scaleX ?? model?.scale ?? 1));
  const height = Number(model?.unrotatedHeightMm ?? Number(model?.initialHeightMm) * Number(model?.scaleY ?? model?.scale ?? 1));
  const centerX = Number(model?.centerXmm);
  const centerY = Number(model?.centerYmm);
  return { width, height, centerX, centerY };
}

function visibleLocalRect(model, width, height) {
  const candidate = model?.visibleLocalRect;
  if (candidate && typeof candidate === 'object') {
    return {
      x: Number(candidate.x),
      y: Number(candidate.y),
      width: Number(candidate.width),
      height: Number(candidate.height),
    };
  }
  const crop = model?.crop;
  if (!crop) return { x: 0, y: 0, width, height };
  const rawX = Number(crop.x);
  const rawY = Number(crop.y);
  const cropWidth = Number(crop.width);
  const cropHeight = Number(crop.height);
  return {
    x: model?.flipX ? width - rawX - cropWidth : rawX,
    y: model?.flipY ? height - rawY - cropHeight : rawY,
    width: cropWidth,
    height: cropHeight,
  };
}

function artworkFootprint(entry) {
  if (entry?.visible === false || entry?.outputRole === 'finish' || !entry?.model?.source) return null;
  const model = entry.model;
  const { width, height, centerX, centerY } = modelDimensions(model);
  const rect = visibleLocalRect(model, width, height);
  if (![width, height, centerX, centerY, rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || width <= EPSILON || height <= EPSILON || rect.width <= EPSILON || rect.height <= EPSILON) {
    return { invalid: true, artworkId: artworkId(entry) };
  }
  const rotation = Number(model.rotation || 0) * Math.PI / 180;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  return {
    artworkId: artworkId(entry),
    polygon: corners.map((corner) => {
      const localX = corner.x - width / 2;
      const localY = corner.y - height / 2;
      return {
        x: centerX + localX * cosine - localY * sine,
        y: centerY + localX * sine + localY * cosine,
      };
    }),
  };
}

function artworkId(entry, fallbackIndex = 0) {
  return String(entry?.model?.source?.id || entry?.model?.source?.fileName || `artwork-${fallbackIndex + 1}`);
}

function horizontalIntersections(polygon, x) {
  const values = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (Math.abs(end.x - start.x) <= EPSILON) continue;
    const crosses = (start.x <= x && x < end.x) || (end.x <= x && x < start.x);
    if (!crosses) continue;
    const ratio = (x - start.x) / (end.x - start.x);
    values.push(start.y + (end.y - start.y) * ratio);
  }
  values.sort((first, second) => first - second);
  const intervals = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    if (values[index + 1] - values[index] > COVERAGE_TOLERANCE) {
      intervals.push({ start: values[index], end: values[index + 1] });
    }
  }
  return intervals;
}

function horizontalIntersectionsContour(segments, x) {
  const values = [];
  for (const segment of segments) {
    if (segment.kind === 'LINE') {
      const start = point(segment.start);
      const end = point(segment.end);
      if (Math.abs(end.x - start.x) <= EPSILON) continue;
      const crosses = (start.x <= x && x < end.x) || (end.x <= x && x < start.x);
      if (!crosses) continue;
      const ratio = (x - start.x) / (end.x - start.x);
      values.push(start.y + (end.y - start.y) * ratio);
      continue;
    }
    const angles = getArcAngles(segment);
    const distance = x - angles.center.x;
    if (Math.abs(distance) > angles.radius + COVERAGE_TOLERANCE) continue;
    const height = Math.sqrt(Math.max(0, angles.radius * angles.radius - distance * distance));
    for (const y of [angles.center.y - height, angles.center.y + height]) {
      const fraction = arcFractionForAngle(Math.atan2(y - angles.center.y, distance), angles);
      if (fraction != null) values.push(y);
    }
  }
  const sortedValues = [...new Set(values
    .filter(Number.isFinite)
    .sort((first, second) => first - second)
    .map((value) => value.toFixed(12)))].map(Number);
  const intervals = [];
  for (let index = 0; index + 1 < sortedValues.length; index += 2) {
    if (sortedValues[index + 1] - sortedValues[index] > COVERAGE_TOLERANCE) {
      intervals.push({ start: sortedValues[index], end: sortedValues[index + 1] });
    }
  }
  return intervals;
}

function pointInPolygon(value, polygon) {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(value, polygon[index], polygon[(index + 1) % polygon.length])) return true;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    const intersects = ((current.y > value.y) !== (prior.y > value.y))
      && value.x < ((prior.x - current.x) * (value.y - current.y)) / (prior.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function coveredAtPoint(value, footprints) {
  return footprints.some((footprint) => pointInPolygon(value, footprint.polygon));
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((interval) => interval.end - interval.start > COVERAGE_TOLERANCE)
    .sort((first, second) => first.start - second.start || first.end - second.end);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end + COVERAGE_TOLERANCE) merged.push({ ...interval });
    else last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

function intervalCovered(interval, coverage) {
  return coverage.some((candidate) => (
    candidate.start <= interval.start + COVERAGE_TOLERANCE
    && candidate.end >= interval.end - COVERAGE_TOLERANCE
  ));
}

function segmentIntersection(firstStart, firstEnd, secondStart, secondEnd) {
  const firstVector = { x: firstEnd.x - firstStart.x, y: firstEnd.y - firstStart.y };
  const secondVector = { x: secondEnd.x - secondStart.x, y: secondEnd.y - secondStart.y };
  const denominator = firstVector.x * secondVector.y - firstVector.y * secondVector.x;
  if (Math.abs(denominator) <= EPSILON) return null;
  const dx = secondStart.x - firstStart.x;
  const dy = secondStart.y - firstStart.y;
  const firstFactor = (dx * secondVector.y - dy * secondVector.x) / denominator;
  const secondFactor = (dx * firstVector.y - dy * firstVector.x) / denominator;
  if (firstFactor < -EPSILON || firstFactor > 1 + EPSILON || secondFactor < -EPSILON || secondFactor > 1 + EPSILON) return null;
  return { x: firstStart.x + firstFactor * firstVector.x, y: firstStart.y + firstFactor * firstVector.y };
}

function coverageForSurface(contour, footprints) {
  if (!footprints.length) return { status: 'uncovered' };
  if (contour.segments.some((segment) => (
    !coveredAtPoint(point(segment.start), footprints)
    || !coveredAtPoint(point(segment.end), footprints)
  ))) {
    return { status: 'uncovered' };
  }
  const arcStatus = arcBoundaryCoverage(contour.arcs, footprints);
  if (arcStatus === 'uncovered') return { status: 'uncovered' };

  const xEvents = contour.segments.flatMap((segment) => [Number(segment.start.x), Number(segment.end.x)]);
  for (const segment of contour.arcs) {
    const angles = getArcAngles(segment);
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const fraction = arcFractionForAngle(angle, angles);
      if (fraction != null) xEvents.push(arcPointAtFraction(angles, fraction).x);
    }
  }
  for (const footprint of footprints) {
    xEvents.push(...footprint.polygon.map((value) => value.x));
    for (const surfaceSegment of contour.segments) {
      const firstStart = point(surfaceSegment.start);
      const firstEnd = point(surfaceSegment.end);
      for (let second = 0; second < footprint.polygon.length; second += 1) {
        const secondStart = footprint.polygon[second];
        const secondEnd = footprint.polygon[(second + 1) % footprint.polygon.length];
        if (surfaceSegment.kind === 'ARC') {
          const angles = getArcAngles(surfaceSegment);
          xEvents.push(...circleSegmentIntersections(angles, secondStart, secondEnd)
            .map((hit) => hit.point.x));
        } else {
          const hit = segmentIntersection(firstStart, firstEnd, secondStart, secondEnd);
          if (hit) xEvents.push(hit.x);
        }
      }
    }
  }
  const sortedEvents = [...new Set(xEvents
    .filter(Number.isFinite)
    .sort((first, second) => first - second)
    .map((value) => value.toFixed(9)))].map(Number);
  for (let index = 0; index + 1 < sortedEvents.length; index += 1) {
    const start = sortedEvents[index];
    const end = sortedEvents[index + 1];
    if (end - start <= COVERAGE_TOLERANCE) continue;
    const x = (start + end) / 2;
    const surfaceIntervals = horizontalIntersectionsContour(contour.segments, x);
    const coverage = mergeIntervals(footprints.flatMap((footprint) => horizontalIntersections(footprint.polygon, x)));
    if (surfaceIntervals.some((interval) => !intervalCovered(interval, coverage))) {
      return { status: contour.arcs.length ? 'unknown' : 'uncovered' };
    }
  }
  if (arcStatus === 'covered') return { status: 'covered' };
  return { status: contour.arcs.length ? 'unknown' : 'covered' };
}

function qualityForArtwork(entry, index, requiredDpi) {
  const source = entry?.model?.source || {};
  const id = artworkId(entry, index);
  const name = String(source.fileName || id);
  const vector = source.vector === true || source.mimeType === 'application/pdf';
  if (vector) return { artworkId: id, name, quality: 'vector', dpi: null, issues: [] };

  let dpi = null;
  const hasEffectiveDpi = typeof entry?.model?.getEffectiveDpi === 'function';
  if (hasEffectiveDpi) {
    try {
      const reportedDpi = entry.model.getEffectiveDpi();
      if (positiveFiniteNumber(reportedDpi)) dpi = reportedDpi;
    } catch {
      dpi = null;
    }
  }
  if (!hasEffectiveDpi && !positiveFiniteNumber(dpi)) {
    const { width, height } = modelDimensions(entry.model);
    const rect = visibleLocalRect(entry.model, width, height);
    const widthPx = Number(source.widthPx);
    const heightPx = Number(source.heightPx);
    if ([width, height, rect.width, rect.height, widthPx, heightPx].every(Number.isFinite)
      && width > EPSILON && height > EPSILON && rect.width > EPSILON && rect.height > EPSILON
      && widthPx > 0 && heightPx > 0) {
      dpi = Math.min(
        (widthPx * (rect.width / width)) / (rect.width / 25.4),
        (heightPx * (rect.height / height)) / (rect.height / 25.4),
      );
    }
  }
  if (!positiveFiniteNumber(dpi)) {
    return { artworkId: id, name, quality: 'unknown', dpi: null, issues: ['dpi-unknown'] };
  }
  if (dpi < requiredDpi) {
    return {
      artworkId: id,
      name,
      quality: 'warning',
      dpi,
      issues: ['dpi-below-recommended'],
    };
  }
  return { artworkId: id, name, quality: 'pass', dpi, issues: [] };
}

function sortById(items) {
  return items.sort((first, second) => String(first.id || first.artworkId).localeCompare(String(second.id || second.artworkId)));
}

function sortIssues(issues) {
  return issues.sort((first, second) => (
    String(first.code).localeCompare(String(second.code))
    || String(first.surfaceId || first.artworkId || '').localeCompare(String(second.surfaceId || second.artworkId || ''))
  ));
}

/**
 * Analyze Technical artwork coverage and source quality without changing any
 * CartonDocument or ArtworkModel state. The contour is flattened only inside
 * this diagnostic boundary; exports continue to consume the canonical LINE/ARC
 * geometry unchanged.
 */
export function analyzeTechnicalArtworkPreflight({ carton, artworks = [], requiredDpi = 300 } = {}) {
  const dpiRequirement = Number.isFinite(Number(requiredDpi)) && Number(requiredDpi) > 0
    ? Number(requiredDpi)
    : 300;
  const report = {
    mode: 'technical',
    requiredDpi: dpiRequirement,
    printableSurfaces: [],
    excludedSurfaces: [],
    unknownSurfaces: [],
    artworkQuality: [],
    issues: [],
    summary: { covered: 0, uncovered: 0, unknown: 0 },
  };
  const visiblePrintEntries = (Array.isArray(artworks) ? artworks : [])
    .filter((entry) => entry?.visible !== false && entry?.outputRole !== 'finish' && entry?.model?.source);
  const footprints = [];
  for (const [index, entry] of visiblePrintEntries.entries()) {
    const footprint = artworkFootprint(entry);
    if (footprint?.polygon) footprints.push(footprint);
    report.artworkQuality.push(qualityForArtwork(entry, index, dpiRequirement));
  }

  let surfaces = [];
  let cartonInvalid = false;
  try {
    if (!carton || typeof carton.getArtworkSurfaces !== 'function') {
      cartonInvalid = true;
    } else {
      const candidate = carton.getArtworkSurfaces();
      if (Array.isArray(candidate)) surfaces = candidate;
      else cartonInvalid = true;
    }
  } catch {
    cartonInvalid = true;
  }
  if (cartonInvalid) {
    report.unknownSurfaces.push({
      id: 'technical-carton',
      status: 'unknown',
      reason: 'technical-carton-invalid',
    });
    report.summary.unknown += 1;
    report.issues.push({ code: 'technical-carton-invalid', severity: 'warning' });
  }
  for (const surface of [...surfaces].sort((first, second) => String(first?.id || '').localeCompare(String(second?.id || '')))) {
    const id = String(surface?.id || '');
    const classification = classifySurface(surface);
    const base = { id, role: surface?.role || null, kind: surface?.kind || null };
    if (classification.classification === 'excluded') {
      report.excludedSurfaces.push({ ...base, reason: classification.reason });
      continue;
    }
    const contour = contourPolygon(surface);
    if (classification.classification === 'unknown') {
      report.unknownSurfaces.push({ ...base, status: 'unknown', reason: classification.reason });
      report.summary.unknown += 1;
      report.issues.push({ code: classification.reason, severity: 'warning', surfaceId: id });
      continue;
    }
    if (!contour.polygon) {
      report.printableSurfaces.push({ ...base, status: 'unknown', covered: false, reason: contour.reason });
      report.summary.unknown += 1;
      report.issues.push({ code: contour.reason, severity: 'warning', surfaceId: id });
      continue;
    }
    const coverage = coverageForSurface(contour, footprints);
    report.printableSurfaces.push({
      ...base,
      status: coverage.status,
      covered: coverage.status === 'covered',
      reason: coverage.status === 'covered'
        ? null
        : coverage.status === 'unknown' ? 'coverage-not-provable' : 'uncovered-printable-surface',
      algorithm: 'line-arc-contour-scanline-union',
    });
    report.summary[coverage.status] += 1;
    if (coverage.status === 'uncovered') {
      report.issues.push({ code: 'uncovered-printable-surface', severity: 'warning', surfaceId: id });
    } else if (coverage.status === 'unknown') {
      report.issues.push({ code: 'coverage-not-provable', severity: 'warning', surfaceId: id });
    }
  }

  for (const quality of report.artworkQuality) {
    for (const code of quality.issues) {
      report.issues.push({
        code,
        severity: 'warning',
        artworkId: quality.artworkId,
        name: quality.name,
        ...(quality.dpi == null ? {} : { dpi: quality.dpi }),
      });
    }
  }
  sortById(report.printableSurfaces);
  sortById(report.excludedSurfaces);
  sortById(report.unknownSurfaces);
  report.artworkQuality.sort((first, second) => first.artworkId.localeCompare(second.artworkId));
  sortIssues(report.issues);
  return report;
}

export const createTechnicalArtworkPreflight = analyzeTechnicalArtworkPreflight;
export const runTechnicalArtworkPreflight = analyzeTechnicalArtworkPreflight;
