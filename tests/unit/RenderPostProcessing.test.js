import { describe, expect, it } from 'vitest';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import { getRenderPassPlan } from '../../src/render/RenderPostProcessing.js';

describe('RenderPostProcessing pass plans', () => {
  it('keeps OutputPass last and enables the correct passes by quality state', () => {
    const effects = DEFAULT_RENDER_SETTINGS.effects;
    expect(getRenderPassPlan({ state: 'interactive', effects })).toEqual(['render', 'smaa', 'output']);
    expect(getRenderPassPlan({ state: 'settled', effects })).toEqual(['taa', 'gtao', 'output']);
    expect(getRenderPassPlan({ state: 'export', effects, transparent: true })).toEqual(['render', 'gtao', 'smaa', 'output']);
  });

  it('does not add heavy effects when they are disabled', () => {
    const effects = structuredClone(DEFAULT_RENDER_SETTINGS.effects);
    effects.gtao.enabled = false;
    effects.dof.enabled = true;
    effects.antialiasing.settled = 'native';
    expect(getRenderPassPlan({ state: 'settled', effects })).toEqual(['render', 'dof', 'output']);
  });
});
