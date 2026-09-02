import {
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import { describe, expect, it, vi } from 'vitest';

import { RenderStudioCameraRig } from '../../src/render/RenderStudioCameraRig.js';
import {
  cameraHeadingElevation,
  focalLengthToFov,
  fovToFocalLength,
} from '../../src/render/cameraState.js';
import { RenderStudioSurface } from '../../src/render/RenderStudioSurface.js';

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    }),
  };
}

function makeSurface({ container = { clientWidth: 800, clientHeight: 600 }, projection = 'perspective' } = {}) {
  const renderer = {
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  };
  const surface = new RenderStudioSurface({
    canvas: makeEventTarget(),
    container,
    windowRef: {
      ...makeEventTarget(),
      devicePixelRatio: 1,
    },
    projection,
    rendererFactory: vi.fn(() => renderer),
  });
  return { surface, renderer };
}

function makeBounds() {
  return {
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    radius: 1,
  };
}

function makeRig(options = {}) {
  const { surface, renderer } = makeSurface(options);
  const boundsProvider = options.boundsProvider || vi.fn(() => makeBounds());
  const onCameraChange = options.onCameraChange || vi.fn();
  const rig = new RenderStudioCameraRig({
    surface,
    boundsProvider,
    initialState: options.initialState,
    onCameraChange,
  });
  return { rig, surface, renderer, boundsProvider, onCameraChange };
}

function disposeRig({ rig, surface }) {
  rig.dispose();
  surface.dispose();
}

