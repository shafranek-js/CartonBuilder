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
import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';

vi.mock('../../src/render/LegacyRenderSceneSource.js', () => ({
  LegacyRenderSceneSource: vi.fn(),
}));

function makePostProcessing() {
  return {
    render: vi.fn(),
    setScene: vi.fn(),
    setEffects: vi.fn(),
    setTransparent: vi.fn(),
    setQualityState: vi.fn(),
    setRenderScale: vi.fn(),
    resize: vi.fn(),
    renderToTarget: vi.fn(),
    getDiagnostics: vi.fn(() => ({})),
    dispose: vi.fn(),
  };
}

function makeQualityManager() {
  return {
    scale: 1,
    setProfile: vi.fn(),
    markInteraction: vi.fn(),
    beginExport: vi.fn(),
    endExport: vi.fn(),
    recordFrame: vi.fn(),
    getDiagnostics: vi.fn(() => ({})),
    dispose: vi.fn(),
  };
}

vi.mock('../../src/render/RenderPostProcessing.js', () => ({
  RenderPostProcessing: vi.fn(() => makePostProcessing()),
}));

vi.mock('../../src/render/RenderQualityManager.js', () => ({
  RenderQualityManager: vi.fn(() => makeQualityManager()),
}));

import { RenderPostProcessing } from '../../src/render/RenderPostProcessing.js';
import { WebGLCartonRenderer } from '../../src/render/WebGLCartonRenderer.js';

const fixture = JSON.parse(readFileSync(
  new URL('../../src/workflow/fixtures/rte-workflow.v1.json', import.meta.url),
  'utf8',
));

let dom;
let hadDomParser;
let previousDomParser;

function makeStudioController(renderSurface) {
  return {
    renderSurface,
    scene: renderSurface.scene,
    camera: renderSurface.camera,
    renderer: renderSurface.renderer,
    geometryMode: 'studio-shell',
    environmentAsset: null,
    environmentMap: { resolutionCap: 2048 },
    setToneMapping: vi.fn(),
    setRenderCallback: vi.fn(),
    setMaterialProfile: vi.fn(),
    setLightDirection: vi.fn(),
    setLightIntensity: vi.fn(),
    setHemisphereIntensity: vi.fn(),
    setEnvironmentIntensity: vi.fn(),
    setEnvironment: vi.fn(),
    setEnvironmentMap: vi.fn(),
    setShadowsEnabled: vi.fn(),
    setShadowMapSize: vi.fn(),
    setShadowBlur: vi.fn(),
    setShadowIntensity: vi.fn(),
    setBackgroundMode: vi.fn(),
    setBackgroundImage: vi.fn(),
    setFloorReflection: vi.fn(),
    setExposure: vi.fn(),
    setCameraPreset: vi.fn(),
    setCameraState: vi.fn(),
    getCameraState: vi.fn(() => ({ preset: 'isometric' })),
    fitCameraToFrame: vi.fn(),
    resetView: vi.fn(),
    setBackgroundAsset: vi.fn(() => Promise.resolve(true)),
    setEnvironmentAsset: vi.fn(() => Promise.resolve(true)),
    render: vi.fn(),
    resize: vi.fn(),
    renderToPixels: vi.fn(() => Promise.resolve({ pixels: [1], width: 1, height: 1 })),
    dispose: vi.fn(),
  };
}

function findNode(root, predicate) {
  let result = null;
  root.traverse((node) => {
    if (!result && predicate(node)) result = node;
  });
  return result;
}

function makeRendererArgs() {
  return {
    canvas: { id: 'technical-canvas' },
    container: { clientWidth: 800, clientHeight: 600 },
    boxModel: { id: 'technical-box-model' },
    sceneModel: { artworks: [] },
    textureCanvas: { id: 'technical-texture-canvas' },
    materialMaps: {},
    renderSettings: structuredClone(DEFAULT_RENDER_SETTINGS),
    boardAppearance: {
      thicknessMm: 0.7,
      bevelRadiusMm: 0.2,
      interiorColor: '#f4f2ec',
      edgeColor: '#c8c1b5',
    },
    windowRef: {
      clearTimeout: vi.fn(),
      performance: { now: vi.fn(() => 0) },
    },
  };
}

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

