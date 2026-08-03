import { describe, expect, it } from 'vitest';

import { getRenderHealth } from '../../src/render/renderPreflight.js';

describe('getRenderHealth', () => {
  it('marks a lost context as unavailable', () => {
    expect(getRenderHealth({ contextState: 'lost' })).toEqual({
      status: 'unavailable',
      reasons: ['context-lost'],
    });
  });

  it('marks sustained frame-time pressure as degraded', () => {
    expect(getRenderHealth({ quality: { targetFrameMs: 20, frameTime: 26, renderScale: 1 } })).toEqual({
      status: 'degraded',
      reasons: ['performance'],
    });
  });
});
