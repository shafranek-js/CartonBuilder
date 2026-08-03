import { describe, expect, it } from 'vitest';

import { createDiagnosticsBlob } from '../../src/diagnostics.js';

describe('createDiagnosticsBlob', () => {
  it('includes render health without project or artwork bytes', async () => {
    const blob = createDiagnosticsBlob({
      renderDiagnostics: {
        health: { status: 'healthy', reasons: [] },
        contextState: 'ready',
      },
      windowRef: {
        navigator: { userAgent: 'Chrome/1' },
        document: { documentElement: { lang: 'en' } },
        innerWidth: 1280,
        innerHeight: 720,
      },
    });
    const payload = JSON.parse(await blob.text());
    expect(payload.version).toBe(2);
    expect(payload.render).toMatchObject({ contextState: 'ready' });
    expect(payload.privacy).toContain('No artwork bytes');
    expect(payload.box).toBeNull();
  });
});
