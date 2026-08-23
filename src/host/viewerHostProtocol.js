import { normalizeTechnicalViewerState } from '../project/technicalViewerState.js';

const CONTRACT_VERSION = 'carton-workflow.v1';
const PLUGIN_ID = 'carton-fold-viewer';
const PLUGIN_VERSION = '2.4.0';
const DEFAULT_PLUGIN_ORIGIN = 'null';
const DEFAULT_TIMEOUT_MS = 120000;

export const VIEWER_PROTOCOL_VERSION = CONTRACT_VERSION;
export const VIEWER_MESSAGE_TYPES = Object.freeze({
  INIT: 'host:init',
  LOAD: 'viewer:load',
  STATE: 'host:state',
  ARTWORK: 'host:artwork',
  CANCEL: 'host:cancel',
  READY: 'plugin:ready',
  MODEL_LOADED: 'viewer:model-loaded',
  STATE_UPDATED: 'viewer:state',
  ARTWORK_UPDATED: 'viewer:artwork',
  GLB_EXPORTED: 'viewer:glb-exported',
  ERROR: 'plugin:error',
  CANCELLED: 'viewer:cancelled',
});

export const DEFAULT_VIEWER_PAYLOAD_LIMITS = Object.freeze({
  maxMessageBytes: 64 * 1024 * 1024,
  maxSvgBytes: 8 * 1024 * 1024,
  maxAssetBytes: 32 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxGlbBytes: 64 * 1024 * 1024,
});

