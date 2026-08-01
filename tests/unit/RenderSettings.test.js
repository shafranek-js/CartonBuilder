import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RENDER_SETTINGS,
  getRenderFrameAspect,
  getRenderOutputDimensions,
  sanitizeRenderSettings,
} from '../../src/render/RenderSettings.js';

describe('RenderSettings', () => {
  it('exposes a complete immutable default profile', () => {
    expect(DEFAULT_RENDER_SETTINGS).toMatchObject({
      presetId: 'clean-studio',
      aspect: 'square',
      longEdge: 2048,
      camera: { preset: 'isometric', projection: 'perspective', fov: 35 },
      background: { mode: 'solid', color: '#e8eaeb' },
      lighting: { azimuth: 63, elevation: 48, intensity: 2.6 },
      shadows: { enabled: true, mapSize: 1024 },
      material: { profile: 'matte' },
      quality: { interactive: 'balanced', export: 'high' },
      effects: { gtao: { enabled: true }, dof: { enabled: false } },
    });
  });

  it('sanitizes enums, ranges, colors and camera vectors', () => {
    const result = sanitizeRenderSettings({
      presetId: 'unknown',
      aspect: 'wide',
      longEdge: 999,
      camera: {
        preset: 'unknown',
        projection: 'bad',
        fov: 999,
        position: [1, Infinity, 3],
        target: ['x', 2, 3],
      },
      background: { mode: 'bad', color: 'red' },
      lighting: {
        azimuth: -20,
        elevation: 999,
        intensity: -2,
        environment: 'bad',
        environmentIntensity: 999,
        exposure: 999,
      },
      shadows: { enabled: false, intensity: 2, blur: -1, mapSize: 777 },
      material: { profile: 'bad' },
      quality: { interactive: 'bad', export: 'high' },
      effects: {
        gtao: { enabled: 'bad', intensity: 2, radius: -1, resolution: 'bad' },
        antialiasing: { interactive: 'bad', settled: 'taa', export: 'taa', taaSamples: 999 },
        dof: { enabled: 'yes', focusMode: 'bad', focusDistance: -1, aperture: 9, maxBlur: -1 },
      },
    });

    expect(result.presetId).toBe('clean-studio');
    expect(result.aspect).toBe('wide');
    expect(result.longEdge).toBe(2048);
    expect(result.camera).toMatchObject({ preset: 'isometric', projection: 'perspective', fov: 120 });
    expect(result.camera.position).toEqual([1, 1, 1]);
    expect(result.camera.target).toEqual([0, 0, 0]);
    expect(result.background).toEqual({ mode: 'solid', color: '#e8eaeb' });
    expect(result.lighting).toMatchObject({ azimuth: 0, elevation: 85, intensity: 0, environment: 'studio', environmentIntensity: 5, exposure: 3 });
    expect(result.shadows).toMatchObject({ enabled: false, intensity: 1, blur: 0, mapSize: 1024 });
    expect(result.material.profile).toBe('matte');
    expect(result.quality).toMatchObject({ interactive: 'balanced', export: 'high' });
    expect(result.effects.gtao).toMatchObject({ enabled: true, intensity: 1, radius: 0.01, resolution: 'half' });
    expect(result.effects.antialiasing).toMatchObject({ interactive: 'smaa', settled: 'taa', export: 'taa', taaSamples: 64 });
    expect(result.effects.dof).toMatchObject({ enabled: false, focusMode: 'carton-center', focusDistance: 0.01, aperture: 0.2, maxBlur: 0 });
  });

  it.each([
    ['square', 2048, 2048, 2048],
    ['landscape', 2048, 2048, 1536],
    ['wide', 2048, 2048, 1152],
    ['portrait', 2048, 1536, 2048],
    ['square', 4096, 4096, 4096],
    ['landscape', 4096, 4096, 3072],
    ['wide', 4096, 4096, 2304],
    ['portrait', 4096, 3072, 4096],
  ])('calculates %s %s px output dimensions', (aspect, longEdge, width, height) => {
    const dimensions = getRenderOutputDimensions({ aspect, longEdge });
    expect(dimensions).toEqual({ width, height });
    expect(getRenderFrameAspect({ aspect, longEdge })).toBeCloseTo(width / height);
  });
});
