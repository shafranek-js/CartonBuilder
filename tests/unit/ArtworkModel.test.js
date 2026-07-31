import { describe, expect, it } from 'vitest';

import { ArtworkModel } from '../../src/artwork/ArtworkModel.js';
import { HistoryManager } from '../../src/artwork/HistoryManager.js';
import { ViewportModel } from '../../src/artwork/ViewportModel.js';

const bounds = { minX: -40, minY: -130, width: 230, height: 260 };
const source = {
  id: 'asset-1',
  fileName: 'artwork.png',
  mimeType: 'image/png',
  byteLength: 1000,
  widthPx: 3000,
  heightPx: 2000,
};

describe('ArtworkModel', () => {
  it('fits and centres artwork inside the dieline', () => {
    const model = new ArtworkModel().load(source, bounds);

    expect(model.centerXmm).toBe(75);
    expect(model.centerYmm).toBe(0);
    expect(model.initialWidthMm).toBe(230);
    expect(model.initialHeightMm).toBeCloseTo(153.333);
    expect(model.scale).toBe(1);
    expect(model.modified).toBe(false);
  });

  it('keeps proportions and swaps displayed dimensions after rotation', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setDisplayedWidth(115);

    expect(model.scale).toBe(0.5);
    expect(model.displayedHeightMm).toBeCloseTo(76.667);

    model.rotateQuarterTurns(1);
    expect(model.displayedWidthMm).toBeCloseTo(76.667);
    expect(model.displayedHeightMm).toBe(115);
  });

  it('calculates effective DPI from physical placement', () => {
    const model = new ArtworkModel().load(source, bounds);
    const dpi = model.getEffectiveDpi();

    expect(dpi).toBeCloseTo(331.304, 2);
    model.setScale(2);
    expect(model.getEffectiveDpi()).toBeCloseTo(dpi / 2);
  });

  it('round-trips independent serialized state', () => {
    const original = new ArtworkModel().load(source, bounds);
    original.moveBy(12, -4).setOpacity(0.6).rotateQuarterTurns(1);

    const state = original.toJSON();
    const restored = new ArtworkModel(state);
    state.source.fileName = 'changed.png';

    expect(restored.toJSON()).toEqual(original.toJSON());
    expect(restored.source.fileName).toBe('artwork.png');
  });

  it('clamps background opacity, persists it and resets to the default', () => {
    const model = new ArtworkModel().load(source, bounds);

    expect(model.bgOpacity).toBe(0.28);
    model.setBgOpacity(2);
    expect(model.bgOpacity).toBe(1);
    model.setBgOpacity(-1);
    expect(model.bgOpacity).toBe(0);
    model.setBgOpacity(0.5);

    const restored = new ArtworkModel(model.toJSON());
    expect(restored.bgOpacity).toBe(0.5);
    restored.resetTransform();
    expect(restored.bgOpacity).toBe(0.28);
  });

  it('keeps PDF page rotation as the initial canonical rotation', () => {
    const model = new ArtworkModel().load({
      ...source,
      mimeType: 'application/pdf',
      vector: true,
      pdfPageRotation: 90,
    }, bounds);

    expect(model.rotation).toBe(90);
    expect(model.displayedWidthMm).toBeCloseTo(173.333, 2);
    expect(model.displayedHeightMm).toBeCloseTo(260);
    expect(model.modified).toBe(false);
    model.rotateQuarterTurns(1).resetTransform();
    expect(model.rotation).toBe(90);
  });
});

describe('ViewportModel', () => {
  it('fits bounds and round-trips screen coordinates', () => {
    const viewport = new ViewportModel().fit(bounds, 1000, 700, 40);
    const screen = viewport.modelToScreen(75, 0);

    expect(screen.x).toBeCloseTo(500);
    expect(screen.y).toBeCloseTo(350);
    const restored = viewport.screenToModel(screen.x, screen.y);
    expect(restored.x).toBeCloseTo(75);
    expect(restored.y).toBeCloseTo(0);
  });

  it('keeps the model anchor fixed while zooming', () => {
    const viewport = new ViewportModel({ zoom: 2, panX: 10, panY: 20 });
    const before = viewport.screenToModel(300, 200);

    viewport.zoomAt(300, 200, 1.5);

    expect(viewport.screenToModel(300, 200)).toEqual(before);
  });
});

describe('HistoryManager', () => {
  it('undoes and redoes committed editor states', () => {
    let applied = null;
    const history = new HistoryManager({ limit: 2, apply: (state) => { applied = state; } });

    history.commit('first', { value: 1 }, { value: 2 });
    history.commit('second', { value: 2 }, { value: 3 });

    expect(history.undo()).toBe('second');
    expect(applied).toEqual({ value: 2 });
    expect(history.redo()).toBe('second');
    expect(applied).toEqual({ value: 3 });
  });

  it('caps history at the configured limit', () => {
    const history = new HistoryManager({ limit: 2, apply: () => {} });
    history.commit('one', { value: 0 }, { value: 1 });
    history.commit('two', { value: 1 }, { value: 2 });
    history.commit('three', { value: 2 }, { value: 3 });

    expect(history.undoStack.map(({ label }) => label)).toEqual(['two', 'three']);
  });
});
