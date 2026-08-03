import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FINISH_CONFIG,
  sanitizeArtworkFinish,
  sanitizeFinishConfig,
} from '../../src/render/FinishConfig.js';

describe('finish configuration', () => {
  it('keeps legacy artwork layers as ordinary print output', () => {
    expect(sanitizeArtworkFinish({})).toEqual({ outputRole: 'print', finish: null });
    expect(sanitizeArtworkFinish(null)).toEqual({ outputRole: 'print', finish: null });
  });

  it('sanitizes finish roles and physical parameters', () => {
    expect(sanitizeArtworkFinish({
      outputRole: 'finish',
      finish: {
        type: 'foil',
        maskChannel: 'luminance',
        intensity: 2,
        foilColor: '#ABCDEF',
        foilRoughness: -1,
        reliefStrength: 9,
      },
    })).toEqual({
      outputRole: 'finish',
      finish: {
        ...DEFAULT_FINISH_CONFIG,
        type: 'foil',
        maskChannel: 'luminance',
        intensity: 1,
        foilColor: '#abcdef',
        foilRoughness: 0.04,
        reliefStrength: 1,
      },
    });
  });

  it('drops finish data when the role is changed back to print', () => {
    expect(sanitizeArtworkFinish({ outputRole: 'print', finish: { type: 'foil' } }))
      .toEqual({ outputRole: 'print', finish: null });
  });
});

describe('finish config defaults', () => {
  it('uses a presentation-safe gloss default', () => {
    expect(DEFAULT_FINISH_CONFIG.type).toBe('spot-gloss');
    expect(DEFAULT_FINISH_CONFIG.foilColor).toBe('#d4af37');
  });
});
