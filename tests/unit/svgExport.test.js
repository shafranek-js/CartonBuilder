import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createExportSvg,
  formatNumber,
  getExportFilename,
} from '../../src/export/svgExport.js';
import {
  createTechnicalSvgExport,
  validateTechnicalSvgProvenance,
} from '../../src/export/technicalSvgExport.js';
import { TechnicalCartonDocument } from '../../src/carton/TechnicalCartonDocument.js';
import { createTechnicalBoxModelAdapter } from '../../src/carton/technicalBoxModelAdapter.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { AppError } from '../../src/errors.js';
import { validateSvgV4Export } from '../../src/workflow/export/svgMetadata.mjs';
import { sha256Async, utf8ByteLength } from '../../src/workflow/workflow/crypto.js';
import { scanSvgSecurity } from '../../src/workflow/workflow/security.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/workflow/fixtures');
const expectedArcCounts = { rte: 19, ste: 20, tt_sl123: 21 };

function loadTechnicalFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}-workflow.v1.json`), 'utf8'));
}

function metadataBlock(markup, id) {
  return markup.match(new RegExp(`<metadata id="${id}"[^>]*>[\\s\\S]*?<\\/metadata>`))?.[0] || null;
}

function decodeMetadata(block) {
  const content = block.slice(block.indexOf('>') + 1, block.lastIndexOf('</metadata>'));
  return JSON.parse(content
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&'));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function withExistingProvenance(markup, quote = '"') {
  const provenance = `<metadata data-schema-version=${quote}cartonbuilder.technical-svg-provenance.v1${quote} id=${quote}cartonbuilder-export-provenance${quote}>{}</metadata>`;
  const pbdEnd = markup.indexOf('</metadata>') + '</metadata>'.length;
  return `${markup.slice(0, pbdEnd)}${provenance}${markup.slice(pbdEnd)}`;
}

async function documentWithCanonicalMarkup(name, markup) {
  const bundle = cloneJson(loadTechnicalFixture(name));
  bundle.semanticSvg.markup = markup;
  bundle.semanticSvg.byteLength = utf8ByteLength(markup);
  bundle.semanticSvg.sha256 = await sha256Async(markup);
  bundle.semanticSvg.assetId = `svg-${bundle.semanticSvg.sha256.slice(0, 16)}`;
  return TechnicalCartonDocument.create(bundle);
}

function createCompleteModel() {
  const model = new BoxNetModel();
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

describe('SVG export', () => {
  it('formats dimensions and filenames compatibly', () => {
    expect(formatNumber(150)).toBe('150');
    expect(formatNumber(40.567)).toBe('40.57');
    expect(getExportFilename({ width: 150.5, height: 90.25, depth: 40 })).toBe(
      'box-net-150.5x90.25x40mm.svg',
    );
  });

  it('exports all six panels with physical dimensions and expected colors', () => {
    const svg = createExportSvg(createCompleteModel());

    expect(svg).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(svg.match(/<rect /g)).toHaveLength(6);
    expect(svg).toContain('width="245.6mm"');
    expect(svg).toContain('height="275.6mm"');
    expect(svg).toContain('fill="#b7dcef"');
    expect(svg).toContain('fill="#efa6ec"');
    expect(svg.match(/<text /g)).toHaveLength(2);
    expect(svg).toContain('Front Panel');
    expect(svg).toContain('Base Panel');
    expect(svg).not.toContain('plus-action');
    expect(svg).not.toContain('remove-action');
  });

  for (const name of ['rte', 'ste', 'tt_sl123']) {
    it(`exports canonical technical SVG metadata and provenance for ${name.toUpperCase()}`, async () => {
      const bundle = loadTechnicalFixture(name);
      const document = await TechnicalCartonDocument.create(bundle);
      const model = createTechnicalBoxModelAdapter(document);
      const exported = await createTechnicalSvgExport(model);
      const identity = document.getSourceIdentity();
      const pbdMetadata = metadataBlock(exported, 'cartonbuilder-metadata');
      const provenanceMetadata = metadataBlock(exported, 'cartonbuilder-export-provenance');

      expect((exported.match(/<metadata id="cartonbuilder-metadata"/g) || [])).toHaveLength(1);
      expect(pbdMetadata).toBe(metadataBlock(bundle.semanticSvg.markup, 'cartonbuilder-metadata'));
      expect((exported.match(/<metadata id="cartonbuilder-export-provenance"/g) || [])).toHaveLength(1);
      expect(provenanceMetadata).not.toBeNull();

      const provenance = decodeMetadata(provenanceMetadata);
      expect(provenance).toEqual({
        format: 'CartonBuilder Technical SVG Export Provenance',
        schemaVersion: 'cartonbuilder.technical-svg-provenance.v1',
        source: {
          producer: identity.producer,
          producerVersion: identity.producerVersion,
          modelEngineVersion: identity.modelEngineVersion,
          contractPackageVersion: identity.contractPackageVersion,
          artifactVersion: identity.artifactVersion,
          artifactSha256: identity.artifactSha256,
          modelSchemaVersion: identity.modelSchemaVersion,
          svgSchemaVersion: identity.svgSchemaVersion,
          cartonType: identity.cartonType,
          profileIds: identity.profileIds,
        },
        integrity: {
          modelSha256: bundle.modelJson.sha256,
          semanticSvgAssetId: bundle.semanticSvg.assetId,
          sourceSemanticSvgSha256: await sha256Async(bundle.semanticSvg.markup),
        },
        status: { referenceOnly: true, productionCertified: false },
      });
      expect(provenance.source.cartonType).toBe(name === 'tt_sl123' ? 'TT_SL123' : name.toUpperCase());
      expect(provenance.status).toEqual({ referenceOnly: true, productionCertified: false });

      expect(exported.replace(provenanceMetadata, '')).toBe(bundle.semanticSvg.markup);
      expect(bundle.semanticSvg.byteLength).toBe(utf8ByteLength(bundle.semanticSvg.markup));
      expect(bundle.semanticSvg.sha256).toBe(await sha256Async(bundle.semanticSvg.markup));
      expect(bundle.semanticSvg.assetId).toBe(`svg-${bundle.semanticSvg.sha256.slice(0, 16)}`);
      expect(provenance.integrity.sourceSemanticSvgSha256).toBe(bundle.semanticSvg.sha256);
      expect(validateTechnicalSvgProvenance(exported, provenance).provenance).toEqual(provenance);
      expect(validateSvgV4Export(exported).valid).toBe(true);
      expect(scanSvgSecurity(exported)).toEqual([]);
      expect(document.getDielinePrimitives().filter((primitive) => primitive.kind === 'ARC')).toHaveLength(expectedArcCounts[name]);
      expect(document.getDielinePrimitives().filter((primitive) => primitive.role === 'OPEN_CUT').length).toBeGreaterThan(0);
      for (const marker of [
        'data-layer-class=',
        'data-parent-panel=',
        'data-child-panel=',
        'data-semantic-role=',
        'data-entity-kind="receiving-opening"',
      ]) expect(exported).toContain(marker);
    });
  }

  it('rejects canonical markup changed without changing the declared SHA and creates no output', async () => {
    const document = await TechnicalCartonDocument.create(loadTechnicalFixture('rte'));
    const adapter = createTechnicalBoxModelAdapter(document);
    const canonical = adapter.getCanonicalSemanticSvg();
    const markup = canonical.markup.replace('</svg>', ' \n</svg>');
    const mutatedCanonical = {
      ...canonical,
      markup,
      byteLength: utf8ByteLength(markup),
    };
    let output;

    await expect(createTechnicalSvgExport({
      mode: 'technical',
      getCanonicalSemanticSvg: () => mutatedCanonical,
      getSourceIdentity: () => document.getSourceIdentity(),
    })).rejects.toMatchObject({
      code: 'technicalSvgExportInvalid',
      parameters: { reason: 'canonical-svg-sha256-mismatch' },
    });
    expect(output).toBeUndefined();
  });

  it.each(['"', "'"])('accepts a rehashed bundle with existing provenance long enough to reject it structurally (%s quotes)', async (quote) => {
    const source = loadTechnicalFixture('rte');
    const markup = withExistingProvenance(source.semanticSvg.markup, quote);
    const document = await documentWithCanonicalMarkup('rte', markup);
    const adapter = createTechnicalBoxModelAdapter(document);

    await expect(createTechnicalSvgExport(adapter)).rejects.toMatchObject({
      code: 'technicalSvgExportInvalid',
      parameters: { reason: 'canonical-svg-already-has-provenance' },
    });
  });

  it('rejects an incorrect canonical byte length before export', async () => {
    const document = await TechnicalCartonDocument.create(loadTechnicalFixture('rte'));
    const adapter = createTechnicalBoxModelAdapter(document);
    const canonical = adapter.getCanonicalSemanticSvg();

    await expect(createTechnicalSvgExport({
      mode: 'technical',
      getCanonicalSemanticSvg: () => ({ ...canonical, byteLength: canonical.byteLength + 1 }),
      getSourceIdentity: () => document.getSourceIdentity(),
    })).rejects.toMatchObject({
      code: 'technicalSvgExportInvalid',
      parameters: { reason: 'canonical-svg-byte-length-mismatch' },
    });
  });

  it('rejects an incorrect content-addressed canonical asset id', async () => {
    const document = await TechnicalCartonDocument.create(loadTechnicalFixture('rte'));
    const adapter = createTechnicalBoxModelAdapter(document);
    const canonical = adapter.getCanonicalSemanticSvg();

    await expect(createTechnicalSvgExport({
      mode: 'technical',
      getCanonicalSemanticSvg: () => ({ ...canonical, assetId: 'svg-0000000000000000' }),
      getSourceIdentity: () => document.getSourceIdentity(),
    })).rejects.toMatchObject({
      code: 'technicalSvgExportInvalid',
      parameters: { reason: 'canonical-svg-asset-id-mismatch' },
    });
  });

  it('rejects a source identity SHA that does not match the canonical bytes', async () => {
    const document = await TechnicalCartonDocument.create(loadTechnicalFixture('rte'));
    const adapter = createTechnicalBoxModelAdapter(document);
    const identity = document.getSourceIdentity();

    await expect(createTechnicalSvgExport({
      mode: 'technical',
      getCanonicalSemanticSvg: () => adapter.getCanonicalSemanticSvg(),
      getSourceIdentity: () => ({ ...identity, svgSha256: 'f'.repeat(64) }),
    })).rejects.toMatchObject({
      code: 'technicalSvgExportInvalid',
      parameters: { reason: 'source-svg-sha256-mismatch' },
    });
  });

  it('rejects provenance whose parsed JSON differs from the built object', async () => {
    const document = await TechnicalCartonDocument.create(loadTechnicalFixture('rte'));
    const adapter = createTechnicalBoxModelAdapter(document);
    const exported = await createTechnicalSvgExport(adapter);
    const provenanceMetadata = metadataBlock(exported, 'cartonbuilder-export-provenance');
    const provenance = decodeMetadata(provenanceMetadata);
    const tamperedMetadata = provenanceMetadata.replace(
      '&quot;cartonType&quot;:&quot;RTE&quot;',
      '&quot;cartonType&quot;:&quot;STE&quot;',
    );
    const tampered = exported.replace(provenanceMetadata, tamperedMetadata);

    expect(() => validateTechnicalSvgProvenance(tampered, provenance)).toThrowError(expect.objectContaining({
      code: 'technicalSvgExportInvalid',
      parameters: { reason: 'provenance-mismatch' },
    }));
  });

  it('keeps canonical semantic SVG access read-only and fails closed without it', async () => {
    const bundle = loadTechnicalFixture('rte');
    const document = await TechnicalCartonDocument.create(bundle);
    const adapter = createTechnicalBoxModelAdapter(document);
    const canonical = document.getCanonicalSemanticSvg();
    canonical.markup = 'MUTATED';
    canonical.assetId = 'MUTATED';
    expect(document.getCanonicalSemanticSvg().markup).toBe(bundle.semanticSvg.markup);
    expect(document.getCanonicalSemanticSvg().assetId).toBe(bundle.semanticSvg.assetId);

    const sourceIdentity = document.getSourceIdentity();
    expect(() => createExportSvg({
      mode: 'technical',
      getCanonicalSemanticSvg: () => null,
      getSourceIdentity: () => sourceIdentity,
    })).toThrowError(expect.objectContaining({
      code: 'technicalSvgExportInvalid',
      parameters: { reason: 'technical-svg-export-must-use-async-path' },
    }));
    expect(() => createExportSvg({
      mode: 'technical',
      getCanonicalSemanticSvg: () => ({ ...adapter.getCanonicalSemanticSvg(), markup: '<svg />' }),
      getSourceIdentity: () => sourceIdentity,
    })).toThrow(AppError);
  });
});
