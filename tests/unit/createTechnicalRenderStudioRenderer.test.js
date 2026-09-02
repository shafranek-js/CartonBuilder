import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import { RenderStudioAppearanceController } from '../../src/render/RenderStudioAppearanceController.js';
import { RenderStudioCameraRig } from '../../src/render/RenderStudioCameraRig.js';
import { RenderStudioRenderTargetService } from '../../src/render/RenderStudioRenderTargetService.js';
import { RenderStudioSceneController } from '../../src/render/RenderStudioSceneController.js';
import { RenderStudioSurface } from '../../src/render/RenderStudioSurface.js';
import { createTechnicalRenderStudioRenderer } from '../../src/render/createTechnicalRenderStudioRenderer.js';

function makeRenderSurface(label = 'technical') {
  return {
    scene: { id: `${label}-scene` },
    camera: { id: `${label}-camera` },
    renderer: { id: `${label}-renderer` },
  };
}

function makeSurface(renderSurface = makeRenderSurface()) {
  return {
    renderSurface,
    dispose: vi.fn(),
  };
}

function makeCameraRig() {
  return { dispose: vi.fn() };
}

function makeAppearanceController() {
  return { dispose: vi.fn() };
}

function makeRenderTargetService() {
  return { dispose: vi.fn() };
}

function makeSceneController(renderSurface, overrides = {}) {
  const methods = [
    'setToneMapping',
    'setRenderCallback',
    'setMaterialProfile',
    'setLightDirection',
    'setLightIntensity',
    'setHemisphereIntensity',
    'setEnvironmentIntensity',
    'setEnvironment',
    'setShadowsEnabled',
    'setShadowMapSize',
    'setShadowBlur',
    'setShadowIntensity',
    'setBackgroundMode',
    'setBackgroundImage',
    'setFloorReflection',
    'setExposure',
    'setCameraPreset',
    'setCameraState',
    'getCameraState',
    'fitCameraToFrame',
    'resetView',
    'setBackgroundAsset',
    'render',
    'resize',
    'renderToPixels',
  ];
  return {
    renderSurface,
    ...Object.fromEntries(methods.map((method) => [method, vi.fn()])),
    dispose: vi.fn(),
    ...overrides,
  };
}

function makeSource(renderSurface, overrides = {}) {
  return {
    renderSurface,
    replaceArtwork: vi.fn(),
    setBoardAppearance: vi.fn(),
    createPortableScene: vi.fn(),
    getBounds: vi.fn(() => ({
      minX: -0.1,
      minY: -0.05,
      minZ: -0.02,
      maxX: 0.1,
      maxY: 0.05,
      maxZ: 0.02,
      width: 0.2,
      height: 0.1,
      depth: 0.04,
      centerX: 0,
      centerY: 0,
      centerZ: 0,
      radius: 0.11,
      units: 'm',
    })),
    getDiagnostics: vi.fn(() => ({ source: 'technical', built: true })),
    dispose: vi.fn(),
    ...overrides,
  };
}

function makeAdapter(methods) {
  return Object.fromEntries(methods.map((method) => [method, vi.fn()]));
}

