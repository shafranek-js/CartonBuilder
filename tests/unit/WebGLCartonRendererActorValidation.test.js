import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';

function makeSurface(label) {
  return {
    scene: { id: `${label}-scene` },
    camera: { id: `${label}-camera` },
    renderer: { id: `${label}-renderer` },
  };
}

function makeActor(label, renderSurface = makeSurface(label)) {
  return {
    renderSurface,
    scene: renderSurface.scene,
    camera: renderSurface.camera,
    renderer: renderSurface.renderer,
    geometryMode: 'solid',
    environmentAsset: null,
    environmentMap: { resolutionCap: 2048 },
    setToneMapping: vi.fn(),
    setRenderCallback: vi.fn(),
    setFinishSummary: vi.fn(),
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
    setCameraProjection: vi.fn(),
    getCameraState: vi.fn(() => ({ preset: 'isometric' })),
    fitCameraToFrame: vi.fn(),
    resetView: vi.fn(),
    setBackgroundAsset: vi.fn(() => Promise.resolve(true)),
    setEnvironmentAsset: vi.fn(() => Promise.resolve(true)),
    render: vi.fn(),
    resize: vi.fn(),
    renderToPixels: vi.fn(() => Promise.resolve({ pixels: [1], width: 1, height: 1 })),
    replaceArtwork: vi.fn(),
    setBoardAppearance: vi.fn(),
    createPortableScene: vi.fn(),
    getBounds: vi.fn(),
    getDiagnostics: vi.fn(() => ({ source: label })),
    dispose: vi.fn(),
  };
}

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

vi.mock('../../src/render/LegacyRenderSceneSource.js', () => ({
  LegacyRenderSceneSource: vi.fn(() => makeActor('legacy')),
}));

vi.mock('../../src/render/RenderPostProcessing.js', () => ({
  RenderPostProcessing: vi.fn(() => makePostProcessing()),
}));

vi.mock('../../src/render/RenderQualityManager.js', () => ({
  RenderQualityManager: vi.fn(() => makeQualityManager()),
}));

import { RenderPostProcessing } from '../../src/render/RenderPostProcessing.js';
import { RenderQualityManager } from '../../src/render/RenderQualityManager.js';
import { WebGLCartonRenderer } from '../../src/render/WebGLCartonRenderer.js';

function makeRendererArgs() {
  return {
    canvas: { id: 'render-canvas' },
    container: { clientWidth: 800, clientHeight: 600 },
    boxModel: { id: 'box-model' },
    sceneModel: { artworks: [] },
    textureCanvas: { id: 'texture-canvas' },
    materialMaps: { normal: { id: 'normal-map' } },
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

function createSplitRenderer(source, controller) {
  return new WebGLCartonRenderer({
    ...makeRendererArgs(),
    sceneSourceFactory: vi.fn(() => source),
    sceneController: controller,
  });
}

describe('WebGLCartonRenderer actor validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts valid different actors with one shared render surface', () => {
    const surface = makeSurface('shared');
    const source = makeActor('source', surface);
    const controller = makeActor('controller', surface);

    const renderer = createSplitRenderer(source, controller);

    expect(renderer.source).toBe(source);
    expect(renderer.sceneController).toBe(controller);
    expect(RenderPostProcessing).toHaveBeenCalledTimes(1);
    expect(RenderQualityManager).toHaveBeenCalledTimes(1);

    renderer.dispose();
  });

  it('rejects a source without a required method before creating resources', () => {
    const surface = makeSurface('shared');
    const source = makeActor('source', surface);
    const controller = makeActor('controller', surface);
    delete source.createPortableScene;

    expect(() => createSplitRenderer(source, controller)).toThrow(
      'Render scene source must implement createPortableScene().',
    );
    expect(RenderPostProcessing).not.toHaveBeenCalled();
    expect(RenderQualityManager).not.toHaveBeenCalled();
  });

  it('rejects a controller without a required method before creating resources', () => {
    const surface = makeSurface('shared');
    const source = makeActor('source', surface);
    const controller = makeActor('controller', surface);
    delete controller.renderToPixels;

    expect(() => createSplitRenderer(source, controller)).toThrow(
      'Render scene controller must implement renderToPixels().',
    );
    expect(RenderPostProcessing).not.toHaveBeenCalled();
    expect(RenderQualityManager).not.toHaveBeenCalled();
  });

  it('rejects malformed and mismatched surfaces before creating resources', () => {
    const malformedSurface = makeSurface('malformed');
    delete malformedSurface.renderer;
    const malformedSource = makeActor('source', malformedSurface);
    const malformedController = makeActor('controller', malformedSurface);

    expect(() => createSplitRenderer(malformedSource, malformedController)).toThrow(
      'Render scene source renderSurface must provide renderer.',
    );

    const source = makeActor('source', makeSurface('source'));
    const controller = makeActor('controller', makeSurface('controller'));
    expect(() => createSplitRenderer(source, controller)).toThrow(
      'Render source and scene controller must share renderSurface.scene.',
    );

    expect(RenderPostProcessing).not.toHaveBeenCalled();
    expect(RenderQualityManager).not.toHaveBeenCalled();
  });

  it('allows methods that WebGLCartonRenderer calls optionally to be absent', async () => {
    const surface = makeSurface('shared');
    const source = makeActor('source', surface);
    const controller = makeActor('controller', surface);
    delete source.setFinishSummary;
    delete controller.setEnvironmentMap;
    delete controller.setEnvironmentAsset;
    delete controller.setCameraProjection;

    const renderer = createSplitRenderer(source, controller);
    await renderer.initialize({ artworks: [] });

    expect(controller.render).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });

  it('tracks camera identity through renderSurface without a controller.camera mirror', () => {
    const surface = makeSurface('shared');
    const source = makeActor('source', surface);
    const controller = makeActor('controller', surface);
    delete controller.camera;
    const renderer = createSplitRenderer(source, controller);
    const postProcessing = RenderPostProcessing.mock.results[0].value;
    const nextCamera = { id: 'replacement-camera' };
    controller.setCameraState.mockImplementation(() => {
      surface.camera = nextCamera;
    });
    postProcessing.setScene.mockClear();

    renderer.setCameraState({ preset: 'front' });

    expect(postProcessing.setScene).toHaveBeenCalledWith(surface.scene, nextCamera);
    renderer.dispose();
  });
});
