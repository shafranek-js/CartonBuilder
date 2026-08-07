import { describe, expect, it } from 'vitest';
import { createRenderSettingsSnapshot, parseRenderSettingsSnapshot } from '../../src/render/renderSettingsSnapshot.js';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from '../../src/render/RenderSettings.js';
import { DEFAULT_BOARD_APPEARANCE } from '../../src/render/BoardAppearance.js';

describe('render settings snapshot', () => {
  it('round-trips render settings and board appearance', () => {
    const renderSettings = sanitizeRenderSettings({
      ...DEFAULT_RENDER_SETTINGS,
      presetId: 'warm-retail',
      aspect: 'landscape',
      lighting: { ...DEFAULT_RENDER_SETTINGS.lighting, environment: 'warm', azimuth: 120, intensity: 2.4 },
      output: { ...DEFAULT_RENDER_SETTINGS.output, format: 'jpg', jpegQuality: 0.9 },
    });
    const boardAppearance = { thicknessMm: 0.8, bevelRadiusMm: 0.25, interiorColor: '#abcdef', edgeColor: '#123456' };
    const json = createRenderSettingsSnapshot({ renderSettings, boardAppearance });
    const parsed = parseRenderSettingsSnapshot(json);
    expect(parsed.renderSettings).toEqual(sanitizeRenderSettings(renderSettings));
    expect(parsed.boardAppearance).toEqual({ thicknessMm: 0.8, bevelRadiusMm: 0.25, interiorColor: '#abcdef', edgeColor: '#123456' });
  });

  it('accepts a named render preset shape', () => {
    const preset = {
      id: 'render-preset-x',
      name: 'My Preset',
      renderSettings: { ...DEFAULT_RENDER_SETTINGS, aspect: 'portrait' },
      boardAppearance: DEFAULT_BOARD_APPEARANCE,
    };
    const parsed = parseRenderSettingsSnapshot(JSON.stringify(preset));
    expect(parsed.renderSettings.aspect).toBe('portrait');
    expect(parsed.boardAppearance.thicknessMm).toBe(0.35);
  });

  it('rejects invalid JSON and missing render settings', () => {
    expect(() => parseRenderSettingsSnapshot('not json')).toThrow();
    expect(() => parseRenderSettingsSnapshot(JSON.stringify({ foo: 1 }))).toThrow();
    expect(() => parseRenderSettingsSnapshot(JSON.stringify([1, 2, 3]))).toThrow();
  });
});
