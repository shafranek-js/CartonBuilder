import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import {
  getAdjacentBasis,
  normalizeDimensions,
  rectanglesOverlap,
} from '../../src/model/geometry.js';

function createReferenceNet(dimensions) {
  const model = new BoxNetModel(dimensions);
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

describe('BoxNetModel', () => {
  it('creates the default Front Panel', () => {
    const model = new BoxNetModel();

    expect(model.dimensions).toEqual({ width: 150, height: 90, depth: 40 });
    expect(model.panelCount).toBe(1);
    expect(model.getPanel('front')).toMatchObject({
      width: 150,
      height: 90,
      x: 0,
      y: 0,
      parentId: null,
    });
    expect(model.isComplete).toBe(false);
  });

  it.each([
    [{ width: 0, height: 90, depth: 40 }, 'width must be a positive number.'],
    [{ width: -1, height: 90, depth: 40 }, 'width must be a positive number.'],
    [{ width: Number.NaN, height: 90, depth: 40 }, 'width must be a positive number.'],
    [{ width: 100001, height: 90, depth: 40 }, 'width is too large.'],
  ])('rejects invalid dimensions', (dimensions, message) => {
    expect(() => normalizeDimensions(dimensions)).toThrow(message);
  });

  it('accepts decimal dimensions and the maximum value', () => {
    expect(normalizeDimensions({ width: 150.5, height: 90.25, depth: 100000 })).toEqual({
      width: 150.5,
      height: 90.25,
      depth: 100000,
    });
  });

  it('rotates the Front Panel basis across every edge', () => {
    const front = new BoxNetModel().getPanel('front');

    expect(getAdjacentBasis(front, 'top').normal).toEqual([0, 1, 0]);
    expect(getAdjacentBasis(front, 'right').normal).toEqual([1, 0, 0]);
    expect(getAdjacentBasis(front, 'bottom').normal).toEqual([0, -1, 0]);
    expect(getAdjacentBasis(front, 'left').normal).toEqual([-1, 0, 0]);
  });

  it('builds the documented six-panel reference net', () => {
    const model = createReferenceNet();

    expect(model.isComplete).toBe(true);
    expect(model.getPanels().map((panel) => panel.id)).toEqual([
      'front',
      'bottom',
      'top',
      'back',
      'left',
      'right',
    ]);
    expect(model.getPanels().map(({ id, x, y, width, height, parentId, parentEdge }) => ({
      id,
      x,
      y,
      width,
      height,
      parentId,
      parentEdge,
    }))).toEqual([
      { id: 'front', x: 0, y: 0, width: 150, height: 90, parentId: null, parentEdge: null },
      { id: 'bottom', x: 0, y: 90, width: 150, height: 40, parentId: 'front', parentEdge: 'bottom' },
      { id: 'top', x: 0, y: -40, width: 150, height: 40, parentId: 'front', parentEdge: 'top' },
      { id: 'back', x: 0, y: -130, width: 150, height: 90, parentId: 'top', parentEdge: 'top' },
      { id: 'left', x: -40, y: 0, width: 40, height: 90, parentId: 'front', parentEdge: 'left' },
      { id: 'right', x: 150, y: -130, width: 40, height: 90, parentId: 'back', parentEdge: 'right' },
    ]);
    expect(model.getBounds()).toEqual({
      minX: -40,
      minY: -130,
      maxX: 190,
      maxY: 130,
      width: 230,
      height: 260,
    });
  });

  it('prevents duplicate faces even when reached from another panel', () => {
    const model = new BoxNetModel();
    model.addPanel('front', 'bottom');
    model.addPanel('bottom', 'left');

    expect(model.getPanel('left')).not.toBeNull();
    expect(model.getPotential('front', 'left')).toBeNull();
  });

  it('rejects occupied geometry and allows edge contact', () => {
    expect(rectanglesOverlap(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 9, y: 0, width: 10, height: 10 },
    )).toBe(true);
    expect(rectanglesOverlap(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 },
    )).toBe(false);

    const model = new BoxNetModel();
    model.panels.set('blocker', {
      id: 'blocker',
      faceKey: 'blocker',
      faceName: 'Blocker',
      x: 0,
      y: -40,
      width: 150,
      height: 40,
      order: 1,
      parentId: null,
      parentEdge: null,
      links: { top: null, right: null, bottom: null, left: null },
      basis: { normal: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0] },
    });

    expect(model.getPotential('front', 'top')).toBeNull();
  });

  it('only deletes leaf panels and restores their parent edge', () => {
    const model = new BoxNetModel();
    model.addPanel('front', 'top');
    model.addPanel('top', 'top');

    expect(model.deletePanel('front')).toBe(false);
    expect(model.deletePanel('top')).toBe(false);
    expect(model.deletePanel('back')).toBe(true);
    expect(model.getPanel('top').links.top).toBeNull();
    expect(model.getEligibleEdges('top')).toContain('top');
  });

  it('returns an independent serialized state', () => {
    const model = createReferenceNet();
    const state = model.toJSON();

    state.dimensions.width = 1;
    state.panels[0].basis.normal[0] = 99;

    expect(model.dimensions.width).toBe(150);
    expect(model.getPanel('front').basis.normal).toEqual([0, 0, 1]);
  });
});
