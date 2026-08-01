import { describe, expect, it } from 'vitest';

import {
  deleteScenePreset,
  getUserScenePresets,
  saveScenePreset,
} from '../../src/preview3d/ScenePresetStore.js';

describe('ScenePresetStore', () => {
  it('saves and retrieves custom scene presets', async () => {
    const saved = await saveScenePreset({
      name: 'My Warm Studio',
      settings: { environment: 'warm', lightAzimuth: 180 },
    });

    expect(saved).toMatchObject({
      name: 'My Warm Studio',
      isBuiltIn: false,
    });
    expect(saved.settings).toMatchObject({ environment: 'warm', lightAzimuth: 180 });

    const presets = await getUserScenePresets();
    expect(presets.some((p) => p.id === saved.id)).toBe(true);

    await deleteScenePreset(saved.id);
    const after = await getUserScenePresets();
    expect(after.some((p) => p.id === saved.id)).toBe(false);
  });

  it('falls back to a default name when the name is empty', async () => {
    const saved = await saveScenePreset({ name: '   ', settings: {} });
    expect(saved.name).toBe('Scene preset');
    await deleteScenePreset(saved.id);
  });
});
