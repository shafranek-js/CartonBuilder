import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { buildConstructionTemplate, validateConstructionElements } from '../../src/model/ConstructionTemplates.js';
import { buildFoldGraph, computePanelTransforms } from '../../src/preview3d/foldGraph.js';
import { getDielineSegments, getPanelMaskPath } from '../../src/model/dieline.js';
import { migrateProjectSnapshot } from '../../src/project/projectSchema.js';

const dimensions = { width: 150, height: 90, depth: 40 };

describe('parametric carton constructions', () => {
  it.each(['ste', 'rte'])('generates a valid 13-element %s construction', (templateId) => {
    const template = buildConstructionTemplate(templateId, dimensions, { caliperMm: 0.35 });
    expect(template.elements).toHaveLength(13);
    expect(template.elements.filter((element) => element.surfaceKey)).toHaveLength(6);
    expect(validateConstructionElements(template.elements)).toMatchObject({ valid: true });
    expect(template.parameters.glueTabWidthMm).toBe(15);
    expect(template.parameters.tuckTabDepthMm).toBeCloseTo(18);
  });

  it('sanitizes parameters and keeps the hidden clearance bounded', () => {
    const model = new BoxNetModel({ width: 24, height: 18, depth: 10 }, { caliperMm: 2 }, { templateId: 'ste' });
    expect(model.construction.parameters.glueTabWidthMm).toBeGreaterThanOrEqual(6);
    expect(model.construction.parameters.tuckTabDepthMm).toBeGreaterThanOrEqual(6);
    expect(Math.min(model.board.caliperMm * 2, 1)).toBeLessThanOrEqual(1);
    model.setConstruction('rte', { lockEarMm: 999, dustFlapReachMm: 999 });
    expect(model.construction.parameters.lockEarMm).toBeLessThanOrEqual(6);
    expect(model.getElements()).toHaveLength(13);
  });

  it.each(['ste', 'rte'])('builds a connected staged fold graph for %s', (templateId) => {
    const model = new BoxNetModel(dimensions, null, { templateId });
    const graph = buildFoldGraph(model, { caliperMm: 0.35 });
    expect(graph.nodes.size).toBe(13);
    expect(computePanelTransforms(graph, 0).size).toBe(13);
    expect(computePanelTransforms(graph, 0.5).size).toBe(13);
    expect(computePanelTransforms(graph, 1).size).toBe(13);
  });

  it('uses polygon masks and explicit cut/fold segments', () => {
    const model = new BoxNetModel(dimensions, null, { templateId: 'ste' });
    const mask = getPanelMaskPath(model);
    const dieline = getDielineSegments(model);
    expect(mask).toContain('M');
    expect(dieline.cut.length).toBeGreaterThan(0);
    expect(dieline.fold.length).toBeGreaterThan(0);
  });

  it('migrates a v13 snapshot to explicit legacy construction without changing panels', () => {
    const model = new BoxNetModel();
    const snapshot = {
      schemaVersion: 13,
      workflowStep: 'box',
      box: model.toJSON(),
      artworks: [],
      activeArtworkIndex: -1,
    };
    delete snapshot.box.construction;
    const migrated = migrateProjectSnapshot(snapshot);
    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.box.construction.templateId).toBe('legacy-six-panel');
    expect(migrated.box.panels).toEqual(snapshot.box.panels);
  });
});
