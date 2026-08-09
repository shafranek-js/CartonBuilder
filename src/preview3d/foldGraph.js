import { Matrix4, Vector3 } from 'three';

const HALF_PI = Math.PI / 2;
const EPSILON = 1e-7;

const EDGE_GEOMETRY = Object.freeze({
  top: Object.freeze({
    axis: Object.freeze([1, 0, 0]),
    parentOffset(panel) {
      return [0, panel.height / 2, 0];
    },
    childOffset(panel) {
      return [0, panel.height / 2, 0];
    },
  }),
  right: Object.freeze({
    axis: Object.freeze([0, 1, 0]),
    parentOffset(panel) {
      return [panel.width / 2, 0, 0];
    },
    childOffset(panel) {
      return [panel.width / 2, 0, 0];
    },
  }),
  bottom: Object.freeze({
    axis: Object.freeze([1, 0, 0]),
    parentOffset(panel) {
      return [0, -panel.height / 2, 0];
    },
    childOffset(panel) {
      return [0, -panel.height / 2, 0];
    },
  }),
  left: Object.freeze({
    axis: Object.freeze([0, 1, 0]),
    parentOffset(panel) {
      return [-panel.width / 2, 0, 0];
    },
    childOffset(panel) {
      return [-panel.width / 2, 0, 0];
    },
  }),
});

function vectorEquals(left, right, epsilon = EPSILON) {
  return left.every((value, index) => Math.abs(value - right[index]) <= epsilon);
}

function matrixFromBasis(basis) {
  const matrix = new Matrix4();
  matrix.makeBasis(
    new Vector3(...basis.right),
    new Vector3(...basis.up),
    new Vector3(...basis.normal),
  );
  return matrix;
}

function basisFromMatrix(matrix) {
  const right = new Vector3();
  const up = new Vector3();
  const normal = new Vector3();
  matrix.extractBasis(right, up, normal);
  return {
    right: right.toArray(),
    up: up.toArray(),
    normal: normal.toArray(),
  };
}

function rotatedBasis(parentBasis, axis, angle) {
  const parentMatrix = matrixFromBasis(parentBasis);
  const rotation = new Matrix4().makeRotationAxis(new Vector3(...axis), angle);
  return basisFromMatrix(parentMatrix.multiply(rotation));
}

function findTargetAngle(parent, child, edge) {
  const definition = EDGE_GEOMETRY[edge];
  if (!definition) throw new Error(`Invalid hinge edge: ${edge}`);

  for (const angle of [-HALF_PI, HALF_PI]) {
    const candidate = rotatedBasis(parent.basis, definition.axis, angle);
    if (
      vectorEquals(candidate.right, child.basis.right)
      && vectorEquals(candidate.up, child.basis.up)
      && vectorEquals(candidate.normal, child.basis.normal)
    ) {
      return angle;
    }
  }

  throw new Error(`Panel ${child.id} basis does not match hinge ${parent.id}.${edge}.`);
}

function normalizePanels(source) {
  if (source?.construction?.templateId && source.construction.templateId !== 'legacy-six-panel'
    && typeof source.getElements === 'function') {
    return source.getElements();
  }
  const panels = typeof source?.getPanels === 'function'
    ? source.getPanels()
    : source?.panels;
  if (!Array.isArray(panels) || panels.length !== 6) {
    throw new Error('A complete six-panel box model is required for 3D preview.');
  }
  return panels;
}

