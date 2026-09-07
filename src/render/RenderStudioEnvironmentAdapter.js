import {
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  NoColorSpace,
  PMREMGenerator,
  RGBAFormat,
} from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

import {
  ENVIRONMENT_MAP_PRESETS,
  getEnvironmentMapPreset,
  loadBuiltInEnvironmentAsset,
  sanitizeEnvironmentMap,
  validateRenderEnvironment,
} from './environmentAssets.js';
import {
  EnvironmentRuntimeCache,
  prepareEnvironmentTexture,
} from './environmentRuntime.js';

const FALLBACK_PRESET = 'neutral-softbox';
export const PROCEDURAL_COLORS = Object.freeze({
  studio: [0.82, 0.86, 0.92],
  bright: [1.15, 1.1, 1.02],
  warm: [1.05, 0.72, 0.46],
  cool: [0.46, 0.72, 1.05],
  night: [0.08, 0.1, 0.16],
  none: [0.5, 0.5, 0.5],
});

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertSurface(renderSurface) {
  if (!isObjectLike(renderSurface)
    || !isObjectLike(renderSurface.scene)
    || !isObjectLike(renderSurface.renderer)) {
    throw new TypeError(
      'RenderStudioEnvironmentAdapter requires a renderSurface with scene and renderer.',
    );
  }
}

function assertFunction(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`RenderStudioEnvironmentAdapter requires ${name}().`);
  }
}

function disposeOnce(resources) {
  let firstError = null;
  const seen = new Set();
  for (const resource of resources) {
    if (!resource || seen.has(resource) || typeof resource.dispose !== 'function') continue;
    seen.add(resource);
    try {
      resource.dispose();
    } catch (error) {
      firstError ||= error;
    }
  }
  if (firstError) throw firstError;
}

function disposeEnvironmentEntry(entry) {
  if (!entry || entry.disposed) return false;
  entry.disposed = true;
  disposeOnce([
    entry.runtimeTexture,
    entry.sourceTexture,
    entry.renderTarget,
  ]);
  return true;
}

