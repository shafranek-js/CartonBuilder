import {
  DataTexture,
  DataUtils,
  HalfFloatType,
} from 'three';

export const ENVIRONMENT_RUNTIME_RESOLUTIONS = Object.freeze([1024, 2048, 4096]);
export const ENVIRONMENT_RUNTIME_CACHE_LIMIT = 2;
export const ENVIRONMENT_RUNTIME_GPU_BUDGET_BYTES = 128 * 1024 * 1024;

function normalizeResolution(value) {
  const numeric = Number(value);
  return ENVIRONMENT_RUNTIME_RESOLUTIONS.includes(numeric) ? numeric : 2048;
}
function bytesPerChannel(type) {
  return type === HalfFloatType ? 2 : 4;
}

export function estimateEnvironmentRuntimeBytes(width, height, {
  channels = 4,
  type = HalfFloatType,
  pmremMultiplier = 1.5,
} = {}) {
  return Math.ceil(Math.max(0, width) * Math.max(0, height) * Math.max(1, channels)
    * bytesPerChannel(type) * pmremMultiplier);
}

/**
 * Selects a runtime size without ever upsampling the source. The original
 * asset remains untouched; this describes only the GPU texture that will be
 * prepared before PMREM.
 */
export function resolveEnvironmentRuntimeDimensions({
  sourceWidth,
  sourceHeight,
  requestedResolution = 2048,
  maxTextureSize = Infinity,
  channels = 4,
  type = HalfFloatType,
  gpuBudgetBytes = ENVIRONMENT_RUNTIME_GPU_BUDGET_BYTES,
} = {}) {
  const width = Math.max(0, Math.round(Number(sourceWidth) || 0));
  const height = Math.max(0, Math.round(Number(sourceHeight) || 0));
  const requested = normalizeResolution(requestedResolution);
  const sourceKnown = width > 0 && height > 0;
  const sourceCap = sourceKnown ? Math.min(requested, width) : requested;
  const maxSize = Number.isFinite(Number(maxTextureSize))
    ? Math.max(0, Number(maxTextureSize))
    : Infinity;
  const budget = Number.isFinite(Number(gpuBudgetBytes))
    ? Math.max(0, Number(gpuBudgetBytes))
    : ENVIRONMENT_RUNTIME_GPU_BUDGET_BYTES;
  const candidates = ENVIRONMENT_RUNTIME_RESOLUTIONS
    .filter((cap) => cap <= sourceCap)
    .sort((a, b) => b - a);
  if (!candidates.length && sourceKnown) candidates.push(sourceCap);

  let lastReason = null;
  for (const cap of candidates) {
    const targetWidth = sourceKnown ? Math.min(cap, width) : cap;
    const targetHeight = sourceKnown
      ? Math.max(1, Math.round(height * targetWidth / width))
      : Math.max(1, Math.round(targetWidth / 2));
    if (targetWidth > maxSize || targetHeight > maxSize) {
      lastReason = 'max-texture-size';
      continue;
    }
    const estimatedBytes = estimateEnvironmentRuntimeBytes(targetWidth, targetHeight, {
      channels,
      type,
    });
    if (estimatedBytes > budget) {
      lastReason = 'memory-budget';
      continue;
    }
    return {
      requestedResolution: requested,
      effectiveResolution: targetWidth,
      width: targetWidth,
      height: targetHeight,
      downsampled: sourceKnown && targetWidth < width,
      estimatedBytes,
      fallbackReason: targetWidth < sourceCap ? lastReason : null,
    };
  }

  return {
    requestedResolution: requested,
    effectiveResolution: null,
    width: 0,
    height: 0,
    downsampled: false,
    estimatedBytes: 0,
    fallbackReason: lastReason || 'no-viable-resolution',
  };
}

function channelsForTexture(texture) {
  const image = texture?.image || {};
  const pixelCount = Math.max(1, Number(image.width) || 1) * Math.max(1, Number(image.height) || 1);
  return Math.max(1, Math.round((image.data?.length || 0) / pixelCount) || 4);
}

function readChannel(data, index, type) {
  return type === HalfFloatType && data instanceof Uint16Array
    ? DataUtils.fromHalfFloat(data[index])
    : Number(data[index] || 0);
}

