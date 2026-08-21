import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TechnicalCartonDocument } from '../../../src/carton/TechnicalCartonDocument.js';
import { createTechnicalBoxModelAdapter } from '../../../src/carton/technicalBoxModelAdapter.js';
import { getDielineSegments, getPanelMaskPath } from '../../../src/model/dieline.js';
import { createExportSvg } from '../../../src/export/svgExport.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/workflow/fixtures');
const expectedArcCounts = { rte: 19, ste: 20, tt_sl123: 21 };
function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}-workflow.v1.json`), 'utf8'));
}

describe('technical artwork compatibility model', () => {
  it('projects semantic surfaces and exact dieline primitives without changing the source document', async () => {
    const bundle = loadFixture('rte');
    const document = await TechnicalCartonDocument.create(bundle);
    const adapter = createTechnicalBoxModelAdapter(document);

    expect(adapter.mode).toBe('technical');
    expect(adapter.isComplete).toBe(true);
    expect(adapter.getElements().length).toBeGreaterThan(0);
    expect(adapter.getPanels()).toEqual(adapter.getElements());
    expect(adapter.getDielinePrimitives()).toEqual(document.getDielinePrimitives());
    expect(adapter.getBounds()).toEqual(document.getBounds());
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

      const svg = createExportSvg(adapter);
      expect(svg).toContain('<path');
      expect(svg).toContain('A');
      for (const primitive of sourcePrimitives.filter((item) => item.role === 'OPEN_CUT')) {
        expect(consumed.some((item) => item.start.x === primitive.start.x && item.start.y === primitive.start.y)).toBe(true);
      }
    });
  }
});
