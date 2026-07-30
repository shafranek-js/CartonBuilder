import { describe, expect, it } from 'vitest';

import {
  createExportSvg,
  formatNumber,
  getExportFilename,
} from '../../src/export/svgExport.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';

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
});
