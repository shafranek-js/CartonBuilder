import { describe, expect, it, vi } from 'vitest';
import { HalfFloatType, SRGBColorSpace } from 'three';

import { RenderStudioRenderTargetService } from '../../src/render/RenderStudioRenderTargetService.js';

function makeSurface(projection = 'perspective') {
  const scene = { id: 'studio-scene' };
  const perspectiveCamera = {
    isPerspectiveCamera: true,
    aspect: 4 / 3,
    fov: 35,
    updateProjectionMatrix: vi.fn(),
  };
  const orthographicCamera = {
    isOrthographicCamera: true,
    left: -2,
    right: 2,
    top: 2,
    bottom: -2,
    updateProjectionMatrix: vi.fn(),
  };
  let activeProjection = projection;
  const renderer = {
    currentTarget: null,
    size: { x: 800, y: 600 },
    pixelRatio: 2,
    getRenderTarget: vi.fn(() => renderer.currentTarget),
    setRenderTarget: vi.fn((target) => { renderer.currentTarget = target; }),
    getSize: vi.fn((target) => {
      target.x = renderer.size.x;
      target.y = renderer.size.y;
      return target;
    }),
    getPixelRatio: vi.fn(() => renderer.pixelRatio),
    setPixelRatio: vi.fn((pixelRatio) => { renderer.pixelRatio = pixelRatio; }),
    setSize: vi.fn((width, height) => { renderer.size = { x: width, y: height }; }),
    clear: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixels: vi.fn((target, x, y, width, height, pixels) => {
      pixels.fill(7);
    }),
  };
  const renderSurface = {
    scene,
    renderer,
    get camera() {
      return activeProjection === 'orthographic' ? orthographicCamera : perspectiveCamera;
    },
  };
  const surface = {
    renderSurface,
    resize: vi.fn(({ width, height, pixelRatio, render }) => {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      if (activeProjection === 'perspective') {
        perspectiveCamera.aspect = width / height;
      } else {
        const halfHeight = 2;
        const halfWidth = halfHeight * width / height;
        orthographicCamera.left = -halfWidth;
        orthographicCamera.right = halfWidth;
        orthographicCamera.top = halfHeight;
        orthographicCamera.bottom = -halfHeight;
      }
      return render === false ? true : true;
    }),
    setCameraProjection: vi.fn((nextProjection) => {
      activeProjection = nextProjection;
      return true;
    }),
    setPerspectiveFov: vi.fn((fov) => {
      perspectiveCamera.fov = fov;
      return true;
    }),
    setOrthographicHeight: vi.fn((height) => {
      const aspect = renderer.size.x / renderer.size.y;
      const halfHeight = height / 2;
      const halfWidth = halfHeight * aspect;
      orthographicCamera.left = -halfWidth;
      orthographicCamera.right = halfWidth;
      orthographicCamera.top = halfHeight;
      orthographicCamera.bottom = -halfHeight;
      return true;
    }),
    getCameraOptics: vi.fn(() => ({
      projection: activeProjection,
      perspectiveFov: perspectiveCamera.fov,
      orthographicHeight: 4,
      aspect: renderer.size.x / renderer.size.y,
    })),
    renderer,
    perspectiveCamera,
    orthographicCamera,
  };
  return surface;
}

function makeAppearanceController() {
  return {
    beginRenderStateTransaction: vi.fn(() => vi.fn()),
  };
}

function makeTarget(width, height, options) {
  return {
    width,
    height,
    options,
    texture: { colorSpace: null },
    dispose: vi.fn(),
  };
}

function makeService({
  surface = makeSurface(),
  appearanceController = makeAppearanceController(),
  renderTargetFactory = vi.fn((width, height, options) => makeTarget(width, height, options)),
} = {}) {
  const service = new RenderStudioRenderTargetService({
    surface,
    appearanceController,
    renderTargetFactory,
  });
  return { service, surface, appearanceController, renderTargetFactory };
}

