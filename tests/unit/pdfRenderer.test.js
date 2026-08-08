import { describe, expect, it } from 'vitest';

import { classifyArtwork, ArtworkKind } from '../../src/pdf-renderer/aiCompatibility.js';
import { createDocumentRegistry } from '../../src/pdf-renderer/documentRegistry.js';
import { pixmapToRgba } from '../../src/pdf-renderer/pixelConverter.js';
import {
  deserializeRendererError,
  serializeRendererError,
  RendererRequestType,
} from '../../src/pdf-renderer/protocol.js';
import { createRenderCache, renderCacheKey } from '../../src/pdf-renderer/renderCache.js';
import { createRenderDeduper } from '../../src/pdf-renderer/renderScheduler.js';

describe('aiCompatibility.classifyArtwork', () => {
  it('classifies PDF and PDF-compatible AI', () => {
    expect(classifyArtwork({ recognized: true, isPDF: true, extension: 'pdf' })).toEqual({
      kind: ArtworkKind.PDF,
      errorCode: null,
    });
    expect(classifyArtwork({ recognized: true, isPDF: true, extension: 'ai' })).toEqual({
      kind: ArtworkKind.PDF_AI,
      errorCode: null,
    });
  });

  it('rejects unrecognized files with the right code', () => {
    expect(classifyArtwork({ recognized: false, isPDF: false, extension: 'ai' })).toEqual({
      kind: ArtworkKind.REJECTED,
      errorCode: 'aiNotPdfCompatible',
    });
    expect(classifyArtwork({ recognized: false, isPDF: false, extension: 'pdf' })).toEqual({
      kind: ArtworkKind.REJECTED,
      errorCode: 'pdfDamaged',
    });
  });
});

describe('documentRegistry', () => {
  it('opens, reuses and destroys documents', () => {
    const destroyed = [];
    const registry = createDocumentRegistry();
    const makeDoc = (name) => ({
      destroy: () => destroyed.push(name),
    });

    const first = makeDoc('a');
    registry.open('1', first);
    expect(registry.get('1')).toBe(first);
    registry.open('1', makeDoc('b'));
    expect(destroyed).toEqual(['a']);

    expect(registry.close('1')).toBe(true);
    expect(destroyed).toEqual(['a', 'b']);
    expect(registry.close('1')).toBe(false);
    expect(registry.get('1')).toBeNull();
  });

  it('closes every document on closeAll', () => {
    const destroyed = [];
    const registry = createDocumentRegistry();
    registry.open('1', { destroy: () => destroyed.push('1') });
    registry.open('2', { destroy: () => destroyed.push('2') });
    registry.closeAll();
    expect(destroyed.sort()).toEqual(['1', '2']);
    expect(registry.size).toBe(0);
  });
});

describe('pixelConverter.pixmapToRgba', () => {
  it('expands a 3-component pixmap to RGBA', () => {
    const width = 2;
    const height = 2;
    const pixels = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    const pixmap = {
      getPixels: () => pixels,
      getNumberOfComponents: () => 3,
      getWidth: () => width,
      getStride: () => 6,
      getHeight: () => height,
    };
    const rgba = pixmapToRgba(pixmap);
    expect(rgba).toEqual(new Uint8ClampedArray([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
    ]));
  });

  it('keeps the alpha channel of a 4-component pixmap', () => {
    const pixmap = {
      getPixels: () => new Uint8Array([1, 2, 3, 4]),
      getNumberOfComponents: () => 4,
      getWidth: () => 1,
      getStride: () => 4,
      getHeight: () => 1,
    };
    expect(Array.from(pixmapToRgba(pixmap))).toEqual([1, 2, 3, 4]);
  });
});

describe('renderCache', () => {
  it('evicts least-recently-used entries beyond the byte budget', () => {
    const cache = createRenderCache({ maxBytes: 100, maxEntries: 10 });
    cache.set('a', { value: 1 }, 60);
    cache.set('b', { value: 2 }, 60);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b').value).toBe(2);
  });

  it('bumps entries on access and evicts the oldest', () => {
    const cache = createRenderCache({ maxBytes: 1000, maxEntries: 2 });
    cache.set('a', { value: 1 }, 1);
    cache.set('b', { value: 2 }, 1);
    cache.get('a');
    cache.set('c', { value: 3 }, 1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a').value).toBe(1);
    expect(cache.get('c').value).toBe(3);
  });
});

describe('renderCacheKey', () => {
  it('distinguishes rendering parameters', () => {
    const base = { docId: 'd', pageIndex: 0, scale: 1, box: 'CropBox', usage: 'Print' };
    expect(renderCacheKey(base)).toBe(renderCacheKey(base));
    expect(renderCacheKey({ ...base, box: 'TrimBox' })).not.toBe(renderCacheKey(base));
    expect(renderCacheKey({ ...base, scale: 2 })).not.toBe(renderCacheKey(base));
    expect(renderCacheKey({ ...base, visibility: { '0': false } }))
      .not.toBe(renderCacheKey({ ...base, visibility: { '0': true } }));
    expect(renderCacheKey({ ...base, processMask: 1 }))
      .not.toBe(renderCacheKey({ ...base, processMask: 15 }));
    expect(renderCacheKey({ ...base, separationBehaviors: [1] }))
      .not.toBe(renderCacheKey({ ...base, separationBehaviors: [2] }));
  });
});

describe('renderDeduper', () => {
  it('coalesces concurrent runs for the same key', async () => {
    const deduper = createRenderDeduper();
    let calls = 0;
    const fn = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return calls;
    };
    const [a, b] = await Promise.all([
      deduper.run('k', fn),
      deduper.run('k', fn),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(calls).toBe(1);
    const c = await deduper.run('k', fn);
    expect(c).toBe(2);
  });
});

describe('protocol', () => {
  it('serializes and deserializes renderer errors', () => {
    const error = { code: 'pdfDamaged', parameters: { page: 3 } };
    const serialized = serializeRendererError(error);
    expect(serialized).toEqual(error);
    expect(deserializeRendererError(serialized)).toEqual(error);
    expect(serializeRendererError(new Error('boom'))).toEqual({
      code: 'pdfRenderFailed',
      parameters: {},
    });
  });

  it('exposes the request types used by the worker', () => {
    expect(RendererRequestType.render).toBe('render');
    expect(RendererRequestType.open).toBe('open');
    expect(RendererRequestType.recognize).toBe('recognize');
  });
});
