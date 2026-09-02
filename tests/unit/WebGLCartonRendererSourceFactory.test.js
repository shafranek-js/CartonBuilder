import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';

function makeSource(sourceOptions) {
  const renderSurface = {
    scene: { id: 'injected-scene' },
    camera: { id: 'injected-camera' },
    renderer: { id: 'injected-renderer' },
  };
  return {
    ...renderSurface,
    renderSurface,
    geometryMode: 'solid',
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
    getCameraState: vi.fn(),
    createPortableScene: vi.fn(),
    fitCameraToFrame: vi.fn(),
    resetView: vi.fn(),
    replaceArtwork: vi.fn(),
    setBoardAppearance: vi.fn(),
    setBackgroundAsset: vi.fn(),
    setEnvironmentAsset: vi.fn(),
    renderToPixels: vi.fn(),
    resize: vi.fn(),
    getResourceInfo: vi.fn(),
    getGeometryDiagnostics: vi.fn(),
    getDiagnostics: vi.fn(() => ({ source: 'injected' })),
    getBounds: vi.fn(),
    dispose: vi.fn(),
    sourceOptions,
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
  LegacyRenderSceneSource: vi.fn((sourceOptions) => makeSource(sourceOptions)),
}));

vi.mock('../../src/render/RenderPostProcessing.js', () => ({
  RenderPostProcessing: vi.fn(() => makePostProcessing()),
}));

vi.mock('../../src/render/RenderQualityManager.js', () => ({
  RenderQualityManager: vi.fn(() => makeQualityManager()),
}));

import { LegacyRenderSceneSource } from '../../src/render/LegacyRenderSceneSource.js';
import { WebGLCartonRenderer } from '../../src/render/WebGLCartonRenderer.js';

function makeRendererArgs() {
  const renderSettings = structuredClone(DEFAULT_RENDER_SETTINGS);
  renderSettings.camera.projection = 'orthographic';
  renderSettings.camera.fov = 52;
  renderSettings.lighting.environment = 'cool';
  renderSettings.material.profile = 'gloss';
  renderSettings.background.mode = 'transparent';
  renderSettings.effects.gtao.enabled = false;
  renderSettings.effects.dof.enabled = true;

  return {
    canvas: { id: 'render-canvas' },
    container: { id: 'render-container' },
    boxModel: { id: 'box-model' },
    sceneModel: { artworks: [] },
    textureCanvas: { id: 'texture-canvas' },
    materialMaps: { normal: { id: 'normal-map' } },
    renderSettings,
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

describe('WebGLCartonRenderer scene source factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the injected source factory once with the established Legacy source options', () => {
    const args = makeRendererArgs();
    let receivedOptions;
    const injectedSource = makeSource();
    const sceneSourceFactory = vi.fn((sourceOptions) => {
      receivedOptions = sourceOptions;
      return injectedSource;
    });

    const renderer = new WebGLCartonRenderer({ ...args, sceneSourceFactory });

    expect(sceneSourceFactory).toHaveBeenCalledTimes(1);
    expect(LegacyRenderSceneSource).not.toHaveBeenCalled();
    expect(receivedOptions).toMatchObject({
      canvas: args.canvas,
      container: args.container,
      boxModel: args.boxModel,
      textureCanvas: args.textureCanvas,
      materialMaps: args.materialMaps,
      foldProgress: 1,
      cameraProjection: args.renderSettings.camera.projection,
      cameraFov: args.renderSettings.camera.fov,
      environmentPreset: args.renderSettings.lighting.environment,
      environmentMap: args.renderSettings.lighting.environmentMap,
      materialProfile: args.renderSettings.material.profile,
      geometryMode: 'solid',
      backgroundAsset: args.backgroundAsset,
      environmentAsset: args.environmentAsset,
    });
    expect(renderer.source).toBe(injectedSource);
    expect(renderer.scene).toBe(injectedSource);

    renderer.dispose();
    expect(injectedSource.dispose).toHaveBeenCalledTimes(1);
    expect(LegacyRenderSceneSource).not.toHaveBeenCalled();
  });

  it('keeps the default LegacyRenderSceneSource path when no factory is provided', () => {
    const args = makeRendererArgs();
    const renderer = new WebGLCartonRenderer(args);

    expect(LegacyRenderSceneSource).toHaveBeenCalledTimes(1);
    expect(LegacyRenderSceneSource).toHaveBeenCalledWith(expect.objectContaining({
      canvas: args.canvas,
      container: args.container,
      boxModel: args.boxModel,
      textureCanvas: args.textureCanvas,
      materialMaps: args.materialMaps,
    }));
    expect(renderer.source).toBe(LegacyRenderSceneSource.mock.results[0].value);

    renderer.dispose();
    expect(renderer.source.dispose).toHaveBeenCalledTimes(1);
  });
});
