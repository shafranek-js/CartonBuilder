import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { createPanelSolidGeometry } from '../../src/render/panelSolidGeometry.js';
import { getPanelVertexData } from '../../src/preview3d/panelGeometry.js';

describe('panelSolidGeometry', () => {
  it('creates exterior, interior and edge groups with thickness', () => {
    const model = new BoxNetModel();
    model.addPanel('front', 'bottom');
    const panel = model.getPanels()[0];
    const geometry = createPanelSolidGeometry(panel, { widthMm: 120, heightMm: 80 }, {
      thicknessMm: 0.4,
      bevelRadiusMm: 0.1,
    });
    expect(geometry.getAttribute('position').count).toBeGreaterThan(8);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2]);
    expect(geometry.getAttribute('uv').count).toBe(geometry.getAttribute('position').count);
    expect(geometry.boundingBox.min.z).toBeCloseTo(-0.2);
    expect(geometry.boundingBox.max.z).toBeCloseTo(0.2);
    geometry.dispose();
  });

  it('keeps exterior UV orientation aligned with the flat Preview panel', () => {
    const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
    const panel = model.getPanel('front');
    const bounds = model.getBounds();
    const geometry = createPanelSolidGeometry(panel, bounds, { thicknessMm: 0.4, bevelRadiusMm: 0 });
    const previewData = getPanelVertexData(panel, bounds);
    const uv = geometry.getAttribute('uv');

    for (let index = 0; index < 4; index += 1) {
      expect(uv.getX(index + 1)).toBeCloseTo(previewData.uvs[index * 2], 8);
      expect(uv.getY(index + 1)).toBeCloseTo(previewData.uvs[index * 2 + 1], 8);
    }
    geometry.dispose();
  });
});