export function proceduralTexture(legacyPreset = 'studio') {
  const color = PROCEDURAL_COLORS[legacyPreset] || PROCEDURAL_COLORS.studio;
  // A small equirectangular texture is deliberately used for the safe
  // fallback. It is linear data and is never decoded through an image loader.
  const data = new Float32Array([
    color[0], color[1], color[2], 1,
    color[0] * 0.72, color[1] * 0.72, color[2] * 0.72, 1,
  ]);
  const texture = new DataTexture(data, 2, 1, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function markEnvironmentTexture(texture) {
  if (!texture) throw new Error('Environment texture loader returned no texture.');
  texture.mapping = EquirectangularReflectionMapping;
  // HDRLoader/EXRLoader may expose a linear transfer color space. Explicitly
  // use NoColorSpace at this boundary so a future loader cannot silently make
  // a light-space map sRGB.
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

async function defaultEnvironmentTextureLoader(asset) {
  const bytes = await asset.blob.arrayBuffer();
  const Loader = asset.mimeType === 'application/vnd.openexr'
    || asset.mimeType === 'image/x-exr'
    ? EXRLoader
    : HDRLoader;
  const loader = new Loader();
  const texture = typeof loader.createDataTexture === 'function'
    ? loader.createDataTexture(bytes)
    : loader.parse(bytes);
  return markEnvironmentTexture(texture);
}

function legacyPresetId(value) {
  const preset = ENVIRONMENT_MAP_PRESETS.find((entry) => entry.legacyPreset === value);
  return preset?.id || FALLBACK_PRESET;
}

function environmentKey(map, asset) {
  return [
    map.source,
    map.presetId,
    map.assetId || asset?.assetId || '',
    map.resolutionCap,
  ].join(':');
}

function errorReason(error) {
  return error?.code || error?.message || 'environment-load-failed';
}

/**
 * Production environment/HDRI adapter for the geometry-free Render Studio.
 * It owns decoded runtime textures and PMREM targets, never the persistence
 * Blob from which a custom or bundled asset was loaded.
 */
export class RenderStudioEnvironmentAdapter {
  constructor({
    renderSurface,
    surface = null,
    windowRef = globalThis.window || globalThis,
    environmentAsset = null,
    environmentMap = null,
    fetchFn = null,
    textureLoader = defaultEnvironmentTextureLoader,
    environmentTextureLoader = null,
    proceduralTextureFactory = proceduralTexture,
    pmremGeneratorFactory = (renderer) => new PMREMGenerator(renderer),
    cache = null,
    cacheLimit = 2,
    gpuBudgetBytes,
    maxTextureSize,
  } = {}) {
    const resolvedSurface = renderSurface || surface?.renderSurface;
    assertSurface(resolvedSurface);
    assertFunction('textureLoader', environmentTextureLoader || textureLoader);
    assertFunction('pmremGeneratorFactory', pmremGeneratorFactory);

    this.renderSurface = resolvedSurface;
    this.surface = surface;
    this.windowRef = windowRef;
    this.fetchFn = fetchFn
      || (typeof windowRef?.fetch === 'function' ? windowRef.fetch.bind(windowRef) : globalThis.fetch);
    this.textureLoader = environmentTextureLoader || textureLoader;
    if (typeof proceduralTextureFactory !== 'function') {
      throw new TypeError('RenderStudioEnvironmentAdapter requires proceduralTextureFactory().');
    }
    this.proceduralTextureFactory = proceduralTextureFactory;
    this.pmremGeneratorFactory = pmremGeneratorFactory;
    this._pmremGenerator = null;
    this.gpuBudgetBytes = gpuBudgetBytes;
    this.maxTextureSize = maxTextureSize;
    this.cache = cache || new EnvironmentRuntimeCache(cacheLimit, disposeEnvironmentEntry);
    this.disposed = false;
    this._generation = 0;
    this._environmentMap = sanitizeEnvironmentMap(environmentMap);
    this._environmentAsset = environmentAsset || null;
    this._currentTexture = null;
    this._currentRuntimeTexture = null;
    this._activeKey = null;
    this._diagnostics = {
      source: this._environmentMap.source,
      assetId: this._environmentAsset?.assetId || '',
      presetId: this._environmentMap.presetId,
      requestedResolution: this._environmentMap.resolutionCap,
      effectiveResolution: null,
      width: 0,
      height: 0,
      cacheHit: false,
      fallbackReason: null,
      cacheEntries: this.cache.size,
    };
  }

  get environmentAsset() {
    return this._environmentAsset;
  }

  get environmentMap() {
    return { ...this._environmentMap };
  }

  _runtimeDimensions(texture, map) {
    const renderer = this.renderSurface.renderer;
    return {
      requestedResolution: map.resolutionCap,
      maxTextureSize: this.maxTextureSize
        ?? renderer.capabilities?.maxTextureSize
        ?? Infinity,
      gpuBudgetBytes: this.gpuBudgetBytes,
    };
  }

  async _resolveAsset(map, assetOverride = undefined) {
    const preset = getEnvironmentMapPreset(map.presetId);
    if (map.source === 'none' || (map.source === 'builtin' && preset?.kind === 'procedural')) {
      return null;
    }

    const candidate = assetOverride === undefined ? this._environmentAsset : assetOverride;
    const candidateBlob = candidate instanceof Blob ? candidate : candidate?.blob;
    if (candidateBlob instanceof Blob) {
      const validated = await validateRenderEnvironment(candidateBlob);
      if (candidate !== candidateBlob && candidate.assetId && candidate.assetId !== validated.assetId) {
        throw new Error('Environment asset checksum does not match its metadata.');
      }
      return {
        ...(candidate === candidateBlob ? {} : candidate),
        ...validated,
        source: candidate.source || 'custom',
        presetId: candidate.presetId || map.presetId,
      };
    }

    if (map.source === 'builtin' && preset?.assetUrl) {
      return loadBuiltInEnvironmentAsset(map.presetId, this.fetchFn);
    }
    throw new Error('Environment map requires a validated HDR or EXR asset.');
  }

  async _loadSourceTexture(map, assetOverride = undefined) {
    const asset = await this._resolveAsset(map, assetOverride);
    if (!asset) return {
      texture: this.proceduralTextureFactory(
        getEnvironmentMapPreset(map.presetId)?.legacyPreset || 'studio',
      ),
      asset: null,
    };
    const texture = markEnvironmentTexture(await this.textureLoader(asset, {
      renderSurface: this.renderSurface,
      map,
    }));
    return { texture, asset };
  }

  async _buildEntry(map, assetOverride = undefined) {
    const { texture: sourceTexture, asset } = await this._loadSourceTexture(map, assetOverride);
    let preparedTexture = null;
    let target = null;
    try {
      const prepared = prepareEnvironmentTexture(
        sourceTexture,
        this._runtimeDimensions(sourceTexture, map),
      );
      preparedTexture = prepared.texture;
      if (!preparedTexture) throw new Error('Environment map has no viable runtime resolution.');

      const pmrem = this._pmremGenerator
        || this.pmremGeneratorFactory(this.renderSurface.renderer);
      if (!isObjectLike(pmrem) || typeof pmrem.fromEquirectangular !== 'function') {
        throw new TypeError('Environment PMREM factory must provide fromEquirectangular().');
      }
      this._pmremGenerator = pmrem;
      pmrem.compileEquirectangularShader?.();
      target = pmrem.fromEquirectangular(preparedTexture);
      if (!target?.texture) throw new Error('Environment PMREM did not return a texture.');

      const entry = {
        texture: target.texture,
        runtimeTexture: preparedTexture,
        sourceTexture: preparedTexture === sourceTexture ? null : sourceTexture,
        renderTarget: target,
        asset,
        dimensions: prepared.dimensions,
        disposed: false,
      };
      return entry;
    } catch (error) {
      try {
        disposeOnce([target, preparedTexture, sourceTexture]);
      } catch {
        // Preserve the original environment construction error.
      }
      throw error;
    }
  }

  _updateDiagnostics(map, entry, { cacheHit = false, fallbackReason = null } = {}) {
    const dimensions = entry?.dimensions || {};
    this._diagnostics = {
      source: map.source,
      assetId: map.assetId || entry?.asset?.assetId || this._environmentAsset?.assetId || '',
      presetId: map.presetId,
      requestedResolution: dimensions.requestedResolution || map.resolutionCap,
      effectiveResolution: dimensions.effectiveResolution ?? null,
      width: dimensions.width || 0,
      height: dimensions.height || 0,
      cacheHit,
      fallbackReason,
      cacheEntries: this.cache.size,
    };
  }

  _fallbackEntry(map, reason) {
    const key = `fallback:${map.presetId}:${map.resolutionCap}`;
    const cached = this.cache.get(key);
    if (cached) {
      this._currentTexture = cached.texture;
      this._currentRuntimeTexture = cached.runtimeTexture || cached.texture;
      this._activeKey = key;
      this._updateDiagnostics(map, cached, { cacheHit: true, fallbackReason: reason });
      return cached.texture;
    }

    const texture = this.proceduralTextureFactory('studio');
    const entry = {
      texture,
      runtimeTexture: texture,
      sourceTexture: null,
      renderTarget: null,
      asset: null,
      dimensions: {
        requestedResolution: map.resolutionCap,
        effectiveResolution: 2,
        width: 2,
        height: 1,
        fallbackReason: reason,
      },
      disposed: false,
    };
    this.cache.set(key, entry, key);
    this._currentTexture = texture;
    this._currentRuntimeTexture = texture;
    this._activeKey = key;
    this._updateDiagnostics(map, entry, { fallbackReason: reason });
    return texture;
  }

  get currentRuntimeTexture() {
    return this._currentRuntimeTexture || null;
  }

  _schedule(map, assetOverride = undefined) {
    const generation = ++this._generation;
    if (map.source === 'none' || map.presetId === 'no-reflections') {
      this._currentTexture = null;
      this._currentRuntimeTexture = null;
      this._activeKey = null;
      this._updateDiagnostics(map, null);
      return Promise.resolve(null);
    }
    const key = environmentKey(map, assetOverride || this._environmentAsset);
    const cached = this.cache.get(key);
    if (cached) {
      this._currentTexture = cached.texture;
      this._currentRuntimeTexture = cached.runtimeTexture || cached.texture;
      this._activeKey = key;
      this._updateDiagnostics(map, cached, { cacheHit: true });
      return Promise.resolve(cached.texture);
    }

    return Promise.resolve()
      .then(() => this._buildEntry(map, assetOverride))
      .then((entry) => {
        if (this.disposed || generation !== this._generation) {
          disposeEnvironmentEntry(entry);
          return this._currentTexture;
        }
        this.cache.set(key, entry, key);
        this._currentTexture = entry.texture;
        this._currentRuntimeTexture = entry.runtimeTexture;
        this._activeKey = key;
        this._updateDiagnostics(map, entry);
        return entry.texture;
      })
      .catch((error) => {
        if (this.disposed || generation !== this._generation) return this._currentTexture;
        return this._fallbackEntry(map, errorReason(error));
      });
  }

  setEnvironment(preset = 'studio') {
    if (this.disposed) return false;
    const presetId = legacyPresetId(preset);
    this._environmentMap = sanitizeEnvironmentMap({
      ...this._environmentMap,
      source: presetId === 'no-reflections' ? 'none' : 'builtin',
      presetId,
      assetId: '',
    });
    return this._schedule(this._environmentMap);
  }

  setEnvironmentMap(environmentMap) {
    if (this.disposed) return false;
    this._environmentMap = sanitizeEnvironmentMap(environmentMap);
    return this._schedule(this._environmentMap);
  }

  setEnvironmentAsset(asset) {
    if (this.disposed) return false;
    this._environmentAsset = asset || null;
    const map = this._environmentMap;
    return this._schedule(map, this._environmentAsset);
  }

  getDiagnostics() {
    return {
      ...this._diagnostics,
      cacheEntries: this.cache.size,
    };
  }

  handleContextLost() {
    if (this.disposed) return false;
    this._generation += 1;
    this._currentTexture = null;
    this._currentRuntimeTexture = null;
    this._activeKey = null;
    try { this._pmremGenerator?.dispose?.(); } catch { /* context loss is already terminal for these resources */ }
    this._pmremGenerator = null;
    this._clearCacheBestEffort();
    return true;
  }

  handleContextRestored() {
    if (this.disposed) return false;
    return this._schedule(this._environmentMap, this._environmentAsset);
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    this._generation += 1;
    this._currentTexture = null;
    this._currentRuntimeTexture = null;
    this._activeKey = null;
    let firstError = null;
    try {
      this._pmremGenerator?.dispose?.();
    } catch (error) {
      firstError ||= error;
    }
    this._pmremGenerator = null;
    try {
      this._clearCacheBestEffort((error) => { firstError ||= error; });
    } catch (error) {
      firstError ||= error;
    }
    if (firstError) throw firstError;
    return true;
  }

  _clearCacheBestEffort(onError = () => {}) {
    const entries = this.cache?.entries instanceof Map
      ? [...this.cache.entries.values()]
      : null;
    if (!entries) {
      try {
        this.cache.clear?.();
      } catch (error) {
        onError(error);
      }
      return;
    }
    for (const entry of entries) {
      try {
        disposeEnvironmentEntry(entry);
      } catch (error) {
        onError(error);
      }
    }
    this.cache.entries.clear();
  }
}

export { disposeEnvironmentEntry };
