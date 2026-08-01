import { describe, expect, it, vi } from 'vitest';

import { RenderQualityManager } from '../../src/render/RenderQualityManager.js';

describe('RenderQualityManager', () => {
  it('moves from interactive to settled after the inactivity delay', () => {
    vi.useFakeTimers();
    const onStateChange = vi.fn();
    const manager = new RenderQualityManager({ windowRef: globalThis, onStateChange });
    manager.markInteraction();
    expect(manager.getDiagnostics().state).toBe('interactive');
    vi.advanceTimersByTime(300);
    expect(manager.getDiagnostics().state).toBe('settled');
    expect(onStateChange).toHaveBeenCalledWith('settled');
    manager.dispose();
    vi.useRealTimers();
  });

  it('isolates export state from adaptive frame scaling', () => {
    const manager = new RenderQualityManager({ windowRef: globalThis });
    manager.beginExport();
    for (let index = 0; index < 20; index += 1) manager.recordFrame(200);
    expect(manager.getDiagnostics().state).toBe('export');
    expect(manager.getDiagnostics().renderScale).toBe(1);
    manager.endExport('settled');
    expect(manager.getDiagnostics().state).toBe('settled');
  });
});
