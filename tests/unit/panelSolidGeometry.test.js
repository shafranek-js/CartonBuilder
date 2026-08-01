import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { createPanelSolidGeometry } from '../../src/render/panelSolidGeometry.js';

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
});