describe('RenderStudioRenderTargetService', () => {
  it('validates dimensions, signal and dependencies before allocating a target', async () => {
    const renderTargetFactory = vi.fn();
    const { service } = makeService({ renderTargetFactory });
    const controller = new AbortController();
    controller.abort();

    await expect(service.renderToPixels({ width: Number.NaN, height: 10 })).rejects.toThrow('width');
    await expect(service.renderToPixels({ width: 10, height: 10, signal: {} })).rejects.toThrow('AbortSignal');
    await expect(service.renderToPixels({ width: 10, height: 10, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(renderTargetFactory).not.toHaveBeenCalled();
  });

  it('does not allocate when already aborted and rejects malformed constructor dependencies', async () => {
    const renderTargetFactory = vi.fn();
    const { service } = makeService({ renderTargetFactory });
    const controller = new AbortController();
    controller.abort();

    await expect(service.renderToPixels({ width: 10, height: 10, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(renderTargetFactory).not.toHaveBeenCalled();
    expect(() => new RenderStudioRenderTargetService({
      surface: makeSurface(),
      appearanceController: {},
      renderTargetFactory,
    })).toThrow('beginRenderStateTransaction');
  });

  it('performs a normal sync render, configures output target, and restores state', async () => {
    const result = makeService();
    const { service, surface, appearanceController, renderTargetFactory } = result;
    const previousTarget = { id: 'previous-target' };
    surface.renderer.currentTarget = previousTarget;

    const output = await service.renderToPixels({
      width: 321.9,
      height: 200.8,
      backgroundMode: 'transparent',
      backgroundColor: '#123456',
      includeShadow: false,
      includeReflection: false,
    });
    const target = renderTargetFactory.mock.results[0].value;
    const restore = appearanceController.beginRenderStateTransaction.mock.results[0].value;

    expect(output.width).toBe(321);
    expect(output.height).toBe(200);
    expect(output.pixels).toBeInstanceOf(Uint8Array);
    expect(output.pixels.length).toBe(321 * 200 * 4);
    expect(target.options).toEqual({ depthBuffer: true, stencilBuffer: false, samples: 4 });
    expect(target.texture.colorSpace).toBe(SRGBColorSpace);
    expect(appearanceController.beginRenderStateTransaction).toHaveBeenCalledWith({
      backgroundMode: 'transparent',
      backgroundColor: '#123456',
      includeShadow: false,
      includeReflection: false,
    });
    expect(surface.renderer.clear).toHaveBeenCalledWith(true, true, true);
    expect(surface.renderer.render).toHaveBeenCalledWith(surface.renderSurface.scene, surface.renderSurface.camera);
    expect(surface.renderer.readRenderTargetPixels).toHaveBeenCalledWith(
      target,
      0,
      0,
      321,
      200,
      expect.any(Uint8Array),
    );
    expect(restore).toHaveBeenCalledTimes(1);
    expect(target.dispose).toHaveBeenCalledTimes(1);
    expect(surface.renderer.currentTarget).toBe(previousTarget);
    expect(surface.renderer.size).toEqual({ x: 800, y: 600 });
    expect(surface.renderer.pixelRatio).toBe(2);
    expect(surface.resize).toHaveBeenLastCalledWith({
      width: 800,
      height: 600,
      pixelRatio: 2,
      render: false,
    });
  });

  it('supports an override-owned target and restores at most once without default render', async () => {
    const result = makeService();
    const { service, surface } = result;
    const overrideTarget = makeTarget(40, 30, {});
    const restore = vi.fn();

    const output = await service.renderToPixels({
      width: 40,
      height: 30,
      renderOverride: vi.fn(() => ({ target: overrideTarget, restore })),
    });

    expect(output.width).toBe(40);
    expect(surface.renderer.render).not.toHaveBeenCalled();
    expect(surface.renderer.readRenderTargetPixels).toHaveBeenCalledWith(
      overrideTarget,
      0,
      0,
      40,
      30,
      expect.any(Uint8Array),
    );
    expect(restore).toHaveBeenCalledTimes(1);
    expect(overrideTarget.dispose).not.toHaveBeenCalled();
  });

  it('prefers async readback and falls back to sync readback', async () => {
    const asyncResult = makeService();
    const asyncRead = vi.fn(async (target, x, y, width, height, pixels) => pixels.fill(9));
    asyncResult.surface.renderer.readRenderTargetPixelsAsync = asyncRead;
    const asyncOutput = await asyncResult.service.renderToPixels({ width: 4, height: 3 });
    expect(asyncRead).toHaveBeenCalledTimes(1);
    expect(asyncOutput.pixels[0]).toBe(9);
    expect(asyncResult.surface.renderer.readRenderTargetPixels).not.toHaveBeenCalled();

    const syncResult = makeService();
    const syncOutput = await syncResult.service.renderToPixels({ width: 4, height: 3 });
    expect(syncResult.surface.renderer.readRenderTargetPixels).toHaveBeenCalledTimes(1);
    expect(syncOutput.pixels[0]).toBe(7);
  });

  it('uses a typed readback buffer for half-float post-processing targets', async () => {
    const halfFloatTarget = makeTarget(4, 3, {});
    halfFloatTarget.texture.type = HalfFloatType;
    const result = makeService({
      renderTargetFactory: vi.fn(() => halfFloatTarget),
    });
    result.surface.renderer.readRenderTargetPixelsAsync = vi.fn(async (
      target,
      x,
      y,
      width,
      height,
      pixels,
    ) => {
      expect(target).toBe(halfFloatTarget);
      expect([x, y, width, height]).toEqual([0, 0, 4, 3]);
      expect(pixels).toBeInstanceOf(Uint16Array);
      pixels.fill(0x3c00); // IEEE-754 half-float 1.0
    });

    const output = await result.service.renderToPixels({ width: 4, height: 3 });

    expect(output.pixels).toBeInstanceOf(Uint8Array);
    expect([...output.pixels]).toEqual(new Array(4 * 3 * 4).fill(255));
  });

  it('uses the requested output aspect for perspective and orthographic cameras', async () => {
    const perspective = makeService({ surface: makeSurface('perspective') });
    let perspectiveOutputAspect;
    perspective.surface.renderer.render.mockImplementation(() => {
      perspectiveOutputAspect = perspective.surface.perspectiveCamera.aspect;
    });
    await perspective.service.renderToPixels({ width: 200, height: 100 });
    expect(perspectiveOutputAspect).toBe(2);
    expect(perspective.surface.perspectiveCamera.updateProjectionMatrix).toHaveBeenCalled();
    expect(perspective.surface.perspectiveCamera.aspect).toBeCloseTo(4 / 3);

    const orthographic = makeService({ surface: makeSurface('orthographic') });
    let orthographicOutputFrame;
    orthographic.surface.renderer.render.mockImplementation(() => {
      orthographicOutputFrame = {
        left: orthographic.surface.orthographicCamera.left,
        right: orthographic.surface.orthographicCamera.right,
        top: orthographic.surface.orthographicCamera.top,
        bottom: orthographic.surface.orthographicCamera.bottom,
      };
    });
    await orthographic.service.renderToPixels({ width: 200, height: 100 });
    expect(orthographicOutputFrame).toEqual({ left: -4, right: 4, top: 2, bottom: -2 });
    expect(orthographic.surface.orthographicCamera.updateProjectionMatrix).toHaveBeenCalled();
    expect(orthographic.surface.renderer.size).toEqual({ x: 800, y: 600 });
  });

  it('restores all state after render failure and preserves the render error over cleanup errors', async () => {
    const result = makeService();
    const { service, surface, appearanceController } = result;
    const renderError = new Error('render failed');
    const cleanupError = new Error('cleanup failed');
    surface.renderer.render.mockImplementation(() => { throw renderError; });
    appearanceController.beginRenderStateTransaction.mockReturnValue(vi.fn(() => { throw cleanupError; }));
    surface.renderer.setRenderTarget.mockImplementation((target) => {
      surface.renderer.currentTarget = target;
      if (target === null) throw cleanupError;
    });

    await expect(service.renderToPixels({ width: 20, height: 10 })).rejects.toBe(renderError);
    expect(surface.renderer.currentTarget).toBeNull();
    expect(surface.resize).toHaveBeenLastCalledWith({
      width: 800,
      height: 600,
      pixelRatio: 2,
      render: false,
    });
    expect(appearanceController.beginRenderStateTransaction.mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  it('rechecks abort after async readback and still cleans up the transaction and target', async () => {
    const result = makeService();
    const { service, surface, renderTargetFactory, appearanceController } = result;
    let releaseReadback;
    surface.renderer.readRenderTargetPixelsAsync = vi.fn(() => new Promise((resolve) => {
      releaseReadback = resolve;
    }));
    const abortController = new AbortController();
    const pending = service.renderToPixels({ width: 8, height: 6, signal: abortController.signal });
    await Promise.resolve();
    abortController.abort();
    releaseReadback();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(renderTargetFactory.mock.results[0].value.dispose).toHaveBeenCalledTimes(1);
    expect(appearanceController.beginRenderStateTransaction.mock.results[0].value).toHaveBeenCalledTimes(1);
  });

  it('disposes each temporary target once across two sequential resource cycles', async () => {
    const result = makeService();
    await result.service.renderToPixels({ width: 5, height: 4 });
    await result.service.renderToPixels({ width: 7, height: 6 });

    expect(result.renderTargetFactory).toHaveBeenCalledTimes(2);
    for (const call of result.renderTargetFactory.mock.results) {
      expect(call.value.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('has idempotent disposal and does not own surface or appearance controller', async () => {
    const result = makeService();
    expect(result.service.dispose()).toBe(true);
    expect(result.service.dispose()).toBe(false);
    expect(result.surface).not.toHaveProperty('dispose');
    expect(result.appearanceController).not.toHaveProperty('dispose');
    await expect(result.service.renderToPixels({ width: 2, height: 2 })).rejects.toThrow('disposed');
    expect(result.renderTargetFactory).not.toHaveBeenCalled();
  });
});

describe('RenderStudioRenderTargetService cleanup regression', () => {
  it('reports a viewport restore failure after a successful readback and completes cleanup', async () => {
    const result = makeService();
    const restoreError = new Error('viewport restore failed');
    const resizeImplementation = result.surface.resize.getMockImplementation();
    result.surface.resize.mockImplementation((options) => {
      const resizeResult = resizeImplementation(options);
      if (options.width === 800 && options.height === 600) throw restoreError;
      return resizeResult;
    });

    await expect(result.service.renderToPixels({ width: 20, height: 10 })).rejects.toBe(restoreError);

    const target = result.renderTargetFactory.mock.results[0].value;
    const appearanceRestore = result.appearanceController.beginRenderStateTransaction.mock.results[0].value;
    expect(appearanceRestore).toHaveBeenCalledTimes(1);
    expect(target.dispose).toHaveBeenCalledTimes(1);
    expect(result.surface.renderer.currentTarget).toBeNull();
  });
});
