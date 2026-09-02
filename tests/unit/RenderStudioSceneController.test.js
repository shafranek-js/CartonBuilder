import { describe, expect, it, vi } from 'vitest';

import { RenderStudioSceneController } from '../../src/render/RenderStudioSceneController.js';
import { assertRenderSceneController } from '../../src/render/renderSceneActors.js';

const APPEARANCE_METHODS = [
  'setToneMapping',
  'setMaterialProfile',
  'setLightDirection',
  'setLightIntensity',
  'setHemisphereIntensity',
  'setEnvironmentIntensity',
  'setEnvironment',
  'setEnvironmentMap',
  'setShadowsEnabled',
  'setShadowMapSize',
  'setShadowBlur',
  'setShadowIntensity',
  'setBackgroundMode',
  'setBackgroundImage',
  'setBackgroundAsset',
  'setEnvironmentAsset',
  'setFloorReflection',
  'setExposure',
];

function makeSurface({ scene = {}, camera = {}, renderer = {} } = {}) {
  const renderSurface = { scene, camera, renderer };
  return {
    get renderSurface() {
      return renderSurface;
    },
    setRenderCallback: vi.fn(() => 'surface-callback'),
    render: vi.fn(() => 'surface-render'),
    resize: vi.fn(() => 'surface-resize'),
    dispose: vi.fn(),
    renderSurface,
  };
}

function makeCameraRig() {
  return {
    setCameraPreset: vi.fn(() => 'preset-result'),
    setCameraState: vi.fn(() => 'state-result'),
    getCameraState: vi.fn(() => ({ preset: 'front' })),
    fitCameraToFrame: vi.fn(() => 'fit-result'),
    resetView: vi.fn(() => 'reset-result'),
    dispose: vi.fn(),
  };
}

function makeAppearanceController() {
  return Object.fromEntries([
    ...APPEARANCE_METHODS.map((method) => [method, vi.fn((...args) => `${method}:${args.length}`)]),
    ['dispose', vi.fn()],
  ]);
}

function makeRenderTargetService() {
  return {
    renderToPixels: vi.fn(() => Promise.resolve({ pixels: [1], width: 1, height: 1 })),
    dispose: vi.fn(),
  };
}

function makeController(overrides = {}) {
  const surface = overrides.surface || makeSurface();
  const cameraRig = overrides.cameraRig || makeCameraRig();
  const appearanceController = overrides.appearanceController || makeAppearanceController();
  const renderTargetService = overrides.renderTargetService || makeRenderTargetService();
  const controller = new RenderStudioSceneController({
    surface,
    cameraRig,
    appearanceController,
    renderTargetService,
  });
  return {
    controller,
    surface,
    cameraRig,
    appearanceController,
    renderTargetService,
  };
}

