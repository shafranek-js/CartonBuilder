import {
  RenderWorkflowLifecycle,
  RenderWorkflowRouter,
} from './RenderWorkflowRouter.js';

export const DEFAULT_RENDER_APPLICATION_CAPABILITIES = Object.freeze({
  technicalRender: false,
});

function normalizeApplicationCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_RENDER_APPLICATION_CAPABILITIES;
  }
  return Object.freeze({
    technicalRender: value.technicalRender === true,
  });
}

function assertRouter(router) {
  if (!router || typeof router.resolve !== 'function' || typeof router.invoke !== 'function') {
    throw new TypeError('Render workflow bootstrap requires a valid router.');
  }
}

/**
 * Build the workflow routing boundary without reading browser state. The
 * production entrypoint uses the default capability object; acceptance code
 * can inject an explicit application capability without exposing a runtime
 * switch through URL, storage, or window globals.
 */
export function createRenderWorkflowBootstrap({
  applicationCapabilities = DEFAULT_RENDER_APPLICATION_CAPABILITIES,
  quickFactory = null,
  technicalFactory = null,
  router: suppliedRouter = null,
  lifecycleFactory = ({ router }) => new RenderWorkflowLifecycle({ router }),
} = {}) {
  const normalizedCapabilities = normalizeApplicationCapabilities(applicationCapabilities);
  const router = suppliedRouter || new RenderWorkflowRouter({
    quickFactory,
    technicalFactory,
    applicationCapabilities: normalizedCapabilities,
  });
  assertRouter(router);
  if (typeof lifecycleFactory !== 'function') {
    throw new TypeError('Render workflow bootstrap lifecycleFactory must be a function.');
  }
  const lifecycle = lifecycleFactory({
    router,
    applicationCapabilities: normalizedCapabilities,
  });
  if (!lifecycle || typeof lifecycle.activate !== 'function') {
    throw new TypeError('Render workflow bootstrap lifecycleFactory must return a lifecycle.');
  }

  return Object.freeze({
    applicationCapabilities: normalizedCapabilities,
    router,
    lifecycle,
  });
}
