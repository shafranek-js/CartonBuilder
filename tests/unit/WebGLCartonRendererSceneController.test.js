import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';

function makeSurface(label) {
  return {
    scene: { id: `${label}-scene` },
    camera: { id: `${label}-camera` },
    renderer: { id: `${label}-renderer` },
  };
}

function makeSceneActor(label, renderSurface = makeSurface(label)) {
  return {
    label,
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
    render: vi.fn(),
    getCameraState: vi.fn(() => ({ preset: 'isometric' })),
    createPortableScene: vi.fn(),
    fitCameraToFrame: vi.fn(),
    resetView: vi.fn(),
    replaceArtwork: vi.fn(),
    setBoardAppearance: vi.fn(),
    setBackgroundAsset: vi.fn(() => Promise.resolve(true)),
    setEnvironmentAsset: vi.fn(() => Promise.resolve(true)),
    renderToPixels: vi.fn(() => Promise.resolve({ pixels: [1], width: 1, height: 1 })),
    resize: vi.fn(),
    getResourceInfo: vi.fn(),
    getGeometryDiagnostics: vi.fn(),
    getDiagnostics: vi.fn(() => ({ source: label })),
    getBounds: vi.fn(),
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
  LegacyRenderSceneSource: vi.fn((sourceOptions) => makeSceneActor('legacy')),
}));

vi.mock('../../src/render/RenderPostProcessing.js', () => ({
  RenderPostProcessing: vi.fn(() => makePostProcessing()),
}));

vi.mock('../../src/render/RenderQualityManager.js', () => ({
  RenderQualityManager: vi.fn(() => makeQualityManager()),
}));

import { LegacyRenderSceneSource } from '../../src/render/LegacyRenderSceneSource.js';
import { RenderPostProcessing } from '../../src/render/RenderPostProcessing.js';
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
    backgroundAsset: { assetId: 'background' },
    environmentAsset: { assetId: 'environment' },
    windowRef: {
      clearTimeout: vi.fn(),
      performance: { now: vi.fn(() => 0) },
    },
  };
}

function makeInjectedRenderer({ source, controller }) {
  const args = makeRendererArgs();
  return new WebGLCartonRenderer({
    ...args,
    sceneSourceFactory: vi.fn(() => source),
    sceneController: controller,
  });
}

