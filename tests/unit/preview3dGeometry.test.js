import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { getPanelVertexData } from '../../src/preview3d/panelGeometry.js';

function createReferenceNet() {
  const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

function uvForNetPoint(bounds, x, y) {
  return [
    (x - bounds.minX) / bounds.width,
    1 - (y - bounds.minY) / bounds.height,
  ];
}

describe('3D panel geometry', () => {
  it('maps every panel corner from canonical flat-net coordinates', () => {
    const model = createReferenceNet();
    const bounds = model.getBounds();

    for (const panel of model.getPanels()) {
      const data = getPanelVertexData(panel, bounds);
      const expected = [
        uvForNetPoint(bounds, panel.x, panel.y + panel.height),
        uvForNetPoint(bounds, panel.x + panel.width, panel.y + panel.height),
        uvForNetPoint(bounds, panel.x + panel.width, panel.y),
        uvForNetPoint(bounds, panel.x, panel.y),
      ].flat();
      data.uvs.forEach((value, index) => {
        expect(value).toBeCloseTo(expected[index], 8);
      });
      expect(data.positions).toEqual([
        -panel.width / 2, -panel.height / 2, 0,
        panel.width / 2, -panel.height / 2, 0,
        panel.width / 2, panel.height / 2, 0,
        -panel.width / 2, panel.height / 2, 0,
      ]);
    }
  });

  it('uses identical UV coordinates on every shared fold line', () => {
    const model = createReferenceNet();
    const bounds = model.getBounds();

    for (const panel of model.getPanels()) {
      if (!panel.parentId) continue;
      const parent = model.getPanel(panel.parentId);
      const horizontal = panel.parentEdge === 'top' || panel.parentEdge === 'bottom';
      const parentPoints = horizontal
        ? [[panel.x, panel.parentEdge === 'top' ? parent.y : parent.y + parent.height],
          [panel.x + panel.width, panel.parentEdge === 'top' ? parent.y : parent.y + parent.height]]
        : [[panel.parentEdge === 'left' ? parent.x : parent.x + parent.width, panel.y],
          [panel.parentEdge === 'left' ? parent.x : parent.x + parent.width, panel.y + panel.height]];
      const childPoints = horizontal
        ? [[panel.x, panel.parentEdge === 'top' ? panel.y + panel.height : panel.y],
          [panel.x + panel.width, panel.parentEdge === 'top' ? panel.y + panel.height : panel.y]]
        : [[panel.parentEdge === 'left' ? panel.x + panel.width : panel.x, panel.y],
          [panel.parentEdge === 'left' ? panel.x + panel.width : panel.x, panel.y + panel.height]];

      expect(parentPoints.map(([x, y]) => uvForNetPoint(bounds, x, y)))
        .toEqual(childPoints.map(([x, y]) => uvForNetPoint(bounds, x, y)));
    }
  });
});