describe('RenderStudioSceneController', () => {
  it('requires all owned dependencies and their operational APIs', () => {
    expect(() => new RenderStudioSceneController()).toThrow(
      'RenderStudioSceneController requires surface.',
    );

    const surface = makeSurface();
    expect(() => new RenderStudioSceneController({
      surface,
      cameraRig: { dispose: vi.fn() },
      appearanceController: makeAppearanceController(),
      renderTargetService: makeRenderTargetService(),
    })).toThrow('RenderStudioSceneController cameraRig must implement setCameraPreset().');

    const cameraRig = makeCameraRig();
    const appearanceController = makeAppearanceController();
    delete appearanceController.setEnvironment;
    expect(() => new RenderStudioSceneController({
      surface,
      cameraRig,
      appearanceController,
      renderTargetService: makeRenderTargetService(),
    })).toThrow('RenderStudioSceneController appearanceController must implement setEnvironment().');

    expect(() => new RenderStudioSceneController({
      surface,
      cameraRig,
      appearanceController: makeAppearanceController(),
      renderTargetService: { dispose: vi.fn() },
    })).toThrow('RenderStudioSceneController renderTargetService must implement renderToPixels().');
  });

  it('keeps a stable renderSurface with dynamic camera identity and passes actor validation', () => {
    const firstCamera = {};
    const nextCamera = {};
    const surface = makeSurface({ camera: firstCamera });
    const result = makeController({ surface });
    const renderSurface = result.controller.renderSurface;

    expect(renderSurface).toBe(result.controller.renderSurface);
    expect(renderSurface.scene).toBe(surface.renderSurface.scene);
    expect(renderSurface.renderer).toBe(surface.renderSurface.renderer);
    expect(renderSurface.camera).toBe(firstCamera);

    surface.renderSurface.camera = nextCamera;
    expect(renderSurface.camera).toBe(nextCamera);
    expect(() => assertRenderSceneController(result.controller)).not.toThrow();

    result.controller.dispose();
  });

  it('delegates camera methods exactly, including their return values', () => {
    const { controller, cameraRig } = makeController();
    const args = { projection: 'orthographic', render: false };

    expect(controller.setCameraPreset('front', args)).toBe('preset-result');
    expect(controller.setCameraState(args, { notify: false })).toBe('state-result');
    expect(controller.getCameraState()).toEqual({ preset: 'front' });
    expect(controller.fitCameraToFrame(args)).toBe('fit-result');
    expect(controller.resetView(args)).toBe('reset-result');

    expect(cameraRig.setCameraPreset).toHaveBeenCalledWith('front', args);
    expect(cameraRig.setCameraState).toHaveBeenCalledWith(args, { notify: false });
    expect(cameraRig.getCameraState).toHaveBeenCalledWith();
    expect(cameraRig.fitCameraToFrame).toHaveBeenCalledWith(args);
    expect(cameraRig.resetView).toHaveBeenCalledWith(args);

    controller.dispose();
  });

  it('delegates surface methods exactly without fitting during resize', () => {
    const { controller, surface, cameraRig } = makeController();
    const callback = vi.fn();
    const options = { width: 640, height: 480, render: false };

    expect(controller.setRenderCallback(callback)).toBe('surface-callback');
    expect(controller.render()).toBe('surface-render');
    expect(controller.resize(options)).toBe('surface-resize');

    expect(surface.setRenderCallback).toHaveBeenCalledWith(callback);
    expect(surface.render).toHaveBeenCalledWith();
    expect(surface.resize).toHaveBeenCalledWith(options);
    expect(cameraRig.fitCameraToFrame).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('forwards every appearance operation without changing arguments or Promise results', async () => {
    const { controller, appearanceController } = makeController();
    for (const method of APPEARANCE_METHODS) {
      const first = { method, value: 1 };
      const second = { nested: true };
      const result = controller[method](first, second);
      expect(result).toBe(`${method}:2`);
      expect(appearanceController[method]).toHaveBeenCalledWith(first, second);
    }

    const promise = Promise.resolve('asset-ready');
    appearanceController.setEnvironmentAsset.mockReturnValueOnce(promise);
    expect(controller.setEnvironmentAsset('environment.hdr')).toBe(promise);

    controller.dispose();
  });

  it('delegates renderToPixels exactly and does not render first', async () => {
    const { controller, surface, renderTargetService } = makeController();
    const options = { width: 320, height: 200, transparent: true };
    const result = controller.renderToPixels(options);

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual({ pixels: [1], width: 1, height: 1 });
    expect(renderTargetService.renderToPixels).toHaveBeenCalledWith(options);
    expect(surface.render).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('blocks camera and appearance delegation after disposal while retaining the surface handle', () => {
    const { controller, cameraRig, appearanceController } = makeController();
    const renderSurface = controller.renderSurface;

    expect(controller.dispose()).toBe(true);
    expect(controller.setCameraPreset('front')).toBe(false);
    expect(controller.setCameraState({})).toBe(false);
    expect(controller.getCameraState()).toBe(false);
    expect(controller.fitCameraToFrame()).toBe(false);
    expect(controller.resetView()).toBe(false);
    expect(controller.setToneMapping('neutral')).toBe(false);
    expect(controller.setEnvironmentAsset('environment.hdr')).toBe(false);
    expect(controller.renderSurface).toBe(renderSurface);
    expect(cameraRig.setCameraPreset).not.toHaveBeenCalled();
    expect(cameraRig.setCameraState).not.toHaveBeenCalled();
    expect(cameraRig.getCameraState).not.toHaveBeenCalled();
    expect(appearanceController.setToneMapping).not.toHaveBeenCalled();
    expect(appearanceController.setEnvironmentAsset).not.toHaveBeenCalled();
  });

  it('disposes all owners in order, preserves the first error, deduplicates owners, and is idempotent', () => {
    const order = [];
    const firstError = new Error('render target cleanup failed');
    const secondError = new Error('appearance cleanup failed');
    const surface = makeSurface();
    surface.dispose = vi.fn(() => order.push('surface'));
    const cameraRig = makeCameraRig();
    cameraRig.dispose = vi.fn(() => order.push('camera'));
    const appearanceController = makeAppearanceController();
    appearanceController.dispose = vi.fn(() => {
      order.push('appearance');
      throw secondError;
    });
    const renderTargetService = makeRenderTargetService();
    renderTargetService.dispose = vi.fn(() => {
      order.push('target');
      throw firstError;
    });
    const { controller } = makeController({
      surface,
      cameraRig,
      appearanceController,
      renderTargetService,
    });

    expect(() => controller.dispose()).toThrow(firstError);
    expect(order).toEqual(['target', 'appearance', 'camera', 'surface']);
    expect(renderTargetService.dispose).toHaveBeenCalledTimes(1);
    expect(appearanceController.dispose).toHaveBeenCalledTimes(1);
    expect(cameraRig.dispose).toHaveBeenCalledTimes(1);
    expect(surface.dispose).toHaveBeenCalledTimes(1);
    expect(controller.dispose()).toBe(false);
    expect(controller.render()).toBe(false);
    expect(controller.renderToPixels({})).toBe(false);

    const shared = {
      ...makeSurface(),
      ...makeCameraRig(),
      ...makeAppearanceController(),
      ...makeRenderTargetService(),
    };
    const sharedDispose = vi.fn();
    shared.dispose = sharedDispose;
    const sharedResult = makeController({
      surface: shared,
      cameraRig: shared,
      appearanceController: shared,
      renderTargetService: shared,
    });
    expect(sharedResult.controller.dispose()).toBe(true);
    expect(sharedDispose).toHaveBeenCalledTimes(1);
    expect(sharedResult.controller.dispose()).toBe(false);
  });
});
