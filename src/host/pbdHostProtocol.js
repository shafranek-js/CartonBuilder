const PROTOCOL_VERSION = 'carton-host.v1';
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;

function byteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function createSessionId() {
  const random = Math.random().toString(36).slice(2, 12);
  return `pbd-host-${Date.now()}-${random}`;
}

function serializeMessage(message) {
  try {
    const serialized = JSON.stringify(message);
    return byteLength(serialized) <= MAX_MESSAGE_BYTES ? serialized : null;
  } catch {
    return null;
  }
}

function normalizeError(error, fallbackCode = 'PBD_HOST_ERROR') {
  if (error && typeof error === 'object') return error;
  return { code: fallbackCode, message: String(error || fallbackCode) };
}

/**
 * Host-side bridge for the sandboxed Packaging Box Designer plugin.
 * The contract package in src/workflow is synchronized from PBD; this
 * runtime bridge intentionally lives outside that replaceable package.
 */
export function createPbdHost({
  iframe,
  windowRef = globalThis.window,
  locale = 'en',
  expectedPluginId = 'packaging-box-designer',
  expectedPluginVersion = '1.2.0',
  expectedPluginOrigin = 'null',
  capabilities = {
    artwork2d: true,
    flatExport: true,
    foldPreview: true,
    technicalRender: false,
  },
  onReady = () => {},
  onValidation = () => {},
  onError = () => {},
} = {}) {
  if (!iframe?.contentWindow) throw new Error('PBD host iframe is required.');
  if (!windowRef?.addEventListener) throw new Error('PBD host window is required.');

  const listeners = [];
  const state = {
    started: false,
    initialized: false,
    ready: false,
    sessionId: null,
    pluginOrigin: null,
    validation: null,
    restoreState: 'idle',
  };
  let pendingRequest = null;
  let initializationWaiters = [];
  let initialLoadSeen = false;

  const allowedOrigin = windowRef.location?.origin || '*';

  function targetOriginFor(eventOrigin) {
    return eventOrigin && eventOrigin !== 'null' ? eventOrigin : '*';
  }

  function post(type, payload = {}, targetOrigin = state.pluginOrigin || '*') {
    const message = {
      protocolVersion: PROTOCOL_VERSION,
      type,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      payload,
    };
    if (!serializeMessage(message)) {
      const error = { code: 'HOST_MESSAGE_TOO_LARGE', message: 'Host message exceeds the maximum allowed size.' };
      onError(error);
      return false;
    }
    iframe.contentWindow.postMessage(message, targetOrigin);
    return true;
  }

  function rejectPending(error) {
    if (!pendingRequest) return;
    const request = pendingRequest;
    pendingRequest = null;
    if (request.timeoutId != null) windowRef.clearTimeout?.(request.timeoutId);
    request.reject(normalizeError(error));
  }

  function resolveInitialization() {
    const waiters = initializationWaiters;
    initializationWaiters = [];
    for (const waiter of waiters) {
      if (waiter.timeoutId != null) windowRef.clearTimeout?.(waiter.timeoutId);
      waiter.resolve();
    }
  }

  function rejectInitialization(error) {
    const waiters = initializationWaiters;
    initializationWaiters = [];
    for (const waiter of waiters) {
      if (waiter.timeoutId != null) windowRef.clearTimeout?.(waiter.timeoutId);
      waiter.reject(normalizeError(error));
    }
  }

  function acceptEvent(event) {
    if (event?.source !== iframe.contentWindow) return false;
    if (expectedPluginOrigin != null && event.origin !== expectedPluginOrigin) {
      onError({
        code: 'PBD_PLUGIN_ORIGIN_MISMATCH',
        message: 'Packaging Box Designer message origin is not trusted.',
      });
      return false;
    }
    const data = event?.data;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return false;
    if (!serializeMessage(data)) {
      onError({ code: 'HOST_MESSAGE_TOO_LARGE', message: 'Plugin message exceeds the maximum allowed size.' });
      return false;
    }
    if (data.protocolVersion !== PROTOCOL_VERSION) {
      onError({ code: 'HOST_PROTOCOL_VERSION_UNSUPPORTED', message: 'Plugin protocol version is unsupported.' });
      return false;
    }
    return true;
  }

  function handleMessage(event) {
    if (!acceptEvent(event)) return;
    const data = event.data;

    if (data.type === 'plugin:ready') {
      const pluginId = data.payload?.pluginId;
      const pluginVersion = data.payload?.pluginVersion;
      if (pluginId !== expectedPluginId || pluginVersion !== expectedPluginVersion) {
        onError({
          code: 'PBD_PLUGIN_IDENTITY_MISMATCH',
          message: 'Packaging Box Designer identity or version is not trusted.',
        });
        return;
      }

      // A document reload emits a fresh bootstrap ready without a session.
      // It may arrive before the iframe's load event, so recognize it here
      // and invalidate the previous session instead of treating it as a
      // stale acknowledgement from the old document.
      if (!data.sessionId && (state.ready || state.initialized)) {
        rejectInitialization({ code: 'PBD_HOST_RELOADED', message: 'Packaging Box Designer was reloaded.' });
        rejectPending({ code: 'PBD_HOST_RELOADED', message: 'Packaging Box Designer was reloaded.' });
        state.ready = false;
        state.initialized = false;
        state.sessionId = null;
        state.pluginOrigin = null;
        state.validation = null;
        state.restoreState = 'idle';
      }

      // The plugin sends one bootstrap ready message before host:init and one
      // acknowledgement after host:init. Only the bootstrap message starts
      // the handshake; treating both messages as a new ready event caused an
      // infinite host:init/plugin:ready loop.
      if (!state.ready) {
        state.ready = true;
        state.sessionId = createSessionId();
        state.pluginOrigin = targetOriginFor(event.origin);
        post('host:init', {
          hostVersion: '1.0.0',
          locale,
          allowedOrigin,
          capabilities,
        }, state.pluginOrigin);
        onReady({ pluginId, pluginVersion });
      } else if (!state.initialized && data.sessionId === state.sessionId) {
        state.initialized = true;
        resolveInitialization();
      }
      return;
    }

    if (!state.initialized || data.sessionId !== state.sessionId) return;

    if (data.type === 'pbd:validation-state') {
      state.validation = data.payload || {};
      onValidation(state.validation);
      return;
    }

    if (data.type === 'pbd:carton-ready') {
      if (!pendingRequest || pendingRequest.kind !== 'request') return;
      const bundle = data.payload?.bundle;
      if (!bundle || typeof bundle !== 'object') {
        const error = { code: 'PBD_CARTON_BUNDLE_INVALID', message: 'Packaging Box Designer returned an invalid carton bundle.' };
        onError(error);
        rejectPending(error);
        return;
      }
      const request = pendingRequest;
      pendingRequest = null;
      if (request.timeoutId != null) windowRef.clearTimeout?.(request.timeoutId);
      request.resolve(bundle);
      return;
    }

    if (data.type === 'pbd:carton-loaded') {
      if (!pendingRequest || pendingRequest.kind !== 'load') return;
      const bundle = data.payload?.bundle;
      const expected = pendingRequest.expected;
      const actual = {
        modelSha256: data.payload?.modelSha256 || bundle?.modelJson?.sha256,
        svgSha256: data.payload?.svgSha256 || bundle?.semanticSvg?.sha256,
      };
      if (!bundle || actual.modelSha256 !== expected.modelSha256 || actual.svgSha256 !== expected.svgSha256) {
        const error = { code: 'PBD_CARTON_RESTORE_HASH_MISMATCH', message: 'Packaging Box Designer did not confirm the saved technical carton hashes.', expected, actual };
        state.restoreState = 'failed';
        onError(error);
        rejectPending(error);
        return;
      }
      state.restoreState = 'loaded';
      const request = pendingRequest;
      pendingRequest = null;
      if (request.timeoutId != null) windowRef.clearTimeout?.(request.timeoutId);
      request.resolve(bundle);
      return;
    }

    if (data.type === 'pbd:carton-load-failed') {
      if (!pendingRequest || pendingRequest.kind !== 'load') return;
      const error = normalizeError(data.payload?.error, 'PBD_CARTON_RESTORE_FAILED');
      state.restoreState = 'failed';
      onError(error);
      rejectPending(error);
      return;
    }

    if (data.type === 'plugin:error') {
      const error = normalizeError(data.payload?.error);
      onError(error);
      rejectPending(error);
      return;
    }

    if (data.type === 'plugin:cancelled') {
      const error = { code: 'PBD_REQUEST_CANCELLED', message: 'Packaging Box Designer cancelled the request.' };
      onError(error);
      rejectPending(error);
    }
  }

  function handleLoad() {
    if (!state.started) return;
    // The first load belongs to the document that start() just attached. Its
    // bootstrap ready can arrive after load, so it must not reject waiters.
    if (!initialLoadSeen) {
      initialLoadSeen = true;
      return;
    }
    // DOMContentLoaded in the sandbox can post the bootstrap ready before the
    // browser emits iframe load. Do not erase a valid new handshake here.
    if (state.ready || state.initialized) return;
    state.ready = false;
    state.initialized = false;
    state.sessionId = null;
    state.pluginOrigin = null;
    state.validation = null;
    state.restoreState = 'idle';
    rejectInitialization({ code: 'PBD_HOST_RELOADED', message: 'Packaging Box Designer was reloaded.' });
    rejectPending({ code: 'PBD_HOST_RELOADED', message: 'Packaging Box Designer was reloaded.' });
  }

  function start() {
    if (state.started) return api;
    state.started = true;
    windowRef.addEventListener('message', handleMessage);
    iframe.addEventListener?.('load', handleLoad);
    listeners.push(() => windowRef.removeEventListener?.('message', handleMessage));
    listeners.push(() => iframe.removeEventListener?.('load', handleLoad));
    if (!iframe.src && iframe.dataset?.src) iframe.src = iframe.dataset.src;
    return api;
  }

  function requestCarton({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!state.initialized) {
      const error = { code: 'PBD_HOST_NOT_READY', message: 'Packaging Box Designer is not ready.' };
      onError(error);
      return Promise.reject(error);
    }
    if (pendingRequest) return Promise.reject({ code: 'PBD_REQUEST_IN_PROGRESS', message: 'A carton request is already in progress.' });

    return new Promise((resolve, reject) => {
      const timeoutId = windowRef.setTimeout?.(() => {
        const error = { code: 'PBD_REQUEST_TIMEOUT', message: 'Packaging Box Designer did not return a carton in time.' };
        onError(error);
        rejectPending(error);
      }, timeoutMs);
      pendingRequest = { kind: 'request', resolve, reject, timeoutId };
      if (!post('host:request-carton')) {
        rejectPending({ code: 'HOST_MESSAGE_TOO_LARGE', message: 'Could not send the carton request.' });
      }
    });
  }

  function waitForInitialized({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (state.initialized) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeoutId = windowRef.setTimeout?.(() => {
        const error = { code: 'PBD_HOST_NOT_READY', message: 'Packaging Box Designer did not complete its handshake in time.' };
        rejectInitialization(error);
      }, timeoutMs);
      initializationWaiters.push({ resolve, reject, timeoutId });
    });
  }

  async function loadCarton(bundle, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!bundle || typeof bundle !== 'object') return Promise.reject({ code: 'PBD_CARTON_BUNDLE_INVALID', message: 'A technical carton bundle is required.' });
    await waitForInitialized({ timeoutMs });
    if (pendingRequest) return Promise.reject({ code: 'PBD_REQUEST_IN_PROGRESS', message: 'A Packaging Box Designer request is already in progress.' });
    const expected = {
      modelSha256: bundle.modelJson?.sha256,
      svgSha256: bundle.semanticSvg?.sha256,
    };
    if (!expected.modelSha256 || !expected.svgSha256) return Promise.reject({ code: 'PBD_CARTON_BUNDLE_INVALID', message: 'The technical carton bundle does not contain integrity hashes.' });
    state.restoreState = 'loading';
    return new Promise((resolve, reject) => {
      const timeoutId = windowRef.setTimeout?.(() => {
        const error = { code: 'PBD_CARTON_RESTORE_TIMEOUT', message: 'Packaging Box Designer did not restore the technical carton in time.' };
        state.restoreState = 'failed';
        onError(error);
        rejectPending(error);
      }, timeoutMs);
      pendingRequest = { kind: 'load', resolve, reject, timeoutId, expected };
      if (!post('host:load-carton', { bundle })) rejectPending({ code: 'HOST_MESSAGE_TOO_LARGE', message: 'Could not send the technical carton bundle.' });
    });
  }

  function cancel() {
    if (!state.initialized) return false;
    return post('host:cancel');
  }

  function dispose() {
    if (!state.started) return;
    rejectPending({ code: 'PBD_HOST_DISPOSED', message: 'Packaging Box Designer host was disposed.' });
    for (const remove of listeners.splice(0)) remove();
    state.started = false;
    state.initialized = false;
    state.ready = false;
    initialLoadSeen = false;
  }

  const api = {
    start,
    requestCarton,
    loadCarton,
    waitForInitialized,
    cancel,
    dispose,
    getState() {
      return {
        ...state,
        validation: state.validation ? structuredClone(state.validation) : null,
      };
    },
  };

  return api;
}
