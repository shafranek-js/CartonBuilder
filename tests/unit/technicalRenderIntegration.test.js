import { readFileSync } from 'node:fs';

import { JSDOM } from 'jsdom';
import {
  PerspectiveCamera,
  Scene,
  Texture,
} from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTechnicalPortableScene } from '../../src/render/technicalPortableScene.js';
import { resolveTechnicalRenderBounds } from '../../src/render/technicalRenderDependencies.js';
import { TechnicalRenderSceneSource } from '../../src/render/TechnicalRenderSceneSource.js';
import { createTechnicalFoldRuntime } from '../../src/render/technicalRenderDependencies.js';

const fixture = JSON.parse(readFileSync(
  new URL('../../src/workflow/fixtures/rte-workflow.v1.json', import.meta.url),
  'utf8',
));

let dom;
let hadDomParser;
let previousDomParser;

beforeEach(() => {
  hadDomParser = Object.prototype.hasOwnProperty.call(globalThis, 'DOMParser');
  previousDomParser = globalThis.DOMParser;
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.DOMParser = dom.window.DOMParser;
});

afterEach(() => {
  if (hadDomParser) globalThis.DOMParser = previousDomParser;
  else delete globalThis.DOMParser;
  dom?.window.close();
  dom = null;
  vi.restoreAllMocks();
});

describe('real Technical Render composition', () => {
  it('composes the vendored runtime, RTE SVG, bounds, artwork replacement, and portable teardown', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.01, 100);
    const renderSurface = { scene, camera, renderer: null };
    const runtime = createTechnicalFoldRuntime();
    const source = new TechnicalRenderSceneSource({
      runtime,
      renderSurface,
      boundsResolver: resolveTechnicalRenderBounds,
      portableSceneFactory: createTechnicalPortableScene,
    });
    const firstTexture = new Texture();
    const secondTexture = new Texture();
    const firstTextureDispose = vi.spyOn(firstTexture, 'dispose');
    const secondTextureDispose = vi.spyOn(secondTexture, 'dispose');
    let portable = null;

    try {
      expect(source.buildScene({
        semanticSvg: fixture.semanticSvg.markup,
        artworkAtlas: firstTexture,
      })).toBe(renderSurface);

      const liveModel = source.model;
      const livePanel = liveModel.children
        .flatMap((node) => node.children || [])
        .find((node) => node.userData?.panel_id);
      const liveCrease = (() => {
        let result = null;
        liveModel.traverse((node) => {
          if (!result && node.userData?.fold_id) result = node;
        });
        return result;
      })();
      const liveGeometry = livePanel.geometry;
      const liveMaterial = Array.isArray(livePanel.material)
        ? livePanel.material[0]
        : livePanel.material;
      const liveGeometryDispose = vi.spyOn(liveGeometry, 'dispose');
      const liveMaterialDispose = vi.spyOn(liveMaterial, 'dispose');
      const liveFoldGraph = source.foldGraph;
      const liveBounds = source.getBounds();
      const liveBoundsWithUnits = resolveTechnicalRenderBounds({ model: liveModel });

      expect(scene.children).toContain(liveModel);
      expect(liveModel.scale.toArray()).toEqual([1, 1, 1]);
      expect(runtime.getFoldProgress()).toBe(1);
      expect(liveBoundsWithUnits).toMatchObject({ units: 'm' });
      expect(Object.values(liveBoundsWithUnits).every((value) => (
        typeof value === 'string' || Number.isFinite(value)
      ))).toBe(true);
      expect(liveBoundsWithUnits.width).toBeGreaterThan(0.05);
      expect(liveBoundsWithUnits.width).toBeLessThan(2);
      expect(liveBounds.width).toBe(liveBoundsWithUnits.width);
      expect(livePanel).toBeTruthy();
      expect(livePanel.userData.panel_id).toBeTruthy();
      expect(liveCrease).toBeTruthy();
      expect(liveCrease.userData.fold_id).toBeTruthy();
      expect(liveMaterial.map).toBe(firstTexture);
      expect(source.getDiagnostics()).toMatchObject({
        source: 'technical',
        built: true,
        foldProgress: 1,
      });

      source.replaceArtwork(secondTexture);
      expect(source.model).toBe(liveModel);
      expect(source.foldGraph).toBe(liveFoldGraph);
      expect(liveModel.getObjectByName(livePanel.name)).toBe(livePanel);
      expect(livePanel.geometry).toBe(liveGeometry);
      expect(liveMaterial.map).toBe(secondTexture);
      expect(firstTextureDispose).toHaveBeenCalledTimes(1);

      portable = source.createPortableScene();
      const portableModel = portable.scene.children.find((child) => !child.isCamera);
      const portablePanel = portableModel.getObjectByName(livePanel.name);
      const portableCrease = portableModel.getObjectByName(liveCrease.name);
      const portableBounds = resolveTechnicalRenderBounds({ model: portableModel });
      const portableTexture = portablePanel.material[0].map;
      const portableTextureDispose = vi.spyOn(portableTexture, 'dispose');

      expect(portable.scene).not.toBe(scene);
      expect(portableModel).not.toBe(liveModel);
      expect(portableModel.scale.toArray()).toEqual([1, 1, 1]);
      expect(portablePanel.userData.panel_id).toBe(livePanel.userData.panel_id);
      expect(portableCrease.userData.fold_id).toBe(liveCrease.userData.fold_id);
      expect(portableBounds).toMatchObject({ units: 'm' });
      expect(portableBounds.width).toBeCloseTo(liveBoundsWithUnits.width, 9);
      expect(portableBounds.height).toBeCloseTo(liveBoundsWithUnits.height, 9);
      expect(portableBounds.depth).toBeCloseTo(liveBoundsWithUnits.depth, 9);

      portable.dispose();
      expect(portableTextureDispose).toHaveBeenCalledTimes(1);
      expect(liveGeometryDispose).not.toHaveBeenCalled();
      expect(liveMaterialDispose).not.toHaveBeenCalled();
      expect(secondTextureDispose).not.toHaveBeenCalled();

      expect(source.dispose()).toBe(true);
      expect(source.dispose()).toBe(false);
      portable = null;
      expect(scene.children).toEqual([]);
      expect(runtime.getModel()).toBeNull();
      expect(liveGeometryDispose).toHaveBeenCalledTimes(1);
      expect(liveMaterialDispose).toHaveBeenCalledTimes(1);
      expect(secondTextureDispose).toHaveBeenCalledTimes(1);
    } finally {
      portable?.dispose();
      source.dispose();
    }
  });
});