describe('WebGLCartonRenderer scene controller seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the Quick source as the controller when no controller is provided', async () => {
    const renderer = new WebGLCartonRenderer(makeRendererArgs());

    expect(renderer.sceneController).toBe(renderer.source);
    expect(renderer.scene).toBe(renderer.source);

    await renderer.initialize({ artworks: [] });
    expect(renderer.source.setFinishSummary).toHaveBeenCalledTimes(1);
    expect(renderer.source.render).toHaveBeenCalledTimes(1);

    renderer.dispose();
    expect(renderer.source.setRenderCallback).toHaveBeenLastCalledWith(null);
    expect(renderer.source.dispose).toHaveBeenCalledTimes(1);
    expect(LegacyRenderSceneSource).toHaveBeenCalledTimes(1);
  });

  it('routes geometry operations to source and studio operations to controller', async () => {
    const renderSurface = makeSurface('shared');
    const source = makeSceneActor('source', renderSurface);
    const controller = makeSceneActor('controller', renderSurface);
    source.geometryMode = 'technical-semantic';
    controller.geometryMode = 'studio-shell';
    const renderer = makeInjectedRenderer({ source, controller });
    expect(renderer.sceneController).toBe(controller);
    expect(renderer.scene).toBe(controller);
    vi.clearAllMocks();

    const sceneModel = { artworks: [] };
    await renderer.initialize(sceneModel);
    renderer.replaceArtwork('atlas', { normal: 'normal-map' }, sceneModel);
    renderer.setBoardAppearance(makeRendererArgs().boardAppearance);
    const portableScene = { scene: {}, dispose: vi.fn() };
    const bounds = { units: 'm', width: 1 };
    source.getBounds.mockReturnValue(bounds);
    source.createPortableScene.mockReturnValue(portableScene);

    expect(renderer.createPortableScene({ includeCamera: true })).toBe(portableScene);
    expect(renderer.getBounds()).toBe(bounds);
    const diagnostics = renderer.getDiagnostics();
    expect(diagnostics.source).toBe('source');
    expect(diagnostics.geometryMode).toBe('technical-semantic');

    expect(source.setFinishSummary).toHaveBeenCalledTimes(2);
    expect(source.replaceArtwork).toHaveBeenCalledWith('atlas', { normal: 'normal-map' });
    expect(source.setBoardAppearance).toHaveBeenCalledTimes(1);
    expect(source.createPortableScene).toHaveBeenCalledTimes(1);
    expect(source.getBounds).toHaveBeenCalledTimes(1);
    expect(source.getDiagnostics).toHaveBeenCalledTimes(1);
    expect(source.render).not.toHaveBeenCalled();
    expect(controller.setFinishSummary).not.toHaveBeenCalled();
    expect(controller.replaceArtwork).not.toHaveBeenCalled();
    expect(controller.setBoardAppearance).not.toHaveBeenCalled();
    expect(controller.createPortableScene).not.toHaveBeenCalled();
    expect(controller.getBounds).not.toHaveBeenCalled();
    expect(controller.getDiagnostics).not.toHaveBeenCalled();

    renderer.setCameraState({ preset: 'front' });
    expect(renderer.getCameraState()).toEqual({ preset: 'isometric' });
    renderer.fitCameraToFrame({ padding: 1 });
    renderer.resetView();
    renderer.render();
    expect(await renderer.renderToPixels({ format: 'png' })).toMatchObject({ width: 1, height: 1 });
    expect(renderer.resize(320, 240, 1)).toBe(true);
    await renderer.setBackgroundAsset({ assetId: 'new-background' });
    await renderer.setEnvironmentAsset({ assetId: 'new-environment' });

    expect(controller.setCameraState).toHaveBeenCalledWith({ preset: 'front' });
    expect(controller.getCameraState).toHaveBeenCalledTimes(1);
    expect(controller.fitCameraToFrame).toHaveBeenCalledWith({ padding: 1 });
    expect(controller.resetView).toHaveBeenCalledTimes(1);
    expect(controller.render).toHaveBeenCalledTimes(2);
    expect(controller.renderToPixels).toHaveBeenCalledTimes(1);
    expect(controller.resize).toHaveBeenCalledWith({ width: 320, height: 240, pixelRatio: 1 });
    expect(controller.setBackgroundAsset).toHaveBeenCalledWith(
      { assetId: 'new-background' },
      { render: true },
    );
    expect(controller.setEnvironmentAsset).toHaveBeenCalledWith(
      { assetId: 'new-environment' },
      { render: true },
    );
    expect(source.setCameraState).not.toHaveBeenCalled();
    expect(source.render).not.toHaveBeenCalled();
    expect(source.renderToPixels).not.toHaveBeenCalled();
    expect(source.resize).not.toHaveBeenCalled();
    expect(source.setBackgroundAsset).not.toHaveBeenCalled();
    expect(source.setEnvironmentAsset).not.toHaveBeenCalled();

    renderer.dispose();
  });

  it('disposes separate source and controller once each', () => {
    const renderSurface = makeSurface('shared');
    const source = makeSceneActor('source', renderSurface);
    const controller = makeSceneActor('controller', renderSurface);
    const renderer = makeInjectedRenderer({ source, controller });

    renderer.dispose();

    expect(controller.setRenderCallback).toHaveBeenLastCalledWith(null);
    expect(source.setRenderCallback).not.toHaveBeenCalled();
    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it('still disposes a separate controller when source disposal throws', () => {
    const renderSurface = makeSurface('shared');
    const source = makeSceneActor('source', renderSurface);
    const controller = makeSceneActor('controller', renderSurface);
    const disposalError = new Error('source disposal failed');
    source.dispose.mockImplementation(() => {
      throw disposalError;
    });
    const renderer = makeInjectedRenderer({ source, controller });

    expect(() => renderer.dispose()).toThrow(disposalError);

    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the shared source/controller only once', () => {
    const source = makeSceneActor('shared');
    const args = makeRendererArgs();
    const renderer = new WebGLCartonRenderer({
      ...args,
      sceneSourceFactory: vi.fn(() => source),
      sceneController: source,
    });

    renderer.dispose();

    expect(source.dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched render surfaces before creating post-processing resources', () => {
    const source = makeSceneActor('source', makeSurface('source'));
    const controller = makeSceneActor('controller', makeSurface('controller'));
    const args = makeRendererArgs();

    expect(() => new WebGLCartonRenderer({
      ...args,
      sceneSourceFactory: vi.fn(() => source),
      sceneController: controller,
    })).toThrow('Render source and scene controller must share renderSurface.scene.');
    expect(RenderPostProcessing).not.toHaveBeenCalled();
  });
});
