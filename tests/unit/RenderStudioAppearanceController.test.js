import { describe, expect, it, vi } from 'vitest';
import {
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Texture,
} from 'three';

import { RenderStudioAppearanceController } from '../../src/render/RenderStudioAppearanceController.js';

function makeSurface() {
  const scene = new Scene();
  const renderer = {
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: { enabled: false, needsUpdate: false },
    setClearColor: vi.fn(),
  };
  const renderSurface = { scene, camera: {}, renderer };
  return {
    renderSurface,
    render: vi.fn(),
  };
}

function makeBounds() {
  return {
    minX: -0.4,
    minY: -0.2,
    minZ: -0.3,
    maxX: 0.6,
    maxY: 0.8,
    maxZ: 0.7,
    centerX: 0.1,
    centerY: 0.3,
    centerZ: 0.2,
    radius: 0.75,
    units: 'm',
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeDependencies(overrides = {}) {
  const environmentTexture = new Texture();
  const backgroundTexture = new Texture();
  const surface = overrides.surface || makeSurface();
  const boundsProvider = overrides.boundsProvider || vi.fn(makeBounds);
  const materialProfileSetter = overrides.materialProfileSetter || vi.fn(() => 'material-result');
  const environmentAdapter = overrides.environmentAdapter || {
    setEnvironment: vi.fn(() => environmentTexture),
    setEnvironmentMap: vi.fn(() => ({ texture: environmentTexture })),
    setEnvironmentAsset: vi.fn(() => Promise.resolve({ texture: environmentTexture })),
    dispose: vi.fn(),
  };
  const backgroundAdapter = overrides.backgroundAdapter || {
    setBackgroundImage: vi.fn(() => backgroundTexture),
    setBackgroundAsset: vi.fn(() => Promise.resolve({ texture: backgroundTexture })),
    dispose: vi.fn(),
  };
  const reflectionAdapter = overrides.reflectionAdapter || {
    setFloorReflection: vi.fn(() => 'reflection-result'),
    dispose: vi.fn(),
  };
  const threeFactories = overrides.threeFactories || {
    createGroup: vi.fn(() => new Group()),
    createHemisphereLight: vi.fn((...args) => new HemisphereLight(...args)),
    createDirectionalLight: vi.fn((...args) => new DirectionalLight(...args)),
    createPlaneGeometry: vi.fn((...args) => new PlaneGeometry(...args)),
    createShadowMaterial: vi.fn((...args) => new ShadowMaterial(...args)),
    createMesh: vi.fn((...args) => new Mesh(...args)),
  };
  const controller = new RenderStudioAppearanceController({
    surface,
    boundsProvider,
    materialProfileSetter,
    environmentAdapter,
    backgroundAdapter,
    reflectionAdapter,
    threeFactories,
  });
  return {
    controller,
    surface,
    boundsProvider,
    materialProfileSetter,
    environmentAdapter,
    backgroundAdapter,
    reflectionAdapter,
    threeFactories,
    environmentTexture,
    backgroundTexture,
  };
}

describe('RenderStudioAppearanceController', () => {
  it('creates only a single appearance group with lights and a shadow floor', () => {
    const result = makeDependencies();
    const { controller, surface, threeFactories } = result;

    expect(surface.renderSurface.scene.children).toEqual([controller.appearanceGroup]);
    expect(controller.appearanceGroup.name).toBe('RenderStudioAppearance');
    expect(controller.appearanceGroup.children).toContain(controller.hemisphereLight);
    expect(controller.appearanceGroup.children).toContain(controller.directionalLight);
    expect(controller.appearanceGroup.children).toContain(controller.floor);
    expect(controller.floor.receiveShadow).toBe(true);
    expect(controller.appearanceGroup.children.some((node) => node.isCamera)).toBe(false);
    expect(threeFactories.createGroup).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('positions directional light and floor against validated meter bounds', () => {
    const result = makeDependencies();
    const { controller, boundsProvider } = result;
    const before = controller.directionalLight.position.clone();

    expect(controller.setLightDirection(90, 45)).toBe(true);
    expect(boundsProvider).toHaveBeenCalledTimes(1);
    expect(controller.directionalLight.position.equals(before)).toBe(false);
    expect(controller.floor.position.x).toBeCloseTo(0.1);
    expect(controller.floor.position.y).toBeCloseTo(-0.21);
    expect(controller.floor.position.z).toBeCloseTo(0.2);
    expect(controller.floor.scale.x).toBeGreaterThan(0);
    expect(controller.directionalLight.position.y).toBeGreaterThan(0.3);

    controller.dispose();
  });

  it('rejects invalid bounds and appearance inputs before mutating resources', () => {
    const invalidBounds = vi.fn(() => ({ centerX: 0, centerY: 0, centerZ: 0, radius: Number.NaN }));
    const result = makeDependencies({ boundsProvider: invalidBounds });
    const { controller } = result;
    const lightPosition = controller.directionalLight.position.clone();
    const floorPosition = controller.floor.position.clone();
    const floorOpacity = controller.floor.material.opacity;

    expect(() => controller.setLightDirection(20, 40)).toThrow('finite meter bounds');
    expect(controller.directionalLight.position.equals(lightPosition)).toBe(true);
    expect(controller.floor.position.equals(floorPosition)).toBe(true);
    expect(controller.setLightDirection(Number.NaN, 40)).toBe(false);
    expect(controller.setLightIntensity(-1)).toBe(false);
    expect(controller.setShadowMapSize(1000)).toBe(false);
    expect(controller.setShadowBlur(9)).toBe(false);
    expect(controller.setShadowIntensity(2)).toBe(false);
    expect(controller.setExposure(0)).toBe(false);
    expect(controller.floor.material.opacity).toBe(floorOpacity);

    controller.dispose();
  });

  it('updates real renderer tone mapping and exposure without rendering', () => {
    const result = makeDependencies();
    const { controller, surface } = result;

    expect(controller.setToneMapping('none')).toBe(true);
    expect(controller.setExposure(1.35)).toBe(true);
    expect(surface.renderSurface.renderer.toneMapping).toBe(0);
    expect(surface.renderSurface.renderer.toneMappingExposure).toBe(1.35);
    expect(surface.render).not.toHaveBeenCalled();
    expect(controller.setToneMapping('neutral')).toBe(true);
    expect(surface.render).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('updates shadow state, map size, blur and floor intensity without implicit render', () => {
    const result = makeDependencies();
    const { controller, surface } = result;

    expect(controller.setShadowsEnabled(false)).toBe(true);
    expect(controller.setShadowMapSize(2048)).toBe(true);
    expect(controller.setShadowBlur(4)).toBe(true);
    expect(controller.setShadowIntensity(0.6)).toBe(true);
    expect(surface.renderSurface.renderer.shadowMap.enabled).toBe(false);
    expect(controller.directionalLight.castShadow).toBe(false);
    expect(controller.directionalLight.shadow.mapSize.x).toBe(2048);
    expect(controller.directionalLight.shadow.mapSize.y).toBe(2048);
    expect(controller.directionalLight.shadow.radius).toBe(4);
    expect(controller.floor.material.opacity).toBe(0.6);
    expect(surface.render).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('switches solid and transparent backgrounds using the real scene and renderer', () => {
    const result = makeDependencies();
    const { controller, surface } = result;

    expect(controller.setBackgroundMode('solid', '#112233')).toBe(true);
    expect(surface.renderSurface.scene.background.isColor).toBe(true);
    expect(surface.renderSurface.scene.background.getHexString()).toBe('112233');
    expect(surface.renderSurface.renderer.setClearColor).toHaveBeenLastCalledWith('#112233', 1);
    expect(controller.setBackgroundMode('transparent')).toBe(true);
    expect(surface.renderSurface.scene.background).toBeNull();
    expect(surface.renderSurface.renderer.setClearColor).toHaveBeenLastCalledWith(0x000000, 0);
    expect(() => controller.setBackgroundMode('solid', 'not-a-color')).toThrow('#rrggbb');
    expect(surface.renderSurface.scene.background).toBeNull();

    controller.dispose();
  });

  it('delegates image and background assets with exact arguments', async () => {
    const result = makeDependencies();
    const { controller, backgroundAdapter, backgroundTexture } = result;
    const image = { fit: 'contain', positionX: 0.25 };
    const asset = { assetId: 'background-1', blob: {} };

    expect(controller.setBackgroundImage(image)).toBe(backgroundTexture);
    expect(backgroundAdapter.setBackgroundImage).toHaveBeenCalledWith(image);
    const assetPromise = controller.setBackgroundAsset(asset, { render: false });
    expect(assetPromise).toBeInstanceOf(Promise);
    await expect(assetPromise).resolves.toEqual({ texture: backgroundTexture });
    expect(backgroundAdapter.setBackgroundAsset).toHaveBeenCalledWith(asset, { render: false });

    controller.dispose();
  });

  it('delegates environment/map/asset, applies returned texture and exposes diagnostics', async () => {
    const result = makeDependencies();
    const {
      controller,
      environmentAdapter,
      environmentTexture,
      surface,
    } = result;
    const map = { source: 'builtin', presetId: 'neutral-softbox', usage: 'both' };
    const asset = { assetId: 'env-1' };

    expect(controller.setEnvironment('cool')).toBe(environmentTexture);
    expect(controller.setEnvironmentMap(map)).toEqual({ texture: environmentTexture });
    expect(surface.renderSurface.scene.environment).toBe(environmentTexture);
    const assetPromise = controller.setEnvironmentAsset(asset);
    expect(assetPromise).toBeInstanceOf(Promise);
    await expect(assetPromise).resolves.toEqual({ texture: environmentTexture });
    expect(environmentAdapter.setEnvironment).toHaveBeenCalledWith('cool');
    expect(environmentAdapter.setEnvironmentMap).toHaveBeenCalledWith(map);
    expect(environmentAdapter.setEnvironmentAsset).toHaveBeenCalledWith(asset);
    expect(controller.environmentAsset).toBe(asset);
    expect(controller.environmentMap).toMatchObject(map);
    expect(controller.getDiagnostics()).toMatchObject({
      environmentPreset: 'cool',
      environmentAsset: asset,
      environmentMap: map,
    });

    controller.dispose();
  });

  it('delegates material and floor reflection exactly without rendering', () => {
    const result = makeDependencies();
    const { controller, materialProfileSetter, reflectionAdapter, surface } = result;
    const reflection = { enabled: true, strength: 0.2 };

    expect(controller.setMaterialProfile('gloss')).toBe('material-result');
    expect(controller.setFloorReflection(reflection, { render: false })).toBe('reflection-result');
    expect(materialProfileSetter).toHaveBeenCalledWith('gloss');
    expect(reflectionAdapter.setFloorReflection).toHaveBeenCalledWith(reflection, { render: false });
    expect(surface.render).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('validates dependencies before factories and disposes adapters once with first-error semantics', () => {
    const factory = vi.fn(() => new Group());
    expect(() => new RenderStudioAppearanceController({
      surface: makeSurface(),
      boundsProvider: vi.fn(makeBounds),
      materialProfileSetter: vi.fn(),
      environmentAdapter: {},
      backgroundAdapter: {},
      reflectionAdapter: {},
      threeFactories: { createGroup: factory },
    })).toThrow('environmentAdapter must implement setEnvironment().');
    expect(factory).not.toHaveBeenCalled();

    const firstError = new Error('reflection cleanup failed');
    const secondError = new Error('environment cleanup failed');
    const sharedAdapter = {
      setEnvironment: vi.fn(),
      setEnvironmentMap: vi.fn(),
      setEnvironmentAsset: vi.fn(),
      setBackgroundImage: vi.fn(),
      setBackgroundAsset: vi.fn(),
      setFloorReflection: vi.fn(),
      dispose: vi.fn(() => { throw secondError; }),
    };
    const reflectionAdapter = {
      setFloorReflection: vi.fn(),
      dispose: vi.fn(() => { throw firstError; }),
    };
    const result = makeDependencies({
      environmentAdapter: sharedAdapter,
      backgroundAdapter: sharedAdapter,
      reflectionAdapter,
    });
    expect(() => result.controller.dispose()).toThrow(firstError);
    expect(reflectionAdapter.dispose).toHaveBeenCalledTimes(1);
    expect(sharedAdapter.dispose).toHaveBeenCalledTimes(1);
    expect(result.controller.dispose()).toBe(false);
    expect(result.surface.renderSurface.scene.children).not.toContain(result.controller.appearanceGroup);
    expect(result.surface).not.toHaveProperty('disposed', true);
  });
});

describe('RenderStudioAppearanceController runtime regressions', () => {
  it('aims the directional light through its scene-owned target', () => {
    const { controller } = makeDependencies();

    expect(controller.setLightDirection(90, 45)).toBe(true);
    expect(controller.directionalLight.target.parent).toBe(controller.appearanceGroup);
    expect(controller.directionalLight.target.position.toArray()).toEqual([0.1, 0.3, 0.2]);

    controller.dispose();
  });

  it('ignores stale environment and background asset resolutions', async () => {
    const oldEnvironment = deferred();
    const newEnvironment = deferred();
    const oldBackground = deferred();
    const newBackground = deferred();
    const environmentAdapter = {
      setEnvironment: vi.fn(),
      setEnvironmentMap: vi.fn(),
      setEnvironmentAsset: vi.fn()
        .mockReturnValueOnce(oldEnvironment.promise)
        .mockReturnValueOnce(newEnvironment.promise),
      dispose: vi.fn(),
    };
    const backgroundAdapter = {
      setBackgroundImage: vi.fn(),
      setBackgroundAsset: vi.fn()
        .mockReturnValueOnce(oldBackground.promise)
        .mockReturnValueOnce(newBackground.promise),
      dispose: vi.fn(),
    };
    const { controller, surface } = makeDependencies({ environmentAdapter, backgroundAdapter });
    const oldEnvironmentTexture = new Texture();
    const newEnvironmentTexture = new Texture();
    const oldBackgroundTexture = new Texture();
    const newBackgroundTexture = new Texture();

    controller.setBackgroundMode('image');
    const oldEnvironmentResult = controller.setEnvironmentAsset({ assetId: 'old-environment' });
    const newEnvironmentResult = controller.setEnvironmentAsset({ assetId: 'new-environment' });
    const oldBackgroundResult = controller.setBackgroundAsset({ assetId: 'old-background' });
    const newBackgroundResult = controller.setBackgroundAsset({ assetId: 'new-background' });

    newEnvironment.resolve({ texture: newEnvironmentTexture });
    newBackground.resolve({ texture: newBackgroundTexture });
    await Promise.all([newEnvironmentResult, newBackgroundResult]);
    expect(surface.renderSurface.scene.environment).toBe(newEnvironmentTexture);
    expect(surface.renderSurface.scene.background).toBe(newBackgroundTexture);

    oldEnvironment.resolve({ texture: oldEnvironmentTexture });
    oldBackground.resolve({ texture: oldBackgroundTexture });
    await Promise.all([oldEnvironmentResult, oldBackgroundResult]);
    expect(surface.renderSurface.scene.environment).toBe(newEnvironmentTexture);
    expect(surface.renderSurface.scene.background).toBe(newBackgroundTexture);

    controller.dispose();
  });

  it('does not mutate the scene when assets resolve after disposal', async () => {
    const environmentLoad = deferred();
    const backgroundLoad = deferred();
    const environmentAdapter = {
      setEnvironment: vi.fn(),
      setEnvironmentMap: vi.fn(),
      setEnvironmentAsset: vi.fn(() => environmentLoad.promise),
      dispose: vi.fn(),
    };
    const backgroundAdapter = {
      setBackgroundImage: vi.fn(),
      setBackgroundAsset: vi.fn(() => backgroundLoad.promise),
      dispose: vi.fn(),
    };
    const { controller, surface } = makeDependencies({ environmentAdapter, backgroundAdapter });

    controller.setBackgroundMode('image');
    const environmentResult = controller.setEnvironmentAsset({ assetId: 'environment' });
    const backgroundResult = controller.setBackgroundAsset({ assetId: 'background' });
    controller.dispose();
    const environmentBeforeResolution = surface.renderSurface.scene.environment;
    const backgroundBeforeResolution = surface.renderSurface.scene.background;

    environmentLoad.resolve({ texture: new Texture() });
    backgroundLoad.resolve({ texture: new Texture() });
    await Promise.all([environmentResult, backgroundResult]);
    expect(surface.renderSurface.scene.environment).toBe(environmentBeforeResolution);
    expect(surface.renderSurface.scene.background).toBe(backgroundBeforeResolution);
  });

  it('disposes replaced and active shadow maps exactly once', () => {
    const { controller } = makeDependencies();
    const replacedDepthTexture = { dispose: vi.fn() };
    const replacedMap = { depthTexture: replacedDepthTexture, dispose: vi.fn() };
    const activeDepthTexture = { dispose: vi.fn() };
    const activeMap = { depthTexture: activeDepthTexture, dispose: vi.fn() };

    controller.directionalLight.shadow.map = replacedMap;
    expect(controller.setShadowMapSize(2048)).toBe(true);
    expect(replacedDepthTexture.dispose).toHaveBeenCalledTimes(1);
    expect(replacedMap.dispose).toHaveBeenCalledTimes(1);
    expect(controller.directionalLight.shadow.map).toBeNull();

    controller.directionalLight.shadow.map = activeMap;
    expect(controller.dispose()).toBe(true);
    expect(activeDepthTexture.dispose).toHaveBeenCalledTimes(1);
    expect(activeMap.dispose).toHaveBeenCalledTimes(1);
    expect(controller.dispose()).toBe(false);
    expect(activeDepthTexture.dispose).toHaveBeenCalledTimes(1);
    expect(activeMap.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('RenderStudioAppearanceController render state transaction', () => {
  it('applies temporary output state and restores it once without rendering', () => {
    const { controller, reflectionAdapter, surface } = makeDependencies();
    const initialReflection = {
      enabled: true,
      strength: 0.3,
      blur: 0.4,
      fadeDistance: 0.8,
      includeInTransparentExport: true,
    };
    controller.setBackgroundMode('solid', '#123456');
    controller.setShadowsEnabled(true);
    controller.setShadowIntensity(0.6);
    controller.setFloorReflection(initialReflection, { render: false });
    const initialDiagnostics = controller.getDiagnostics();
    surface.render.mockClear();
    reflectionAdapter.setFloorReflection.mockClear();

    const restore = controller.beginRenderStateTransaction({
      backgroundMode: 'transparent',
      backgroundColor: '#000000',
      includeShadow: false,
      includeReflection: false,
    });

    expect(controller.getDiagnostics()).toMatchObject({
      backgroundMode: 'transparent',
      backgroundColor: '#000000',
      shadowEnabled: false,
      shadowIntensity: 0,
      floorReflection: { ...initialReflection, enabled: false },
    });
    expect(surface.renderSurface.scene.background).toBeNull();
    expect(surface.render).not.toHaveBeenCalled();

    expect(restore()).toBe(true);
    expect(controller.getDiagnostics()).toMatchObject(initialDiagnostics);
    expect(restore()).toBe(false);
    expect(reflectionAdapter.setFloorReflection).toHaveBeenCalledTimes(2);
    expect(surface.render).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('continues restore after failures, preserves the first error, and remains idempotent', () => {
    const { controller, reflectionAdapter, surface } = makeDependencies();
    const initialReflection = {
      enabled: true,
      strength: 0.25,
      blur: 0.5,
      fadeDistance: 0.9,
      includeInTransparentExport: false,
    };
    controller.setBackgroundMode('solid', '#234567');
    controller.setShadowsEnabled(true);
    controller.setShadowIntensity(0.5);
    controller.setFloorReflection(initialReflection, { render: false });
    const restore = controller.beginRenderStateTransaction({
      backgroundMode: 'transparent',
      includeShadow: false,
      includeReflection: false,
    });
    const firstError = new Error('background restore failed');
    const secondError = new Error('reflection restore failed');
    surface.renderSurface.renderer.setClearColor.mockImplementationOnce(() => { throw firstError; });
    reflectionAdapter.setFloorReflection.mockImplementationOnce(() => { throw secondError; });

    expect(() => restore()).toThrow(firstError);
    expect(controller.getDiagnostics()).toMatchObject({
      shadowEnabled: true,
      shadowIntensity: 0.5,
      floorReflection: initialReflection,
    });
    expect(restore()).toBe(false);
    expect(surface.render).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('rolls back partial application while preserving the original transaction error', () => {
    const { controller, reflectionAdapter, surface } = makeDependencies();
    const initialReflection = {
      enabled: true,
      strength: 0.2,
      blur: 0.55,
      fadeDistance: 0.75,
      includeInTransparentExport: false,
    };
    controller.setBackgroundMode('solid', '#345678');
    controller.setShadowsEnabled(true);
    controller.setShadowIntensity(0.45);
    controller.setFloorReflection(initialReflection, { render: false });
    const initialDiagnostics = controller.getDiagnostics();
    const transactionError = new Error('reflection override failed');
    const rollbackError = new Error('reflection rollback failed');
    reflectionAdapter.setFloorReflection
      .mockImplementationOnce(() => { throw transactionError; })
      .mockImplementationOnce(() => { throw rollbackError; });

    expect(() => controller.beginRenderStateTransaction({
      backgroundMode: 'transparent',
      includeShadow: false,
      includeReflection: false,
    })).toThrow(transactionError);
    expect(controller.getDiagnostics()).toMatchObject(initialDiagnostics);
    expect(surface.render).not.toHaveBeenCalled();

    controller.dispose();
  });
});
