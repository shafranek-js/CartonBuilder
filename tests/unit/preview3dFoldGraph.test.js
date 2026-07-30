import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { EDGES, OPPOSITE_EDGE } from '../../src/model/geometry.js';
import {
  buildFoldGraph,
  computePanelTransforms,
  getPanelEdgePoints,
  getTransformBasis,
  transformPoint,
} from '../../src/preview3d/foldGraph.js';

function stateKey(model) {
  return model.getPanels()
    .map((panel) => [
      panel.id,
      panel.parentId,
      panel.parentEdge,
      panel.x,
      panel.y,
    ].join(':'))
    .sort()
    .join('|');
}

function enumerateCompleteNets() {
  const start = new BoxNetModel({ width: 151, height: 93, depth: 41 });
  const seen = new Set();
  const complete = [];

  function visit(model) {
    const key = stateKey(model);
    if (seen.has(key)) return;
    seen.add(key);
    if (model.isComplete) {
      complete.push(model);
      return;
    }

    for (const panel of model.getPanels()) {
      for (const edge of EDGES) {
        if (!model.getPotential(panel.id, edge)) continue;
        const next = BoxNetModel.fromJSON(model.toJSON());
        next.addPanel(panel.id, edge);
        visit(next);
      }
    }
  }

  visit(start);
  return complete;
}

function expectVectorClose(actual, expected, precision = 6) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], precision));
}

function expectSameSegment(actual, expected) {
  const direct = actual.every((point, index) => (
    point.every((value, axis) => Math.abs(value - expected[index][axis]) < 1e-6)
  ));
  const reversed = actual.every((point, index) => (
    point.every((value, axis) => Math.abs(value - expected[1 - index][axis]) < 1e-6)
  ));
  expect(direct || reversed).toBe(true);
}

describe('3D fold graph', () => {
  const completeNets = enumerateCompleteNets();

  it('covers every complete net reachable by the current box model', () => {
    expect(completeNets).toHaveLength(384);
  });

  it('reconstructs flat placement and folded basis for all reachable nets', () => {
    for (const model of completeNets) {
      const graph = buildFoldGraph(model);
      const flat = computePanelTransforms(graph, 0);
      const folded = computePanelTransforms(graph, 1);
      const root = model.getPanel('front');
      const rootCenterX = root.x + root.width / 2;
      const rootCenterY = root.y + root.height / 2;

      expect(graph.nodes.size).toBe(6);
      expect(new Set(graph.order).size).toBe(6);

      for (const panel of model.getPanels()) {
        const flatElements = flat.get(panel.id).elements;
        expect(flatElements[12]).toBeCloseTo(
          panel.x + panel.width / 2 - rootCenterX,
          6,
        );
        expect(flatElements[13]).toBeCloseTo(
          -(panel.y + panel.height / 2 - rootCenterY),
          6,
        );
        expect(flatElements[14]).toBeCloseTo(0, 6);

        const basis = getTransformBasis(folded.get(panel.id));
        expectVectorClose(basis.right, panel.basis.right);
        expectVectorClose(basis.up, panel.basis.up);
        expectVectorClose(basis.normal, panel.basis.normal);
      }
    }
  });

  it('keeps parent and child hinge segments coincident throughout folding', () => {
    for (const model of completeNets) {
      const graph = buildFoldGraph(model);
      for (const progress of [0, 0.5, 1]) {
        const transforms = computePanelTransforms(graph, progress);
        for (const panel of model.getPanels()) {
          if (!panel.parentId) continue;
          const parent = model.getPanel(panel.parentId);
          const parentSegment = getPanelEdgePoints(parent, panel.parentEdge)
            .map((point) => transformPoint(transforms.get(parent.id), point));
          const childSegment = getPanelEdgePoints(panel, OPPOSITE_EDGE[panel.parentEdge])
            .map((point) => transformPoint(transforms.get(panel.id), point));
          expectSameSegment(parentSegment, childSegment);
        }
      }
    }
  });

  it('clamps fold progress without mutating the model', () => {
    const model = completeNets[0];
    const before = model.toJSON();
    const graph = buildFoldGraph(model);
    const below = computePanelTransforms(graph, -2);
    const open = computePanelTransforms(graph, 0);
    const above = computePanelTransforms(graph, 4);
    const folded = computePanelTransforms(graph, 1);

    for (const panel of model.getPanels()) {
      expect(below.get(panel.id).elements).toEqual(open.get(panel.id).elements);
      expect(above.get(panel.id).elements).toEqual(folded.get(panel.id).elements);
    }
    expect(model.toJSON()).toEqual(before);
  });
});
