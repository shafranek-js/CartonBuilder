function isObjectLike(value) {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function createAbortError() {
  const error = new Error('Render workflow operation aborted.');
  error.name = 'AbortError';
  return error;
}

function isCurrentGeneration(lifecycle, generation, signal = null) {
  return !lifecycle.disposed
    && lifecycle.generation === generation
    && !signal?.aborted;
}

function assertFactory(factory, label) {
  if (typeof factory !== 'function') {
    throw new TypeError(`${label} must be a function.`);
  }
}

const TECHNICAL_FORBIDDEN_INPUTS = Object.freeze([
  'boxModel',
  'textureCanvas',
  'legacySource',
  'legacyRenderSceneSource',
  'boxScene',
  'preview3d',
  'preview3dFacade',
  'quickSource',
]);

function createFactoryOptions(route, options) {
  if (route.source !== 'technical') return options;
  const technicalOptions = { ...options };
  for (const key of TECHNICAL_FORBIDDEN_INPUTS) delete technicalOptions[key];
  if (technicalOptions.rendererOptions
    && typeof technicalOptions.rendererOptions === 'object'
    && !Array.isArray(technicalOptions.rendererOptions)) {
    technicalOptions.rendererOptions = { ...technicalOptions.rendererOptions };
    for (const key of TECHNICAL_FORBIDDEN_INPUTS) delete technicalOptions.rendererOptions[key];
    delete technicalOptions.rendererOptions.sceneModel;
    if (technicalOptions.rendererOptions.source !== 'technical-only') {
      delete technicalOptions.rendererOptions.source;
    }
    delete technicalOptions.rendererOptions.sceneSourceFactory;
    delete technicalOptions.rendererOptions.sceneController;
  }
  return technicalOptions;
}

/**
 * Return whether the selected workflow has an explicitly enabled Render
 * implementation. Quick is the existing, always-available route. Technical
 * stays fail-closed until its capability is enabled by the validated source.
 */
export function canUseRenderWorkflow({
  workflowMode,
  capabilities = null,
  applicationCapabilities = null,
} = {}) {
  if (workflowMode === 'quick') return true;
  if (workflowMode !== 'technical') return false;
  return capabilities !== null
    && typeof capabilities === 'object'
    && !Array.isArray(capabilities)
    && capabilities.technicalRender === true
    && applicationCapabilities !== null
    && typeof applicationCapabilities === 'object'
    && !Array.isArray(applicationCapabilities)
    && applicationCapabilities.technicalRender === true;
}

export function canRestoreRenderStep({
  workflowMode,
  capabilities = null,
  applicationCapabilities = null,
  workflowStep,
  hasArtwork = false,
  documentComplete = false,
} = {}) {
  return workflowStep === 'render'
    && Boolean(hasArtwork)
    && Boolean(documentComplete)
    && canUseRenderWorkflow({ workflowMode, capabilities, applicationCapabilities });
}

export class RenderWorkflowRouter {
  constructor({ quickFactory = null, technicalFactory = null, applicationCapabilities = null } = {}) {
    if (quickFactory !== null) assertFactory(quickFactory, 'quickFactory');
    if (technicalFactory !== null) assertFactory(technicalFactory, 'technicalFactory');
    this.quickFactory = quickFactory;
    this.technicalFactory = technicalFactory;
    this.applicationCapabilities = applicationCapabilities;
  }

  resolve({
    workflowMode,
    capabilities = null,
    applicationCapabilities = this.applicationCapabilities,
  } = {}) {
    const enabled = canUseRenderWorkflow({ workflowMode, capabilities, applicationCapabilities });
    if (workflowMode === 'quick') {
      return { workflowMode, source: 'quick', enabled, factory: this.quickFactory };
    }
    if (workflowMode === 'technical') {
      return { workflowMode, source: 'technical', enabled, factory: this.technicalFactory };
    }
    return { workflowMode: null, source: null, enabled: false, factory: null };
  }

  invoke(route, options) {
    if (!route?.enabled) return false;
    if (!route.factory) throw new TypeError(`Render ${route.source} factory is not configured.`);
    return route.factory(createFactoryOptions(route, options));
  }

  create(options = {}) {
    const route = this.resolve(options);
    if (!route.enabled) return false;
    return this.invoke(route, options);
  }
}

/**
 * Owns the renderer generation boundary shared by workflow routing and
 * asynchronous Render work. A renderer only becomes current after it has
 * been acquired; late acquisitions are disposed as stale resources.
 */
export class RenderWorkflowLifecycle {
  constructor({ router } = {}) {
    if (!isObjectLike(router) || typeof router.resolve !== 'function') {
      throw new TypeError('RenderWorkflowLifecycle requires a render workflow router.');
    }
    this.router = router;
    this.disposed = false;
    this.generation = 0;
    this.renderer = null;
    this.route = null;
    this.operation = null;
    this.disposedRenderers = new WeakSet();
    this.resourceCounters = {
      rendererAcquisitions: 0,
      rendererDisposals: 0,
      operationsStarted: 0,
      operationsAborted: 0,
    };
  }

  disposeRenderer(renderer) {
    if (!isObjectLike(renderer) || this.disposedRenderers.has(renderer)) return;
    this.disposedRenderers.add(renderer);
    this.resourceCounters.rendererDisposals += 1;
    if (typeof renderer.dispose !== 'function') {
      throw new TypeError('Render workflow renderer must implement dispose().');
    }
    const result = renderer.dispose();
    return result && typeof result.then === 'function' ? Promise.resolve(result) : undefined;
  }

  abort() {
    const operation = this.operation;
    if (!operation || operation.controller.signal.aborted) return false;
    this.resourceCounters.operationsAborted += 1;
    operation.controller.abort();
    return true;
  }

  async activate(options = {}) {
    if (this.disposed) return false;
    const signal = options.signal || null;
    const generation = ++this.generation;
    this.abort();
    const previousRoute = this.route;
    const route = this.router.resolve(options);
    this.route = route;

    if (!route.enabled) {
      const previous = this.renderer;
      this.renderer = null;
      if (previous) await this.disposeRenderer(previous);
      return false;
    }

    // A renderer from another workflow must never remain callable while the
    // new route is being acquired. Dispose it before invoking the next source
    // factory so a failed Technical activation cannot fall back to Quick.
    if (this.renderer && previousRoute?.source !== route.source) {
      const previous = this.renderer;
      this.renderer = null;
      await this.disposeRenderer(previous);
    }

    let candidate;
    try {
      candidate = await this.router.invoke(route, options);
    } catch (error) {
      if (!isCurrentGeneration(this, generation, signal)) return false;
      throw error;
    }

    if (!isCurrentGeneration(this, generation, signal)) {
      await this.disposeRenderer(candidate);
      return false;
    }
    if (!isObjectLike(candidate)) {
      throw new TypeError(`Render ${route.source} factory must return a renderer.`);
    }
    if (typeof candidate.dispose !== 'function') {
      throw new TypeError(`Render ${route.source} renderer must implement dispose().`);
    }

    const previous = this.renderer;
    this.renderer = candidate;
    this.resourceCounters.rendererAcquisitions += 1;
    if (previous && previous !== candidate) await this.disposeRenderer(previous);
    return candidate;
  }

  run(operation) {
    assertFactory(operation, 'Render workflow operation');
    if (this.disposed) return Promise.reject(createAbortError());

    this.abort();
    const controller = new AbortController();
    const generation = this.generation;
    const record = { controller, generation };
    this.operation = record;
    this.resourceCounters.operationsStarted += 1;

    let result;
    try {
      result = operation({
        signal: controller.signal,
        generation,
        renderer: this.renderer,
      });
    } catch (error) {
      result = Promise.reject(error);
    }

    return Promise.resolve(result)
      .then((value) => {
        if (!isCurrentGeneration(this, generation, controller.signal)) throw createAbortError();
        return value;
      }, (error) => {
        if (!isCurrentGeneration(this, generation, controller.signal)) throw createAbortError();
        throw error;
      })
      .then((value) => {
        if (this.operation === record) this.operation = null;
        return value;
      }, (error) => {
        if (this.operation === record) this.operation = null;
        throw error;
      });
  }

  replaceArtwork(...args) {
    if (this.disposed || !this.renderer) return false;
    this.abort();
    const generation = ++this.generation;
    const renderer = this.renderer;
    let result;
    try {
      result = renderer.replaceArtwork(...args);
    } catch (error) {
      throw error;
    }
    if (!result || typeof result.then !== 'function') return result === undefined ? true : result;
    return Promise.resolve(result).then((value) => (
      isCurrentGeneration(this, generation) ? value : false
    ), (error) => {
      if (!isCurrentGeneration(this, generation)) return false;
      throw error;
    });
  }

  getRenderer() {
    return this.renderer;
  }

  release() {
    if (this.disposed) return false;
    this.generation += 1;
    this.abort();
    this.operation = null;
    this.route = null;
    const renderer = this.renderer;
    this.renderer = null;
    if (!renderer) return true;
    return this.disposeRenderer(renderer) || true;
  }

  getDiagnostics() {
    return {
      source: this.route?.source || null,
      workflowMode: this.route?.workflowMode || null,
      generation: this.generation,
      rendererActive: Boolean(this.renderer),
      operationActive: Boolean(this.operation),
      disposed: this.disposed,
      resourceCounters: { ...this.resourceCounters },
    };
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    this.generation += 1;
    this.abort();
    this.operation = null;
    const renderer = this.renderer;
    this.renderer = null;
    if (renderer) {
      // Renderer disposal is intentionally synchronous at this boundary, as
      // the existing WebGLCartonRenderer contract is synchronous. Promise
      // returns are consumed to prevent an unhandled cleanup rejection.
      try {
        const result = this.disposeRenderer(renderer);
        if (result?.catch) result.catch(() => {});
      } catch (error) {
        throw error;
      }
    }
    return true;
  }
}