const SHA256_RE = /^[a-f0-9]{64}$/i;
const MAP_KEYS = new Set(['alpha', 'normal', 'roughness', 'metalness']);
const INCOMING_TYPES = new Set([
  VIEWER_MESSAGE_TYPES.READY,
  VIEWER_MESSAGE_TYPES.MODEL_LOADED,
  VIEWER_MESSAGE_TYPES.GLB_EXPORTED,
  VIEWER_MESSAGE_TYPES.ERROR,
  VIEWER_MESSAGE_TYPES.CANCELLED,
  VIEWER_MESSAGE_TYPES.STATE_UPDATED,
  VIEWER_MESSAGE_TYPES.ARTWORK_UPDATED,
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createError(code, stage, message, details = undefined) {
  return {
    code,
    stage,
    message,
    recoverable: true,
    ...(details === undefined ? {} : { details }),
  };
}

function normalizeError(error, fallbackCode = 'VIEWER_HOST_ERROR') {
  if (error && typeof error === 'object' && typeof error.code === 'string') return error;
  return createError(fallbackCode, 'protocol', String(error?.message || error || fallbackCode));
}

function textByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function asArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

function jsonByteLength(value) {
  try {
    const serialized = JSON.stringify(value, (_key, nested) => {
      if (nested instanceof ArrayBuffer) return { __transferableByteLength: nested.byteLength };
      return nested;
    });
    return textByteLength(serialized || '');
  } catch {
    return Infinity;
  }
}

function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now()}-${random}`;
}

function checkSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw createError('viewer-sha256-invalid', 'integrity', `${label} must be a 64-character hexadecimal SHA-256.`);
  }
}

function checkClaimedIntegrity(claimed, actualByteLength, actualSha256, label) {
  if (claimed?.byteLength !== undefined && claimed.byteLength !== actualByteLength) {
    throw createError('viewer-byte-length-mismatch', 'integrity', `${label}.byteLength does not match the host bytes.`);
  }
  if (claimed?.sha256 !== undefined && String(claimed.sha256).toLowerCase() !== actualSha256) {
    throw createError('viewer-sha256-mismatch', 'integrity', `${label}.sha256 does not match the host bytes.`);
  }
}

export async function sha256Async(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) {
    throw createError('viewer-crypto-unavailable', 'integrity', 'Web Crypto SHA-256 is unavailable in the host.', undefined);
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getOrigin(windowRef) {
  const origin = windowRef?.location?.origin;
  return typeof origin === 'string' && origin ? origin : 'null';
}

function negotiateLimits(requested = {}) {
  if (!isRecord(requested)) throw createError('viewer-payload-limit-invalid', 'handshake', 'Viewer payload limits must be an object.');
  const limits = {};
  for (const [key, maximum] of Object.entries(DEFAULT_VIEWER_PAYLOAD_LIMITS)) {
    const value = requested[key] === undefined ? maximum : requested[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw createError('viewer-payload-limit-invalid', 'handshake', `payloadLimits.${key} must be a positive safe integer.`);
    }
    limits[key] = Math.min(maximum, value);
  }
  return limits;
}

async function createBinaryDescriptor(value, label, limits) {
  const claimed = isRecord(value) ? value : null;
  let data = claimed?.data ?? claimed?.buffer ?? value;
  let mimeType = claimed?.mimeType;
  if (data instanceof Blob) {
    mimeType = mimeType || data.type || 'application/octet-stream';
    data = await data.arrayBuffer();
  }
  const buffer = asArrayBuffer(data);
  if (!buffer) throw createError('viewer-payload-invalid', 'payload-validation', `${label} must contain transferable binary data.`);
  if (buffer.byteLength <= 0 || buffer.byteLength > limits.maxAssetBytes) {
    throw createError('viewer-payload-too-large', 'payload-validation', `${label} exceeds maxAssetBytes.`);
  }
  if (typeof mimeType !== 'string' || !/^image\//i.test(mimeType)) {
    throw createError('viewer-mime-type-invalid', 'payload-validation', `${label} must use an image MIME type.`);
  }
  const sha256 = await sha256Async(buffer);
  checkClaimedIntegrity(claimed, buffer.byteLength, sha256, label);
  return {
    data: buffer,
    byteLength: buffer.byteLength,
    sha256,
    mimeType,
  };
}

async function createSvgDescriptor(value, limits) {
  const claimed = isRecord(value) ? value : null;
  const text = typeof value === 'string' ? value : claimed?.text;
  if (typeof text !== 'string' || !text) throw createError('viewer-payload-invalid', 'payload-validation', 'semanticSvg must contain SVG text.');
  const byteLength = textByteLength(text);
  if (byteLength <= 0 || byteLength > limits.maxSvgBytes) {
    throw createError('viewer-payload-too-large', 'payload-validation', 'semanticSvg exceeds maxSvgBytes.');
  }
  const sha256 = await sha256Async(text);
  checkClaimedIntegrity(claimed, byteLength, sha256, 'semanticSvg');
  return { text, byteLength, sha256 };
}

function validateLoadMetadata(payload) {
  if (payload.loadId !== undefined && (typeof payload.loadId !== 'string' || payload.loadId.length < 1 || payload.loadId.length > 128)) {
    throw createError('viewer-load-id-invalid', 'payload-validation', 'loadId must be a non-empty string of at most 128 characters.');
  }
  if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.length > 256)) {
    throw createError('viewer-name-invalid', 'payload-validation', 'name must be a string of at most 256 characters.');
  }
}

export function createViewerHost({
  iframe,
  windowRef = globalThis.window,
  locale = 'en',
  expectedPluginOrigin = DEFAULT_PLUGIN_ORIGIN,
  expectedPluginId = PLUGIN_ID,
  expectedPluginVersion = PLUGIN_VERSION,
  payloadLimits = DEFAULT_VIEWER_PAYLOAD_LIMITS,
  capabilities = {
    artwork2d: false,
    flatExport: false,
    foldPreview: true,
    technicalRender: false,
    referenceOnly: true,
    productionCertified: false,
  },
  onReady = () => {},
  onModelLoaded = () => {},
  onGlbExported = () => {},
  onError = () => {},
  onCancelled = () => {},
  onState = () => {},
  onArtworkUpdated = () => {},
} = {}) {
  if (!iframe?.contentWindow) throw new Error('Viewer host iframe is required.');
  if (!windowRef?.addEventListener) throw new Error('Viewer host window is required.');

  const state = {
    started: false,
    initialized: false,
    sessionId: null,
    allowedOrigin: getOrigin(windowRef),
    limits: null,
    loadId: null,
    viewerState: null,
  };
  let pendingLoad = null;
  let pendingCancel = null;
  let pendingState = null;
  let pendingArtwork = null;
  let readyWaiters = [];

  function report(error) {
    const normalized = normalizeError(error);
    onError(normalized);
    return normalized;
  }

  function settleReady(error = null) {
    const waiters = readyWaiters;
    readyWaiters = [];
    for (const waiter of waiters) {
      windowRef.clearTimeout?.(waiter.timeoutId);
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }

  function rejectLoad(error) {
    if (!pendingLoad) return;
    const request = pendingLoad;
    pendingLoad = null;
    if (request.timeoutId != null) windowRef.clearTimeout?.(request.timeoutId);
    request.reject(normalizeError(error, 'VIEWER_LOAD_FAILED'));
  }

  function targetOrigin() {
    // An allow-scripts sandbox has an opaque destination origin. The outgoing
    // host -> iframe direction therefore requires '*'; incoming events remain
    // locked to expectedPluginOrigin and iframe.contentWindow below.
    return '*';
  }

  function post(type, payload = {}, transfer = []) {
    if (!state.started || !state.sessionId) return false;
    const message = {
      contractVersion: CONTRACT_VERSION,
      type,
      sessionId: state.sessionId,
      payload,
    };
    if (jsonByteLength(message) > (state.limits?.maxMessageBytes || DEFAULT_VIEWER_PAYLOAD_LIMITS.maxMessageBytes)) {
      report(createError('viewer-message-too-large', 'payload-validation', 'Viewer message exceeds negotiated maxMessageBytes.'));
      return false;
    }
    iframe.contentWindow.postMessage(message, targetOrigin(), transfer);
    return true;
  }

  function beginHandshake() {
    rejectLoad(createError('viewer-reloaded', 'lifecycle', 'Viewer iframe was reloaded.'));
    state.initialized = false;
    state.sessionId = createId('viewer-host');
    state.allowedOrigin = getOrigin(windowRef);
    state.limits = negotiateLimits(payloadLimits);
    state.loadId = null;
    state.viewerState = null;
    post(VIEWER_MESSAGE_TYPES.INIT, {
      sessionId: state.sessionId,
      contractVersion: CONTRACT_VERSION,
      allowedOrigin: state.allowedOrigin,
      locale,
      capabilities: structuredClone(capabilities),
      payloadLimits: state.limits,
    });
  }

  function acceptEvent(event) {
    if (event?.source !== iframe.contentWindow) return false;
    if (event.origin !== expectedPluginOrigin) {
      report(createError('viewer-origin-mismatch', 'security', 'Viewer message origin is not trusted.'));
      return false;
    }
    const data = event?.data;
    if (!isRecord(data) || !INCOMING_TYPES.has(data.type)) {
      report(createError('viewer-message-type-invalid', 'protocol', 'Viewer message type is not supported.'));
      return false;
    }
    if (data.contractVersion !== CONTRACT_VERSION) {
      report(createError('viewer-contract-version-unsupported', 'protocol', `Expected ${CONTRACT_VERSION}.`));
      return false;
    }
    if (!state.sessionId || data.sessionId !== state.sessionId) {
      report(createError('viewer-session-mismatch', 'security', 'Viewer message sessionId does not match the active session.'));
      return false;
    }
    if (jsonByteLength(data) > (state.limits?.maxMessageBytes || DEFAULT_VIEWER_PAYLOAD_LIMITS.maxMessageBytes)) {
      report(createError('viewer-message-too-large', 'payload-validation', 'Viewer message exceeds negotiated maxMessageBytes.'));
      return false;
    }
    return true;
  }

  async function handleGlbExported(data) {
    const payload = data.payload;
    if (!isRecord(payload) || payload.loadId !== state.loadId || !pendingLoad) {
      report(createError('viewer-load-id-mismatch', 'protocol', 'GLB export does not belong to the active viewer load.'));
      return;
    }
    const glb = asArrayBuffer(payload.glb);
    if (!glb || glb.byteLength <= 0 || glb.byteLength > state.limits.maxGlbBytes) {
      rejectLoad(createError('viewer-glb-invalid', 'export', 'Viewer GLB is missing or exceeds maxGlbBytes.'));
      return;
    }
    if (payload.byteLength !== glb.byteLength || payload.mimeType !== 'model/gltf-binary') {
      rejectLoad(createError('viewer-glb-metadata-mismatch', 'export', 'Viewer GLB metadata is invalid.'));
      return;
    }
    checkSha256(payload.sha256, 'viewer:glb-exported.sha256');
    const actualSha256 = await sha256Async(glb);
    if (actualSha256 !== payload.sha256.toLowerCase()) {
      rejectLoad(createError('viewer-glb-sha256-mismatch', 'integrity', 'Viewer GLB SHA-256 does not match the transferred bytes.'));
      return;
    }
    const request = pendingLoad;
    pendingLoad = null;
    windowRef.clearTimeout?.(request.timeoutId);
    const result = { ...payload, glb, actualSha256 };
    onGlbExported(result);
    request.resolve(result);
  }

  function acceptViewerState(payload) {
    if (!isRecord(payload) || payload.loadId !== state.loadId || !isRecord(payload.state)) {
      report(createError('viewer-load-id-mismatch', 'state', 'viewer state does not match the active viewer load.'));
      return false;
    }
    try {
      const viewerState = normalizeTechnicalViewerState(payload.state, { allowNull: false });
      const changed = JSON.stringify(state.viewerState) !== JSON.stringify(viewerState);
      state.viewerState = viewerState;
      if (changed) onState({ loadId: payload.loadId, state: structuredClone(viewerState) });
      if (pendingState?.loadId === payload.loadId) {
        const request = pendingState;
        pendingState = null;
        windowRef.clearTimeout?.(request.timeoutId);
        request.resolve(viewerState);
      }
      return true;
    } catch (error) {
      report(createError('viewer-state-invalid', 'state', error.message));
      return false;
    }
  }

  function handleMessage(event) {
    if (!acceptEvent(event)) return;
    const data = event.data;
    const payload = isRecord(data.payload) ? data.payload : {};
    if (data.type === VIEWER_MESSAGE_TYPES.READY) {
      if (payload.pluginId !== expectedPluginId || payload.pluginVersion !== expectedPluginVersion) {
        report(createError('viewer-identity-mismatch', 'handshake', 'Viewer identity or version is not trusted.'));
        return;
      }
      if (payload.contractVersion !== CONTRACT_VERSION) {
        report(createError('viewer-contract-version-unsupported', 'handshake', 'Viewer ready payload has an unsupported contract version.'));
        return;
      }
      const limits = payload.payloadLimits;
      if (!isRecord(limits) || Object.entries(state.limits || {}).some(([key, value]) => limits[key] !== value)) {
        report(createError('viewer-payload-limit-mismatch', 'handshake', 'Viewer did not acknowledge the negotiated payload limits.'));
        return;
      }
      state.initialized = true;
      settleReady();
      onReady({
        pluginId: payload.pluginId,
        pluginVersion: payload.pluginVersion,
        locale: payload.locale,
        capabilities: payload.capabilities,
        payloadLimits: { ...limits },
      });
      return;
    }
    if (!state.initialized) {
      report(createError('viewer-not-ready', 'handshake', 'Viewer message arrived before plugin:ready.'));
      return;
    }
    if (data.type === VIEWER_MESSAGE_TYPES.MODEL_LOADED) {
      if (!pendingLoad || payload.loadId !== state.loadId || !Array.isArray(payload.panelIds) || !Array.isArray(payload.animationNames)) {
        report(createError('viewer-load-id-mismatch', 'protocol', 'viewer:model-loaded does not match the active load.'));
        return;
      }
      onModelLoaded({ ...payload });
      if (payload.state !== undefined) acceptViewerState(payload);
      return;
    }
    if (data.type === VIEWER_MESSAGE_TYPES.STATE_UPDATED) {
      acceptViewerState(payload);
      return;
    }
    if (data.type === VIEWER_MESSAGE_TYPES.ARTWORK_UPDATED) {
      if (!isRecord(payload) || payload.loadId !== state.loadId) {
        report(createError('viewer-load-id-mismatch', 'artwork', 'viewer:artwork does not match the active viewer load.'));
        return;
      }
      onArtworkUpdated(payload);
      if (pendingArtwork?.loadId === payload.loadId) {
        const request = pendingArtwork;
        pendingArtwork = null;
        windowRef.clearTimeout?.(request.timeoutId);
        request.resolve(payload);
      }
      return;
    }
    if (data.type === VIEWER_MESSAGE_TYPES.GLB_EXPORTED) {
      void handleGlbExported(data).catch((error) => rejectLoad(report(error)));
      return;
    }
    if (data.type === VIEWER_MESSAGE_TYPES.ERROR) {
      const error = report(payload.error || payload);
      rejectLoad(error);
      pendingCancel?.reject(error);
      pendingCancel = null;
      pendingState?.reject(error);
      pendingState = null;
      pendingArtwork?.reject(error);
      pendingArtwork = null;
      return;
    }
    if (data.type === VIEWER_MESSAGE_TYPES.CANCELLED) {
      const error = createError('viewer-cancelled', 'lifecycle', payload.reason || 'Viewer cancelled the active operation.');
      rejectLoad(error);
      onCancelled(payload);
      pendingCancel?.resolve(payload);
      pendingCancel = null;
    }
  }

  function waitForReady({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (state.initialized) return Promise.resolve();
    if (!state.started) return Promise.reject(createError('viewer-host-not-started', 'lifecycle', 'Viewer host has not been started.'));
    return new Promise((resolve, reject) => {
      const timeoutId = windowRef.setTimeout?.(() => {
        const error = createError('viewer-ready-timeout', 'handshake', 'Viewer did not complete its handshake in time.');
        settleReady(error);
      }, timeoutMs);
      readyWaiters.push({ resolve, reject, timeoutId });
    });
  }

  async function load({
    semanticSvg,
    artworkAtlas,
    maps = {},
    finishMetadata = null,
    state: viewerState = null,
    name = 'technical-carton.svg',
    loadId = createId('technical-load'),
    exportGlb = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    await waitForReady({ timeoutMs });
    if (pendingLoad) throw createError('viewer-load-in-progress', 'lifecycle', 'A Viewer load is already in progress.');
    if (!isRecord(maps)) throw createError('viewer-maps-invalid', 'payload-validation', 'Viewer artwork maps must be an object.');
    validateLoadMetadata({ name, loadId });
    const normalizedSvg = await createSvgDescriptor(semanticSvg, state.limits);
    const normalizedAtlas = await createBinaryDescriptor(artworkAtlas, 'artworkAtlas', state.limits);
    const normalizedMaps = {};
    const transfer = [normalizedAtlas.data];
    let totalBytes = normalizedSvg.byteLength + normalizedAtlas.byteLength;
    for (const [key, value] of Object.entries(maps)) {
      if (!MAP_KEYS.has(key)) throw createError('viewer-map-type-unsupported', 'payload-validation', `Unsupported artwork map: ${key}.`);
      if (value == null) continue;
      const normalized = await createBinaryDescriptor(value, `maps.${key}`, state.limits);
      normalizedMaps[key] = normalized;
      transfer.push(normalized.data);
      totalBytes += normalized.byteLength;
    }
    if (totalBytes > state.limits.maxTotalBytes) throw createError('viewer-payload-too-large', 'payload-validation', 'Viewer load exceeds maxTotalBytes.');
    const payload = {
      loadId,
      name,
      semanticSvg: normalizedSvg,
      artworkAtlas: normalizedAtlas,
      maps: normalizedMaps,
      exportGlb: exportGlb !== false,
      ...(viewerState == null ? {} : { state: normalizeTechnicalViewerState(viewerState, { allowNull: false }) }),
      ...(finishMetadata == null ? {} : { finishMetadata: structuredClone(finishMetadata) }),
    };
    if (jsonByteLength({ contractVersion: CONTRACT_VERSION, type: VIEWER_MESSAGE_TYPES.LOAD, sessionId: state.sessionId, payload }) > state.limits.maxMessageBytes) {
      throw createError('viewer-message-too-large', 'payload-validation', 'Viewer load exceeds maxMessageBytes.');
    }
    state.loadId = loadId;
    return new Promise((resolve, reject) => {
      const timeoutId = windowRef.setTimeout?.(() => rejectLoad(createError('viewer-load-timeout', 'load', 'Viewer did not export the loaded model in time.')), timeoutMs);
      pendingLoad = { resolve, reject, timeoutId };
      if (!post(VIEWER_MESSAGE_TYPES.LOAD, payload, transfer)) {
        rejectLoad(createError('viewer-message-too-large', 'payload-validation', 'Could not send viewer:load.'));
      }
    });
  }

  async function setState(viewerState, { loadId = state.loadId, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    await waitForReady({ timeoutMs });
    if (!loadId || loadId !== state.loadId) throw createError('viewer-load-id-mismatch', 'state', 'No matching active viewer load exists.');
    if (pendingState) throw createError('viewer-state-in-progress', 'state', 'A Viewer state update is already in progress.');
    const normalized = normalizeTechnicalViewerState(viewerState, { allowNull: false });
    const payload = { loadId, state: normalized };
    if (jsonByteLength({ contractVersion: CONTRACT_VERSION, type: VIEWER_MESSAGE_TYPES.STATE, sessionId: state.sessionId, payload }) > state.limits.maxMessageBytes) {
      throw createError('viewer-message-too-large', 'payload-validation', 'Viewer state exceeds maxMessageBytes.');
    }
    return new Promise((resolve, reject) => {
      const timeoutId = windowRef.setTimeout?.(() => {
        pendingState = null;
        reject(createError('viewer-state-timeout', 'state', 'Viewer did not acknowledge state in time.'));
      }, timeoutMs);
      pendingState = { loadId, resolve, reject, timeoutId };
      if (!post(VIEWER_MESSAGE_TYPES.STATE, payload)) {
        pendingState = null;
        windowRef.clearTimeout?.(timeoutId);
        reject(createError('viewer-message-send-failed', 'state', 'Could not send host:state.'));
      }
    });
  }

  async function setArtworkAtlas(artworkAtlas, maps = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    await waitForReady({ timeoutMs });
    if (!state.loadId) throw createError('viewer-load-id-mismatch', 'artwork', 'No matching active viewer load exists.');
    if (!isRecord(maps)) throw createError('viewer-maps-invalid', 'payload-validation', 'Viewer artwork maps must be an object.');
    const normalizedAtlas = await createBinaryDescriptor(artworkAtlas, 'artworkAtlas', state.limits);
    const normalizedMaps = {};
    const transfer = [normalizedAtlas.data];
    let totalBytes = normalizedAtlas.byteLength;
    for (const [key, value] of Object.entries(maps)) {
      if (!MAP_KEYS.has(key)) throw createError('viewer-map-type-unsupported', 'payload-validation', `Unsupported artwork map: ${key}.`);
      if (value == null) continue;
      normalizedMaps[key] = await createBinaryDescriptor(value, `maps.${key}`, state.limits);
      transfer.push(normalizedMaps[key].data);
      totalBytes += normalizedMaps[key].byteLength;
    }
    if (totalBytes > state.limits.maxTotalBytes) throw createError('viewer-payload-too-large', 'payload-validation', 'Viewer artwork update exceeds maxTotalBytes.');
    if (pendingArtwork) throw createError('viewer-artwork-in-progress', 'artwork', 'A Viewer artwork update is already in progress.');
    const payload = { loadId: state.loadId, artworkAtlas: normalizedAtlas, maps: normalizedMaps };
    return new Promise((resolve, reject) => {
      const timeoutId = windowRef.setTimeout?.(() => {
        pendingArtwork = null;
        reject(createError('viewer-artwork-timeout', 'artwork', 'Viewer did not acknowledge artwork update in time.'));
      }, timeoutMs);
      pendingArtwork = { loadId: state.loadId, resolve, reject, timeoutId };
      if (!post(VIEWER_MESSAGE_TYPES.ARTWORK, payload, transfer)) {
        pendingArtwork = null;
        windowRef.clearTimeout?.(timeoutId);
        reject(createError('viewer-message-send-failed', 'artwork', 'Could not send host:artwork.'));
      }
    });
  }

  function cancel({ reason = 'host-request', timeoutMs = 5000 } = {}) {
    if (!state.initialized) return Promise.resolve(false);
    if (pendingCancel) return pendingCancel.promise;
    let resolveCancel;
    let rejectCancel;
    const promise = new Promise((resolve, reject) => { resolveCancel = resolve; rejectCancel = reject; });
    const timeoutId = windowRef.setTimeout?.(() => {
      pendingCancel = null;
      resolveCancel({ reason, timedOut: true });
    }, timeoutMs);
    pendingCancel = { promise, resolve: (value) => { windowRef.clearTimeout?.(timeoutId); resolveCancel(value); }, reject: (error) => { windowRef.clearTimeout?.(timeoutId); rejectCancel(error); } };
    if (!post(VIEWER_MESSAGE_TYPES.CANCEL, { reason })) {
      pendingCancel.reject(createError('viewer-cancel-failed', 'lifecycle', 'Could not send host:cancel.'));
    }
    return promise;
  }

  function start() {
    if (state.started) return api;
    state.started = true;
    windowRef.addEventListener('message', handleMessage);
    iframe.addEventListener?.('load', beginHandshake);
    const currentSrc = iframe.getAttribute?.('src') || '';
    if ((!currentSrc || currentSrc === 'about:blank') && iframe.dataset?.src) {
      iframe.src = iframe.dataset.src;
    }
    return api;
  }

  function dispose({ cancelActive = true } = {}) {
    if (!state.started) return false;
    if (cancelActive && state.initialized) post(VIEWER_MESSAGE_TYPES.CANCEL, { reason: 'host-dispose' });
    rejectLoad(createError('viewer-host-disposed', 'lifecycle', 'Viewer host was disposed.'));
    settleReady(createError('viewer-host-disposed', 'lifecycle', 'Viewer host was disposed.'));
    pendingCancel?.resolve({ reason: 'host-dispose' });
    pendingCancel = null;
    const disposed = createError('viewer-host-disposed', 'lifecycle', 'Viewer host was disposed.');
    pendingState?.reject(disposed);
    pendingState = null;
    pendingArtwork?.reject(disposed);
    pendingArtwork = null;
    windowRef.removeEventListener?.('message', handleMessage);
    iframe.removeEventListener?.('load', beginHandshake);
    state.started = false;
    state.initialized = false;
    state.sessionId = null;
    state.loadId = null;
    state.viewerState = null;
    state.limits = null;
    iframe.removeAttribute?.('src');
    return true;
  }

  const api = {
    start,
    load,
    setState,
    setArtworkAtlas,
    waitForReady,
    cancel,
    dispose,
    getState() {
      return {
        ...state,
        limits: state.limits ? { ...state.limits } : null,
        pendingLoad: Boolean(pendingLoad),
      };
    },
  };
  return api;
}
