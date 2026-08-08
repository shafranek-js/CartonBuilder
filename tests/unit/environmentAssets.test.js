import { describe, expect, it, vi } from 'vitest';

import {
  detectRenderEnvironmentType,
  ENVIRONMENT_MAP_PRESETS,
  loadBuiltInEnvironmentAsset,
  MAX_RENDER_ENVIRONMENT_BYTES,
  sanitizeEnvironmentMap,
  validateRenderEnvironment,
} from '../../src/render/environmentAssets.js';

describe('HDR/EXR environment assets', () => {
  it('allows 4K-class EXR files up to the 128 MiB safety limit', () => {
    expect(MAX_RENDER_ENVIRONMENT_BYTES).toBe(128 * 1024 * 1024);
    expect(ENVIRONMENT_MAP_PRESETS.filter((entry) => entry.kind === 'packaged')).toHaveLength(5);
  });

  it('loads a packaged Poly Haven HDR through the same validation path as uploads', async () => {
    const fetchFn = vi.fn(async (url) => ({
      ok: true,
      blob: async () => {
        const blob = new Blob([
          '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 4\n',
          new Uint8Array(64),
        ], { type: 'image/vnd.radiance' });
        return blob;
      },
      url,
    }));
    const asset = await loadBuiltInEnvironmentAsset('polyhaven-abandoned-hall-01', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(
      '/render-environments/polyhaven/abandoned_hall_01_4k.hdr',
      { cache: 'force-cache' },
    );
    expect(asset).toMatchObject({
      kind: 'environment',
      source: 'builtin',
      presetId: 'polyhaven-abandoned-hall-01',
      width: 4,
      height: 2,
    });
  });

  it('detects Radiance HDR signatures and preserves equirectangular dimensions', async () => {
    const header = '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 4\n';
    const file = new Blob([header, new Uint8Array(64)], { type: 'image/vnd.radiance' });
    Object.defineProperty(file, 'name', { value: 'studio.hdr' });
    expect(detectRenderEnvironmentType(new Uint8Array(await file.slice(0, 16).arrayBuffer())))
      .toBe('image/vnd.radiance');
    const asset = await validateRenderEnvironment(file);
    expect(asset.kind).toBe('environment');
    expect(asset.width).toBe(4);
    expect(asset.height).toBe(2);
    expect(asset.fileName).toBe('studio.hdr');
    expect(asset.assetId).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects unsupported content even when a file is named .hdr', async () => {
    const file = new Blob(['not an hdr'], { type: 'image/vnd.radiance' });
    Object.defineProperty(file, 'name', { value: 'broken.hdr' });
    await expect(validateRenderEnvironment(file)).rejects.toMatchObject({ code: 'renderEnvironmentUnsupported' });
  });

  it('sanitizes custom map state without losing the safe fallback', () => {
    expect(sanitizeEnvironmentMap({ source: 'custom', assetId: 'a'.repeat(200), rotation: 999 }))
      .toMatchObject({ source: 'custom', assetId: 'a'.repeat(128), rotation: 360, presetId: 'neutral-softbox' });
  });
});
