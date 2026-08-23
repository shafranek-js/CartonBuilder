import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TechnicalCartonDocument } from '../../../src/carton/TechnicalCartonDocument.js';
import { createTechnicalBoxModelAdapter } from '../../../src/carton/technicalBoxModelAdapter.js';
import { getDielineSegments, getPanelMaskPath } from '../../../src/model/dieline.js';
import { createTechnicalSvgExport } from '../../../src/export/technicalSvgExport.js';
import { buildSnapTargets } from '../../../src/artwork/snap.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/workflow/fixtures');
const expectedArcCounts = { rte: 19, ste: 20, tt_sl123: 21 };
const presentationTransforms = {
  identity: { a: 1, b: 0, c: 0, d: 1 },
  hflip: { a: -1, b: 0, c: 0, d: 1 },
  vflip: { a: 1, b: 0, c: 0, d: -1 },
  rotateCw: { a: 0, b: 1, c: -1, d: 0 },
  rotateCcw: { a: 0, b: -1, c: 1, d: 0 },
};
function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}-workflow.v1.json`), 'utf8'));
}

function withPresentationTransform(document, transform) {
  return {
    mode: 'technical',
    dimensions: document.dimensions,
    board: document.board,
    getModel: () => document.getModel(),
    getBounds: () => document.getBounds(),
    getPresentationTransform: () => transform,
    getArtworkSurfaces: () => document.getArtworkSurfaces(),
    getDielinePrimitives: () => document.getDielinePrimitives(),
    getCanonicalSemanticSvg: () => document.getCanonicalSemanticSvg(),
    getSourceIdentity: () => document.getSourceIdentity(),
    serialize: () => document.serialize(),
  };
}

describe('technical artwork compatibility model', () => {
  it('projects semantic surfaces into the persisted SVG presentation without changing the source document', async () => {
    const bundle = loadFixture('rte');
    const document = await TechnicalCartonDocument.create(bundle);
    const adapter = createTechnicalBoxModelAdapter(document);

    expect(adapter.mode).toBe('technical');
    expect(adapter.isComplete).toBe(true);
    expect(adapter.getElements().length).toBeGreaterThan(0);
    expect(adapter.getPanels()).toEqual(adapter.getElements());
    expect(adapter.getPresentationTransform()).toEqual({ a: 1, b: 0, c: 0, d: 1 });
    expect(adapter.getDielinePrimitives().map(({ id, kind }) => ({ id, kind })))
      .toEqual(document.getDielinePrimitives().map(({ id, kind }) => ({ id, kind })));
    expect(adapter.getBounds().width).toBeCloseTo(document.getBounds().width, 8);
    expect(adapter.getBounds().height).toBeCloseTo(document.getBounds().height, 8);
    expect(adapter.getDielinePrimitives()).not.toEqual(document.getDielinePrimitives());
    expect(adapter.getCanonicalSemanticSvg()).toEqual(document.getCanonicalSemanticSvg());
    expect(adapter.getSourceIdentity()).toEqual(document.getSourceIdentity());
    expect(adapter.toJSON().mode).toBe('technical');
  });

  for (const name of ['rte', 'ste', 'tt_sl123']) {
    it(`preserves every LINE and ARC primitive for ${name.toUpperCase()} artwork consumers`, async () => {
      const document = await TechnicalCartonDocument.create(loadFixture(name));
      const adapter = createTechnicalBoxModelAdapter(document);
      const sourcePrimitives = document.getDielinePrimitives();
      const { cut, fold } = getDielineSegments(adapter);
      const consumed = [...cut, ...fold];

      expect(consumed).toHaveLength(sourcePrimitives.length);
      for (const kind of ['LINE', 'ARC']) {
        expect(consumed.filter((primitive) => primitive.kind === kind)).toHaveLength(
          sourcePrimitives.filter((primitive) => primitive.kind === kind).length,
        );
      }
      expect(sourcePrimitives.filter((primitive) => primitive.kind === 'ARC')).toHaveLength(expectedArcCounts[name]);
      expect(getPanelMaskPath(adapter)).toContain('A');

      const svg = await createTechnicalSvgExport(adapter);
      expect(svg).toContain('<path');
      expect(svg).toContain('A');
      for (const primitive of sourcePrimitives.filter((item) => item.role === 'OPEN_CUT')) {
        expect(consumed.some((item) => item.id === primitive.id && item.role === primitive.role)).toBe(true);
      }
    });
  }

  for (const name of ['rte', 'ste', 'tt_sl123']) {
    for (const [transformName, transform] of Object.entries(presentationTransforms)) {
      it(`builds semantic snapping targets from projected ${name.toUpperCase()} ${transformName} geometry`, async () => {
        const document = await TechnicalCartonDocument.create(loadFixture(name));
        const sourceSerialization = document.serialize();
        const sourceSvg = document.getCanonicalSemanticSvg();
        const adapter = createTechnicalBoxModelAdapter(withPresentationTransform(document, transform));
        const targets = buildSnapTargets(adapter);

        expect(targets.endpoints.length).toBeGreaterThan(0);
        expect(targets.intersections.length).toBeGreaterThan(0);
        expect(targets.panelCenters.length).toBeGreaterThan(0);
        expect(targets.panelBoundaries.length).toBeGreaterThan(0);
        expect(targets.targets.every((target) => Number.isFinite(target.point.x) && Number.isFinite(target.point.y))).toBe(true);
        expect(targets.panelBoundaries.every((target) => ['LINE', 'ARC'].includes(target.segment.kind))).toBe(true);
        expect(targets.panelBoundaries.some((target) => target.segment.kind === 'ARC')).toBe(true);
        expect(document.serialize()).toEqual(sourceSerialization);
        expect(document.getCanonicalSemanticSvg()).toEqual(sourceSvg);
      });
    }
  }

  for (const name of ['rte', 'ste', 'tt_sl123']) {
    for (const [transformName, transform] of Object.entries(presentationTransforms)) {
      it(`exposes the projected body.front frame for ${name.toUpperCase()} ${transformName}`, async () => {
        const document = await TechnicalCartonDocument.create(loadFixture(name));
        const sourceSerialization = document.serialize();
        const adapter = createTechnicalBoxModelAdapter(withPresentationTransform(document, transform));
        const projectedFront = adapter.getArtworkSurfaces().find((surface) => surface.id === 'body.front');
        const frame = adapter.getArtworkReferenceFrame();

        expect(projectedFront).toBeDefined();
        expect(frame).toEqual({
          surfaceId: 'body.front',
          units: 'mm',
          origin: { x: projectedFront.bounds.minX, y: projectedFront.bounds.minY },
          bounds: projectedFront.bounds,
        });
        expect(Object.values(frame.origin).every(Number.isFinite)).toBe(true);
        expect(Object.values(frame.bounds).every(Number.isFinite)).toBe(true);

        const copy = adapter.getArtworkReferenceFrame();
        copy.origin.x += 1000;
        copy.bounds.width += 1000;
        expect(adapter.getArtworkReferenceFrame()).toEqual(frame);
        expect(document.serialize()).toEqual(sourceSerialization);
      });
    }
  }

  it('fails closed when body.front is absent or its projected bounds are invalid', async () => {
    const document = await TechnicalCartonDocument.create(loadFixture('rte'));
    const surfaces = document.getArtworkSurfaces();
    const base = withPresentationTransform(document, presentationTransforms.identity);
    const withoutFront = {
      ...base,
      getArtworkSurfaces: () => surfaces.filter((surface) => surface.id !== 'body.front'),
    };
    expect(createTechnicalBoxModelAdapter(withoutFront).getArtworkReferenceFrame()).toBeNull();

    const invalidFront = surfaces.find((surface) => surface.id === 'body.front');
    const invalidSurfaces = surfaces.map((surface) => surface.id === 'body.front'
      ? { ...surface, polygon: [], contour: { segments: [], closed: true } }
      : surface);
    const withInvalidFront = {
      ...base,
      getArtworkSurfaces: () => invalidSurfaces,
    };
    expect(invalidFront).toBeDefined();
    expect(createTechnicalBoxModelAdapter(withInvalidFront).getArtworkReferenceFrame()).toBeNull();
  });
});
