import { describe, expect, it, vi } from 'vitest';
import {
  DataTexture,
  FloatType,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import { RenderStudioBackgroundAdapter } from '../../src/render/RenderStudioBackgroundAdapter.js';
import { RenderStudioEnvironmentAdapter } from '../../src/render/RenderStudioEnvironmentAdapter.js';
import { RenderStudioReflectionAdapter } from '../../src/render/RenderStudioReflectionAdapter.js';
import { createTechnicalRenderStudioRenderer } from '../../src/render/createTechnicalRenderStudioRenderer.js';
import { validateRenderBackground } from '../../src/render/renderAssets.js';

function makeSurface() {
  const scene = {
    add: vi.fn(),
    remove: vi.fn(),
  };
  const renderer = {
    capabilities: { maxTextureSize: 4096 },
    getSize: vi.fn((size) => {
      size.x = 640;
      size.y = 480;
      return size;
    }),
    render: vi.fn(),
  };
  return {
    scene,
    renderer,
    camera: { id: 'camera' },
  };
}

function makeEnvironmentTexture(seed) {
  const texture = new DataTexture(
    new Float32Array([
      seed, seed, seed, 1,
      seed / 2, seed / 2, seed / 2, 1,
      seed, seed / 2, seed, 1,
      seed / 2, seed, seed / 2, 1,
    ]),
    2,
    2,
    RGBAFormat,
    FloatType,
  );
  texture.dispose = vi.fn();
  return texture;
}

function makePmremFactory(targets) {
  return vi.fn(() => ({
    compileEquirectangularShader: vi.fn(),
    fromEquirectangular: vi.fn((source) => {
      const targetTexture = { isTexture: true, source };
      const target = {
        texture: targetTexture,
        dispose: vi.fn(),
      };
      targets.push({ source, target, targetTexture });
      return target;
    }),
    dispose: vi.fn(),
  }));
}

function hdrBlob() {
  return new Blob([
    '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n',
    new Uint8Array([128, 128, 128, 128, 128, 128, 128, 128]),
  ], { type: 'image/vnd.radiance' });
}

function pngBlob(value) {
  return new Blob([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    new Uint8Array([value, value, value]),
  ], { type: 'image/png' });
}

describe('Render Studio production appearance adapters', () => {
  it('loads procedural and packaged environments as linear PMREM resources', async () => {
    const renderSurface = makeSurface();
    const targets = [];
    const loadedAssets = [];
    const adapter = new RenderStudioEnvironmentAdapter({
      renderSurface,
      fetchFn: vi.fn(async () => ({ ok: true, blob: async () => hdrBlob() })),
      textureLoader: vi.fn(async (asset) => {
        loadedAssets.push(asset);
        return makeEnvironmentTexture(1);
      }),
      proceduralTextureFactory: vi.fn(() => makeEnvironmentTexture(0.5)),
      pmremGeneratorFactory: makePmremFactory(targets),
    });

    const procedural = await adapter.setEnvironment('cool');
    expect(procedural.source.colorSpace).toBe(NoColorSpace);
    expect(adapter.getDiagnostics()).toMatchObject({
      source: 'builtin',
      presetId: 'cool-studio',
      effectiveResolution: 2,
      fallbackReason: null,
    });

    const packaged = await adapter.setEnvironmentMap({
      source: 'builtin',
      presetId: 'polyhaven-abandoned-hall-01',
      usage: 'both',
      resolutionCap: 2048,
    });
    expect(packaged).toBe(targets[1].targetTexture);
    expect(loadedAssets[0].source).toBe('builtin');
    expect(adapter.getDiagnostics()).toMatchObject({
      presetId: 'polyhaven-abandoned-hall-01',
      requestedResolution: 2048,
      effectiveResolution: 2,
      fallbackReason: null,
    });
    expect(renderSurface.scene.add).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('disables legacy and canonical no-reflections environments without allocating GPU resources', async () => {
    const renderSurface = makeSurface();
    const proceduralTextureFactory = vi.fn(() => makeEnvironmentTexture(0.5));
    const pmremGeneratorFactory = vi.fn();
    const adapter = new RenderStudioEnvironmentAdapter({
      renderSurface,
      proceduralTextureFactory,
      pmremGeneratorFactory,
    });

    await expect(adapter.setEnvironment('none')).resolves.toBeNull();
    await expect(adapter.setEnvironmentMap({
      source: 'none',
      presetId: 'no-reflections',
      usage: 'lighting',
    })).resolves.toBeNull();

    expect(proceduralTextureFactory).not.toHaveBeenCalled();
    expect(pmremGeneratorFactory).not.toHaveBeenCalled();
    expect(adapter.getDiagnostics()).toMatchObject({
      source: 'none',
      presetId: 'no-reflections',
      effectiveResolution: null,
      fallbackReason: null,
    });
    adapter.dispose();
  });

  it('uses the environment LRU and disposes each cached entry exactly once', async () => {
    const renderSurface = makeSurface();
    const targets = [];
    const pmremGeneratorFactory = makePmremFactory(targets);
    const adapter = new RenderStudioEnvironmentAdapter({
      renderSurface,
      cacheLimit: 2,
      textureLoader: vi.fn(async () => makeEnvironmentTexture(1)),
      proceduralTextureFactory: vi.fn(() => makeEnvironmentTexture(0.5)),
      pmremGeneratorFactory,
    });

    await adapter.setEnvironmentMap({ source: 'builtin', presetId: 'neutral-softbox', resolutionCap: 1024 });
    await adapter.setEnvironmentMap({ source: 'builtin', presetId: 'cool-studio', resolutionCap: 1024 });
    await adapter.setEnvironmentMap({ source: 'builtin', presetId: 'warm-studio', resolutionCap: 1024 });
    await adapter.setEnvironmentMap({ source: 'builtin', presetId: 'warm-studio', resolutionCap: 1024 });

    expect(targets[0].target.dispose).toHaveBeenCalledTimes(1);
    expect(targets[0].source.dispose).toBeTypeOf('function');
    expect(adapter.getDiagnostics().cacheHit).toBe(true);
    expect(adapter.getDiagnostics().cacheEntries).toBe(2);
    expect(pmremGeneratorFactory).toHaveBeenCalledTimes(1);
    adapter.dispose();
    adapter.dispose();
    expect(pmremGeneratorFactory.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
    for (const entry of targets) {
      expect(entry.target.dispose).toHaveBeenCalledTimes(1);
      expect(entry.source.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps the newest environment and disposes stale temporary PMREM resources', async () => {
    const renderSurface = makeSurface();
    const targets = [];
    const pending = [];
    const adapter = new RenderStudioEnvironmentAdapter({
      renderSurface,
      fetchFn: vi.fn(async () => ({ ok: true, blob: async () => hdrBlob() })),
      textureLoader: vi.fn(() => new Promise((resolve) => pending.push(resolve))),
      proceduralTextureFactory: vi.fn(() => makeEnvironmentTexture(0.5)),
      pmremGeneratorFactory: makePmremFactory(targets),
    });

    const first = adapter.setEnvironmentMap({ source: 'builtin', presetId: 'polyhaven-abandoned-hall-01', resolutionCap: 1024 });
    const second = adapter.setEnvironmentMap({ source: 'builtin', presetId: 'polyhaven-abandoned-hall-01', resolutionCap: 2048 });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1](makeEnvironmentTexture(2));
    const newest = await second;
    pending[0](makeEnvironmentTexture(1));
    await first;

    expect(adapter.getDiagnostics().presetId).toBe('polyhaven-abandoned-hall-01');
    expect(newest).toBe(targets[0].targetTexture);
    expect(targets[1].source.dispose).toHaveBeenCalledTimes(1);
    expect(targets[1].target.dispose).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it('falls back safely for an invalid environment asset without disposing its Blob', async () => {
    const renderSurface = makeSurface();
    const adapter = new RenderStudioEnvironmentAdapter({
      renderSurface,
      proceduralTextureFactory: vi.fn(() => makeEnvironmentTexture(0.5)),
      pmremGeneratorFactory: makePmremFactory([]),
    });
    const result = await adapter.setEnvironmentMap({
      source: 'custom',
      assetId: 'missing',
      resolutionCap: 2048,
    });
    expect(result).toBeTruthy();
    expect(adapter.getDiagnostics().fallbackReason).toBeTruthy();
    adapter.dispose();
  });

  it('keeps background state latest-wins and applies sRGB textures', async () => {
    const renderSurface = makeSurface();
    const firstAsset = await validateRenderBackground(pngBlob(1));
    const secondAsset = await validateRenderBackground(pngBlob(2));
    const pending = new Map();
    const loaded = [];
    const urlApi = { revokeObjectURL: vi.fn() };
    const adapter = new RenderStudioBackgroundAdapter({
      renderSurface,
      urlApi,
      textureLoader: vi.fn((asset) => new Promise((resolve) => pending.set(asset.assetId, resolve))),
    });

    const first = adapter.setBackgroundAsset(firstAsset);
    const second = adapter.setBackgroundAsset(secondAsset);
    await vi.waitFor(() => expect(pending.size).toBe(2));
    const secondTexture = { isTexture: true, colorSpace: null, dispose: vi.fn() };
    pending.get(secondAsset.assetId)({ texture: secondTexture, objectUrl: 'blob:second' });
    loaded.push(await second);
    const firstTexture = { isTexture: true, colorSpace: null, dispose: vi.fn() };
    pending.get(firstAsset.assetId)({ texture: firstTexture, objectUrl: 'blob:first' });
    await first;

    expect(loaded[0]).toBe(secondTexture);
    expect(secondTexture.colorSpace).toBe(SRGBColorSpace);
    expect(firstTexture.dispose).toHaveBeenCalledTimes(1);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(adapter.getDiagnostics().assetId).toBe(secondAsset.assetId);
    adapter.dispose();
    expect(secondTexture.dispose).toHaveBeenCalledTimes(1);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:second');
  });

  it('retains the current background after a failed replacement and clears on null', async () => {
    const renderSurface = makeSurface();
    const asset = await validateRenderBackground(pngBlob(3));
    const texture = { isTexture: true, colorSpace: null, dispose: vi.fn() };
    const adapter = new RenderStudioBackgroundAdapter({
      renderSurface,
      textureLoader: vi.fn(async () => ({ texture })),
    });
    await adapter.setBackgroundAsset(asset);
    const invalid = await adapter.setBackgroundAsset(new Blob(['invalid'], { type: 'image/png' }));
    expect(invalid).toBe(texture);
    expect(adapter.getDiagnostics().fallbackReason).toBeTruthy();
    await adapter.setBackgroundAsset(null);
    expect(texture.dispose).toHaveBeenCalledTimes(1);
    adapter.dispose();
    expect(texture.dispose).toHaveBeenCalledTimes(1);
  });

  it('places, hides and restores the production reflection resource from Technical bounds', () => {
    const renderSurface = makeSurface();
    const geometry = [];
    const reflectors = [];
    const adapter = new RenderStudioReflectionAdapter({
      renderSurface,
      boundsProvider: () => ({
        minX: -0.2,
        minY: -0.05,
        minZ: -0.1,
        maxX: 0.2,
        maxY: 0.05,
        maxZ: 0.1,
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        width: 0.4,
        depth: 0.2,
      }),
      planeGeometryFactory: vi.fn(() => {
        const value = { dispose: vi.fn() };
        geometry.push(value);
        return value;
      }),
      reflectorFactory: vi.fn(() => {
        const value = {
          position: { set: vi.fn() },
          rotation: {},
          scale: { set: vi.fn() },
          material: { userData: {}, needsUpdate: false },
          visible: true,
          dispose: vi.fn(),
        };
        reflectors.push(value);
        return value;
      }),
    });

    expect(adapter.setFloorReflection({ enabled: true, strength: 0.4, blur: 0.2, fadeDistance: 0.1 })).toBe(true);
    expect(reflectors[0].position.set).toHaveBeenCalledWith(0, -0.0505, 0);
    expect(reflectors[0].scale.set).toHaveBeenCalledWith(0.6000000000000001, 0.4, 1);
    expect(adapter.getDiagnostics()).toMatchObject({ enabled: true, visible: true, strength: 0.4 });
    expect(adapter.setBackgroundMode('transparent')).toBe(true);
    expect(reflectors[0].visible).toBe(false);
    adapter.setFloorReflection({ includeInTransparentExport: true });
    expect(reflectors[0].visible).toBe(true);
    adapter.handleContextLost();
    expect(reflectors[0].dispose).toHaveBeenCalledTimes(1);
    expect(geometry[0].dispose).toHaveBeenCalledTimes(1);
    adapter.handleContextRestored();
    expect(reflectors).toHaveLength(2);
    adapter.dispose();
    adapter.dispose();
    expect(reflectors[1].dispose).toHaveBeenCalledTimes(1);
    expect(geometry[1].dispose).toHaveBeenCalledTimes(1);
    expect(renderSurface.renderer.render).not.toHaveBeenCalled();
  });

  it('drives production reflection strength, blur and fade through shader uniforms', () => {
    const renderSurface = makeSurface();
    const optionsSeen = [];
    const reflectors = [];
    const adapter = new RenderStudioReflectionAdapter({
      renderSurface,
      boundsProvider: () => ({
        minX: -0.2,
        minY: -0.05,
        minZ: -0.1,
        maxX: 0.2,
        maxY: 0.05,
        maxZ: 0.1,
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        width: 0.4,
        depth: 0.2,
      }),
      planeGeometryFactory: vi.fn(() => ({ dispose: vi.fn() })),
      reflectorFactory: vi.fn((geometry, options) => {
        optionsSeen.push(options);
        const value = {
          position: { set: vi.fn() },
          rotation: {},
          scale: { set: vi.fn() },
          material: {
            uniforms: {
              strength: { value: 0 },
              blur: { value: 0 },
              fadeDistance: { value: 0 },
              texelSize: { value: { set: vi.fn() } },
            },
            userData: {},
            needsUpdate: false,
          },
          visible: true,
          dispose: vi.fn(),
        };
        reflectors.push(value);
        return value;
      }),
    });

    adapter.setFloorReflection({
      enabled: true,
      strength: 0.4,
      blur: 9,
      fadeDistance: 0,
    });

    expect(optionsSeen[0].shader?.name).toBe('CartonBuilderRenderStudioFloorReflectionShader');
    expect(reflectors[0].material.uniforms.strength.value).toBe(0.4);
    expect(reflectors[0].material.uniforms.blur.value).toBe(1);
    expect(reflectors[0].material.uniforms.fadeDistance.value).toBe(0.05);
    expect(reflectors[0].material.uniforms.texelSize.value.set).toHaveBeenCalledWith(1 / 640, 1 / 480);
    expect(adapter.getDiagnostics()).toMatchObject({ blur: 1, fadeDistance: 0.05 });

    adapter.setFloorReflection({ strength: 0.2, blur: 0.3, fadeDistance: 1.5 });
    expect(reflectors[0].material.uniforms.strength.value).toBe(0.2);
    expect(reflectors[0].material.uniforms.blur.value).toBe(0.3);
    expect(reflectors[0].material.uniforms.fadeDistance.value).toBe(1.5);
    adapter.dispose();
  });

  it('creates production defaults after the shared surface while preserving injected adapters', () => {
    const renderSurface = makeSurface();
    const surface = { renderSurface, dispose: vi.fn() };
    const source = {
      renderSurface,
      replaceArtwork: vi.fn(),
      setBoardAppearance: vi.fn(),
      createPortableScene: vi.fn(),
      getBounds: vi.fn(() => ({ centerX: 0, centerY: 0, centerZ: 0, radius: 1, units: 'm' })),
      getDiagnostics: vi.fn(() => ({ source: 'technical', built: true })),
      dispose: vi.fn(),
    };
    const actorMethods = [
      'setToneMapping', 'setRenderCallback', 'setMaterialProfile', 'setLightDirection',
      'setLightIntensity', 'setHemisphereIntensity', 'setEnvironmentIntensity', 'setEnvironment',
      'setShadowsEnabled', 'setShadowMapSize', 'setShadowBlur', 'setShadowIntensity',
      'setBackgroundMode', 'setBackgroundImage', 'setFloorReflection', 'setExposure',
      'setCameraPreset', 'setCameraState', 'getCameraState', 'fitCameraToFrame', 'resetView',
      'setBackgroundAsset', 'setEnvironmentMap', 'setEnvironmentAsset', 'render', 'resize',
      'renderToPixels',
    ];
    const controller = {
      renderSurface,
      ...Object.fromEntries(actorMethods.map((name) => [name, vi.fn()])),
      dispose: vi.fn(),
    };
    const appearance = { dispose: vi.fn() };
    let adapters;
    const options = {
      technicalDocument: {
        isComplete: true,
        workflowMode: 'technical',
        getBundle: vi.fn(() => { throw new Error('bundle must remain source-owned'); }),
      },
      canvas: { id: 'canvas' },
      container: { id: 'container' },
      renderSettings: structuredClone(DEFAULT_RENDER_SETTINGS),
      artworkAtlas: { id: 'atlas' },
      materialProfileSetter: vi.fn(),
      surfaceFactory: vi.fn(() => surface),
      cameraRigFactory: vi.fn(() => ({ dispose: vi.fn() })),
      materialControllerFactory: vi.fn(() => ({
        setMaterialProfile: vi.fn(),
        setBoardAppearance: vi.fn(),
        dispose: vi.fn(),
      })),
      appearanceControllerFactory: vi.fn((input) => {
        adapters = input;
        return appearance;
      }),
      renderTargetServiceFactory: vi.fn(() => ({ dispose: vi.fn() })),
      sceneControllerFactory: vi.fn(() => controller),
      technicalSourceFactory: vi.fn(() => source),
      rendererFactory: vi.fn(({ sceneSourceFactory }) => {
        sceneSourceFactory();
        return { dispose: vi.fn() };
      }),
    };

    createTechnicalRenderStudioRenderer(options);
    expect(adapters.environmentAdapter).toBeInstanceOf(RenderStudioEnvironmentAdapter);
    expect(adapters.backgroundAdapter).toBeInstanceOf(RenderStudioBackgroundAdapter);
    expect(adapters.reflectionAdapter).toBeInstanceOf(RenderStudioReflectionAdapter);
    expect(adapters.environmentAdapter.renderSurface).toBe(renderSurface);
    expect(adapters.backgroundAdapter.renderSurface).toBe(renderSurface);
    expect(adapters.reflectionAdapter.renderSurface).toBe(renderSurface);
    expect(options.technicalDocument.getBundle).not.toHaveBeenCalled();
  });
});
