import {
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
} from 'three';
import { describe, expect, it, vi } from 'vitest';

import { RenderStudioSurface } from '../../src/render/RenderStudioSurface.js';

function makeEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: vi.fn((type, listener) => {
      listeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    }),
    dispatchEvent(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
}

function makeRenderer() {
  return {
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeWindow({ ResizeObserver } = {}) {
  const target = makeEventTarget();
  return {
    ...target,
    ResizeObserver,
    devicePixelRatio: 1,
  };
}

function makeSurfaceOptions(overrides = {}) {
  const canvas = makeEventTarget();
  const container = { clientWidth: 800, clientHeight: 600 };
  const windowRef = makeWindow();
  const renderer = makeRenderer();
  return {
    canvas,
    container,
    windowRef,
    rendererFactory: vi.fn(() => renderer),
    sceneFactory: vi.fn(() => new Scene()),
    perspectiveCameraFactory: vi.fn((...args) => new PerspectiveCamera(...args)),
    orthographicCameraFactory: vi.fn((...args) => new OrthographicCamera(...args)),
    ...overrides,
    renderer,
  };
}

describe('RenderStudioSurface', () => {
  it('creates a shared geometry-free scene surface with injectable Three factories', () => {
    const options = makeSurfaceOptions();
    const surface = new RenderStudioSurface(options);

    expect(options.sceneFactory).toHaveBeenCalledTimes(1);
    expect(options.perspectiveCameraFactory).toHaveBeenCalledTimes(1);
    expect(options.orthographicCameraFactory).toHaveBeenCalledTimes(1);
    expect(options.rendererFactory).toHaveBeenCalledWith(expect.objectContaining({
      canvas: options.canvas,
      alpha: true,
    }));
    expect(surface.renderSurface.scene).toBeInstanceOf(Scene);
    expect(surface.renderSurface.renderer).toBe(options.renderer);
    expect(surface.renderSurface.scene.children).toEqual([
      surface.perspectiveCamera,
      surface.orthographicCamera,
    ]);
    expect(surface.renderSurface.scene.children.some((child) => child.geometry)).toBe(false);

    surface.dispose();
  });

  it('keeps a stable surface while switching only the active camera identity', () => {
    const surface = new RenderStudioSurface(makeSurfaceOptions({ projection: 'orthographic' }));
    const renderSurface = surface.renderSurface;
    const scene = renderSurface.scene;
    const renderer = renderSurface.renderer;

    expect(surface.renderSurface).toBe(renderSurface);
    expect(renderSurface.camera).toBe(surface.orthographicCamera);
    expect(surface.setCameraProjection('perspective')).toBe(true);
    expect(renderSurface.camera).toBe(surface.perspectiveCamera);
    expect(surface.setProjection('orthographic')).toBe(true);
    expect(renderSurface.camera).toBe(surface.orthographicCamera);
    expect(renderSurface.scene).toBe(scene);
    expect(renderSurface.renderer).toBe(renderer);
    expect(() => surface.setCameraProjection('invalid')).toThrow(/perspective.*orthographic/i);

    surface.dispose();
  });

  it('resizes valid viewports, updates both camera projections, and ignores hidden viewports', () => {
    const options = makeSurfaceOptions();
    const surface = new RenderStudioSurface(options);
    const { renderer } = options;
    renderer.setSize.mockClear();
    renderer.setPixelRatio.mockClear();
    surface.perspectiveCamera.updateProjectionMatrix = vi.fn();
    surface.orthographicCamera.updateProjectionMatrix = vi.fn();

    expect(surface.resize({ width: 640, height: 320, pixelRatio: 2, render: false })).toBe(true);
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2);
    expect(renderer.setSize).toHaveBeenCalledWith(640, 320, false);
    expect(surface.perspectiveCamera.aspect).toBe(2);
    expect(surface.perspectiveCamera.updateProjectionMatrix).toHaveBeenCalledTimes(1);
    expect(surface.orthographicCamera.left).toBe(-2);
    expect(surface.orthographicCamera.right).toBe(2);
    expect(surface.orthographicCamera.top).toBe(1);
    expect(surface.orthographicCamera.bottom).toBe(-1);
    expect(surface.orthographicCamera.updateProjectionMatrix).toHaveBeenCalledTimes(1);

    const lastViewport = surface.getLastViewport();
    renderer.setSize.mockClear();
    surface.perspectiveCamera.aspect = 123;
    expect(surface.resize({ width: 0, height: 0 })).toBe(false);
    expect(renderer.setSize).not.toHaveBeenCalled();
    expect(surface.perspectiveCamera.aspect).toBe(123);
    expect(surface.getLastViewport()).toEqual(lastViewport);

    surface.dispose();
  });

  it('uses a callback for render and falls back to renderer.render', () => {
    const options = makeSurfaceOptions();
    const surface = new RenderStudioSurface(options);
    const callback = vi.fn();

    surface.render();
    expect(options.renderer.render).toHaveBeenCalledWith(
      surface.renderSurface.scene,
      surface.renderSurface.camera,
    );
    options.renderer.render.mockClear();

    expect(surface.setRenderCallback(callback)).toBe(true);
    surface.render();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(options.renderer.render).not.toHaveBeenCalled();

    surface.dispose();
    expect(surface.setRenderCallback(vi.fn())).toBe(false);
    expect(surface.render()).toBe(false);
  });

  it('handles context loss/restoration and ResizeObserver notifications', () => {
    let observer;
    class FakeResizeObserver {
      constructor(callback) {
        this.callback = callback;
        observer = this;
      }

      observe = vi.fn();
      disconnect = vi.fn();
    }

    const onContextLost = vi.fn();
    const onContextRestored = vi.fn();
    const options = makeSurfaceOptions({
      windowRef: makeWindow({ ResizeObserver: FakeResizeObserver }),
      onContextLost,
      onContextRestored,
    });
    const surface = new RenderStudioSurface(options);
    expect(observer.observe).toHaveBeenCalledWith(options.container);

    const preventDefault = vi.fn();
    options.canvas.dispatchEvent('webglcontextlost', { preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(onContextRestored).not.toHaveBeenCalled();

    options.canvas.dispatchEvent('webglcontextrestored', {});
    expect(onContextRestored).toHaveBeenCalledTimes(1);

    options.container.clientWidth = 400;
    options.container.clientHeight = 200;
    options.renderer.setSize.mockClear();
    observer.callback();
    expect(options.renderer.setSize).toHaveBeenCalledWith(400, 200, false);

    surface.dispose();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('falls back to window resize events and disposes every resource exactly once', () => {
    const options = makeSurfaceOptions();
    const surface = new RenderStudioSurface(options);
    options.renderer.dispose.mockClear();
    options.canvas.removeEventListener.mockClear();
    options.windowRef.removeEventListener.mockClear();

    expect(options.windowRef.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    options.container.clientWidth = 300;
    options.container.clientHeight = 150;
    options.renderer.setSize.mockClear();
    options.windowRef.dispatchEvent('resize');
    expect(options.renderer.setSize).toHaveBeenCalledWith(300, 150, false);

    expect(surface.dispose()).toBe(true);
    expect(surface.dispose()).toBe(false);
    expect(options.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(options.windowRef.removeEventListener).toHaveBeenCalledTimes(1);
    expect(options.canvas.removeEventListener).toHaveBeenCalledTimes(2);
    expect(surface.renderSurface.scene.children).toEqual([]);
  });

  it('preserves the constructor error while cleaning partially created resources', () => {
    const options = makeSurfaceOptions();
    const initialError = new Error('resize observer setup failed');
    const observer = {
      observe: vi.fn(() => { throw initialError; }),
      disconnect: vi.fn(() => { throw new Error('observer cleanup failed'); }),
    };
    options.resizeObserverFactory = vi.fn(() => observer);
    options.renderer.dispose.mockImplementation(() => { throw new Error('renderer cleanup failed'); });

    expect(() => new RenderStudioSurface(options)).toThrow(initialError);
    expect(options.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(options.canvas.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
