import { exportGlb } from './GlbExportService.js';
import { renderStill } from './StillRenderService.js';
import { exportTurntable } from './TurntableExportService.js';

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function createAbortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('Technical Render export aborted.', 'AbortError');
  }
  const error = new Error('Technical Render export aborted.');
  error.name = 'AbortError';
  return error;
}

function assertService(name, service) {
  if (typeof service !== 'function') {
    throw new TypeError(`Technical Render export requires ${name}().`);
  }
}

function assertAbortController(controller) {
  if (!isObjectLike(controller)
    || !isObjectLike(controller.signal)
    || typeof controller.signal.aborted !== 'boolean'
    || typeof controller.signal.addEventListener !== 'function'
    || typeof controller.abort !== 'function') {
    throw new TypeError('Technical Render export abortControllerFactory must return an AbortController.');
  }
}

/**
 * Headless output boundary for the Technical renderer.
 *
 * The service implementations remain the single raster/ZIP/GLB pipelines.
 * This class only supplies the live renderer, owns operation cancellation and
 * prevents an older operation from publishing after a newer one starts.
 */
export class TechnicalRenderExportOrchestrator {
  constructor({
    renderer,
    settings = null,
    renderStillFn = renderStill,
    exportTurntableFn = exportTurntable,
    exportGlbFn = exportGlb,
    abortControllerFactory = () => new AbortController(),
  } = {}) {
    if (!isObjectLike(renderer)) {
      throw new TypeError('Technical Render export requires a renderer.');
    }
    assertService('renderStillFn', renderStillFn);
    assertService('exportTurntableFn', exportTurntableFn);
    assertService('exportGlbFn', exportGlbFn);
    assertService('abortControllerFactory', abortControllerFactory);

    this.renderer = renderer;
    this.settings = settings;
    this.renderStillFn = renderStillFn;
    this.exportTurntableFn = exportTurntableFn;
    this.exportGlbFn = exportGlbFn;
    this.abortControllerFactory = abortControllerFactory;
    this._activeOperation = null;
    this._nextOperationId = 0;
    this._disposed = false;
  }

  _settingsFor(options) {
    return options.settings ?? this.settings ?? this.renderer.currentSettings;
  }

  _run(kind, service, args, externalSignal = null) {
    if (this._disposed) throw new Error('Technical Render export orchestrator is disposed.');

    this.abort();
    const controller = this.abortControllerFactory();
    assertAbortController(controller);
    const operation = {
      id: ++this._nextOperationId,
      kind,
      controller,
    };
    this._activeOperation = operation;

    let removeExternalAbortListener = null;
    if (externalSignal !== undefined && externalSignal !== null) {
      if (typeof externalSignal.addEventListener !== 'function'
        || typeof externalSignal.aborted !== 'boolean') {
        this._activeOperation = null;
        throw new TypeError('Technical Render export signal must be an AbortSignal.');
      }
      const onExternalAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      removeExternalAbortListener = () => {
        externalSignal.removeEventListener?.('abort', onExternalAbort);
      };
      if (externalSignal.aborted) controller.abort();
    }

    const promise = Promise.resolve()
      .then(() => service({ ...args, signal: controller.signal }))
      .then((result) => {
        if (this._disposed || this._activeOperation !== operation || controller.signal.aborted) {
          throw createAbortError();
        }
        return result;
      })
      .catch((error) => {
        if (this._disposed || this._activeOperation !== operation || controller.signal.aborted) {
          throw createAbortError();
        }
        throw error;
      })
      .finally(() => {
        removeExternalAbortListener?.();
        if (this._activeOperation === operation) this._activeOperation = null;
      });

    operation.promise = promise;
    return promise;
  }

  renderStill({ service = this.renderStillFn, ...options } = {}) {
    assertService('renderStillFn', service);
    const { signal, ...serviceOptions } = options;
    return this._run('still', service, {
      renderer: this.renderer,
      settings: this._settingsFor(options),
      ...serviceOptions,
    }, signal);
  }

  exportTurntable({ service = this.exportTurntableFn, options = {}, ...input } = {}) {
    assertService('exportTurntableFn', service);
    const { signal, settings, renderStillFn, ...serviceInput } = input;
    return this._run('turntable', service, {
      renderer: this.renderer,
      settings: settings ?? this._settingsFor(input),
      options,
      ...(renderStillFn ? { renderStillFn } : {}),
      ...serviceInput,
    }, signal);
  }

  exportGlb({ service = this.exportGlbFn, options = {}, ...input } = {}) {
    assertService('exportGlbFn', service);
    const { signal, ...serviceInput } = input;
    return this._run('glb', service, {
      renderer: this.renderer,
      options,
      ...serviceInput,
    }, signal);
  }

  abort() {
    const operation = this._activeOperation;
    if (!operation) return false;
    this._activeOperation = null;
    operation.controller.abort();
    return true;
  }

  dispose() {
    if (this._disposed) return false;
    this.abort();
    this._disposed = true;
    return true;
  }
}

export function createTechnicalRenderExportOrchestrator(options) {
  return new TechnicalRenderExportOrchestrator(options);
}
