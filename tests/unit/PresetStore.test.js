import { describe, expect, it, vi } from 'vitest';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import {
  BUILT_IN_PRESETS,
  deletePreset,
  exportPresetsJson,
  formatPresetDimensions,
  getUserPresets,
  importPresetsFromJson,
  savePreset,
} from '../../src/project/PresetStore.js';

describe('PresetStore', () => {
  it('provides built-in presets', () => {
    expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(BUILT_IN_PRESETS[0]).toMatchObject({
      id: 'preset-standard',
      name: 'Standard Box',
      dimensions: { width: 150, height: 90, depth: 40 },
      isBuiltIn: true,
    });
    expect(BUILT_IN_PRESETS.find((preset) => preset.id === 'preset-tuck')?.name).toBe('Small Box');
  });

  it('formats dimensions into readable strings', () => {
    expect(formatPresetDimensions({ width: 150, height: 90, depth: 40 })).toBe('150 × 90 × 40 mm');
    expect(formatPresetDimensions(null)).toBe('');
  });

  it('saves and retrieves custom user presets', async () => {
    const saved = await savePreset({
      name: 'My Perfume Box',
      dimensions: { width: 60, height: 60, depth: 120 },
    });

    expect(saved).toMatchObject({
      name: 'My Perfume Box',
      dimensions: { width: 60, height: 60, depth: 120 },
      isBuiltIn: false,
    });

    const userPresets = await getUserPresets();
    expect(userPresets.some((p) => p.id === saved.id)).toBe(true);

    await deletePreset(saved.id);
    const afterDelete = await getUserPresets();
    expect(afterDelete.some((p) => p.id === saved.id)).toBe(false);
  });

  it('auto-generates dimension name when name is empty', async () => {
    const saved = await savePreset({
      name: '',
      dimensions: { width: 210, height: 148, depth: 75 },
    });

    expect(saved.name).toBe('210 × 148 × 75 mm');
    await deletePreset(saved.id);
  });

  it('exports and imports presets JSON cleanly', async () => {
    const preset1 = { id: 'p1', name: 'Export Box 1', dimensions: { width: 100, height: 100, depth: 50 } };
    const jsonStr = exportPresetsJson([preset1]);

    expect(jsonStr).toContain('Export Box 1');

    const count = await importPresetsFromJson(jsonStr);
    expect(count).toBe(1);

    const userPresets = await getUserPresets();
    const imported = userPresets.find((p) => p.name === 'Export Box 1');
    expect(imported).toBeDefined();

    if (imported) await deletePreset(imported.id);
  });

  it('normalizes legacy presets when reading and exporting', async () => {
    const legacyState = new BoxNetModel(
      { width: 180, height: 110, depth: 45 },
      { caliperMm: 0.55 },
      { templateId: 'ste', parameters: {} },
    ).toJSON();
    let stored = JSON.stringify([{
      id: 'legacy-preset',
      name: 'Legacy preset',
      dimensions: legacyState.dimensions,
      netState: legacyState,
      construction: legacyState.construction,
    }]);
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_key, value) => { stored = value; },
    });

    try {
      const loaded = await getUserPresets();
      expect(loaded[0].netState.construction).toEqual({
        templateId: 'legacy-six-panel',
        templateVersion: 1,
        parameters: {},
      });
      expect(JSON.parse(stored)[0].netState.construction.templateId).toBe('legacy-six-panel');

      const exported = JSON.parse(exportPresetsJson([{
        id: 'legacy-preset',
        name: 'Legacy preset',
        dimensions: legacyState.dimensions,
        netState: legacyState,
        construction: legacyState.construction,
      }]));
      expect(exported.presets[0].netState.construction.templateId).toBe('legacy-six-panel');
      expect(JSON.stringify(exported)).not.toMatch(/"templateId":"(ste|rte)"/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
