import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';

import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from '../../src/render/RenderSettings.js';
import { sanitizeGlbExportOptions } from '../../src/render/glbOptions.js';
import {
  exportTurntable,
} from '../../src/render/TurntableExportService.js';
import {
  getTurntableDimensions,
  isTurntableWithinPixelBudget,
  sanitizeTurntableOptions,
} from '../../src/render/turntableOptions.js';

describe('3D export options', () => {
  it('sanitizes GLB compatibility, texture and camera options', () => {
    expect(sanitizeGlbExportOptions({
      textureSize: 2048,
      materialMode: 'basic-compatibility',
      includeCamera: false,
    })).toEqual({
      textureSize: 2048,
      materialMode: 'basic-compatibility',
      includeCamera: false,
    });
    expect(sanitizeGlbExportOptions({ textureSize: 999, materialMode: 'nope' })).toEqual({
      textureSize: 'auto',
      materialMode: 'full-pbr',
      includeCamera: true,
    });
  });

  it('normalizes turntable controls and uses the render aspect ratio', () => {
    expect(sanitizeTurntableOptions({ frames: 99, longEdge: 999, format: 'gif' })).toEqual({
      frames: 36,
      longEdge: 1024,
      format: 'png',
    });
    expect(getTurntableDimensions({ ...DEFAULT_RENDER_SETTINGS, aspect: 'landscape' }, 512))
      .toEqual({ width: 512, height: 384 });
    expect(isTurntableWithinPixelBudget({ frames: 36, width: 1024, height: 768 })).toBe(true);
    expect(isTurntableWithinPixelBudget({ frames: 72, width: 2048, height: 1536 })).toBe(false);
  });

  it('writes a numbered ZIP sequence and restores the original camera', async () => {
    const camera = {
      preset: 'custom',
      heading: 12,
      elevation: 4,
      cameraDistance: 300,
      target: [0, 0, 0],
      position: [1, 2, 3],
    };
    const headings = [];
    const renderer = {
      getCameraState: () => camera,
      setCameraState: (next) => headings.push(next.heading),
    };
    const settings = sanitizeRenderSettings({
      ...DEFAULT_RENDER_SETTINGS,
      aspect: 'landscape',
      output: { ...DEFAULT_RENDER_SETTINGS.output, sequence: { frames: 24, longEdge: 512, format: 'jpg' } },
    });
    const blob = await exportTurntable({
      renderer,
      settings,
      options: { frames: 24, longEdge: 512, format: 'jpg' },
      renderStillFn: async ({ width, height }) => new Blob([new Uint8Array([width % 255, height % 255, 7])], { type: 'image/jpeg' }),
    });
    expect(blob.type).toBe('application/zip');
    expect(headings).toHaveLength(25);
    expect(headings.at(-1)).toBe(camera.heading);

    const reader = new ZipReader(new BlobReader(blob));
    const entries = await reader.getEntries();
    await reader.close();
    expect(entries.map((entry) => entry.filename)).toEqual([
      'frame-001.jpg',
      'frame-002.jpg',
      'frame-003.jpg',
      'frame-004.jpg',
      'frame-005.jpg',
      'frame-006.jpg',
      'frame-007.jpg',
      'frame-008.jpg',
      'frame-009.jpg',
      'frame-010.jpg',
      'frame-011.jpg',
      'frame-012.jpg',
      'frame-013.jpg',
      'frame-014.jpg',
      'frame-015.jpg',
      'frame-016.jpg',
      'frame-017.jpg',
      'frame-018.jpg',
      'frame-019.jpg',
      'frame-020.jpg',
      'frame-021.jpg',
      'frame-022.jpg',
      'frame-023.jpg',
      'frame-024.jpg',
    ]);
  });

  it('aborts a sequence without leaving the camera rotated', async () => {
    const camera = {
      preset: 'custom', heading: 8, elevation: 2, cameraDistance: 300, target: [0, 0, 0], position: [1, 2, 3],
    };
    const restored = [];
    const controller = new AbortController();
    const renderer = {
      getCameraState: () => camera,
      setCameraState: (next) => restored.push(next.heading),
    };
    await expect(exportTurntable({
      renderer,
      settings: DEFAULT_RENDER_SETTINGS,
      options: { frames: 24, longEdge: 512, format: 'png' },
      signal: controller.signal,
      renderStillFn: async () => {
        controller.abort();
        return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(restored.at(-1)).toBe(camera.heading);
  });
});
