import { describe, expect, it, vi } from 'vitest';
import { createPbdHost } from '../../../src/host/pbdHostProtocol.js';

function createHarness() {
  const listeners = new Map();
  const frameListeners = new Map();
  const outbound = [];
  const frameWindow = {
    postMessage(message) {
      outbound.push(message);
    },
  };
  const iframe = {
    contentWindow: frameWindow,
    dataset: { src: './plugins/packaging-box-designer/1.2.0/index.html' },
    src: '',
    addEventListener(type, listener) { frameListeners.set(type, listener); },
    removeEventListener(type) { frameListeners.delete(type); },
  };
  const windowRef = {
    location: { origin: 'http://127.0.0.1:5173' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    setTimeout,
  };
  return {
    iframe,
    windowRef,
    outbound,
    dispatch(message, origin = 'null') {
      listeners.get('message')?.({ source: frameWindow, origin, data: message });
    },
    load() { frameListeners.get('load')?.(); },
  };
}

describe('PBD host protocol', () => {
  it('requires the plugin source and session before accepting a bundle', async () => {
    const harness = createHarness();
    const onReady = vi.fn();
    const onValidation = vi.fn();
    const host = createPbdHost({ iframe: harness.iframe, windowRef: harness.windowRef, onReady, onValidation });

    host.start();
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });
    expect(onReady).toHaveBeenCalledTimes(1);
    const init = harness.outbound.find((message) => message.type === 'host:init');
    expect(init?.payload.allowedOrigin).toBe('http://127.0.0.1:5173');
    expect(init?.payload.capabilities).toEqual(expect.objectContaining({ technicalRender: false }));

    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', sessionId: init.sessionId, payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });
    expect(host.getState().initialized).toBe(true);

    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'pbd:validation-state', sessionId: 'wrong', payload: { structural: 'VALID' } });
    expect(onValidation).not.toHaveBeenCalled();

    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'pbd:validation-state', sessionId: init.sessionId, payload: { structural: 'VALID', geometry: 'VALID', contract: 'VALID' } });
    expect(onValidation).toHaveBeenCalledWith(expect.objectContaining({ contract: 'VALID' }));
  });

  it('resolves a request only for the matching session and source', async () => {
    const harness = createHarness();
    const host = createPbdHost({ iframe: harness.iframe, windowRef: harness.windowRef });
    host.start();
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });
    const init = harness.outbound.find((message) => message.type === 'host:init');
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', sessionId: init.sessionId, payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });

    const pending = host.requestCarton();
    const request = harness.outbound.find((message) => message.type === 'host:request-carton');
    expect(request.sessionId).toBe(init.sessionId);

    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'pbd:carton-ready', sessionId: 'wrong', payload: { bundle: { invalid: true } } });
    let settled = false;
    pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    const bundle = { contractVersion: 'carton-workflow.v1', workflowMode: 'technical' };
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'pbd:carton-ready', sessionId: init.sessionId, payload: { bundle } });
    await expect(pending).resolves.toEqual(bundle);
  });

  it('rejects messages from an unexpected opaque-frame origin', () => {
    const harness = createHarness();
    const onError = vi.fn();
    const host = createPbdHost({ iframe: harness.iframe, windowRef: harness.windowRef, onError });
    host.start();
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } }, 'https://evil.example');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'PBD_PLUGIN_ORIGIN_MISMATCH' }));
    expect(harness.outbound).toHaveLength(0);
  });

  it('loads a saved technical bundle and requires matching rebuilt hashes', async () => {
    const harness = createHarness();
    const host = createPbdHost({ iframe: harness.iframe, windowRef: harness.windowRef });
    host.start();
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });
    const init = harness.outbound.find((message) => message.type === 'host:init');
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', sessionId: init.sessionId, payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });

    const bundle = {
      modelJson: { sha256: 'model-hash' },
      semanticSvg: { sha256: 'svg-hash' },
    };
    const pending = host.loadCarton(bundle);
    await Promise.resolve();
    const request = harness.outbound.find((message) => message.type === 'host:load-carton');
    expect(request.sessionId).toBe(init.sessionId);
    expect(request.payload.bundle).toEqual(bundle);

    const rebuilt = { modelJson: { sha256: 'model-hash' }, semanticSvg: { sha256: 'svg-hash' }, workflowMode: 'technical' };
    harness.dispatch({
      protocolVersion: 'carton-host.v1',
      type: 'pbd:carton-loaded',
      sessionId: init.sessionId,
      payload: { bundle: rebuilt, modelSha256: 'model-hash', svgSha256: 'svg-hash' },
    });
    await expect(pending).resolves.toEqual(rebuilt);
    expect(host.getState().restoreState).toBe('loaded');
  });

  it('rejects a failed restore and does not accept a stale-session acknowledgement', async () => {
    const harness = createHarness();
    const onError = vi.fn();
    const host = createPbdHost({ iframe: harness.iframe, windowRef: harness.windowRef, onError });
    host.start();
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });
    const init = harness.outbound.find((message) => message.type === 'host:init');
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', sessionId: init.sessionId, payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });
    const pending = host.loadCarton({ modelJson: { sha256: 'm' }, semanticSvg: { sha256: 's' } });
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'pbd:carton-load-failed', sessionId: 'stale-session', payload: { error: { code: 'PBD_CARTON_RESTORE_FAILED', message: 'failed' } } });
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'pbd:carton-load-failed', sessionId: init.sessionId, payload: { error: { code: 'PBD_CARTON_RESTORE_FAILED', message: 'failed' } } });
    await expect(pending).rejects.toMatchObject({ code: 'PBD_CARTON_RESTORE_FAILED' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'PBD_CARTON_RESTORE_FAILED' }));
  });

  it('survives iframe load ordering and starts a fresh session after document reload', () => {
    const harness = createHarness();
    const host = createPbdHost({ iframe: harness.iframe, windowRef: harness.windowRef });
    host.start();
    harness.load();
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });
    const firstInit = harness.outbound.find((message) => message.type === 'host:init');
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', sessionId: firstInit.sessionId, payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });
    expect(host.getState().initialized).toBe(true);

    // The load event can follow DOMContentLoaded/bootstrap ready.
    harness.load();
    expect(host.getState().initialized).toBe(true);

    // A new document sends a bootstrap ready without the old session.
    harness.dispatch({ protocolVersion: 'carton-host.v1', type: 'plugin:ready', payload: { pluginId: 'packaging-box-designer', pluginVersion: '1.2.0' } });
    const initMessages = harness.outbound.filter((message) => message.type === 'host:init');
    expect(initMessages).toHaveLength(2);
    expect(initMessages[1].sessionId).not.toBe(firstInit.sessionId);
    expect(host.getState().initialized).toBe(false);
  });
});