function makeOptions(overrides = {}) {
  const renderSurface = makeRenderSurface();
  const surface = makeSurface(renderSurface);
  const cameraRig = makeCameraRig();
  const appearanceController = makeAppearanceController();
  const renderTargetService = makeRenderTargetService();
  const sceneController = makeSceneController(renderSurface);
  const source = makeSource(sceneController.renderSurface);
  const technicalDocument = {
    isComplete: true,
    workflowMode: 'technical',
    getBundle: vi.fn(() => { throw new Error('composition root must not read the bundle'); }),
  };
  const environmentAdapter = makeAdapter([
    'setEnvironment',
    'setEnvironmentMap',
    'setEnvironmentAsset',
    'dispose',
  ]);
  const backgroundAdapter = makeAdapter(['setBackgroundImage', 'setBackgroundAsset', 'dispose']);
  const reflectionAdapter = makeAdapter(['setFloorReflection', 'dispose']);
  const materialProfileSetter = vi.fn();
  const artworkAtlas = { id: 'technical-atlas' };
  const materialMaps = { normal: { id: 'technical-normal' } };
  const boardAppearance = { boardType: 'paperboard' };
  const boardAppearanceSetter = vi.fn();
  const windowRef = { id: 'test-window' };
  const threeFactories = { createGroup: vi.fn() };
  const calls = {};

  const options = {
    technicalDocument,
    canvas: { id: 'technical-canvas' },
    container: { id: 'technical-container' },
    renderSettings: structuredClone(DEFAULT_RENDER_SETTINGS),
    artworkAtlas,
    materialMaps,
    boardAppearance,
    boardAppearanceSetter,
    environmentAdapter,
    backgroundAdapter,
    reflectionAdapter,
    materialProfileSetter,
    backgroundAsset: { assetId: 'background' },
    environmentAsset: { assetId: 'environment' },
    windowRef,
    onContextLost: vi.fn(),
    onContextRestored: vi.fn(),
    onCameraChange: vi.fn(),
    threeFactories,
    rendererOptions: {
      marker: 'preserved',
      boxModel: { id: 'must-not-forward' },
      textureCanvas: { id: 'must-not-forward' },
      sceneModel: { id: 'must-not-forward' },
      sceneController: { id: 'caller-override' },
      sceneSourceFactory: vi.fn(),
    },
    surfaceFactory: vi.fn((input) => {
      calls.surface = input;
      return surface;
    }),
    cameraRigFactory: vi.fn((input) => {
      calls.cameraRig = input;
      return cameraRig;
    }),
    appearanceControllerFactory: vi.fn((input) => {
      calls.appearance = input;
      return appearanceController;
    }),
    renderTargetServiceFactory: vi.fn((input) => {
      calls.renderTarget = input;
      return renderTargetService;
    }),
    sceneControllerFactory: vi.fn((input) => {
      calls.sceneController = input;
      return sceneController;
    }),
    technicalSourceFactory: vi.fn((input) => {
      calls.technicalSource = input;
      return source;
    }),
    rendererFactory: vi.fn((input) => {
      calls.renderer = input;
      input.sceneSourceFactory();
      return { dispose: vi.fn() };
    }),
  };

  return {
    options: { ...options, ...overrides },
    renderSurface,
    surface,
    cameraRig,
    appearanceController,
    renderTargetService,
    sceneController,
    source,
    technicalDocument,
    environmentAdapter,
    backgroundAdapter,
    reflectionAdapter,
    materialProfileSetter,
    artworkAtlas,
    materialMaps,
    boardAppearance,
    boardAppearanceSetter,
    windowRef,
    threeFactories,
    calls,
  };
}

