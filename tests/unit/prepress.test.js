import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { migrateProjectSnapshot } from '../../src/project/projectSchema.js';
import { buildProductionDieline } from '../../src/prepress/productionDieline.js';
import { runPrepressPreflight } from '../../src/prepress/prepressPreflight.js';
import { DEFAULT_PREPRESS_SETTINGS, sanitizePrepressSettings } from '../../src/prepress/prepressState.js';
import { createPrepressSvg } from '../../src/export/svgExport.js';
import { validateConstructionCollision } from '../../src/preview3d/geometryCollision.js';

describe('Wave 9A prepress foundations', () => {
  it('sanitizes the production-assist ranges and preserves technical defaults', () => {
    const settings = sanitizePrepressSettings({ mode: 'production-assist', bleedMm: 999, safeMm: -1, slugMm: 999, allowances: { cutOffsetMm: -99 } });
    expect(settings).toMatchObject({ mode: 'production-assist', bleedMm: 20, safeMm: 0, slugMm: 30 });
    expect(settings.allowances.cutOffsetMm).toBe(-5);
    expect(DEFAULT_PREPRESS_SETTINGS.technicalLines.cutSpotName).toBe('CutContour');
  });

  it('migrates v14 to v15 without changing the archive-facing box', () => {
    const model = new BoxNetModel();
    const snapshot = { schemaVersion: 14, workflowStep: 'artwork', box: model.toJSON(), artworks: [], activeArtworkIndex: -1 };
    const migrated = migrateProjectSnapshot(snapshot);
    expect(migrated.schemaVersion).toBe(15);
    expect(migrated.prepress.mode).toBe('technical-proof');
    expect(migrated.box).toEqual(snapshot.box);
  });

  it.each(['legacy-six-panel', 'ste', 'rte'])('derives trim/bleed/safe geometry for %s without mutating model', (templateId) => {
    const model = new BoxNetModel({ width: 100, height: 120, depth: 50 }, { caliperMm: 0.35 }, { templateId });
    const before = model.toJSON();
    const production = buildProductionDieline(model, { mode: 'production-assist', bleedMm: 3, safeMm: 3, slugMm: 10 });
    expect(production.diagnostics.valid).toBe(true);
    expect(production.bleedPolygons.length).toBeGreaterThan(0);
    expect(production.bleedBounds.width).toBeGreaterThan(production.trimBounds.width);
    expect(production.bounds).toEqual(production.trimBounds);
    expect(production.mediaBounds.width).toBeGreaterThan(production.bounds.width);
    expect(model.toJSON()).toEqual(before);
  });

  it('provides named SVG production layers and explicit non-certification boundary', () => {
    const model = new BoxNetModel({ width: 100, height: 120, depth: 50 }, null, { templateId: 'ste' });
    const svg = createPrepressSvg(model, { mode: 'production-assist' });
    for (const id of ['Artwork', 'Bleed', 'Safe', 'CutContour', 'Crease', 'Marks', 'Slug']) expect(svg).toContain(`id="${id}"`);
    expect(svg).toContain('data-spot="CutContour"');
    expect(svg).toContain('production-assist');
  });

  it('classifies STE/RTE thickness contacts as bounded allowed contacts', () => {
    for (const templateId of ['ste', 'rte']) {
      const model = new BoxNetModel({ width: 100, height: 120, depth: 50 }, { caliperMm: 0.35 }, { templateId });
      const result = validateConstructionCollision(model, { progress: 1, caliperMm: 0.35 });
      expect(result.unexpectedIntersections).toBe(0);
      expect(result.allowedIntersections).toBeGreaterThan(0);
    }
  });

  it('reports blocking artwork absence and manual review categories', () => {
    const model = new BoxNetModel();
    const report = runPrepressPreflight({ boxModel: model, artworks: [], settings: DEFAULT_PREPRESS_SETTINGS });
    expect(report.valid).toBe(false);
    expect(report.blocking.map((entry) => entry.code)).toContain('artwork-missing');
    expect(report.manualReview.length).toBeGreaterThan(0);
  });

  it('keeps technical proof geometry free of production allowances', () => {
    const model = new BoxNetModel({ width: 100, height: 120, depth: 50 }, null, { templateId: 'ste' });
    const proof = buildProductionDieline(model, {
      mode: 'technical-proof',
      allowances: { cutOffsetMm: 0, creaseOffsetMm: -3, hingeOverrides: { 'ste:fold:body+closure:x': 2 } },
    });
    const assist = buildProductionDieline(model, {
      mode: 'production-assist',
      allowances: { cutOffsetMm: 0, creaseOffsetMm: -3 },
    });
    expect(proof.diagnostics.allowancesApplied).toBe(false);
    expect(assist.diagnostics.allowancesApplied).toBe(true);
    expect(assist.fold[0].start).not.toEqual(proof.fold[0].start);
  });
});
