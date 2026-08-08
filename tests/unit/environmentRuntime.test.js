import { describe, expect, it, vi } from 'vitest';
import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  FloatType,
  HalfFloatType,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
} from 'three';

import {
  EnvironmentRuntimeCache,
  downsampleEnvironmentTexture,
  prepareEnvironmentTexture,
  resolveEnvironmentRuntimeDimensions,
} from '../../src/render/environmentRuntime.js';

describe('HDRI runtime preparation', () => {
  it('selects 1K, 2K and 4K caps without upsampling smaller maps', () => {
    expect(resolveEnvironmentRuntimeDimensions({ sourceWidth: 4096, sourceHeight: 2048, requestedResolution: 1024 })).toMatchObject({
      effectiveResolution: 1024,
      width: 1024,
      height: 512,
      downsampled: true,
    });
    expect(resolveEnvironmentRuntimeDimensions({ sourceWidth: 4096, sourceHeight: 2048, requestedResolution: 2048 })).toMatchObject({
      effectiveResolution: 2048,
      width: 2048,
      height: 1024,
    });
    expect(resolveEnvironmentRuntimeDimensions({ sourceWidth: 4096, sourceHeight: 2048, requestedResolution: 4096 })).toMatchObject({
      effectiveResolution: 4096,
      width: 4096,
      height: 2048,
    });
    expect(resolveEnvironmentRuntimeDimensions({ sourceWidth: 512, sourceHeight: 256, requestedResolution: 4096 })).toMatchObject({
      effectiveResolution: 512,
      width: 512,
      height: 256,
      downsampled: false,
    });
  });

  it('falls back down the device ladder for texture size and memory budgets', () => {
    expect(resolveEnvironmentRuntimeDimensions({
      sourceWidth: 4096,
      sourceHeight: 2048,
      requestedResolution: 4096,
      maxTextureSize: 1500,
    })).toMatchObject({ effectiveResolution: 1024, fallbackReason: 'max-texture-size' });
    expect(resolveEnvironmentRuntimeDimensions({
      sourceWidth: 4096,
      sourceHeight: 2048,
      requestedResolution: 4096,
      gpuBudgetBytes: 1024,
    })).toMatchObject({ effectiveResolution: null, fallbackReason: 'memory-budget' });
  });

  it('averages float and half-float channels in linear light', () => {
    const floatTexture = new DataTexture(new Float32Array([1, 3, 5, 7]), 2, 2, RedFormat, FloatType);
    const floatResult = downsampleEnvironmentTexture(floatTexture, { downsampled: true, width: 1, height: 1 });
    expect(floatResult.image.data[0]).toBe(4);

    const halfTexture = new DataTexture(
      new Uint16Array([DataUtils.toHalfFloat(1), DataUtils.toHalfFloat(3), DataUtils.toHalfFloat(5), DataUtils.toHalfFloat(7)]),
      2,
      2,
      RedFormat,
      HalfFloatType,
    );
    const halfResult = downsampleEnvironmentTexture(halfTexture, { downsampled: true, width: 1, height: 1 });
    expect(DataUtils.fromHalfFloat(halfResult.image.data[0])).toBeCloseTo(4, 2);
  });

  it('prepares metadata and keeps no-op textures untouched', () => {
    const texture = new DataTexture(new Float32Array([1, 2]), 2, 1, RedFormat, FloatType);
    const result = prepareEnvironmentTexture(texture, { requestedResolution: 1024 });
    expect(result.texture).toBe(texture);
    expect(result.sourceTextureOwned).toBe(false);
    expect(result.dimensions.effectiveResolution).toBe(2);
  });

  it('preserves HDR/EXR loader metadata on the runtime texture', () => {
    const texture = new DataTexture(
      new Uint16Array(4 * 2 * 4),
      4,
      2,
      RGBAFormat,
      HalfFloatType,
    );
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = NoColorSpace;
    const result = prepareEnvironmentTexture(texture, { requestedResolution: 1024 });
    expect(result.texture).toMatchObject({
      type: HalfFloatType,
      format: RGBAFormat,
      mapping: EquirectangularReflectionMapping,
      colorSpace: NoColorSpace,
    });
    expect(result.dimensions).toMatchObject({ effectiveResolution: 4, width: 4, height: 2 });
  });

  it('bounds runtime entries and disposes evicted resources once', () => {
    const dispose = vi.fn((entry) => {
      if (entry.disposed) return;
      entry.disposed = true;
      entry.texture.dispose();
      entry.target.dispose();
    });
    const cache = new EnvironmentRuntimeCache(2, dispose);
    const entry = (id) => ({ id, texture: { dispose: vi.fn() }, target: { dispose: vi.fn() }, disposed: false });
    const a = entry('a');
    const b = entry('b');
    const c = entry('c');
    cache.set('a', a);
    cache.set('b', b);
    expect(cache.get('a')).toBe(a);
    cache.set('c', c, 'c');
    expect(cache.size).toBe(2);
    expect(a.texture.dispose).not.toHaveBeenCalled();
    expect(b.texture.dispose).toHaveBeenCalledTimes(1);
    cache.clear();
    cache.clear();
    expect(a.texture.dispose).toHaveBeenCalledTimes(1);
    expect(c.texture.dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(3);
  });
});
