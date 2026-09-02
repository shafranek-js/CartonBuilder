import { RenderSceneSource } from './RenderSceneSource.js';

const TECHNICAL_UNIT_SCALE = 0.001;
const BOUND_COORDINATE_KEYS = new Set([
  'minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ',
  'width', 'height', 'depth', 'x', 'y', 'z',
]);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function getSemanticSvgText(input) {
  if (typeof input === 'string') return input;
  if (!isObject(input)) return null;
  if (typeof input.markup === 'string') return input.markup;
  if (typeof input.text === 'string') return input.text;
  return null;
}

function normalizeBuildRequest(input, positionalArtworkAtlas, positionalMaps, positionalName) {
  if (typeof input === 'string') {
    return {
      semanticSvg: input,
      artworkAtlas: positionalArtworkAtlas,
      maps: positionalMaps || {},
      name: positionalName || 'technical-carton.svg',
    };
  }

  const request = isObject(input) ? input : {};
  const bundle = request.bundle || request.canonicalBundle || null;
  const semanticSvgSource = request.semanticSvg
    || bundle?.semanticSvg
    || request.svgText
    || request.svg
    || request;
  const semanticSvg = getSemanticSvgText(semanticSvgSource);
  return {
    semanticSvg,
    artworkAtlas: request.artworkAtlas ?? request.atlas ?? positionalArtworkAtlas,
    maps: request.maps ?? request.materialMaps ?? positionalMaps ?? {},
    name: request.name || semanticSvgSource?.fileName || positionalName || 'technical-carton.svg',
  };
}

function normalizeBounds(bounds) {
  if (!isObject(bounds)) {
    throw new TypeError('Technical bounds resolver must return a bounds object.');
  }
  if (bounds.units !== 'mm' && bounds.units !== 'm') {
    throw new Error('Technical bounds must declare units as "mm" or "m".');
  }
  const scale = bounds.units === 'mm' ? TECHNICAL_UNIT_SCALE : 1;
  const normalized = {};
  for (const [key, value] of Object.entries(bounds)) {
    if (key === 'units') continue;
    normalized[key] = BOUND_COORDINATE_KEYS.has(key) && typeof value === 'number'
      ? value * scale
      : value;
  }
  return normalized;
}

function isModel(value) {
  return isObject(value)
    && isObject(value.scale)
    && typeof value.scale.setScalar === 'function';
}

function createPortableWrapper(resource, dispose) {
  const wrapper = Object.create(Object.getPrototypeOf(resource) || Object.prototype);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(resource))) {
    if (key === 'dispose') continue;
    Object.defineProperty(wrapper, key, descriptor);
  }
  Object.defineProperty(wrapper, 'dispose', {
    value: dispose,
    configurable: true,
    enumerable: true,
    writable: true,
  });
  return wrapper;
}

/**
 * Technical source adapter for the shared Render surface.
 *
 * The runtime, Render surface, bounds resolver and portable-scene factory are
 * deliberately injected. This keeps Technical Render inactive until a later
 * wiring step chooses a versioned, validated runtime artifact.
 */
export class TechnicalRenderSceneSource extends RenderSceneSource {
  constructor({
    runtime = null,
    renderSurface = null,
    surface = null,
    portableSceneFactory = null,
    boundsResolver = null,
    boardAppearanceSetter = null,
    setBoardAppearance = null,
  } = {}) {
    super();
    if (!runtime || typeof runtime.loadSemanticSvgText !== 'function') {
      throw new TypeError('TechnicalRenderSceneSource requires a runtime with loadSemanticSvgText().');
    }
    if (typeof runtime.setFoldProgress !== 'function') {
      throw new TypeError('TechnicalRenderSceneSource runtime must implement setFoldProgress().');
    }
    if (typeof runtime.setArtworkAtlas !== 'function') {
      throw new TypeError('TechnicalRenderSceneSource runtime must implement setArtworkAtlas().');
    }
    if (typeof runtime.dispose !== 'function') {
      throw new TypeError('TechnicalRenderSceneSource runtime must implement dispose().');
    }

    const resolvedSurface = renderSurface || surface;
    if (!resolvedSurface?.scene
      || typeof resolvedSurface.scene.add !== 'function'
      || typeof resolvedSurface.scene.remove !== 'function') {
      throw new TypeError('TechnicalRenderSceneSource requires a render surface with a scene.');
    }
    if (typeof boundsResolver !== 'function') {
      throw new TypeError('TechnicalRenderSceneSource requires an injected boundsResolver().');
    }

    this.runtime = runtime;
    this._renderSurface = resolvedSurface;
    this.portableSceneFactory = portableSceneFactory;
    this.boundsResolver = boundsResolver;
    this.boardAppearanceSetter = boardAppearanceSetter || setBoardAppearance;
    this._runtimeResult = null;
    this._model = null;
    this._foldGraph = null;
    this._bounds = null;
    this._built = false;
    this._foldProgress = null;
    this._disposed = false;
    this._runtimeActive = false;
    this._runtimeDisposed = true;
    this._portableResources = new Set();
  }

  get renderSurface() {
    return this._renderSurface;
  }

  get scene() {
    return this._renderSurface.scene;
  }

  get camera() {
    return this._renderSurface.camera;
  }

  get renderer() {
    return this._renderSurface.renderer;
  }

  get model() {
    return this._model;
  }

  get foldGraph() {
    return this._foldGraph;
  }

  getRenderSurface() {
    return this._renderSurface;
  }

  _assertActive() {
    if (this._disposed) throw new Error('Technical render scene source has been disposed.');
  }

  _clearBuildState() {
    this._runtimeResult = null;
    this._model = null;
    this._foldGraph = null;
    this._bounds = null;
    this._built = false;
    this._foldProgress = null;
  }