describe('Technical source through WebGLCartonRenderer composition', () => {
  it('composes real Technical geometry with an injected studio controller and tears down the first error', () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.01, 100);
    const renderSurface = {
      scene,
      camera,
      renderer: { id: 'fake-webgl-renderer' },
    };
    const controller = makeStudioController(renderSurface);
    const firstTexture = new Texture();
    const secondTexture = new Texture();
    const firstTextureDispose = vi.spyOn(firstTexture, 'dispose');
    const secondTextureDispose = vi.spyOn(secondTexture, 'dispose');
    const runtime = createTechnicalFoldRuntime();
    let source = null;
    let renderer = null;
    let portableIndependent = null;
    let portable = null;
    let rendererDisposed = false;

    try {
      const sceneSourceFactory = vi.fn(() => {
        source = new TechnicalRenderSceneSource({
          runtime,
          renderSurface,
          boundsResolver: resolveTechnicalRenderBounds,
          portableSceneFactory: createTechnicalPortableScene,
        });
        source.buildScene({
          semanticSvg: fixture.semanticSvg.markup,
          artworkAtlas: firstTexture,
          name: 'rte-workflow.svg',
        });
        return source;
      });

      renderer = new WebGLCartonRenderer({
        ...makeRendererArgs(),
        sceneSourceFactory,
        sceneController: controller,
      });

      expect(sceneSourceFactory).toHaveBeenCalledTimes(1);
      expect(renderer.source).toBe(source);
      expect(source).toBeInstanceOf(TechnicalRenderSceneSource);
      expect(renderer.sceneController).toBe(controller);
      expect(renderer.scene).toBe(controller);
      expect(source.renderSurface.scene).toBe(controller.renderSurface.scene);
      expect(source.renderSurface.camera).toBe(controller.renderSurface.camera);
      expect(source.renderSurface.renderer).toBe(controller.renderSurface.renderer);

      const liveModel = source.model;
      const livePanel = findNode(liveModel, (node) => node.userData?.panel_id && node.geometry);
      const liveCrease = findNode(liveModel, (node) => node.userData?.fold_id && node.geometry);
      const liveGeometry = livePanel.geometry;
      const liveMaterial = Array.isArray(livePanel.material)
        ? livePanel.material[0]
        : livePanel.material;
      const liveGeometryDispose = vi.spyOn(liveGeometry, 'dispose');
      const liveMaterialDispose = vi.spyOn(liveMaterial, 'dispose');
      const liveFoldGraph = source.foldGraph;
      const bounds = renderer.getBounds();
      const boundsWithUnits = resolveTechnicalRenderBounds({ model: liveModel });

      expect(scene.children).toContain(liveModel);
      expect(liveModel.scale.toArray()).toEqual([1, 1, 1]);
      expect(runtime.getFoldProgress()).toBe(1);
      expect(boundsWithUnits).toMatchObject({ units: 'm' });
      expect(Object.values(boundsWithUnits).every((value) => (
        typeof value === 'string' || Number.isFinite(value)
      ))).toBe(true);
      expect(bounds.width).toBe(boundsWithUnits.width);
      expect(bounds.height).toBe(boundsWithUnits.height);
      expect(bounds.depth).toBe(boundsWithUnits.depth);
      expect(boundsWithUnits.width).toBeGreaterThan(0.05);
      expect(boundsWithUnits.width).toBeLessThan(2);
      expect(livePanel?.userData.panel_id).toBeTruthy();
      expect(liveCrease?.userData.fold_id).toBeTruthy();
      expect(livePanel.material[0]?.map || livePanel.material.map).toBe(firstTexture);
      expect(renderer.getDiagnostics()).toMatchObject({
        source: 'technical',
        built: true,
        foldProgress: 1,
      });
      expect(RenderPostProcessing).toHaveBeenCalledTimes(1);

      renderer.replaceArtwork(secondTexture);
      expect(source.model).toBe(liveModel);
      expect(source.foldGraph).toBe(liveFoldGraph);
      expect(liveModel.getObjectByName(livePanel.name)).toBe(livePanel);
      expect(livePanel.geometry).toBe(liveGeometry);
      expect(livePanel.material[0]?.map || livePanel.material.map).toBe(secondTexture);
      expect(firstTextureDispose).toHaveBeenCalledTimes(1);

      portableIndependent = renderer.createPortableScene({ includeCamera: false });
      const independentModel = portableIndependent.scene.children[0];
      portableIndependent.dispose();
      portableIndependent.dispose();
      expect(portableIndependent.scene.children).toEqual([]);
      expect(liveGeometryDispose).not.toHaveBeenCalled();
      expect(liveMaterialDispose).not.toHaveBeenCalled();
      expect(secondTextureDispose).not.toHaveBeenCalled();
      expect(independentModel).not.toBe(liveModel);

      portable = renderer.createPortableScene();
      const portableModel = portable.scene.children.find((child) => !child.isCamera);
      const portablePanel = portableModel.getObjectByName(livePanel.name);
      const portableCrease = portableModel.getObjectByName(liveCrease.name);
      const portableBounds = resolveTechnicalRenderBounds({ model: portableModel });
      const portableGeometryDispose = vi.spyOn(portablePanel.geometry, 'dispose');
      const portableMaterialDispose = vi.spyOn(
        Array.isArray(portablePanel.material) ? portablePanel.material[0] : portablePanel.material,
        'dispose',
      );
      const portableTexture = Array.isArray(portablePanel.material)
        ? portablePanel.material[0].map
        : portablePanel.material.map;
      const portableTextureDispose = vi.spyOn(portableTexture, 'dispose');

      expect(portable.scene).not.toBe(scene);
      expect(portableModel).not.toBe(liveModel);
      expect(portableModel.scale.toArray()).toEqual([1, 1, 1]);
      expect(portablePanel.userData.panel_id).toBe(livePanel.userData.panel_id);
      expect(portableCrease.userData.fold_id).toBe(liveCrease.userData.fold_id);
      expect(portableBounds).toMatchObject({ units: 'm' });
      expect(portableBounds.width).toBeCloseTo(boundsWithUnits.width, 9);
      expect(portableBounds.height).toBeCloseTo(boundsWithUnits.height, 9);
      expect(portableBounds.depth).toBeCloseTo(boundsWithUnits.depth, 9);

      const sourceTeardownError = new Error('technical source teardown failed');
      const controllerTeardownError = new Error('studio controller teardown failed');
      const originalSourceDispose = source.dispose.bind(source);
      const sourceDispose = vi.spyOn(source, 'dispose').mockImplementation(() => {
        originalSourceDispose();
        throw sourceTeardownError;
      });
      controller.dispose.mockImplementation(() => {
        throw controllerTeardownError;
      });

      expect(() => renderer.dispose()).toThrow(sourceTeardownError);
      rendererDisposed = true;

      expect(sourceDispose).toHaveBeenCalledTimes(1);
      expect(controller.dispose).toHaveBeenCalledTimes(1);
      expect(scene.children).toEqual([]);
      expect(runtime.getModel()).toBeNull();
      expect(source.getDiagnostics()).toMatchObject({
        built: false,
        disposed: true,
        foldProgress: null,
      });
      expect(portable.scene.children).toEqual([]);
      expect(portableGeometryDispose).toHaveBeenCalledTimes(1);
      expect(portableMaterialDispose).toHaveBeenCalledTimes(1);
      expect(portableTextureDispose).toHaveBeenCalledTimes(1);
      expect(liveGeometryDispose).toHaveBeenCalledTimes(1);
      expect(liveMaterialDispose).toHaveBeenCalledTimes(1);
      expect(secondTextureDispose).toHaveBeenCalledTimes(1);
    } finally {
      if (!rendererDisposed && renderer) {
        try {
          renderer.dispose();
        } catch {
          // Preserve the assertion failure from the test body.
        }
      } else if (!renderer && source) {
        try {
          source.dispose();
        } catch {
          // Preserve the assertion failure from the test body.
        }
      }
      portableIndependent?.dispose();
      portable?.dispose();
    }
  });
});
