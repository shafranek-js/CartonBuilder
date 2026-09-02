import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import { createTechnicalWebGLRenderer } from '../../src/render/createTechnicalWebGLRenderer.js';

function makeRenderSurface(label = 'shared') {
  return {
    scene: { id: `${label}-scene` },
    camera: { id: `${label}-camera` },
    renderer: { id: `${label}-renderer` },
  };
}

function makeController(renderSurface = makeRenderSurface()) {
  return {
    renderSurface,
    setToneMapping: vi.fn(),
    setRenderCallback: vi.fn(),
    setMaterialProfile: vi.fn(),
    setLightDirection: vi.fn(),
    setLightIntensity: vi.fn(),
    setHemisphereIntensity: vi.fn(),
    setEnvironmentIntensity: vi.fn(),
    setEnvironment: vi.fn(),
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
    getCameraState: vi.fn(),
    fitCameraToFrame: vi.fn(),
    resetView: vi.fn(),
    setBackgroundAsset: vi.fn(),
    render: vi.fn(),
    resize: vi.fn(),
    renderToPixels: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeRendererOptions() {
  return {
    canvas: { id: 'quick-canvas' },
    container: { id: 'quick-container' },
    boxModel: { id: 'quick-box-model' },
    textureCanvas: { id: 'quick-texture-canvas' },
    materialMaps: { normal: { id: 'quick-normal-map' } },
    renderSettings: structuredClone(DEFAULT_RENDER_SETTINGS),
    sceneController: { id: 'caller-controller-override' },
    sceneSourceFactory: vi.fn(),
  };
}

describe('createTechnicalWebGLRenderer', () => {
  it('composes one Technical source with the exact controller surface and forced renderer actors', () => {
    const renderSurface = makeRenderSurface();
    const sceneController = makeController(renderSurface);
    const technicalDocument = { getBundle: vi.fn(() => { throw new Error('must not read bundle'); }) };
    const artworkAtlas = { id: 'technical-atlas' };
    const materialMaps = { normal: { id: 'technical-normal-map' } };
    const boardAppearanceSetter = vi.fn();
    const source = { dispose: vi.fn() };
    const renderer = { id: 'technical-renderer' };
    const technicalSourceFactory = vi.fn(() => source);
    let rendererArguments;
    const rendererFactory = vi.fn((options) => {
      rendererArguments = options;
      options.sceneSourceFactory(options);
      return renderer;
    });
    const rendererOptions = makeRendererOptions();

    const result = createTechnicalWebGLRenderer({
      technicalDocument,
      sceneController,
      artworkAtlas,
      materialMaps,
      boardAppearanceSetter,
      rendererOptions,
      technicalSourceFactory,
      rendererFactory,
    });

    expect(result).toBe(renderer);
    expect(technicalSourceFactory).toHaveBeenCalledTimes(1);
    expect(technicalSourceFactory).toHaveBeenCalledWith({
      technicalDocument,
      renderSurface,
      artworkAtlas,
      materialMaps,
      boardAppearanceSetter,
    });
    expect(technicalDocument.getBundle).not.toHaveBeenCalled();
    const {
      sceneController: callerController,
      sceneSourceFactory: callerSourceFactory,
      ...forwardedRendererOptions
    } = rendererOptions;
    expect(callerController).not.toBe(sceneController);
    expect(callerSourceFactory).not.toBe(rendererArguments.sceneSourceFactory);
    expect(rendererArguments).toMatchObject({
      ...forwardedRendererOptions,
      sceneController,
    });
    expect(rendererArguments.sceneSourceFactory).not.toBe(rendererOptions.sceneSourceFactory);
    expect(rendererArguments.sceneSourceFactory).toBeTypeOf('function');
  });

  it('does not send Quick or legacy inputs through the Technical factory', () => {
    const renderSurface = makeRenderSurface();
    const sceneController = makeController(renderSurface);
    const technicalDocument = { getBundle: vi.fn() };
    const source = { dispose: vi.fn() };
    const technicalSourceFactory = vi.fn((options) => {
      expect(Object.keys(options)).toEqual([
        'technicalDocument',
        'renderSurface',
        'artworkAtlas',
        'materialMaps',
        'boardAppearanceSetter',
      ]);
      return source;
    });
    const rendererFactory = vi.fn(({ sceneSourceFactory }) => {
      sceneSourceFactory();
      return { id: 'renderer' };
    });

    createTechnicalWebGLRenderer({
      technicalDocument,
      sceneController,
      artworkAtlas: { id: 'atlas' },
      materialMaps: null,
      boardAppearanceSetter: undefined,
      rendererOptions: makeRendererOptions(),
      technicalSourceFactory,
      rendererFactory,
    });

    expect(technicalSourceFactory).toHaveBeenCalledTimes(1);
    expect(technicalSourceFactory.mock.calls[0][0]).not.toHaveProperty('boxModel');
    expect(technicalSourceFactory.mock.calls[0][0]).not.toHaveProperty('canvas');
    expect(technicalSourceFactory.mock.calls[0][0]).not.toHaveProperty('textureCanvas');
  });

  it('rejects an invalid controller before creating a source or renderer', () => {
    const sceneController = makeController();
    delete sceneController.renderToPixels;
    const technicalSourceFactory = vi.fn();
    const rendererFactory = vi.fn();

    expect(() => createTechnicalWebGLRenderer({
      technicalDocument: {},
      sceneController,
      technicalSourceFactory,
      rendererFactory,
    })).toThrow('Render scene controller must implement renderToPixels().');
    expect(technicalSourceFactory).not.toHaveBeenCalled();
    expect(rendererFactory).not.toHaveBeenCalled();
  });

  it('rejects null and array renderer options before composition starts', () => {
    const technicalSourceFactory = vi.fn();
    const rendererFactory = vi.fn();

    for (const rendererOptions of [null, []]) {
      const sceneController = makeController();
      expect(() => createTechnicalWebGLRenderer({
        technicalDocument: {},
        sceneController,
        rendererOptions,
        technicalSourceFactory,
        rendererFactory,
      })).toThrow('rendererOptions to be an object');
      expect(sceneController.dispose).not.toHaveBeenCalled();
    }
    expect(technicalSourceFactory).not.toHaveBeenCalled();
    expect(rendererFactory).not.toHaveBeenCalled();
  });

  it('fails closed when the renderer factory does not create a Technical source', () => {
    const sceneController = makeController();
    const technicalSourceFactory = vi.fn();
    const rendererFactory = vi.fn(() => ({ id: 'renderer-without-source' }));

    expect(() => createTechnicalWebGLRenderer({
      technicalDocument: {},
      sceneController,
      technicalSourceFactory,
      rendererFactory,
    })).toThrow('must create exactly one Technical source');
    expect(technicalSourceFactory).not.toHaveBeenCalled();
    expect(sceneController.dispose).toHaveBeenCalledTimes(1);
  });

  it('cleans source and controller after renderer construction failure and preserves the initial error', () => {
    const renderSurface = makeRenderSurface();
    const sceneController = makeController(renderSurface);
    const source = { dispose: vi.fn(() => { throw new Error('source cleanup failed'); }) };
    const initialError = new Error('renderer construction failed');
    const controllerCleanupError = new Error('controller cleanup failed');
    sceneController.dispose.mockImplementation(() => { throw controllerCleanupError; });
    const technicalSourceFactory = vi.fn(() => source);
    const rendererFactory = vi.fn(({ sceneSourceFactory }) => {
      sceneSourceFactory();
      throw initialError;
    });

    expect(() => createTechnicalWebGLRenderer({
      technicalDocument: {},
      sceneController,
      technicalSourceFactory,
      rendererFactory,
    })).toThrow(initialError);
    expect(technicalSourceFactory).toHaveBeenCalledTimes(1);
    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(sceneController.dispose).toHaveBeenCalledTimes(1);
  });

  it('cleans only the controller when the Technical factory fails before returning a source', () => {
    const sceneController = makeController();
    const initialError = new Error('technical factory failed');
    const technicalSourceFactory = vi.fn(() => { throw initialError; });
    const rendererFactory = vi.fn(({ sceneSourceFactory }) => sceneSourceFactory());

    expect(() => createTechnicalWebGLRenderer({
      technicalDocument: {},
      sceneController,
      technicalSourceFactory,
      rendererFactory,
    })).toThrow(initialError);
    expect(sceneController.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not dispose the same source/controller object twice on failure', () => {
    const sharedActor = makeController();
    sharedActor.replaceArtwork = vi.fn();
    sharedActor.setBoardAppearance = vi.fn();
    sharedActor.createPortableScene = vi.fn();
    sharedActor.getBounds = vi.fn();
    sharedActor.getDiagnostics = vi.fn();
    const initialError = new Error('shared composition failed');
    const technicalSourceFactory = vi.fn(() => sharedActor);
    const rendererFactory = vi.fn(({ sceneSourceFactory }) => {
      sceneSourceFactory();
      throw initialError;
    });

    expect(() => createTechnicalWebGLRenderer({
      technicalDocument: {},
      sceneController: sharedActor,
      technicalSourceFactory,
      rendererFactory,
    })).toThrow(initialError);
    expect(sharedActor.dispose).toHaveBeenCalledTimes(1);
  });
});
