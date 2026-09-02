import { exportGlb } from './GlbExportService.js';
import { renderStill } from './StillRenderService.js';
import { exportTurntable } from './TurntableExportService.js';
import { canUseRenderWorkflow } from './RenderWorkflowRouter.js';
import { createTechnicalRenderExportOrchestrator } from './TechnicalRenderExportOrchestrator.js';

const QUICK_ONLY_INPUTS = Object.freeze([
  'boxModel',
  'sceneModel',
  'textureCanvas',
  'legacySource',
  'legacyRenderSceneSource',
  'boxScene',
  'preview3d',
  'preview3dFacade',
]);

function assertFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function createAbortError() {
  const error = new Error('Render workflow export aborted.');
  error.name = 'AbortError';
  return error;
}

function assertNoQuickInputs(options) {
  for (const key of QUICK_ONLY_INPUTS) {
    if (Object.hasOwn(options, key)) {
      throw new TypeError(`Technical export does not accept Quick-only input ${key}.`);
    }
  }
}

/**
 * Routes the common Render output commands while keeping the Technical
 * orchestrator lazy and isolated from Quick geometry inputs.
 */
export class RenderWorkflowExportRouter {
  constructor({
    getWorkflowOptions = () => ({ workflowMode: 'quick' }),
    getRenderer = () => null,
    technicalOrchestratorFactory = (options) => createTechnicalRenderExportOrchestrator(options),
    quickServices = {},
  } = {}) {
    assertFunction(getWorkflowOptions, 'Render workflow export getWorkflowOptions');
    assertFunction(getRenderer, 'Render workflow export getRenderer');
    assertFunction(technicalOrchestratorFactory, 'Render workflow export technicalOrchestratorFactory');
    assertObject(quickServices, 'Render workflow export quickServices');
    this.getWorkflowOptions = getWorkflowOptions;
    this.getRenderer = getRenderer;
    this.technicalOrchestratorFactory = technicalOrchestratorFactory;
    this.quickServices = {
      renderStill: quickServices.renderStill || renderStill,
      exportTurntable: quickServices.exportTurntable || exportTurntable,
      exportGlb: quickServices.exportGlb || exportGlb,
    };
    for (const [kind, service] of Object.entries(this.quickServices)) {
      assertFunction(service, `Render workflow Quick ${kind}`);
    }
    this.technicalOrchestrator = null;
    this.technicalRenderer = null;
    this.activeOperation = null;
    this.disposed = false;
    this.counters = {
      quickExports: 0,
      technicalExports: 0,
      orchestratorCreations: 0,
      orchestratorDisposals: 0,
    };
  }

  resolve() {
    const options = this.getWorkflowOptions() || {};
    const enabled = canUseRenderWorkflow(options);
    if (options.workflowMode === 'technical') return { ...options, source: 'technical', enabled };
    if (options.workflowMode === 'quick') return { ...options, source: 'quick', enabled: true };
    return { ...options, source: null, enabled: false };
  }

  _getTechnicalOrchestrator(renderer, settings) {
    if (this.technicalOrchestrator && this.technicalRenderer === renderer) return this.technicalOrchestrator;
    if (this.technicalOrchestrator) {
      this.technicalOrchestrator.dispose();
      this.counters.orchestratorDisposals += 1;
      this.technicalOrchestrator = null;
      this.technicalRenderer = null;
    }
    this.technicalOrchestrator = this.technicalOrchestratorFactory({ renderer, settings });
    if (!this.technicalOrchestrator || typeof this.technicalOrchestrator.dispose !== 'function') {
      throw new TypeError('Technical export orchestrator factory must return an orchestrator.');
    }
    for (const method of ['renderStill', 'exportTurntable', 'exportGlb', 'abort']) {
      if (typeof this.technicalOrchestrator[method] !== 'function') {
        throw new TypeError(`Technical export orchestrator must implement ${method}().`);
      }
    }
    this.technicalRenderer = renderer;
    this.counters.orchestratorCreations += 1;
    return this.technicalOrchestrator;
  }

  _run(kind, options = {}) {
    assertObject(options, `Render workflow ${kind} options`);
    if (this.disposed) throw new Error('Render workflow export router is disposed.');
    const route = this.resolve();
    if (!route.enabled) return Promise.resolve(false);
    if (route.source === 'quick') {
      this.counters.quickExports += 1;
      return this.quickServices[kind](options);
    }
    assertNoQuickInputs(options);
    const renderer = options.renderer || this.getRenderer();
    if (!renderer) throw new Error('Technical export requires an active Technical renderer.');
    if (this.activeOperation) this.abort();
    const orchestrator = this._getTechnicalOrchestrator(renderer, options.settings);
    this.counters.technicalExports += 1;
    const result = orchestrator[kind](options);
    if (!result || typeof result.then !== 'function') return result;
    const operation = {};
    this.activeOperation = operation;
    return Promise.resolve(result).then((value) => {
      if (this.activeOperation !== operation || this.disposed) throw createAbortError();
      return value;
    }, (error) => {
      if (this.activeOperation !== operation || this.disposed) throw createAbortError();
      throw error;
    }).then((value) => {
      if (this.activeOperation === operation) this.activeOperation = null;
      return value;
    }, (error) => {
      if (this.activeOperation === operation) this.activeOperation = null;
      throw error;
    });
  }

  renderStill(options) {
    return this._run('renderStill', options);
  }

  exportTurntable(options) {
    return this._run('exportTurntable', options);
  }

  exportGlb(options) {
    return this._run('exportGlb', options);
  }

  abort() {
    const active = Boolean(this.activeOperation);
    this.activeOperation = null;
    return (this.technicalOrchestrator?.abort?.() || false) || active;
  }

  releaseRenderer(renderer = this.technicalRenderer) {
    if (!this.technicalOrchestrator || renderer !== this.technicalRenderer) return false;
    const orchestrator = this.technicalOrchestrator;
    this.technicalOrchestrator = null;
    this.technicalRenderer = null;
    this.activeOperation = null;
    orchestrator.abort();
    orchestrator.dispose();
    this.counters.orchestratorDisposals += 1;
    return true;
  }

  getDiagnostics() {
    return {
      source: this.resolve().source,
      technicalOrchestratorActive: Boolean(this.technicalOrchestrator),
      disposed: this.disposed,
      counters: { ...this.counters },
    };
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    if (!this.releaseRenderer()) this.abort();
    this.activeOperation = null;
    return true;
  }
}
