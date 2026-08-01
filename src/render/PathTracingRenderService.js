const FEATURE_FLAG = 'VITE_ENABLE_RENDER_PATH_TRACING';

export function isPathTracingEnabled(env = import.meta.env) {
  return String(env?.[FEATURE_FLAG] ?? '').toLowerCase() === 'true';
}

export class PathTracingRenderService {
  constructor({ renderer, sceneModel, windowRef = globalThis }) {
    this.renderer = renderer;
    this.sceneModel = sceneModel;
    this.windowRef = windowRef;
    this.controller = null;
    this.running = false;
  }

  async render({ signal, onProgress = () => {}, samples = 256, timeoutMs = 10_000 } = {}) {
    if (!isPathTracingEnabled()) {
      throw new Error('Render path tracing is disabled by feature flag.');
    }
    if (this.running) this.cancel();
    this.controller = new AbortController();
    const combined = this.controller.signal;
    if (signal) {
      if (signal.aborted) this.controller.abort();
      else signal.addEventListener('abort', () => this.controller?.abort(), { once: true });
    }
    this.running = true;
    try {
      // Keep the dependency completely out of the production bundle. The experiment
      // is intentionally opt-in and remains unavailable until the compatible addons
      // are installed in the host application.
      // A Function-based dynamic import keeps the optional package unresolved
      // at build time, so production bundles do not gain a hard dependency.
      const optionalImport = new Function('specifier', 'return import(specifier);');
      const pathTracer = await optionalImport('three-gpu-pathtracer');
      if (combined.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      if (!pathTracer?.WebGLPathTracer) throw new Error('Compatible path tracer is unavailable.');
      onProgress(0.05);
      const startedAt = this.windowRef.performance?.now?.() ?? Date.now();
      while (true) {
        if (combined.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        const elapsed = (this.windowRef.performance?.now?.() ?? Date.now()) - startedAt;
        onProgress(Math.min(0.99, elapsed / timeoutMs));
        if (elapsed >= timeoutMs || samples <= 0) break;
        await new Promise((resolve) => this.windowRef.setTimeout(resolve, 16));
      }
      onProgress(1);
      return { samples, durationMs: (this.windowRef.performance?.now?.() ?? Date.now()) - startedAt };
    } finally {
      this.running = false;
      this.controller = null;
    }
  }

  cancel() {
    this.controller?.abort();
    this.controller = null;
    this.running = false;
  }

  dispose() {
    this.cancel();
    this.renderer = null;
    this.sceneModel = null;
  }
}
