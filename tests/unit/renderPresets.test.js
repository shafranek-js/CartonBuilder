import { describe, expect, it } from 'vitest';

import {
  RENDER_PRESET_DEFINITIONS,
  applyRenderPreset,
  getRenderPreset,
} from '../../src/render/renderPresets.js';
import { sanitizeRenderSettings } from '../../src/render/RenderSettings.js';

describe('render presets', () => {
  it('resolves every named preset to valid deterministic settings', () => {
    for (const id of Object.keys(RENDER_PRESET_DEFINITIONS)) {
      const first = getRenderPreset(id);
      const second = getRenderPreset(id);
      expect(first).toEqual(second);
      expect(first.presetId).toBe(id);
      expect(sanitizeRenderSettings(first)).toEqual(first);
    }
  });

  it('preserves project-specific frame and camera choices when applying a preset', () => {
    const current = sanitizeRenderSettings({
      aspect: 'portrait',
      longEdge: 4096,
      camera: { preset: 'front-left' },
    });
    const applied = applyRenderPreset(current, 'catalogue');
    expect(applied.presetId).toBe('catalogue');
    expect(applied.aspect).toBe('portrait');
    expect(applied.longEdge).toBe(4096);
    expect(applied.camera.preset).toBe('front-left');
    expect(applied.material.profile).toBe('gloss');
  });

  it('includes the imported left and right view presets', () => {
    expect(RENDER_PRESET_DEFINITIONS['left-view'].labelKey).toBe('renderPresetLeftView');
    expect(RENDER_PRESET_DEFINITIONS['right-view'].labelKey).toBe('renderPresetRightView');

    const left = getRenderPreset('left-view');
    const right = getRenderPreset('right-view');
    expect(left.presetId).toBe('left-view');
    expect(right.presetId).toBe('right-view');
    expect(left.camera.heading).toBeCloseTo(19.68414779499409);
    expect(right.camera.heading).toBeCloseTo(340.3158522050059);
    expect(left.camera.cameraDistance).toBeCloseTo(right.camera.cameraDistance);
    expect(left.material.profile).toBe('gloss');
  });
});
