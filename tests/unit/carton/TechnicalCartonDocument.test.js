import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { TechnicalCartonDocument } from '../../../src/carton/TechnicalCartonDocument.js';
import { createCartonDocument } from '../../../src/carton/createCartonDocument.js';
import { CartonDocument } from '../../../src/carton/CartonDocument.js';
import { AppError } from '../../../src/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../../src/workflow/fixtures');

function loadFixture(name) {
  const filePath = path.join(fixturesDir, `${name}-workflow.v1.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('TechnicalCartonDocument multi-fixture validation & contracts', () => {
  const fixtureNames = ['rte', 'ste', 'tt_sl123'];

  for (const name of fixtureNames) {
    it(`validates and creates TechnicalCartonDocument for ${name.toUpperCase()} fixture`, async () => {
      const bundle = loadFixture(name);
      const doc = await TechnicalCartonDocument.create(bundle);

      expect(doc).toBeInstanceOf(CartonDocument);
      expect(doc).toBeInstanceOf(TechnicalCartonDocument);
      expect(doc.mode).toBe('technical');
      expect(doc.isComplete).toBe(true);

      // Dimensions & Board
      const dims = doc.dimensions;
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);
      expect(dims.depth).toBeGreaterThan(0);
      expect(dims.requestedDimensionReference).toBe('INNER');
      expect(dims.resolvedDimensions.inner).toBeDefined();
      expect(dims.resolvedDimensions.outer).toBeDefined();

      const board = doc.board;
      expect(board.caliperMm).toBeGreaterThan(0);
      expect(Number.isFinite(board.insideLoss)).toBe(true);
      expect(Number.isFinite(board.outsideGain)).toBe(true);

      // Bounds
      const bounds = doc.getBounds();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      expect(bounds.maxX).toBeGreaterThan(bounds.minX);
      expect(bounds.maxY).toBeGreaterThan(bounds.minY);

      // Surfaces
      const surfaces = doc.getArtworkSurfaces();
      expect(surfaces.length).toBeGreaterThan(0);
      for (const surface of surfaces) {
        expect(typeof surface.id).toBe('string');
        expect(typeof surface.role).toBe('string');
        expect(typeof surface.kind).toBe('string');
        expect(surface.bounds.width).toBeGreaterThanOrEqual(0);
        expect(surface.bounds.height).toBeGreaterThanOrEqual(0);
        expect(surface.polygon.length).toBeGreaterThanOrEqual(3);
        expect(surface.contour.segments.length).toBeGreaterThanOrEqual(3);
      }

      // Dieline Primitives & ARC preservation
      const primitives = doc.getDielinePrimitives();
      const rawModel = JSON.parse(bundle.modelJson.text);
      expect(primitives.length).toBeGreaterThan(0);

      const folds = primitives.filter((p) => p.classification === 'fold');
      const cuts = primitives.filter((p) => p.classification === 'cut');
      const arcs = primitives.filter((p) => p.kind === 'ARC');
      const lines = primitives.filter((p) => p.kind === 'LINE');

      expect(folds.length).toBeGreaterThan(0);
      expect(cuts.length).toBeGreaterThan(0);
      expect(lines.length).toBeGreaterThan(0);
      expect(arcs.length).toBeGreaterThan(0); // All 3 fixtures have ARCs in flap corners

      const openCutFeatures = (rawModel.features || [])
        .filter((feature) => feature.operation === 'OPEN_CUT')
        .flatMap((feature) => feature.geometry || []);
      expect(primitives.filter((p) => p.role === 'OPEN_CUT').length).toBe(openCutFeatures.length);

      for (const arc of arcs) {
        expect(Number.isFinite(arc.radius)).toBe(true);
        expect(arc.radius).toBeGreaterThan(0);
        expect(Number.isFinite(arc.center.x)).toBe(true);
        expect(Number.isFinite(arc.center.y)).toBe(true);
        expect(typeof arc.clockwise).toBe('boolean');
      }

      // Check exclusion of render: false edges
      const hiddenRawEdges = (rawModel.edges || []).filter((e) => e.render === false || e.referenceAccountingOnly === true);
      for (const hidden of hiddenRawEdges) {
        expect(primitives.some((p) => p.id === hidden.id)).toBe(false);
      }

      // Masks
      const masks = doc.getArtworkMaskPaths();
      expect(masks.length).toBe(surfaces.length);
      for (const mask of masks) {
        expect(mask.d.startsWith('M')).toBe(true);
        expect(mask.d.endsWith('Z')).toBe(true);
      }

      // Source Identity
      const identity = doc.getSourceIdentity();
      expect(identity.mode).toBe('technical');
      expect(identity.producer).toBe('packaging-box-designer');
      expect(identity.modelSchemaVersion).toBe('pbd.model.v1');
      expect(identity.svgSchemaVersion).toBe('pbd.svg.v4');
      expect(identity.referenceOnly).toBe(true);
      expect(identity.productionCertified).toBe(false);
      expect(identity.modelSha256).toBe(bundle.modelJson.sha256);
      expect(identity.svgSha256).toBe(bundle.semanticSvg.sha256);

      // Serialize
      const serialized = doc.serialize();
      expect(serialized.mode).toBe('technical');
      expect(serialized.modelSha256).toBe(bundle.modelJson.sha256);
      expect(serialized.svgSha256).toBe(bundle.semanticSvg.sha256);
    });
  }

  it('guarantees immutability of input bundle and returned structures', async () => {
    const bundle = loadFixture('rte');
    const originalText = bundle.modelJson.text;
    const doc = await TechnicalCartonDocument.create(bundle);

    // Mutate outer object
    bundle.modelJson.text = 'MUTATED';
    bundle.source.cartonType = 'MUTATED';

    expect(doc.getModel().exportMetadata.format).toBe('CartonBuilder Model JSON');
    expect(doc.getSourceIdentity().cartonType).toBe('RTE');

    const exposedModel = doc.getModel();
    exposedModel.input.width = 999;
    const exposedBundle = doc.getBundle();
    exposedBundle.source.cartonType = 'MUTATED_AGAIN';
    expect(doc.dimensions.width).not.toBe(999);
    expect(doc.getSourceIdentity().cartonType).toBe('RTE');
  });

  it('reconstitutes technical document from createCartonDocument with technicalAssets', async () => {
    const bundle = loadFixture('ste');
    const cartonSource = {
      mode: 'technical',
      source: bundle.source,
      modelSha256: bundle.modelJson.sha256,
      svgSha256: bundle.semanticSvg.sha256,
      semanticSvgAssetId: bundle.semanticSvg.assetId,
    };
    const technicalAssets = {
      modelBlob: new Blob([bundle.modelJson.text], { type: 'application/json' }),
      svgBlob: new Blob([bundle.semanticSvg.markup], { type: 'image/svg+xml' }),
    };

    const doc = await createCartonDocument(cartonSource, technicalAssets);
    expect(doc).toBeInstanceOf(TechnicalCartonDocument);
    expect(doc.mode).toBe('technical');
    expect(doc.getSourceIdentity().cartonType).toBe('STE');
  });
});

describe('TechnicalCartonDocument negative security & integrity tests', () => {
  it('rejects bundle with tampered model JSON hash', async () => {
    const bundle = loadFixture('rte');
    bundle.modelJson.sha256 = '0000000000000000000000000000000000000000000000000000000000000000';

    await expect(TechnicalCartonDocument.create(bundle)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bundle with tampered SVG markup hash', async () => {
    const bundle = loadFixture('rte');
    bundle.semanticSvg.sha256 = '0000000000000000000000000000000000000000000000000000000000000000';

    await expect(TechnicalCartonDocument.create(bundle)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bundle with mismatched semanticSvg.assetId', async () => {
    const bundle = loadFixture('rte');
    bundle.semanticSvg.assetId = 'wrong-asset-id';

    await expect(TechnicalCartonDocument.create(bundle)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bundle with unsupported carton type', async () => {
    const bundle = loadFixture('rte');
    bundle.source.cartonType = 'UNKNOWN_HEXAGONAL';

    await expect(TechnicalCartonDocument.create(bundle)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bundle with unknown schema version', async () => {
    const bundle = loadFixture('rte');
    bundle.source.modelSchemaVersion = 'pbd.model.v999';

    await expect(TechnicalCartonDocument.create(bundle)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bundle with malicious SVG markup (script tag)', async () => {
    const bundle = loadFixture('rte');
    bundle.semanticSvg.markup = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    bundle.semanticSvg.byteLength = new Blob([bundle.semanticSvg.markup]).size;
    // Even if hash is matched to the malicious markup:
    const crypto = await import('node:crypto');
    bundle.semanticSvg.sha256 = crypto.createHash('sha256').update(bundle.semanticSvg.markup).digest('hex');

    await expect(TechnicalCartonDocument.create(bundle)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bundle with oversized model JSON text', async () => {
    const bundle = loadFixture('rte');
    bundle.modelJson.text = 'x'.repeat(11 * 1024 * 1024); // 11 MB > 10 MB limit
    bundle.modelJson.byteLength = 11 * 1024 * 1024;

    await expect(TechnicalCartonDocument.create(bundle)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bundle with oversized SVG markup', async () => {
    const bundle = loadFixture('rte');
    bundle.semanticSvg.markup = 'x'.repeat(16 * 1024 * 1024); // 16 MB > 15 MB limit
    bundle.semanticSvg.byteLength = 16 * 1024 * 1024;

    await expect(TechnicalCartonDocument.create(bundle)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bundle when trust options fail (producer mismatch)', async () => {
    const bundle = loadFixture('rte');

    await expect(TechnicalCartonDocument.create(bundle, { expectedProducer: 'third-party-tool' })).rejects.toBeInstanceOf(AppError);
  });

  it('rejects bundle when trust options fail (artifact sha mismatch)', async () => {
    const bundle = loadFixture('rte');

    await expect(TechnicalCartonDocument.create(bundle, { expectedArtifactSha256: 'deadbeef' })).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a bundle whose model validation status is not structurally and geometrically valid', async () => {
    const bundle = loadFixture('rte');
    const model = JSON.parse(bundle.modelJson.text);
    model.validation.structural = 'INVALID';
    model.validation.geometry = 'INVALID';
    model.validation.domains.STRUCTURAL.status = 'INVALID';
    model.validation.domains.GEOMETRY.status = 'INVALID';
    bundle.modelJson.text = JSON.stringify(model);
    bundle.modelJson.byteLength = new Blob([bundle.modelJson.text]).size;
    bundle.modelJson.sha256 = createHash('sha256').update(bundle.modelJson.text).digest('hex');

    await expect(TechnicalCartonDocument.create(bundle)).rejects.toMatchObject({
      code: 'cartonWorkflowGeometryInvalid',
    });
  });
});
