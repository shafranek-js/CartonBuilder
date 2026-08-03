import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import {
  buildRenderSceneModel,
  getRenderArtworkSignature,
} from '../../src/render/RenderSceneModel.js';

function completeBox() {
  const model = new BoxNetModel();
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

function artwork(id, visible = true) {
  const json = {
    source: { id, previewWidthPx: 1200, previewHeightPx: 800 },
    centerXmm: 75,
    centerYmm: 45,
    initialWidthMm: 140,
    initialHeightMm: 70,
    scaleX: 1,
    scaleY: 1,
    rotation: 90,
    opacity: 0.7,
    crop: { x: 2, y: 3, width: 120, height: 60 },
    pdfLayerVisibility: { logo: true },
  };
  return {
    model: {
      hasArtwork: true,
      toJSON: () => structuredClone(json),
    },
    visible,
    previewBlob: new Blob(['preview'], { type: 'image/png' }),
  };
}

describe('RenderSceneModel', () => {
  it('always describes a closed carton and filters hidden artwork', () => {
    const box = completeBox();
    const scene = buildRenderSceneModel({
      boxModel: box,
      artworks: [artwork('visible'), artwork('hidden', false)],
      renderSettings: DEFAULT_RENDER_SETTINGS,
    });

    expect(scene.foldProgress).toBe(1);
    expect(scene.box.panels).toHaveLength(6);
    expect(scene.panelGeometry).toHaveLength(6);
    expect(scene.geometryMode).toBe('solid');
    expect(scene.hingeOffsetMm).toBeCloseTo(0.175);
    expect(scene.flatNetUvs).toHaveLength(6);
    expect(scene.foldTransforms.every((entry) => entry.progress === 1)).toBe(true);
    expect(scene.materials.profile).toBe('matte');
    expect(scene.artworks).toHaveLength(1);
    expect(scene.artworks[0].model.toJSON().crop).toEqual({ x: 2, y: 3, width: 120, height: 60 });
  });

  it('does not mutate canonical box or artwork state', () => {
    const box = completeBox();
    const before = box.toJSON();
    const entry = artwork('stable');
    const artworkBefore = entry.model.toJSON();
    const scene = buildRenderSceneModel({ boxModel: box, artworks: [entry] });

    scene.box.dimensions.width = 1;
    scene.box.panels[0].x = 999;
    expect(box.toJSON()).toEqual(before);
    expect(entry.model.toJSON()).toEqual(artworkBefore);
  });

  it('creates a stable signature from artwork ordering and placement', () => {
    const box = completeBox();
    const first = buildRenderSceneModel({ boxModel: box, artworks: [artwork('a'), artwork('b')] });
    const second = buildRenderSceneModel({ boxModel: box, artworks: [artwork('a'), artwork('b')] });
    const reversed = buildRenderSceneModel({ boxModel: box, artworks: [artwork('b'), artwork('a')] });

    expect(getRenderArtworkSignature(first)).toBe(getRenderArtworkSignature(second));
    expect(getRenderArtworkSignature(first)).not.toBe(getRenderArtworkSignature(reversed));
  });

  it('includes packaging finish state in the Render signature', () => {
    const box = completeBox();
    const entry = artwork('finish');
    const print = buildRenderSceneModel({ boxModel: box, artworks: [entry] });
    const finish = buildRenderSceneModel({
      boxModel: box,
      artworks: [{
        ...entry,
        outputRole: 'finish',
        finish: { type: 'foil', maskChannel: 'alpha', foilColor: '#d4af37', intensity: 0.8 },
      }],
    });

    expect(finish.artworks[0].outputRole).toBe('finish');
    expect(finish.artworks[0].finish.type).toBe('foil');
    expect(getRenderArtworkSignature(finish)).not.toBe(getRenderArtworkSignature(print));
  });

  it('requires at least one visible artwork', () => {
    expect(() => buildRenderSceneModel({
      boxModel: completeBox(),
      artworks: [artwork('hidden', false)],
    })).toThrow('visible artwork');
  });
});
