import { describe, expect, it } from 'vitest';

import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import { runRenderExportPreflight } from '../../src/render/renderPreflight.js';

describe('runRenderExportPreflight', () => {
  it('returns ready for a normal image export before the renderer initializes', () => {
    const result = runRenderExportPreflight({
      kind: 'image',
      settings: DEFAULT_RENDER_SETTINGS,
      rendererAvailable: false,
    });
    expect(result.status).toBe('ready');
    expect(result.dimensions).toEqual({ width: 2048, height: 2048 });
    expect(result.issues.map((entry) => entry.code)).toContain('renderer-will-initialize');
  });

  it('blocks a target that exceeds the reported GPU limit', () => {
    const result = runRenderExportPreflight({
      kind: 'image',
      settings: { ...DEFAULT_RENDER_SETTINGS, longEdge: 4096 },
      diagnostics: { maxTextureSize: 2048, maxRenderbufferSize: 2048 },
    });
    expect(result.status).toBe('blocked');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'gpu-limit', severity: 'error' }),
    ]));
  });

  it('blocks an oversized turntable and warns for basic GLB finish output', () => {
    const turntable = runRenderExportPreflight({
      kind: 'sequence',
      settings: {
        ...DEFAULT_RENDER_SETTINGS,
        output: { ...DEFAULT_RENDER_SETTINGS.output, sequence: { frames: 72, longEdge: 2048, format: 'png' } },
      },
    });
    expect(turntable.status).toBe('blocked');
    expect(turntable.issues.map((entry) => entry.code)).toContain('turntable-budget');

    const glb = runRenderExportPreflight({
      kind: 'glb',
      settings: {
        ...DEFAULT_RENDER_SETTINGS,
        output: { ...DEFAULT_RENDER_SETTINGS.output, glb: { textureSize: 2048, materialMode: 'basic-compatibility' } },
      },
      hasFinishes: true,
    });
    expect(glb.status).toBe('warning');
    expect(glb.issues.map((entry) => entry.code)).toContain('basic-glb-finishes');
  });

  it('reports lost context as a blocking issue for raster output', () => {
    const result = runRenderExportPreflight({
      diagnostics: { contextState: 'lost' },
      settings: DEFAULT_RENDER_SETTINGS,
    });
    expect(result.status).toBe('blocked');
    expect(result.issues[0]).toMatchObject({ code: 'context-lost', severity: 'error' });
  });

  it('warns that GLB viewers do not receive custom HDRI presentation assets', () => {
    const result = runRenderExportPreflight({
      kind: 'glb',
      settings: {
        ...DEFAULT_RENDER_SETTINGS,
        lighting: {
          ...DEFAULT_RENDER_SETTINGS.lighting,
          environmentMap: {
            ...DEFAULT_RENDER_SETTINGS.lighting.environmentMap,
            source: 'custom',
            assetId: 'a'.repeat(64),
          },
        },
      },
    });
    expect(result.status).toBe('warning');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'hdri-glb', severity: 'warning' }));
  });
});
