import { beforeEach, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';

import {
  createViewerHost,
  sha256Async,
  VIEWER_MESSAGE_TYPES,
  VIEWER_PROTOCOL_VERSION,
} from '../../src/host/viewerHostProtocol.js';

function createHarness() {
  const listeners = new Map();
  const childMessages = [];
  const childWindow = {
    postMessage(message, targetOrigin, transfer) {
      childMessages.push({ message, targetOrigin, transfer });
    },
  };
  const iframeListeners = new Map();
  const iframe = {
    contentWindow: childWindow,
    dataset: { src: './plugins/carton-fold-viewer/2.4.0/index.html' },
    src: '',
    addEventListener(type, listener) { iframeListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (iframeListeners.get(type) === listener) iframeListeners.delete(type);
    },
    getAttribute(name) { return name === 'src' && this.src ? this.src : null; },
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    dispatch(type) { iframeListeners.get(type)?.(); },
  };
  const windowRef = {
    location: { origin: 'https://carton-builder.test' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    setTimeout,
    clearTimeout,
    dispatch(type, event) { listeners.get(type)?.(event); },
  };
  return { iframe, windowRef, childMessages };
}

function envelope(type, sessionId, payload) {
  return {
    contractVersion: VIEWER_PROTOCOL_VERSION,
    type,
    sessionId,
    payload,
  };
}

async function waitForMessage(harness, type) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const message = harness.childMessages.find((entry) => entry.message.type === type);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${type}.`);
}

describe('viewer host protocol', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  });

  it('performs the opaque-origin handshake and validates a transferred load/export', async () => {
    const harness = createHarness();
    const loaded = [];
    const exported = [];
    const errors = [];
    const host = createViewerHost({
      ...harness,
      onModelLoaded: (payload) => loaded.push(payload),
      onGlbExported: (payload) => exported.push(payload),
      onError: (error) => errors.push(error),
    });

    host.start();
    expect(harness.iframe.src).toBe('./plugins/carton-fold-viewer/2.4.0/index.html');
    harness.iframe.dispatch('load');
    const init = await waitForMessage(harness, VIEWER_MESSAGE_TYPES.INIT);
    expect(init.targetOrigin).toBe('*');
    expect(init.message.payload.allowedOrigin).toBe('https://carton-builder.test');
    expect(init.message.payload.payloadLimits.maxGlbBytes).toBeGreaterThan(0);

    const { sessionId } = init.message.payload;
    harness.windowRef.dispatch('message', {
      source: harness.iframe.contentWindow,
      origin: 'null',
      data: envelope(VIEWER_MESSAGE_TYPES.READY, sessionId, {
        pluginId: 'carton-fold-viewer',
        pluginVersion: '2.4.0',
        contractVersion: VIEWER_PROTOCOL_VERSION,
        locale: 'en',
        capabilities: { foldPreview: true, technicalRender: false },
        payloadLimits: init.message.payload.payloadLimits,
      }),
    });
    await host.waitForReady();
    expect(host.getState().initialized).toBe(true);

    const semanticSvg = '<svg xmlns="http://www.w3.org/2000/svg"><metadata id="pbd">{}</metadata></svg>';
    const atlas = new TextEncoder().encode('atlas-bytes').buffer;
    const normal = new TextEncoder().encode('normal-bytes').buffer;
    const loadPromise = host.load({
      semanticSvg,
      artworkAtlas: { data: atlas, mimeType: 'image/png' },
      maps: { normal: { data: normal, mimeType: 'image/png' } },
      finishMetadata: { cartonType: 'RTE', referenceOnly: true },
      name: 'rte-technical.svg',
      loadId: 'load-rte-1',
      state: {
        version: 1,
        animationName: null,
        foldProgress: 0.25,
        camera: {
          projection: 'perspective', heading: 20, elevation: 30,
          horizontalPan: 0, verticalPan: 0, distanceFactor: 4,
          frameHeightFactor: 0, fov: 42, verticalCorrection: false,
        },
      },
    });
    const loadMessage = await waitForMessage(harness, VIEWER_MESSAGE_TYPES.LOAD);
    expect(loadMessage.message.payload.semanticSvg.byteLength).toBe(new TextEncoder().encode(semanticSvg).byteLength);
    expect(loadMessage.message.payload.artworkAtlas.sha256).toBe(await sha256Async(atlas));
    expect(loadMessage.message.payload.maps.normal.sha256).toBe(await sha256Async(normal));
    expect(loadMessage.transfer).toContain(loadMessage.message.payload.artworkAtlas.data);

    harness.windowRef.dispatch('message', {
      source: harness.iframe.contentWindow,
      origin: 'null',
      data: envelope(VIEWER_MESSAGE_TYPES.MODEL_LOADED, sessionId, {
        loadId: 'load-rte-1',
        cartonType: 'RTE',
        panelIds: ['front', 'back'],
        animationNames: ['foldProgress'],
        state: {
          version: 1,
          animationName: null,
          foldProgress: 0.25,
          camera: {
            projection: 'perspective', heading: 20, elevation: 30,
            horizontalPan: 0, verticalPan: 0, distanceFactor: 4,
            frameHeightFactor: 0, fov: 42, verticalCorrection: false,
          },
        },
      }),
    });
    const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 0, 0, 0]).buffer;
    harness.windowRef.dispatch('message', {
      source: harness.iframe.contentWindow,
      origin: 'null',
      data: envelope(VIEWER_MESSAGE_TYPES.GLB_EXPORTED, sessionId, {
        loadId: 'load-rte-1',
        byteLength: glb.byteLength,
        sha256: await sha256Async(glb),
        mimeType: 'model/gltf-binary',
        glb,
      }),
    });

    const result = await loadPromise;
    expect(result.actualSha256).toBe(result.sha256);
    expect(loaded[0]).toMatchObject({ cartonType: 'RTE', panelIds: ['front', 'back'] });
    expect(exported).toHaveLength(1);
    expect(errors).toHaveLength(0);

    expect(harness.childMessages.find((entry) => entry.message.type === VIEWER_MESSAGE_TYPES.LOAD)
      .message.payload.state.foldProgress).toBe(0.25);
    expect(host.getState().viewerState.foldProgress).toBe(0.25);

    const nextState = {
      version: 1,
      animationName: null,
      foldProgress: 0.75,
      camera: {
        projection: 'perspective', heading: 50, elevation: 25,
        horizontalPan: 0.1, verticalPan: -0.1, distanceFactor: 5,
        frameHeightFactor: 0, fov: 42, verticalCorrection: false,
      },
    };
    const statePromise = host.setState(nextState);
    const stateMessage = await waitForMessage(harness, VIEWER_MESSAGE_TYPES.STATE);
    harness.windowRef.dispatch('message', {
      source: harness.iframe.contentWindow,
      origin: 'null',
      data: envelope(VIEWER_MESSAGE_TYPES.STATE_UPDATED, sessionId, {
        loadId: 'load-rte-1',
        state: nextState,
      }),
    });
    await expect(statePromise).resolves.toMatchObject({ foldProgress: 0.75 });
    expect(host.getState().viewerState.foldProgress).toBe(0.75);
    expect(stateMessage.message.payload.loadId).toBe('load-rte-1');

    const artworkPromise = host.setArtworkAtlas(
      { data: new TextEncoder().encode('new-atlas').buffer, mimeType: 'image/png' },
      { alpha: { data: new TextEncoder().encode('new-alpha').buffer, mimeType: 'image/png' } },
    );
    const artworkMessage = await waitForMessage(harness, VIEWER_MESSAGE_TYPES.ARTWORK);
    harness.windowRef.dispatch('message', {
      source: harness.iframe.contentWindow,
      origin: 'null',
      data: envelope(VIEWER_MESSAGE_TYPES.ARTWORK_UPDATED, sessionId, { loadId: 'load-rte-1' }),
    });
    await expect(artworkPromise).resolves.toMatchObject({ loadId: 'load-rte-1' });
    expect(artworkMessage.message.payload.maps.alpha.byteLength).toBeGreaterThan(0);
  });

  it('rejects untrusted events, mismatched integrity and load IDs', async () => {
    const harness = createHarness();
    const errors = [];
    const host = createViewerHost({ ...harness, onError: (error) => errors.push(error) });
    host.start();
    harness.iframe.dispatch('load');
    const init = await waitForMessage(harness, VIEWER_MESSAGE_TYPES.INIT);
    const sessionId = init.message.payload.sessionId;

    harness.windowRef.dispatch('message', {
      source: {},
      origin: 'null',
      data: envelope(VIEWER_MESSAGE_TYPES.READY, sessionId, {}),
    });
    harness.windowRef.dispatch('message', {
      source: harness.iframe.contentWindow,
      origin: 'https://evil.test',
      data: envelope(VIEWER_MESSAGE_TYPES.READY, sessionId, {}),
    });
    expect(errors.map((error) => error.code)).toContain('viewer-origin-mismatch');

    harness.windowRef.dispatch('message', {
      source: harness.iframe.contentWindow,
      origin: 'null',
      data: envelope(VIEWER_MESSAGE_TYPES.READY, sessionId, {
        pluginId: 'carton-fold-viewer',
        pluginVersion: '2.4.0',
        contractVersion: VIEWER_PROTOCOL_VERSION,
        payloadLimits: init.message.payload.payloadLimits,
      }),
    });
    await host.waitForReady();

    await expect(host.load({
      semanticSvg: { text: '<svg/>', byteLength: 999 },
      artworkAtlas: { data: new Uint8Array([1]).buffer, mimeType: 'image/png' },
    })).rejects.toMatchObject({ code: 'viewer-byte-length-mismatch' });

    const loadPromise = host.load({
      semanticSvg: '<svg/>',
      artworkAtlas: { data: new Uint8Array([1]).buffer, mimeType: 'image/png' },
      loadId: 'load-good',
      exportGlb: false,
    });
    await waitForMessage(harness, VIEWER_MESSAGE_TYPES.LOAD);
    harness.windowRef.dispatch('message', {
      source: harness.iframe.contentWindow,
      origin: 'null',
      data: envelope(VIEWER_MESSAGE_TYPES.MODEL_LOADED, sessionId, {
        loadId: 'load-wrong', panelIds: [], animationNames: [],
      }),
    });
    expect(errors.map((error) => error.code)).toContain('viewer-load-id-mismatch');
    host.cancel();
    harness.windowRef.dispatch('message', {
      source: harness.iframe.contentWindow,
      origin: 'null',
      data: envelope(VIEWER_MESSAGE_TYPES.CANCELLED, sessionId, { reason: 'test' }),
    });
    await expect(loadPromise).rejects.toMatchObject({ code: 'viewer-cancelled' });
    expect(host.dispose()).toBe(true);
    expect(host.dispose()).toBe(false);
  });
});
