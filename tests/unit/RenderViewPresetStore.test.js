import { describe, expect, it } from 'vitest';
import {
  deleteRenderViewPreset,
  duplicateRenderViewPreset,
  getRenderViewPresets,
  saveRenderViewPreset,
} from '../../src/render/RenderViewPresetStore.js';

describe('RenderViewPresetStore', () => {
  it('supports global CRUD and rejects duplicate names case-insensitively', async () => {
    const preset = await saveRenderViewPreset({
      name: 'Hero angle',
      camera: { heading: 40, elevation: 30, distanceFactor: 3, projection: 'perspective', fov: 35 },
    });
    expect(preset.scope).toBe('global');
    await expect(saveRenderViewPreset({
      name: 'hero ANGLE',
      camera: preset.camera,
    })).rejects.toThrow();
    const copy = await duplicateRenderViewPreset(preset.id, preset.name);
    expect(copy.name).toBe('Hero angle (2)');
    expect((await getRenderViewPresets()).length).toBeGreaterThanOrEqual(2);
    await deleteRenderViewPreset(preset.id);
    await deleteRenderViewPreset(copy.id);
  });
});

