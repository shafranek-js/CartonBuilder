import { describe, expect, it } from 'vitest';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import {
  deleteRenderPreset,
  getRenderPresets,
  saveRenderPreset,
} from '../../src/render/RenderPresetStore.js';

describe('RenderPresetStore', () => {
  it('round-trips a user preset through the fallback store', async () => {
    const preset = await saveRenderPreset({
      name: 'Test preset',
      renderSettings: DEFAULT_RENDER_SETTINGS,
      boardAppearance: { thicknessMm: 0.8 },
    });
    expect(preset.name).toBe('Test preset');
    expect(preset.boardAppearance.thicknessMm).toBe(0.8);
    expect((await getRenderPresets()).some((entry) => entry.id === preset.id)).toBe(true);
    await deleteRenderPreset(preset.id);
    expect((await getRenderPresets()).some((entry) => entry.id === preset.id)).toBe(false);
  });
});