function writeChannel(data, index, value, type) {
  if (type === HalfFloatType && data instanceof Uint16Array) data[index] = DataUtils.toHalfFloat(value);
  else data[index] = value;
}

/**
 * Area-averages an equirectangular data texture in linear light. HDR/EXR
 * loader data is already linear; no sRGB conversion is intentionally used.
 */
export function downsampleEnvironmentTexture(texture, dimensions) {
  if (!texture?.image?.data || !dimensions?.downsampled) return texture;
  const sourceWidth = Number(texture.image.width) || 0;
  const sourceHeight = Number(texture.image.height) || 0;
  const targetWidth = Number(dimensions.width) || sourceWidth;
  const targetHeight = Number(dimensions.height) || sourceHeight;
  if (!sourceWidth || !sourceHeight || targetWidth >= sourceWidth) return texture;

  const source = texture.image.data;
  const channels = channelsForTexture(texture);
  const output = source instanceof Uint16Array
    ? new Uint16Array(targetWidth * targetHeight * channels)
    : new Float32Array(targetWidth * targetHeight * channels);
  const type = texture.type;
  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = Math.floor(y * sourceHeight / targetHeight);
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sourceHeight / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.floor(x * sourceWidth / targetWidth);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sourceWidth / targetWidth));
      const count = (x1 - x0) * (y1 - y0);
      for (let channel = 0; channel < channels; channel += 1) {
        let total = 0;
        for (let sy = y0; sy < y1; sy += 1) {
          for (let sx = x0; sx < x1; sx += 1) {
            total += readChannel(source, (sy * sourceWidth + sx) * channels + channel, type);
          }
        }
        writeChannel(output, (y * targetWidth + x) * channels + channel, total / count, type);
      }
    }
  }
  const result = new DataTexture(output, targetWidth, targetHeight, texture.format, texture.type);
  result.mapping = texture.mapping;
  result.colorSpace = texture.colorSpace;
  result.wrapS = texture.wrapS;
  result.wrapT = texture.wrapT;
  result.magFilter = texture.magFilter;
  result.minFilter = texture.minFilter;
  result.generateMipmaps = texture.generateMipmaps;
  result.flipY = texture.flipY;
  result.needsUpdate = true;
  return result;
}

export function prepareEnvironmentTexture(texture, options = {}) {
  const image = texture?.image || {};
  const channels = channelsForTexture(texture);
  const dimensions = resolveEnvironmentRuntimeDimensions({
    sourceWidth: image.width,
    sourceHeight: image.height,
    channels,
    type: texture?.type,
    ...options,
  });
  if (!dimensions.width) return { texture: null, dimensions, sourceTextureOwned: true };
  const runtimeTexture = downsampleEnvironmentTexture(texture, dimensions);
  return {
    texture: runtimeTexture,
    dimensions,
    sourceTextureOwned: runtimeTexture !== texture,
  };
}

function disposeEntry(entry) {
  if (!entry || entry.disposed) return;
  entry.disposed = true;
  entry.runtimeTexture?.dispose?.();
  entry.renderTarget?.dispose?.();
}

/** Small LRU that owns each runtime texture and PMREM target exactly once. */
export class EnvironmentRuntimeCache {
  constructor(limit = ENVIRONMENT_RUNTIME_CACHE_LIMIT, disposer = disposeEntry) {
    this.limit = Math.max(1, Number(limit) || ENVIRONMENT_RUNTIME_CACHE_LIMIT);
    this.disposer = disposer;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key, entry, activeKey = null) {
    const previous = this.entries.get(key);
    if (previous && previous !== entry) this.disposer(previous);
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === activeKey && this.entries.size > 1) {
        const active = this.entries.get(oldestKey);
        this.entries.delete(oldestKey);
        this.entries.set(oldestKey, active);
        continue;
      }
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.disposer(oldest);
    }
    return entry;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.disposer(entry);
    return true;
  }

  clear() {
    for (const entry of this.entries.values()) this.disposer(entry);
    this.entries.clear();
  }

  keys() {
    return [...this.entries.keys()];
  }

  get size() {
    return this.entries.size;
  }
}
