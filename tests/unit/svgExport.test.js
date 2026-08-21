import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createExportSvg,
  formatNumber,
  getExportFilename,
} from '../../src/export/svgExport.js';
import { TechnicalCartonDocument } from '../../src/carton/TechnicalCartonDocument.js';
import { createTechnicalBoxModelAdapter } from '../../src/carton/technicalBoxModelAdapter.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { AppError } from '../../src/errors.js';
import { validateSvgV4Export } from '../../src/workflow/export/svgMetadata.mjs';
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
      const exported = createExportSvg(model);
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
          sourceSemanticSvgSha256: createHash('sha256').update(bundle.semanticSvg.markup).digest('hex'),
        },
        status: { referenceOnly: true, productionCertified: false },
      });
      expect(provenance.source.cartonType).toBe(name === 'tt_sl123' ? 'TT_SL123' : name.toUpperCase());
      expect(provenance.status).toEqual({ referenceOnly: true, productionCertified: false });

      expect(exported.replace(provenanceMetadata, '')).toBe(bundle.semanticSvg.markup);
      expect(createExportSvg(model)).toBe(exported);
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
    })).toThrow(AppError);
    expect(() => createExportSvg({
      mode: 'technical',
      getCanonicalSemanticSvg: () => ({ ...adapter.getCanonicalSemanticSvg(), markup: '<svg />' }),
      getSourceIdentity: () => sourceIdentity,
    })).toThrowError(expect.objectContaining({ code: 'technicalSvgExportInvalid' }));
  });
});
