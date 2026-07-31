import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PRESETS,
  deletePreset,
  formatPresetDimensions,
  getUserPresets,
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
});