describe('createTechnicalRenderStudioRenderer', () => {
  it('validates before allocation and requires the Technical document and factories', () => {
    const invalidDocument = makeOptions({
      technicalDocument: {
        isComplete: false,
        workflowMode: 'technical',
        getBundle: vi.fn(),
      },
    });

    expect(() => createTechnicalRenderStudioRenderer(invalidDocument.options))
      .toThrow('complete Technical document');
    expect(invalidDocument.options.surfaceFactory).not.toHaveBeenCalled();

    const invalidFactory = makeOptions({ surfaceFactory: null });
    expect(() => createTechnicalRenderStudioRenderer(invalidFactory.options))
      .toThrow('surfaceFactory to be a function');
    expect(invalidFactory.options.technicalSourceFactory).not.toHaveBeenCalled();
  });

  it('creates one shared-surface composition with a late-bound Technical source', () => {
    const context = makeOptions();
    const renderer = createTechnicalRenderStudioRenderer(context.options);

    expect(context.options.surfaceFactory).toHaveBeenCalledTimes(1);
    expect(context.options.cameraRigFactory).toHaveBeenCalledTimes(1);
    expect(context.options.appearanceControllerFactory).toHaveBeenCalledTimes(1);
    expect(context.options.renderTargetServiceFactory).toHaveBeenCalledTimes(1);
    expect(context.options.sceneControllerFactory).toHaveBeenCalledTimes(1);
    expect(context.options.technicalSourceFactory).toHaveBeenCalledTimes(1);
    expect(context.options.rendererFactory).toHaveBeenCalledTimes(1);
    expect(renderer).toBeDefined();

    expect(context.calls.cameraRig.surface).toBe(context.surface);
    expect(context.calls.appearance.surface).toBe(context.surface);
    expect(context.calls.renderTarget.surface).toBe(context.surface);
    expect(context.calls.sceneController).toMatchObject({
      surface: context.surface,
      cameraRig: context.cameraRig,
      appearanceController: context.appearanceController,
      renderTargetService: context.renderTargetService,
    });
    expect(context.calls.technicalSource).toMatchObject({
      technicalDocument: context.technicalDocument,
      renderSurface: context.sceneController.renderSurface,
      artworkAtlas: context.artworkAtlas,
      materialMaps: context.materialMaps,
      boardAppearanceSetter: context.boardAppearanceSetter,
    });
    expect(context.calls.technicalSource.renderSurface).toBe(context.sceneController.renderSurface);
    expect(context.technicalDocument.getBundle).not.toHaveBeenCalled();

    expect(context.calls.cameraRig.initialState).toBe(context.options.renderSettings.camera);
    expect(context.calls.cameraRig.onCameraChange).toBe(context.options.onCameraChange);
    expect(context.calls.appearance.materialProfileSetter).toBe(context.materialProfileSetter);
    expect(context.calls.appearance.environmentAdapter).toBe(context.environmentAdapter);
    expect(context.calls.appearance.backgroundAdapter).toBe(context.backgroundAdapter);
    expect(context.calls.appearance.reflectionAdapter).toBe(context.reflectionAdapter);
    expect(context.calls.appearance.threeFactories).toBe(context.threeFactories);

    expect(context.calls.renderer).toMatchObject({
      marker: 'preserved',
      canvas: context.options.canvas,
      container: context.options.container,
      renderSettings: context.options.renderSettings,
      materialMaps: context.materialMaps,
      boardAppearance: context.boardAppearance,
      backgroundAsset: context.options.backgroundAsset,
      environmentAsset: context.options.environmentAsset,
      windowRef: context.windowRef,
      onContextLost: context.options.onContextLost,
      onContextRestored: context.options.onContextRestored,
      onCameraChange: context.options.onCameraChange,
      sceneController: context.sceneController,
    });
    expect(context.calls.renderer.sceneSourceFactory).toBeTypeOf('function');
    expect(context.calls.renderer.sceneSourceFactory).not.toBe(context.options.rendererOptions.sceneSourceFactory);
    expect(context.calls.renderer).not.toHaveProperty('boxModel');
    expect(context.calls.renderer).not.toHaveProperty('textureCanvas');
    expect(context.calls.renderer).not.toHaveProperty('sceneModel');
  });

  it('does not consult Quick bounds before the source exists and then resolves only Technical bounds', () => {
    const context = makeOptions();
    context.options.cameraRigFactory = vi.fn(({ boundsProvider }) => {
      expect(() => boundsProvider()).toThrow('before the source is built');
      context.calls.boundsProvider = boundsProvider;
      return context.cameraRig;
    });

    createTechnicalRenderStudioRenderer(context.options);

    expect(context.calls.boundsProvider()).toBe(context.source.getBounds.mock.results[0]?.value);
    expect(context.source.getBounds).toHaveBeenCalledTimes(1);
  });

  it('passes null material maps through the Technical boundary without reading the bundle', () => {
    const context = makeOptions({ materialMaps: null });
    createTechnicalRenderStudioRenderer(context.options);

    expect(context.calls.technicalSource.materialMaps).toBeNull();
    expect(context.technicalDocument.getBundle).not.toHaveBeenCalled();
  });

  it.each([
    ['surface', 'surfaceFactory', []],
    ['camera rig', 'cameraRigFactory', ['surface']],
    ['appearance controller', 'appearanceControllerFactory', ['cameraRig', 'surface']],
    ['render target service', 'renderTargetServiceFactory', ['appearanceController', 'cameraRig', 'surface']],
    ['scene controller', 'sceneControllerFactory', ['renderTargetService', 'appearanceController', 'cameraRig', 'surface']],
  ])('cleans up in reverse order when %s construction fails', (label, factoryName, cleanupNames) => {
    const context = makeOptions();
    const initialError = new Error(`${label} construction failed`);
    context.options[factoryName] = vi.fn(() => { throw initialError; });

    expect(() => createTechnicalRenderStudioRenderer(context.options)).toThrow(initialError);
    for (const name of cleanupNames) expect(context[name].dispose).toHaveBeenCalledTimes(1);
    expect(context.options.technicalSourceFactory).not.toHaveBeenCalled();
    expect(context.options.rendererFactory).not.toHaveBeenCalled();
  });

  it('preserves the initial construction error when reverse cleanup also fails', () => {
    const context = makeOptions();
    const initialError = new Error('scene controller construction failed');
    context.options.sceneControllerFactory = vi.fn(() => { throw initialError; });
    context.renderTargetService.dispose.mockImplementation(() => { throw new Error('target cleanup'); });
    context.appearanceController.dispose.mockImplementation(() => { throw new Error('appearance cleanup'); });
    context.cameraRig.dispose.mockImplementation(() => { throw new Error('camera cleanup'); });
    context.surface.dispose.mockImplementation(() => { throw new Error('surface cleanup'); });

    expect(() => createTechnicalRenderStudioRenderer(context.options)).toThrow(initialError);
    expect(context.renderTargetService.dispose).toHaveBeenCalledTimes(1);
    expect(context.appearanceController.dispose).toHaveBeenCalledTimes(1);
    expect(context.cameraRig.dispose).toHaveBeenCalledTimes(1);
    expect(context.surface.dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid controller before Technical source creation', () => {
    const context = makeOptions();
    delete context.sceneController.renderToPixels;
    context.options.sceneControllerFactory = vi.fn(() => context.sceneController);

    expect(() => createTechnicalRenderStudioRenderer(context.options))
      .toThrow('Render scene controller must implement renderToPixels().');
    expect(context.options.technicalSourceFactory).not.toHaveBeenCalled();
    expect(context.options.rendererFactory).not.toHaveBeenCalled();
  });

  it('lets the existing renderer helper own source/controller cleanup after renderer failure', () => {
    const context = makeOptions();
    const initialError = new Error('renderer construction failed');
    context.source.dispose.mockImplementation(() => { throw new Error('source cleanup failed'); });
    context.sceneController.dispose.mockImplementation(() => { throw new Error('controller cleanup failed'); });
    context.options.rendererFactory = vi.fn(({ sceneSourceFactory }) => {
      sceneSourceFactory();
      throw initialError;
    });

    expect(() => createTechnicalRenderStudioRenderer(context.options)).toThrow(initialError);
    expect(context.source.dispose).toHaveBeenCalledTimes(1);
    expect(context.sceneController.dispose).toHaveBeenCalledTimes(1);
    expect(context.surface.dispose).not.toHaveBeenCalled();
    expect(context.appearanceController.dispose).not.toHaveBeenCalled();
  });

  it('does not double-dispose when source and controller are the same actor', () => {
    const context = makeOptions();
    const sharedActor = makeSceneController(context.renderSurface);
    Object.assign(sharedActor, makeSource(context.renderSurface));
    context.options.sceneControllerFactory = vi.fn(() => sharedActor);
    context.options.technicalSourceFactory = vi.fn(() => sharedActor);
    const initialError = new Error('shared composition failed');
    context.options.rendererFactory = vi.fn(({ sceneSourceFactory }) => {
      sceneSourceFactory();
      throw initialError;
    });

    expect(() => createTechnicalRenderStudioRenderer(context.options)).toThrow(initialError);
    expect(sharedActor.dispose).toHaveBeenCalledTimes(1);
  });

  it('returns the final renderer and leaves disposal ownership with it', () => {
    const context = makeOptions();
    const renderer = {
      dispose: vi.fn(() => {
        context.source.dispose();
        context.sceneController.dispose();
      }),
    };
    context.options.rendererFactory = vi.fn(({ sceneSourceFactory }) => {
      sceneSourceFactory();
      return renderer;
    });

    expect(createTechnicalRenderStudioRenderer(context.options)).toBe(renderer);
    expect(context.source.dispose).not.toHaveBeenCalled();
    expect(context.sceneController.dispose).not.toHaveBeenCalled();
    renderer.dispose();
    expect(context.source.dispose).toHaveBeenCalledTimes(1);
    expect(context.sceneController.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('createTechnicalRenderStudioRenderer composition regressions', () => {
  it('cleans the controller and all prior resources when controller validation fails', () => {
    const context = makeOptions();
    delete context.sceneController.renderToPixels;
    context.options.sceneControllerFactory = vi.fn(() => context.sceneController);

    expect(() => createTechnicalRenderStudioRenderer(context.options))
      .toThrow('Render scene controller must implement renderToPixels().');
    expect(context.sceneController.dispose).toHaveBeenCalledTimes(1);
    expect(context.renderTargetService.dispose).toHaveBeenCalledTimes(1);
    expect(context.appearanceController.dispose).toHaveBeenCalledTimes(1);
    expect(context.cameraRig.dispose).toHaveBeenCalledTimes(1);
    expect(context.surface.dispose).toHaveBeenCalledTimes(1);
  });

  it('composes the real Studio components around low-level injected renderer resources', async () => {
    const context = makeOptions();
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const container = { clientWidth: 640, clientHeight: 480 };
    const windowRef = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout,
      clearTimeout,
      performance: { now: () => 0 },
    };
    const lowLevelRenderer = {
      size: { x: 640, y: 480 },
      pixelRatio: 1,
      currentTarget: null,
      toneMapping: null,
      toneMappingExposure: 1,
      shadowMap: { enabled: false, needsUpdate: false },
      setSize: vi.fn((width, height) => {
        lowLevelRenderer.size = { x: width, y: height };
      }),
      getSize: vi.fn((target) => {
        target.x = lowLevelRenderer.size.x;
        target.y = lowLevelRenderer.size.y;
        return target;
      }),
      setPixelRatio: vi.fn((pixelRatio) => {
        lowLevelRenderer.pixelRatio = pixelRatio;
      }),
      getPixelRatio: vi.fn(() => lowLevelRenderer.pixelRatio),
      getRenderTarget: vi.fn(() => lowLevelRenderer.currentTarget),
      setRenderTarget: vi.fn((target) => {
        lowLevelRenderer.currentTarget = target;
      }),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(),
      readRenderTargetPixels: vi.fn((target, x, y, width, height, pixels) => pixels.fill(11)),
      dispose: vi.fn(),
    };
    let composedController = null;
    let composedSource = null;
    let finalRenderer = null;

    context.options.canvas = canvas;
    context.options.container = container;
    context.options.windowRef = windowRef;
    context.options.threeFactories = {};
    context.options.surfaceFactory = vi.fn((options) => new RenderStudioSurface({
      ...options,
      rendererFactory: () => lowLevelRenderer,
    }));
    context.options.cameraRigFactory = vi.fn((options) => new RenderStudioCameraRig(options));
    context.options.appearanceControllerFactory = vi.fn(
      (options) => new RenderStudioAppearanceController(options),
    );
    context.options.renderTargetServiceFactory = vi.fn(
      (options) => new RenderStudioRenderTargetService(options),
    );
    context.options.sceneControllerFactory = vi.fn(
      (options) => new RenderStudioSceneController(options),
    );
    context.options.technicalSourceFactory = vi.fn(({ renderSurface }) => {
      composedSource = makeSource(renderSurface);
      return composedSource;
    });
    context.options.rendererFactory = vi.fn((options) => {
      composedController = options.sceneController;
      composedSource = options.sceneSourceFactory();
      finalRenderer = {
        source: composedSource,
        sceneController: composedController,
        dispose: vi.fn(() => {
          composedSource.dispose();
          composedController.dispose();
        }),
      };
      return finalRenderer;
    });

    const renderer = createTechnicalRenderStudioRenderer(context.options);

    expect(renderer).toBe(finalRenderer);
    expect(composedController).toBeInstanceOf(RenderStudioSceneController);
    expect(composedController.surface).toBeInstanceOf(RenderStudioSurface);
    expect(composedController.cameraRig).toBeInstanceOf(RenderStudioCameraRig);
    expect(composedController.appearanceController).toBeInstanceOf(RenderStudioAppearanceController);
    expect(composedController.renderTargetService).toBeInstanceOf(RenderStudioRenderTargetService);
    expect(composedSource.renderSurface.scene).toBe(composedController.renderSurface.scene);
    expect(composedController.setLightDirection(30, 45)).toBe(true);
    expect(composedSource.getBounds).toHaveBeenCalled();

    const output = await composedController.renderToPixels({ width: 3, height: 2 });
    expect(output).toMatchObject({ width: 3, height: 2 });
    expect([...output.pixels]).toEqual(new Array(24).fill(11));

    renderer.dispose();
    expect(composedSource.dispose).toHaveBeenCalledTimes(1);
    expect(lowLevelRenderer.dispose).toHaveBeenCalledTimes(1);
    expect(context.environmentAdapter.dispose).toHaveBeenCalledTimes(1);
    expect(context.backgroundAdapter.dispose).toHaveBeenCalledTimes(1);
    expect(context.reflectionAdapter.dispose).toHaveBeenCalledTimes(1);
    expect(canvas.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
