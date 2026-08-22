import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import {
  QUICK_CONSTRUCTION_MIGRATION_FLAG,
  normalizeQuickBoxState,
  normalizeQuickProjectSnapshot,
  wasQuickConstructionMigrated,
} from '../../src/model/quickCustomNet.js';
import { savePreset } from '../../src/project/PresetStore.js';
import { migrateProjectSnapshot } from '../../src/project/projectSchema.js';

function createParametricState(templateId, dimensions = { width: 180, height: 110, depth: 45 }) {
  return new BoxNetModel(dimensions, { caliperMm: 0.55 }, { templateId, parameters: {} }).toJSON();
}

function createProject(box, mode = 'quick') {
  return {
    schemaVersion: 17,
    meta: { name: 'Quick compatibility test' },
    workflowStep: 'box',
    workflowSelection: 'quick',
    cartonSource: { mode, box },
    artworks: [],
    activeArtworkIndex: -1,
    render: {},
    prepress: {},
    view: {},
    history: { undo: [], redo: [] },
  };
}

describe('Quick Custom Net compatibility boundary', () => {
  it.each(['ste', 'rte'])('converts old Quick %s to a complete six-surface Custom Net', (templateId) => {
    const result = normalizeQuickBoxState(createParametricState(templateId));

    expect(result.migrated).toBe(true);
    expect(result.box.construction).toEqual({
      templateId: 'legacy-six-panel',
      templateVersion: 1,
      parameters: {},
    });
    expect(result.box.dimensions).toEqual({ width: 180, height: 110, depth: 45 });
    expect(result.box.board).toEqual({ caliperMm: 0.55 });
    expect(result.box.panels).toHaveLength(6);
    expect(result.box.panels.map((panel) => panel.id).sort()).toEqual([
      'back', 'bottom', 'front', 'left', 'right', 'top',
    ]);
    expect(result.box.elements.every((element) => element.role === 'body')).toBe(true);
  });

  it.each(['ste', 'rte'])('normalizes an old Quick %s project at the schema boundary and marks the in-memory warning', (templateId) => {
    const snapshot = migrateProjectSnapshot(createProject(createParametricState(templateId)));

    expect(snapshot.cartonSource.box.construction.templateId).toBe('legacy-six-panel');
    expect(snapshot.workflowSelection).toBe('quick');
    expect(wasQuickConstructionMigrated(snapshot)).toBe(true);
    expect(snapshot[QUICK_CONSTRUCTION_MIGRATION_FLAG]).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(QUICK_CONSTRUCTION_MIGRATION_FLAG);
  });

  it('normalizes a parametric Quick preset before it can be applied later', async () => {
    const saved = await savePreset({
      id: 'quick-compatibility-test',
      name: 'Old STE preset',
      dimensions: { width: 180, height: 110, depth: 45 },
      netState: createParametricState('ste'),
    });

    expect(saved.netState.construction.templateId).toBe('legacy-six-panel');
    expect(saved.netState.construction.parameters).toEqual({});
    expect(saved.netState.panels).toHaveLength(6);
  });

  it('preserves dimensions, board and stable artwork surface identities', () => {
    const result = normalizeQuickBoxState(createParametricState('rte'));
    const model = BoxNetModel.fromJSON(result.box);

    expect(model.dimensions).toEqual({ width: 180, height: 110, depth: 45 });
    expect(model.board).toEqual({ caliperMm: 0.55 });
    expect(model.getElements().map((element) => element.surfaceKey).sort()).toEqual([
      'back', 'bottom', 'front', 'left', 'right', 'top',
    ]);
  });

  it('removes generated parameters and obsolete generated elements on the next snapshot', () => {
    const old = createParametricState('ste');
    const result = normalizeQuickBoxState(old);

    expect(result.box.construction.parameters).toEqual({});
    expect(result.box.elements.map((element) => element.id)).toEqual([
      'front', 'bottom', 'top', 'back', 'left', 'right',
    ]);
    expect(result.box.elements.some((element) => element.id.includes('glue') || element.id.includes('tuck'))).toBe(false);
  });

  it('fails before mutating an active model when conversion is impossible', () => {
    const active = new BoxNetModel({ width: 120, height: 80, depth: 30 });
    const before = active.toJSON();
    const invalid = {
      ...createParametricState('ste'),
      dimensions: { width: -1, height: 80, depth: 30 },
    };

    expect(() => normalizeQuickBoxState(invalid)).toThrow();
    expect(active.toJSON()).toEqual(before);
  });

  it('leaves Technical snapshots untouched', () => {
    const technical = createProject({ model: 'technical-model' }, 'technical');
    const migrated = normalizeQuickProjectSnapshot(technical).snapshot;

    expect(migrated.cartonSource).toEqual(technical.cartonSource);
    expect(migrated).toEqual(technical);
    expect(wasQuickConstructionMigrated(migrated)).toBe(false);
  });
});