  _disposePortableResources() {
    let firstError = null;
    for (const resource of [...this._portableResources]) {
      try {
        resource.dispose();
      } catch (error) {
        firstError ||= error;
      }
    }
    this._portableResources.clear();
    if (firstError) throw firstError;
  }

  _disposeRuntime() {
    if (!this._runtimeActive || this._runtimeDisposed) return;
    this._runtimeActive = false;
    this._runtimeDisposed = true;
    this.runtime.dispose();
  }

  _cleanupScene(candidateModel = null) {
    const errors = [];
    const model = candidateModel || this._model;
    if (model) {
      try {
        this._renderSurface.scene.remove(model);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this._disposePortableResources();
    } catch (error) {
      errors.push(error);
    }
    try {
      this._disposeRuntime();
    } catch (error) {
      errors.push(error);
    }
    this._clearBuildState();
    if (errors.length) throw errors[0];
  }

  _resolveBounds(runtimeResult, model, semanticSvg) {
    const resolved = this.boundsResolver({
      model,
      runtimeResult,
      semanticSvg,
      renderSurface: this._renderSurface,
    });
    return normalizeBounds(resolved);
  }

  /**
   * Build the derived Three.js model from canonical semantic SVG text.
   * The input bundle is read-only from this adapter's perspective; only the
   * runtime-owned model root receives the mm-to-metre presentation scale.
   */
  buildScene(input = {}, positionalArtworkAtlas, positionalMaps, positionalName) {
    this._assertActive();
    const request = normalizeBuildRequest(input, positionalArtworkAtlas, positionalMaps, positionalName);
    if (typeof request.semanticSvg !== 'string' || request.semanticSvg.length === 0) {
      throw new TypeError('TechnicalRenderSceneSource.buildScene() requires canonical semantic SVG text.');
    }

    // Rebuilds intentionally destroy the prior runtime first. A failed new
    // load must never leave stale model/fold/bounds state behind.
    this._cleanupScene();
    this._runtimeActive = true;
    this._runtimeDisposed = false;
    let candidateModel = null;

    try {
      const runtimeResult = this.runtime.loadSemanticSvgText(request.semanticSvg, request.name);
      candidateModel = runtimeResult?.model
        || (isModel(runtimeResult) ? runtimeResult : null)
        || this.runtime.getModel?.();
      if (!isModel(candidateModel)) {
        throw new Error('Technical runtime did not return a Three.js model root.');
      }

      candidateModel.scale.setScalar(TECHNICAL_UNIT_SCALE);
      candidateModel.updateMatrixWorld?.(true);
      this._renderSurface.scene.add(candidateModel);
      this.runtime.setFoldProgress(1);
      this.runtime.setArtworkAtlas(request.artworkAtlas, request.maps);
      const bounds = this._resolveBounds(runtimeResult, candidateModel, request.semanticSvg);
      const foldGraph = runtimeResult?.foldGraph
        || runtimeResult?.parsed?.foldGraph
        || runtimeResult?.parsed?.folds
        || this.runtime.getFoldGraph?.()
        || null;

      this._runtimeResult = runtimeResult;
      this._model = candidateModel;
      this._foldGraph = foldGraph;
      this._bounds = bounds;
      this._built = true;
      this._foldProgress = 1;
      return this._renderSurface;
    } catch (error) {
      try {
        this._cleanupScene(candidateModel);
      } catch {
        // Preserve the original build error while still attempting all cleanup.
      }
      throw error;
    }
  }

  /**
   * Replace only runtime artwork textures. The model and fold graph remain
   * untouched, so this operation cannot accidentally rebuild Technical scene
   * geometry.
   */
  replaceArtwork(artworkAtlas, maps = {}) {
    this._assertActive();
    if (!this._model) throw new Error('Technical render scene is not built.');
    return this.runtime.setArtworkAtlas(artworkAtlas, maps);
  }

  setBoardAppearance(boardAppearance) {
    this._assertActive();
    if (typeof this.boardAppearanceSetter !== 'function') {
      throw new Error('Technical board appearance is unavailable without an injected implementation.');
    }
    return this.boardAppearanceSetter(boardAppearance);
  }

  _trackPortableResource(resource) {
    const originalDispose = resource.dispose.bind(resource);
    let disposed = false;
    const entry = {
      dispose: () => {
        if (disposed) return false;
        disposed = true;
        this._portableResources.delete(entry);
        originalDispose();
        return true;
      },
    };
    this._portableResources.add(entry);
    return createPortableWrapper(resource, entry.dispose);
  }

  createPortableScene(options = {}) {
    this._assertActive();
    if (!this._model) throw new Error('Technical render scene is not built.');
    if (typeof this.portableSceneFactory !== 'function') {
      throw new Error('Technical portable scene factory is not configured.');
    }
    const portable = this.portableSceneFactory({
      model: this._model,
      foldGraph: this._foldGraph,
      renderSurface: this._renderSurface,
      runtimeResult: this._runtimeResult,
      options: structuredClone(options),
    });
    if (!isObject(portable) || !portable.scene || typeof portable.dispose !== 'function') {
      throw new Error('Technical portable scene factory must return { scene, dispose }.');
    }
    return this._trackPortableResource(portable);
  }

  getBounds() {
    return this._bounds ? structuredClone(this._bounds) : null;
  }

  getDiagnostics() {
    return {
      source: 'technical',
      built: this._built,
      disposed: this._disposed,
      foldProgress: this._foldProgress,
      sourceUnits: 'mm',
      renderUnits: 'm',
      unitScale: TECHNICAL_UNIT_SCALE,
    };
  }

  dispose() {
    if (this._disposed) return false;
    this._disposed = true;
    this._cleanupScene();
    return true;
  }
}