export function buildFoldGraph(source, { caliperMm = 0 } = {}) {
  const panels = normalizePanels(source);
  const polygonal = source?.construction?.templateId && source.construction.templateId !== 'legacy-six-panel';
  const nodes = new Map();
  let rootId = null;

  for (const panel of panels) {
    if (!panel?.id || nodes.has(panel.id)) {
      throw new Error('Every 3D panel must have a unique id.');
    }
    nodes.set(panel.id, {
      id: panel.id,
      panel,
      parentId: panel.parentId || null,
      parentEdge: panel.parentEdge || null,
      axis: null,
      targetAngle: 0,
      parentOffset: [0, 0, 0],
      centerOffset: [0, 0, 0],
      children: [],
    });
  }

  for (const node of nodes.values()) {
    if (!node.parentId) {
      if (rootId || node.id !== 'front') {
        throw new Error('The Front Panel must be the only 3D root.');
      }
      rootId = node.id;
      continue;
    }

    const parent = nodes.get(node.parentId);
    if (polygonal) {
      const hinge = node.panel.hinge;
      if (!parent || !hinge) throw new Error(`Invalid polygon hinge relationship for ${node.id}.`);
      const parentCenter = {
        x: parent.panel.x + parent.panel.width / 2,
        y: parent.panel.y + parent.panel.height / 2,
      };
      const childCenter = {
        x: node.panel.x + node.panel.width / 2,
        y: node.panel.y + node.panel.height / 2,
      };
      node.axis = [Number(hinge.axis?.[0]) || 0, Number(hinge.axis?.[1]) || 0, 0];
      node.targetAngle = Number(node.panel.foldAngleDeg || 0) * Math.PI / 180;
      node.parentOffset = [
        Number(hinge.parentPoint.x) - parentCenter.x,
        parentCenter.y - Number(hinge.parentPoint.y),
        0,
      ];
      node.centerOffset = [
        childCenter.x - Number(hinge.childPoint.x),
        Number(hinge.childPoint.y) - childCenter.y,
        0,
      ];
      parent.children.push(node.id);
      continue;
    }
    const definition = EDGE_GEOMETRY[node.parentEdge];
    if (!parent || !definition) {
      throw new Error(`Invalid 3D parent relationship for ${node.id}.`);
    }
    node.axis = [...definition.axis];
    node.targetAngle = findTargetAngle(parent.panel, node.panel, node.parentEdge);
    node.parentOffset = definition.parentOffset(parent.panel);
    node.centerOffset = definition.childOffset(node.panel);
    parent.children.push(node.id);
  }

  if (!rootId) throw new Error('The 3D root panel is missing.');

  const visited = new Set();
  function visit(nodeId) {
    if (visited.has(nodeId)) throw new Error('The 3D fold graph contains a cycle.');
    visited.add(nodeId);
    for (const childId of nodes.get(nodeId).children) visit(childId);
  }
  visit(rootId);
  if (visited.size !== nodes.size) throw new Error('The 3D fold graph is disconnected.');

  return {
    rootId,
    nodes,
    order: panels.map(({ id }) => id),
    caliperMm: Math.max(0, Number(caliperMm) || 0),
  };
}

function clampProgress(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) throw new Error('Fold progress must be finite.');
  return Math.min(1, Math.max(0, value));
}

function translation(values) {
  return new Matrix4().makeTranslation(...values);
}

export function computePanelTransforms(graph, progress, { thicknessAware = graph.caliperMm > 0 } = {}) {
  const foldProgress = clampProgress(progress);
  const transforms = new Map();
  const identity = new Matrix4();
  const halfCaliper = thicknessAware ? Math.max(0, Number(graph.caliperMm) || 0) / 2 : 0;

  function visit(nodeId, parentFrame) {
    const node = graph.nodes.get(nodeId);
    let worldFrame;
    if (!node.parentId) {
      worldFrame = parentFrame.clone();
    } else {
      const rotation = new Matrix4().makeRotationAxis(
        new Vector3(...node.axis),
        node.targetAngle * foldProgress,
      );
      worldFrame = parentFrame.clone()
        .multiply(translation([
          node.parentOffset[0],
          node.parentOffset[1],
          halfCaliper,
        ]))
        .multiply(rotation)
        .multiply(translation([
          node.centerOffset[0],
          node.centerOffset[1],
          -halfCaliper,
        ]));
    }
    transforms.set(node.id, worldFrame);
    for (const childId of node.children) visit(childId, worldFrame);
  }

  visit(graph.rootId, identity);
  return transforms;
}

export function getTransformBasis(matrix) {
  return basisFromMatrix(matrix);
}

export function getPanelEdgePoints(panel, edge) {
  const halfWidth = panel.width / 2;
  const halfHeight = panel.height / 2;
  switch (edge) {
    case 'top':
      return [[-halfWidth, halfHeight, 0], [halfWidth, halfHeight, 0]];
    case 'right':
      return [[halfWidth, halfHeight, 0], [halfWidth, -halfHeight, 0]];
    case 'bottom':
      return [[halfWidth, -halfHeight, 0], [-halfWidth, -halfHeight, 0]];
    case 'left':
      return [[-halfWidth, -halfHeight, 0], [-halfWidth, halfHeight, 0]];
    default:
      throw new Error(`Invalid panel edge: ${edge}`);
  }
}

export function transformPoint(matrix, point) {
  return new Vector3(...point).applyMatrix4(matrix).toArray();
}

export const FOLD_EPSILON = EPSILON;
