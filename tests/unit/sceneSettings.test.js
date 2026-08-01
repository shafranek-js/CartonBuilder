import { describe, expect, it } from 'vitest';

import {
  clearSceneSettings,
  readSceneSettings,
  writeSceneSettings,
} from '../../src/preview3d/sceneSettings.js';

const defaults = Object.freeze({
  foldProgress: 1,
  cameraProjection: 'perspective',
  cameraPreset: 'isometric',
  cameraFov: 35,
  scenePreset: 'studio',
  environment: 'studio',
  environmentIntensity: 0.65,
  lightAzimuth: 63,
  lightElevation: 48,
  lightIntensity: 2.6,
  hemisphereIntensity: 1.7,
  shadowEnabled: true,
  shadowMapSize: 1024,
  shadowBlur: 1.5,
  shadowIntensity: 0.25,
  backgroundColor: null,
});

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    dump: () => data,
  };
}

describe('scene settings persistence', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readSceneSettings(defaults, memoryStorage())).toEqual(defaults);
  });

  it('merges valid persisted values over the defaults', () => {
    const storage = memoryStorage({
      'cartonBuilder.preview3d': JSON.stringify({
        foldProgress: 0.25,
        cameraProjection: 'orthographic',
        scenePreset: 'photorealistic',
        environment: 'warm',
        lightAzimuth: 180,
        shadowMapSize: 2048,
        backgroundColor: '#ff0000',
      }),
    });
    const state = readSceneSettings(defaults, storage);
    expect(state).toMatchObject({
      foldProgress: 0.25,
      cameraProjection: 'orthographic',
      scenePreset: 'photorealistic',
      environment: 'warm',
      lightAzimuth: 180,
      shadowMapSize: 2048,
      backgroundColor: '#ff0000',
    });
    expect(state.cameraFov).toBe(35);
  });

  it('falls back to defaults for invalid values', () => {
    const storage = memoryStorage({
      'cartonBuilder.preview3d': JSON.stringify({
        foldProgress: 42,
        cameraProjection: 'weird',
        cameraPreset: 'diagonal',
        cameraFov: -5,
        environment: 'lava',
        shadowMapSize: 333,
        backgroundColor: 'red',
        shadowEnabled: 'no',
      }),
    });
    const state = readSceneSettings(defaults, storage);
    expect(state).toMatchObject({
      foldProgress: 1,
      cameraProjection: 'perspective',
      cameraPreset: 'isometric',
      cameraFov: 10,
      scenePreset: 'studio',
      environment: 'studio',
      shadowEnabled: true,
      shadowMapSize: 1024,
      shadowIntensity: 0.25,
      backgroundColor: null,
    });
  });

  it('ignores malformed stored JSON', () => {
    const storage = memoryStorage({
      'cartonBuilder.preview3d': '{not json',
    });
    expect(readSceneSettings(defaults, storage)).toEqual(defaults);
  });

  it('writes only the scene fields and round-trips', () => {
    const storage = memoryStorage();
    const state = {
      ...defaults,
      foldProgress: 0.5,
      environment: 'night',
      lightIntensity: 3,
      backgroundColor: '#123456',
      active: true,
      selectedPanelId: 'front',
    };
    writeSceneSettings(state, storage);
    const raw = storage.dump()['cartonBuilder.preview3d'];
    const parsed = JSON.parse(raw);
    expect(parsed.foldProgress).toBe(0.5);
    expect(parsed.environment).toBe('night');
    expect(parsed.backgroundColor).toBe('#123456');
    expect(parsed.active).toBeUndefined();
    expect(parsed.selectedPanelId).toBeUndefined();

    const restored = readSceneSettings(defaults, storage);
    expect(restored.foldProgress).toBe(0.5);
    expect(restored.lightIntensity).toBe(3);
    expect(restored.active).toBeUndefined();
  });

  it('clears the stored settings', () => {
    const storage = memoryStorage({
      'cartonBuilder.preview3d': '{"foldProgress":0.5}',
    });
    clearSceneSettings(storage);
    expect(storage.dump()).toEqual({});
  });
});
