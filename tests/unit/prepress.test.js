import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { CURRENT_PROJECT_SCHEMA_VERSION, migrateProjectSnapshot } from '../../src/project/projectSchema.js';
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

  it('migrates v14 to current schema without changing the archive-facing quick box', () => {
    const model = new BoxNetModel();
    const snapshot = { schemaVersion: 14, workflowStep: 'artwork', box: model.toJSON(), artworks: [], activeArtworkIndex: -1 };
    const migrated = migrateProjectSnapshot(snapshot);
    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migrated.prepress.mode).toBe('technical-proof');
    expect(migrated.cartonSource.box).toEqual(snapshot.box);
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

  it('provides named SVG production layers and explicit non-certification boundary', async () => {
    const model = new BoxNetModel({ width: 100, height: 120, depth: 50 }, null, { templateId: 'ste' });
    const svg = await createPrepressSvg({ boxModel: model, settings: { mode: 'production-assist' } });
    for (const id of ['Artwork', 'Bleed', 'Safe', 'CutContour', 'Crease', 'Marks', 'Slug']) expect(svg).toContain(`id="${id}"`);
    expect(svg).toContain('data-spot="CutContour"');
    expect(svg).toContain('production-assist');
  });

  it('embeds visible artwork inside the bleed-clipped Artwork group', async () => {
    const model = new BoxNetModel({ width: 100, height: 120, depth: 50 }, null, { templateId: 'ste' });
    const artwork = {
      hasArtwork: true,
      centerXmm: 50,
      centerYmm: 60,
      unrotatedWidthMm: 80,
      unrotatedHeightMm: 60,
      rotation: 12,
      opacity: 0.8,
      flipX: true,
      flipY: false,
      crop: { x: 5, y: 4, width: 60, height: 40 },
    };
    const rasterize = async () => ({ blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) });
    const svg = await createPrepressSvg({
      boxModel: model,
      artworks: [{ model: artwork, visible: true, originalBlob: new Blob(['source'], { type: 'image/png' }) }],
      settings: { mode: 'production-assist' },
      rasterize,
    });
    expect(svg).toContain('<clipPath id="PrepressBleedClip">');
    expect(svg).toMatch(/<g id="Artwork"[^>]*>\s*<image href="data:image\/png;base64,AQID"/);
    expect(svg).toContain('clip-path="url(#ArtworkCrop0)"');
    expect(svg).toContain('opacity="0.8"');
    expect(svg).toContain('scale(-1 1)');
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

  it.each(['ste', 'rte'])('applies glue and tuck allowances without mutating %s model', (templateId) => {
    const model = new BoxNetModel({ width: 100, height: 120, depth: 50 }, null, { templateId });
    const before = model.toJSON();
    const baseline = buildProductionDieline(model, { mode: 'production-assist' });
    const adjusted = buildProductionDieline(model, {
      mode: 'production-assist',
      allowances: { glueTabDeltaMm: 4, tuckClearanceDeltaMm: 4 },
    });
    const baseElements = new Map(baseline.elements.map((element) => [element.id, element]));
    const adjustedElements = new Map(adjusted.elements.map((element) => [element.id, element]));
    expect(adjustedElements.get('glue-tab').polygon).not.toEqual(baseElements.get('glue-tab').polygon);
    expect(adjustedElements.get('top-tuck').polygon).not.toEqual(baseElements.get('top-tuck').polygon);
    expect(model.toJSON()).toEqual(before);
  });

  it.each(['ste', 'rte'])('keeps production CutContour joins closed for %s', (templateId) => {
    const model = new BoxNetModel({ width: 100, height: 120, depth: 50 }, null, { templateId });
    const production = buildProductionDieline(model, {
      mode: 'production-assist',
      allowances: { cutOffsetMm: 1 },
    });
    expect(production.diagnostics.valid).toBe(true);
    const degree = new Map();
    for (const segment of production.cut) {
      for (const point of [segment.start, segment.end]) {
        const key = `${point.x.toFixed(5)},${point.y.toFixed(5)}`;
        degree.set(key, (degree.get(key) || 0) + 1);
      }
    }
    expect([...degree.values()].every((value) => value === 2)).toBe(true);
  });
});
