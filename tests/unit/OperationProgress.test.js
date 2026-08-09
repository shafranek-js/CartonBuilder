import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOperationProgress } from '../../src/ui/OperationProgress.js';

function node() {
  const attributes = new Map();
  const listeners = new Map();
  return {
    hidden: true,
    textContent: '',
    value: 0,
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); },
    addEventListener(name, listener) { listeners.set(name, listener); },
    click() { listeners.get('click')?.(); },
  };
}

function setup() {
  const root = node();
  const label = node();
  const detail = node();
  const progress = node();
  const cancelButton = node();
  const announcer = node();
  const busyChanges = [];
  const toast = vi.fn();
  const controller = createOperationProgress({
    root,
    label,
    detail,
    progress,
    cancelButton,
    announcer,
    translate: (key) => key,
    showToast: toast,
    onBusyChange: (busy, meta) => busyChanges.push({ busy, meta }),
    windowRef: {
      setTimeout,
      clearTimeout,
    },
  });
  return { root, label, detail, progress, cancelButton, announcer, busyChanges, toast, controller };
}

describe('OperationProgress', () => {
  beforeEach(() => vi.useFakeTimers());

  it('delays the panel, reports determinate progress monotonically, and suppresses duplicates', async () => {
    const ui = setup();
    let resolveWork;
    const work = new Promise((resolve) => { resolveWork = resolve; });
    const first = ui.controller.run({
      id: 'save',
      labelKey: 'projectSaving',
      cancellable: true,
      work: async ({ report }) => {
        report({ stageKey: 'projectPacking', fraction: 0.4 });
        report({ stageKey: 'projectPacking', fraction: 0.2 });
        return work;
      },
    });

    expect(ui.busyChanges[0].busy).toBe(true);
    expect(ui.root.hidden).toBe(true);
    expect((await ui.controller.run({ id: 'other', labelKey: 'projectOpening', work: async () => true })).status).toBe('busy');
    expect(ui.toast).toHaveBeenCalledWith('operationInProgress');
    vi.advanceTimersByTime(199);
    expect(ui.root.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ui.root.hidden).toBe(false);
    expect(ui.progress.value).toBe(40);
    resolveWork(true);
    await first;
    vi.runAllTimers();
    expect(ui.root.hidden).toBe(true);
    expect(ui.busyChanges.at(-1).busy).toBe(false);
  });

  it('aborts cancellable work and uses indeterminate progress when no fraction is known', async () => {
    const ui = setup();
    const cancelled = ui.controller.run({
      id: 'open',
      labelKey: 'projectOpening',
      cancellable: true,
      work: ({ signal, report }) => new Promise((resolve, reject) => {
        report({ stageKey: 'projectReading' });
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    });
    vi.advanceTimersByTime(200);
    expect(ui.progress.classList.contains('is-indeterminate')).toBe(true);
    ui.cancelButton.click();
    expect((await cancelled).status).toBe('cancelled');
  });
});
