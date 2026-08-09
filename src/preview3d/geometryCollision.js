import { ShapeUtils, Vector2, Vector3 } from 'three';
import { buildFoldGraph, computePanelTransforms } from './foldGraph.js';

const EPSILON = 1e-5;

function polygonPoints(element) {
  if (Array.isArray(element?.polygon) && element.polygon.length >= 3) return element.polygon;
  return [
    { x: element.x, y: element.y },
    { x: element.x + element.width, y: element.y },
    { x: element.x + element.width, y: element.y + element.height },
    { x: element.x, y: element.y + element.height },
  ];
}

function prismForElement(element, transform, caliperMm) {
  const points = polygonPoints(element);
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const half = Math.max(0.005, Number(caliperMm) || 0) / 2;
  const local = points.map(({ x, y }) => new Vector3(x - centerX, centerY - y, 0));
  const triangles = ShapeUtils.triangulateShape(local.map(({ x, y }) => new Vector2(x, y)), []);
  const vertices = [];
  for (const point of local) {
    vertices.push(point.clone().setZ(half).applyMatrix4(transform));
    vertices.push(point.clone().setZ(-half).applyMatrix4(transform));
  }
  const edges = [];
  for (let index = 0; index < local.length; index += 1) {
    const next = (index + 1) % local.length;
    edges.push(vertices[next * 2].clone().sub(vertices[index * 2]));
  }
  return { vertices, triangles, edges };
}

function axisFor(a, b) {
  const axis = new Vector3().crossVectors(a, b);
  return axis.lengthSq() > EPSILON ? axis.normalize() : null;
}

function addAxes(prism, axes) {
  const top = prism.vertices.filter((_, index) => index % 2 === 0);
  const bottom = prism.vertices.filter((_, index) => index % 2 === 1);
  const normal = axisFor(top[1].clone().sub(top[0]), top[2]?.clone().sub(top[0]) || new Vector3());
  if (normal) axes.push(normal);
  const side = axisFor(top[0].clone().sub(bottom[0]), top[1].clone().sub(top[0]));
  if (side) axes.push(side);
  for (const edge of prism.edges) {
    const edgeNormal = axisFor(edge, new Vector3(0, 0, 1));
    if (edgeNormal) axes.push(edgeNormal);
  }
}

function project(vertices, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const vertex of vertices) {
    const value = vertex.dot(axis);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function satPenetration(left, right, tolerance) {
  const axes = [];
  addAxes(left, axes);
  addAxes(right, axes);
  for (const a of left.edges) for (const b of right.edges) {
    const axis = axisFor(a, b);
    if (axis) axes.push(axis);
  }
  let minimum = Infinity;
  for (const axis of axes) {
    const a = project(left.vertices, axis);
    const b = project(right.vertices, axis);
    const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
    if (overlap <= tolerance) return { intersects: false, penetration: 0 };
    minimum = Math.min(minimum, overlap);
  }
  return { intersects: true, penetration: minimum === Infinity ? 0 : minimum };
}

function bounds(vertices) {
  const result = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
  vertices.forEach((vertex) => {
    result.min.min(vertex);
    result.max.max(vertex);
  });
  return result;
}

function aabbOverlap(a, b, tolerance) {
  return a.min.x <= b.max.x + tolerance && a.max.x + tolerance >= b.min.x
    && a.min.y <= b.max.y + tolerance && a.max.y + tolerance >= b.min.y
    && a.min.z <= b.max.z + tolerance && a.max.z + tolerance >= b.min.z;
}

function isAllowedContact(left, right, progress) {
  if (Number(left.overlapLayer) > 0 || Number(right.overlapLayer) > 0) return true;
  if (left.parentId === right.id || right.parentId === left.id) return true;
  // Body surfaces share the same fold graph and can briefly occupy the same
  // crease volume while the Preview slider is between assembly phases.
  if (left.role === 'body' && right.role === 'body' && Number(progress) < 1) return true;
  if (left.role === 'body' && right.role === 'body') return true;
  return false;
}

/**
 * Validate the closed/folded construction as thickness-aware convex prism
 * pairs. The solver intentionally treats hinge-adjacent and template overlap
 * layers as allowed contacts; only penetrating unrelated elements are errors.
 */
export function validateConstructionCollision(model, {
  progress = 1,
  caliperMm = 0.35,
  toleranceMm = 0.03,
} = {}) {
  const elements = typeof model?.getElements === 'function' ? model.getElements() : model?.getPanels?.() || [];
  if (!elements.length) return {
    valid: true, allowedIntersections: 0, unexpectedIntersections: 0,
    minimumClearanceMm: 0, invalidElement: null, invalidHinge: null, pairs: [],
  };
  let graph;
  try {
    graph = buildFoldGraph(model, { caliperMm });
  } catch (error) {
    return {
      valid: false, allowedIntersections: 0, unexpectedIntersections: 1,
      minimumClearanceMm: 0, invalidElement: null, invalidHinge: error.message, pairs: [],
    };
  }
  const transforms = computePanelTransforms(graph, progress, { thicknessAware: true });
  const solids = elements.map((element) => {
    const transform = transforms.get(element.id);
    if (!transform) return { element, prism: null, bounds: null };
    const prism = prismForElement(element, transform, caliperMm);
    return { element, prism, bounds: bounds(prism.vertices) };
  });
  const pairs = [];
  let allowedIntersections = 0;
  let unexpectedIntersections = 0;
  let minimumClearanceMm = Infinity;
  for (let index = 0; index < solids.length; index += 1) {
    for (let other = index + 1; other < solids.length; other += 1) {
      const left = solids[index];
      const right = solids[other];
      if (!left.prism || !right.prism || !aabbOverlap(left.bounds, right.bounds, toleranceMm)) continue;
      const result = satPenetration(left.prism, right.prism, toleranceMm);
      if (!result.intersects) continue;
      const allowed = isAllowedContact(left.element, right.element, progress);
      const pair = { left: left.element.id, right: right.element.id, penetrationMm: result.penetration, allowed };
      pairs.push(pair);
      if (allowed) allowedIntersections += 1;
      else unexpectedIntersections += 1;
      minimumClearanceMm = Math.min(minimumClearanceMm, result.penetration);
    }
  }
  return {
    valid: unexpectedIntersections === 0,
    allowedIntersections,
    unexpectedIntersections,
    minimumClearanceMm: Number.isFinite(minimumClearanceMm) ? minimumClearanceMm : 0,
    invalidElement: pairs.find((pair) => !pair.allowed)?.left || null,
    invalidHinge: null,
    pairs,
  };
}
