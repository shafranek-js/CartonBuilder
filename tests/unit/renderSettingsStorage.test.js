import { describe, expect, it } from 'vitest';
import {
  clearRenderSettings,
  readRenderSettings,
  RENDER_SETTINGS_STORAGE_KEY,
  writeRenderSettings,
} from '../../src/render/renderSettingsStorage.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    dump: () => Object.fromEntries(values),
  };
}

describe('Render settings storage', () => {
  it('round-trips sanitized Render state and board appearance', () => {
    const storage = memoryStorage();

    expect(writeRenderSettings({
      renderSettings: {
        aspect: 'wide',
        longEdge: 4096,
        quality: { html: 2400 },
      },
      boardAppearance: {
        thicknessMm: 0.8,
        bevelRadiusMm: 0.2,
        interiorColor: '#ABCDEF',
      },
    }, storage)).toBe(true);

    expect(storage.dump()).toHaveProperty(RENDER_SETTINGS_STORAGE_KEY);
    expect(readRenderSettings(storage)).toMatchObject({
      renderSettings: {
        aspect: 'wide',
        longEdge: 4096,
        quality: { html: 2400 },
      },
      boardAppearance: {
        thicknessMm: 0.8,
        bevelRadiusMm: 0.2,
        interiorColor: '#abcdef',
      },
    });
  });

  it('ignores malformed storage and supports clearing it', () => {
    const storage = memoryStorage({ [RENDER_SETTINGS_STORAGE_KEY]: '{not-json' });
    expect(readRenderSettings(storage)).toBeNull();

    writeRenderSettings({}, storage);
    clearRenderSettings(storage);
    expect(storage.dump()).toEqual({});
  });
});