describe('RenderStudioCameraRig', () => {
  it('validates surface and provider without calling bounds or rendering in the constructor', () => {
    const { surface, renderer } = makeSurface();
    const boundsProvider = vi.fn(() => makeBounds());
    const onCameraChange = vi.fn();

    const rig = new RenderStudioCameraRig({
      surface,
      boundsProvider,
      initialState: {
        projection: 'perspective',
        position: [1, 2, 3],
        target: [0, 0, 0],
      },
      onCameraChange,
    });
    expect(boundsProvider).not.toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(onCameraChange).not.toHaveBeenCalled();

    expect(() => new RenderStudioCameraRig({ surface: null, boundsProvider })).toThrow(/surface/i);
    expect(() => new RenderStudioCameraRig({ surface, boundsProvider: null })).toThrow(/boundsProvider/i);
    disposeRig({ rig, surface });
  });

  it('applies position, target and FOV while returning detached state snapshots', () => {
    const context = makeRig();
    const { rig, surface, onCameraChange } = context;
    const render = vi.spyOn(surface, 'render');
    const position = [2, 3, 4];
    const target = [0.5, 1, -0.5];

    expect(rig.setCameraState({
      preset: 'custom',
      projection: 'perspective',
      position,
      target,
      fov: 52,
    })).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(onCameraChange).toHaveBeenCalledTimes(1);
    expect(surface.renderSurface.camera.position.toArray()).toEqual(position);
    expect(surface.renderSurface.camera.getWorldDirection(new Vector3())).toBeTruthy();

    const expectedOrientation = cameraHeadingElevation(position, target);
    const snapshot = rig.getCameraState();
    expect(snapshot).toMatchObject({
      preset: 'custom',
      projection: 'perspective',
      fov: 52,
      position,
      target,
      heading: expectedOrientation.heading,
      elevation: expectedOrientation.elevation,
      cameraDistance: expectedOrientation.distance,
    });
    snapshot.position[0] = 999;
    snapshot.target[1] = 999;
    expect(rig.getCameraState().position).toEqual(position);
    expect(rig.getCameraState().target).toEqual(target);
    expect(onCameraChange.mock.calls[0][0]).not.toBe(snapshot);

    disposeRig(context);
  });

  it('keeps FOV and focal length synchronized in both directions', () => {
    const context = makeRig();
    const { rig } = context;

    expect(rig.setCameraState({ focalLength: 50 }, { render: false, notify: false })).toBe(true);
    expect(rig.getCameraState().fov).toBeCloseTo(focalLengthToFov(50), 8);
    expect(rig.getCameraState().focalLength).toBeCloseTo(50, 8);

    expect(rig.setCameraState({ fov: 40 }, { render: false, notify: false })).toBe(true);
    expect(rig.getCameraState().fov).toBe(40);
    expect(rig.getCameraState().focalLength).toBeCloseTo(fovToFocalLength(40), 8);

    disposeRig(context);
  });

  it('preserves visible framing and camera identity across projection changes', () => {
    const context = makeRig();
    const { rig, surface } = context;
    const scene = surface.renderSurface.scene;
    const renderer = surface.renderSurface.renderer;

    rig.setCameraState({
      projection: 'perspective',
      position: [0, 0, 4],
      target: [0, 0, 0],
      fov: 45,
    }, { render: false, notify: false });
    const visibleHeight = 2 * 4 * Math.tan(45 * Math.PI / 360);

    expect(rig.setCameraState({ projection: 'orthographic' }, { render: false, notify: false })).toBe(true);
    expect(surface.getCameraOptics().orthographicHeight).toBeCloseTo(visibleHeight, 8);
    expect(rig.getCameraState().cameraDistance).toBeCloseTo(4, 8);
    expect(surface.renderSurface.camera.position.toArray()).toEqual([0, 0, 4]);

    expect(rig.setCameraState({ projection: 'perspective' }, { render: false, notify: false })).toBe(true);
    expect(rig.getCameraState().cameraDistance).toBeCloseTo(4, 8);
    expect(surface.renderSurface.scene).toBe(scene);
    expect(surface.renderSurface.renderer).toBe(renderer);

    disposeRig(context);
  });

  it('applies local preset directions without importing Quick BoxScene', () => {
    const context = makeRig();
    const { rig, surface } = context;
    rig.setCameraState({
      position: [0, 2, 4],
      target: [0, 0, 0],
      preset: 'custom',
    }, { render: false, notify: false });
    const distance = rig.getCameraState().cameraDistance;

    expect(rig.setCameraPreset('front', { render: false, notify: false })).toBe(true);
    expect(surface.renderSurface.camera.position.x).toBeCloseTo(0, 8);
    expect(surface.renderSurface.camera.position.y).toBeCloseTo(0, 8);
    expect(surface.renderSurface.camera.position.z).toBeCloseTo(distance, 8);

    expect(rig.setCameraPreset('right', { render: false, notify: false })).toBe(true);
    expect(surface.renderSurface.camera.position.x).toBeCloseTo(distance, 8);
    expect(surface.renderSurface.camera.position.z).toBeCloseTo(0, 8);

    expect(rig.setCameraPreset('top', { render: false, notify: false })).toBe(true);
    expect(surface.renderSurface.camera.position.y).toBeCloseTo(distance, 8);
    expect(surface.renderSurface.camera.up.z).toBeCloseTo(-1, 8);

    disposeRig(context);
  });

  it('fits perspective and orthographic cameras to normalized meter bounds', () => {
    const boundsProvider = vi.fn(() => ({ centerX: 1, centerY: 2, centerZ: 3, radius: 0.5 }));
    const context = makeRig({ boundsProvider });
    const { rig, surface } = context;

    rig.setCameraState({
      projection: 'perspective',
      position: [0, 0, 4],
      target: [0, 0, 0],
      fov: 60,
    }, { render: false, notify: false });
    expect(rig.fitCameraToFrame({ margin: 1.2, aspect: 16 / 9, render: false })).toBe(true);
    expect(boundsProvider).toHaveBeenCalledTimes(1);
    expect(rig.getCameraState().target).toEqual([1, 2, 3]);
    expect(surface.renderSurface.camera.aspect).toBeCloseTo(16 / 9, 8);
    expect(rig.getCameraState().cameraDistance).toBeCloseTo(
      1.2 / (2 * Math.tan(60 * Math.PI / 360)),
      8,
    );
    expect(surface.renderSurface.camera.near).toBeGreaterThan(0);
    expect(surface.renderSurface.camera.far).toBeGreaterThan(surface.renderSurface.camera.near);

    expect(rig.setCameraState({ projection: 'orthographic' }, { render: false, notify: false })).toBe(true);
    expect(rig.fitCameraToFrame({ margin: 1.2, aspect: 2, render: false })).toBe(true);
    expect(boundsProvider).toHaveBeenCalledTimes(2);
    expect(rig.getCameraState().orthographicHeight).toBeCloseTo(1.2, 8);
    expect(surface.renderSurface.camera.left).toBeCloseTo(-1.2, 8);
    expect(surface.renderSurface.camera.right).toBeCloseTo(1.2, 8);
    expect(surface.renderSurface.camera.top).toBeCloseTo(0.6, 8);
    expect(surface.renderSurface.camera.bottom).toBeCloseTo(-0.6, 8);

    disposeRig(context);
  });

  it('rejects invalid bounds before mutation, limits render/notify cardinality, and disposes idempotently', () => {
    const boundsProvider = vi.fn(() => ({ centerX: 0, centerY: 0, centerZ: 0, radius: 0 }));
    const context = makeRig({ boundsProvider });
    const { rig, surface, onCameraChange } = context;
    const render = vi.spyOn(surface, 'render');
    const before = rig.getCameraState();

    expect(() => rig.fitCameraToFrame()).toThrow(/finite normalized meter bounds/i);
    expect(rig.getCameraState()).toEqual(before);
    expect(render).not.toHaveBeenCalled();
    expect(onCameraChange).not.toHaveBeenCalled();

    expect(rig.setCameraState({}, { render: true, notify: true })).toBe(false);
    expect(render).not.toHaveBeenCalled();
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(rig.setCameraState({ fov: 50 }, { render: true, notify: true })).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(onCameraChange).toHaveBeenCalledTimes(1);

    const snapshot = rig.getCameraState();
    expect(rig.dispose()).toBe(true);
    expect(rig.dispose()).toBe(false);
    expect(rig.getCameraState()).toEqual(snapshot);
    expect(rig.setCameraState({ fov: 80 })).toBe(false);
    expect(rig.setCameraPreset('front')).toBe(false);
    expect(rig.fitCameraToFrame()).toBe(false);
    expect(rig.resetView()).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);
    expect(surface.disposed).toBe(false);

    surface.dispose();
  });

  it('resets from initial state and then frames against current bounds', () => {
    const boundsProvider = vi.fn(() => ({ centerX: 2, centerY: 1, centerZ: -1, radius: 0.25 }));
    const context = makeRig({
      boundsProvider,
      initialState: {
        preset: 'front',
        projection: 'perspective',
        fov: 50,
        position: [0, 0, 4],
        target: [0, 0, 0],
      },
    });
    const { rig } = context;
    rig.setCameraPreset('right', { render: false, notify: false });

    expect(rig.resetView({ render: false })).toBe(true);
    expect(boundsProvider).toHaveBeenCalledTimes(1);
    expect(rig.getCameraState()).toMatchObject({
      preset: 'front',
      projection: 'perspective',
      fov: 50,
      target: [2, 1, -1],
    });

    disposeRig(context);
  });
});

