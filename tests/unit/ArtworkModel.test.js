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
  it('stores independent preview and render quality preferences', () => {
    const model = new ArtworkModel().load(source, bounds);

    expect(model.quality).toEqual({ preview: 'auto', render: 'auto' });
    model.setPreviewQuality(600).setRenderQuality('2400');
    expect(model.toJSON().quality).toEqual({ preview: 600, render: 2400 });

    const restored = new ArtworkModel(model.toJSON());
    expect(restored.quality).toEqual({ preview: 600, render: 2400 });
    restored.setPreviewQuality(2400);
    expect(restored.quality.preview).toBe('auto');
    restored.setQuality({ preview: 999, render: 'unknown' });
    expect(restored.quality).toEqual({ preview: 'auto', render: 'auto' });
  });

  it('fits and centres artwork inside the dieline', () => {
    const model = new ArtworkModel().load(source, bounds);

    expect(model.centerXmm).toBe(75);
    expect(model.centerYmm).toBe(0);
    expect(model.initialWidthMm).toBe(230);
    expect(model.initialHeightMm).toBeCloseTo(153.333);
    expect(model.scaleX).toBe(1);
    expect(model.scaleY).toBe(1);
    expect(model.modified).toBe(false);
  });

  it('keeps proportions and swaps displayed dimensions after rotation', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setScale(0.5);

    expect(model.scaleX).toBe(0.5);
    expect(model.scaleY).toBe(0.5);
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

  it('defaults to the center reference point and reports its coordinates', () => {
    const model = new ArtworkModel().load(source, bounds);

    expect(model.referencePoint).toBe('center');
    expect(model.getReferencePosition()).toEqual({ x: 75, y: 0 });

    model.setReferencePoint('top-left');
    expect(model.referencePoint).toBe('top-left');
    expect(model.getReferencePosition().x).toBeCloseTo(-40, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(-76.667, 2);
    expect(model.centerXmm).toBe(75);
    expect(model.centerYmm).toBe(0);
    expect(model.modified).toBe(false);
  });

  it('keeps the selected reference point fixed when scaling', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setReferencePoint('top-left');
    const before = model.getReferencePosition();

    model.setScale(2);

    expect(model.getReferencePosition().x).toBeCloseTo(before.x, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(before.y, 5);
    expect(model.scaleX).toBe(2);
    expect(model.scaleY).toBe(2);
  });

  it('moves the selected reference point to the entered coordinates', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setReferencePoint('top-left');

    model.setReferencePosition(0, 0);

    expect(model.getReferencePosition().x).toBeCloseTo(0, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(0, 5);
    expect(model.centerXmm).toBeCloseTo(115, 5);
    expect(model.centerYmm).toBeCloseTo(76.667, 2);
  });

  it('keeps the selected reference point fixed when rotating', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setReferencePoint('top-left');
    const before = model.getReferencePosition();

    model.rotateQuarterTurns(1);

    expect(model.rotation).toBe(90);
    expect(model.getReferencePosition().x).toBeCloseTo(before.x, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(before.y, 5);
  });

  it('keeps the selected reference point fixed for Fit and Fill', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setReferencePoint('bottom-right');
    const before = model.getReferencePosition();

    model.fitDieline(bounds);
    expect(model.getReferencePosition().x).toBeCloseTo(before.x, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(before.y, 5);

    model.setReferencePoint('top-center');
    const fillBefore = model.getReferencePosition();
    model.fillDieline(bounds);
    expect(model.getReferencePosition().x).toBeCloseTo(fillBefore.x, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(fillBefore.y, 5);
  });

  it('persists the reference point and falls back to center for old projects', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setReferencePoint('bottom-center');

    const restored = new ArtworkModel(model.toJSON());
    expect(restored.referencePoint).toBe('bottom-center');

    const oldState = model.toJSON();
    delete oldState.referencePoint;
    const legacy = new ArtworkModel(oldState);
    expect(legacy.referencePoint).toBe('center');

    const invalid = new ArtworkModel({ ...model.toJSON(), referencePoint: 'nowhere' });
    expect(invalid.referencePoint).toBe('center');
  });

  it('does not change the reference point on reset transform', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setReferencePoint('middle-right');
    model.moveBy(10, 20).rotateQuarterTurns(1);

    model.resetTransform();

    expect(model.referencePoint).toBe('middle-right');
  });

  it('tracks PDF layer visibility and round-trips it', () => {
    const model = new ArtworkModel().load({
      ...source,
      pdfLayers: [
        { id: 'a', name: 'Background', group: null },
        { id: 'b', name: 'Labels', group: 'Set' },
      ],
      pdfLayerVisibility: { a: true, b: false },
    }, bounds);

    expect(model.hasPdfLayers).toBe(true);
    expect(model.hasArtwork).toBe(true);
    expect(model.source.pdfLayers).toEqual([
      { id: 'a', name: 'Background', group: null },
      { id: 'b', name: 'Labels', group: 'Set' },
    ]);
    expect(model.pdfLayerVisibility).toEqual({ a: true, b: false });

    model.pdfLayerVisibility.b = true;
    const restored = new ArtworkModel(model.toJSON());
    expect(restored.pdfLayerVisibility).toEqual({ a: true, b: true });
    expect(restored.hasPdfLayers).toBe(true);
  });

  it('defaults PDF layers to null for old projects', () => {
    const model = new ArtworkModel().load(source, bounds);
    expect(model.hasPdfLayers).toBe(false);
    expect(model.pdfLayerVisibility).toBe(null);

    const restored = new ArtworkModel(model.toJSON());
    expect(restored.pdfLayerVisibility).toBe(null);
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

  it('treats an asymmetric crop as the visible artwork geometry', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.applyCrop({ x: 20, y: 10, width: 80, height: 40 });

    expect(model.visibleLocalRect).toEqual({ x: 20, y: 10, width: 80, height: 40 });
    expect(model.displayedWidthMm).toBe(80);
    expect(model.displayedHeightMm).toBe(40);
    expect(model.visibleCenter.x).toBeCloseTo(20, 5);
    expect(model.visibleCenter.y).toBeCloseTo(-46.667, 2);
    expect(model.bounds).toMatchObject({ width: 80, height: 40 });

    const centerBeforeRotation = model.visibleCenter;
    model.rotateQuarterTurns(1);
    expect(model.displayedWidthMm).toBe(40);
    expect(model.displayedHeightMm).toBe(80);
    expect(model.visibleCenter.x).toBeCloseTo(centerBeforeRotation.x, 5);
    expect(model.visibleCenter.y).toBeCloseTo(centerBeforeRotation.y, 5);
    expect(model.getReferencePosition()).toEqual(model.visibleCenter);
  });

  it('rebases an applied crop to 100 percent without changing its pixels', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setScaleX(0.5);
    model.setScaleY(0.75);
    const fullSize = { width: model.unrotatedWidthMm, height: model.unrotatedHeightMm };
    const sourceCenter = { x: model.centerXmm, y: model.centerYmm };

    model.applyCrop({ x: 10, y: 12, width: 50, height: 35 });

    expect(model.scaleX).toBe(1);
    expect(model.scaleY).toBe(1);
    expect(model.unrotatedWidthMm).toBeCloseTo(fullSize.width, 5);
    expect(model.unrotatedHeightMm).toBeCloseTo(fullSize.height, 5);
    expect(model.centerXmm).toBeCloseTo(sourceCenter.x, 5);
    expect(model.centerYmm).toBeCloseTo(sourceCenter.y, 5);
    expect(model.crop).toEqual({ x: 10, y: 12, width: 50, height: 35 });
  });

  it('scales crop geometry with the source while keeping its reference fixed', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.applyCrop({ x: 20, y: 10, width: 80, height: 40 });
    model.setReferencePoint('top-left');
    const reference = model.getReferencePosition();

    model.setScaleX(2);
    model.setScaleY(1.5);

    expect(model.crop).toEqual({ x: 40, y: 15, width: 160, height: 60 });
    expect(model.getReferencePosition().x).toBeCloseTo(reference.x, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(reference.y, 5);
    expect(model.displayedWidthMm).toBeCloseTo(160, 5);
    expect(model.displayedHeightMm).toBeCloseTo(60, 5);
  });

  it('clears the mask without moving the previously visible fragment', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.applyCrop({ x: 8, y: 10, width: 80, height: 40 });
    model.setVisibleCenter(180, 90);
    model.setScale(1.5);
    const visiblePlacement = {
      center: model.visibleCenter,
      reference: model.getReferencePosition(),
    };

    model.clearCrop();

    expect(model.crop).toBeNull();
    expect(model.visibleCenter.x).toBeCloseTo(visiblePlacement.center.x, 5);
    expect(model.visibleCenter.y).toBeCloseTo(visiblePlacement.center.y, 5);
    expect(model.getReferencePosition().x).toBeCloseTo(visiblePlacement.reference.x, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(visiblePlacement.reference.y, 5);
    expect(model.displayedWidthMm).toBeCloseTo(model.unrotatedWidthMm, 5);
    expect(model.displayedHeightMm).toBeCloseTo(model.unrotatedHeightMm, 5);
  });

  it('flips horizontally through the reference point keeping it fixed', () => {
    const model = new ArtworkModel().load(source, bounds);
    const centerBefore = { x: model.centerXmm, y: model.centerYmm };
    const reference = model.getReferencePosition();

    model.flipHorizontal();

    expect(model.flipX).toBe(true);
    expect(model.flipY).toBe(false);
    expect(model.centerXmm).toBeCloseTo(2 * reference.x - centerBefore.x, 5);
    expect(model.centerYmm).toBeCloseTo(centerBefore.y, 5);
    expect(model.getReferencePosition().x).toBeCloseTo(reference.x, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(reference.y, 5);
  });

  it('flips vertically around an off-center reference point', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.setReferencePoint('bottom-right');
    const reference = model.getReferencePosition();
    const centerBefore = { x: model.centerXmm, y: model.centerYmm };

    model.flipVertical();

    expect(model.flipY).toBe(true);
    expect(model.centerYmm).toBeCloseTo(2 * reference.y - centerBefore.y, 5);
    expect(model.centerXmm).toBeCloseTo(centerBefore.x, 5);
    expect(model.getReferencePosition().y).toBeCloseTo(reference.y, 5);
  });

  it('mirrors the visible crop rect when flipped', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.applyCrop({ x: 20, y: 10, width: 80, height: 40 });

    model.flipHorizontal();
    expect(model.visibleLocalRect).toEqual({
      x: model.unrotatedWidthMm - 20 - 80,
      y: 10,
      width: 80,
      height: 40,
    });
    expect(model.visibleLocalRectRaw).toEqual({ x: 20, y: 10, width: 80, height: 40 });

    model.flipVertical();
    expect(model.visibleLocalRect.y).toBeCloseTo(model.unrotatedHeightMm - 10 - 40, 5);
  });

  it('round-trips flip state through serialization', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.flipHorizontal().flipVertical();

    const restored = new ArtworkModel(model.toJSON());
    expect(restored.flipX).toBe(true);
    expect(restored.flipY).toBe(true);
    expect(restored.toJSON()).toEqual(model.toJSON());
  });

  it('resets flip flags on resetTransform', () => {
    const model = new ArtworkModel().load(source, bounds);
    model.flipHorizontal().flipVertical();
    model.resetTransform();
    expect(model.flipX).toBe(false);
    expect(model.flipY).toBe(false);
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