describe('RenderStudioCameraRig portrait framing', () => {
  it('fits a perspective camera without cropping the horizontal sphere extent', () => {
    const context = makeRig({
      boundsProvider: vi.fn(() => ({ centerX: 0, centerY: 0, centerZ: 0, radius: 0.5 })),
    });
    const { rig, surface } = context;
    const aspect = 0.5;
    const fov = 60;
    const requiredSpan = 0.5 * 2 * 1.2;

    rig.setCameraState({
      projection: 'perspective',
      position: [0, 0, 4],
      target: [0, 0, 0],
      fov,
    }, { render: false, notify: false });
    expect(rig.fitCameraToFrame({ margin: 1.2, aspect, render: false })).toBe(true);

    const distance = rig.getCameraState().cameraDistance;
    const visibleHeight = 2 * distance * Math.tan(fov * Math.PI / 360);
    expect(visibleHeight * surface.renderSurface.camera.aspect).toBeCloseTo(requiredSpan, 8);
    expect(visibleHeight).toBeCloseTo(requiredSpan / aspect, 8);

    disposeRig(context);
  });

  it('fits an orthographic camera without cropping the horizontal sphere extent', () => {
    const context = makeRig({
      boundsProvider: vi.fn(() => ({ centerX: 0, centerY: 0, centerZ: 0, radius: 0.5 })),
    });
    const { rig, surface } = context;
    const aspect = 0.5;
    const requiredSpan = 0.5 * 2 * 1.2;

    rig.setCameraState({ projection: 'orthographic' }, { render: false, notify: false });
    expect(rig.fitCameraToFrame({ margin: 1.2, aspect, render: false })).toBe(true);

    const camera = surface.renderSurface.camera;
    expect(camera.right - camera.left).toBeCloseTo(requiredSpan, 8);
    expect(camera.top - camera.bottom).toBeCloseTo(requiredSpan / aspect, 8);
    expect(rig.getCameraState().orthographicHeight).toBeCloseTo(requiredSpan / aspect, 8);

    disposeRig(context);
  });
});
