import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createPresetPicker } from '../../src/ui/PresetPicker.js';

describe('PresetPicker', () => {
  let triggerButton;
  let popoverContainer;
  let model;
  let onApplyPreset;
  let onApplyTechnicalPreset;
  let showToast;
  let announce;
  let mockWindow;
  let mockDocument;
  let currentWorkflow;
  let currentTechnicalDoc;

  beforeEach(() => {
    currentWorkflow = 'quick';
    currentTechnicalDoc = null;
    const triggerListeners = {};
    const docListeners = {};
    const triggerAttrs = {};

    triggerButton = {
      listeners: triggerListeners,
      addEventListener: vi.fn((evt, fn) => {
        triggerListeners[evt] = triggerListeners[evt] || [];
        triggerListeners[evt].push(fn);
      }),
      setAttribute: vi.fn((k, v) => { triggerAttrs[k] = v; }),
      getAttribute: vi.fn((k) => triggerAttrs[k]),
      contains: vi.fn().mockReturnValue(false),
    };

    popoverContainer = {
      hidden: true,
      innerHTML: '',
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      contains: vi.fn().mockReturnValue(false),
    };

    model = {
      dimensions: { width: 150, height: 90, depth: 40 },
      toJSON: vi.fn().mockReturnValue({ width: 150, height: 90, depth: 40 }),
    };

    onApplyPreset = vi.fn();
    onApplyTechnicalPreset = vi.fn();
    showToast = vi.fn();
    announce = vi.fn();
    mockWindow = {
      prompt: vi.fn(),
      confirm: vi.fn().mockReturnValue(true),
    };
    mockDocument = {
      listeners: docListeners,
      addEventListener: vi.fn((evt, fn) => {
        docListeners[evt] = docListeners[evt] || [];
        docListeners[evt].push(fn);
      }),
      createElement: vi.fn().mockReturnValue({ href: '', click: vi.fn() }),
    };
  });

  it('renders quick presets by default in quick workflow', async () => {
    const picker = createPresetPicker({
      triggerButton,
      popoverContainer,
      model,
      getWorkflowMode: () => currentWorkflow,
      getCurrentTechnicalDocument: () => currentTechnicalDoc,
      onApplyPreset,
      onApplyTechnicalPreset,
      showToast,
      announce,
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    await picker.togglePopover(true);

    expect(popoverContainer.hidden).toBe(false);
    expect(popoverContainer.innerHTML).toContain('Presets Library');
    expect(popoverContainer.innerHTML).toContain('Standard Presets');
    expect(popoverContainer.innerHTML).toContain('preset-standard');
    expect(popoverContainer.innerHTML).toContain('preset-cube');
    // Must NOT contain technical presets
    expect(popoverContainer.innerHTML).not.toContain('preset-tech-rte');
    expect(popoverContainer.innerHTML).not.toContain('preset-tech-ste');
  });

  it('renders technical presets when workflow is technical', async () => {
    currentWorkflow = 'technical';
    currentTechnicalDoc = {
      dimensions: { width: 120.6, height: 161.1, depth: 60.6 },
      cartonType: 'RTE',
      getSourceIdentity: () => ({ cartonType: 'RTE' }),
      getBundle: () => ({ modelJson: { cartonType: 'RTE' } }),
    };

    const picker = createPresetPicker({
      triggerButton,
      popoverContainer,
      model,
      getWorkflowMode: () => currentWorkflow,
      getCurrentTechnicalDocument: () => currentTechnicalDoc,
      onApplyPreset,
      onApplyTechnicalPreset,
      showToast,
      announce,
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    await picker.togglePopover(true);

    expect(popoverContainer.hidden).toBe(false);
    expect(popoverContainer.innerHTML).toContain('Technical Dielines');
    expect(popoverContainer.innerHTML).toContain('Standard Technical Dielines');
    expect(popoverContainer.innerHTML).toContain('preset-tech-rte');
    expect(popoverContainer.innerHTML).toContain('preset-tech-ste');
    expect(popoverContainer.innerHTML).toContain('preset-tech-tt-sl123');
    // Must NOT contain quick presets
    expect(popoverContainer.innerHTML).not.toContain('preset-standard');
    expect(popoverContainer.innerHTML).not.toContain('preset-cube');
  });

  it('allows switching workflow mode via setWorkflowMode', async () => {
    const picker = createPresetPicker({
      triggerButton,
      popoverContainer,
      model,
      getWorkflowMode: () => currentWorkflow,
      getCurrentTechnicalDocument: () => currentTechnicalDoc,
      onApplyPreset,
      onApplyTechnicalPreset,
      showToast,
      announce,
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    await picker.togglePopover(true);
    expect(popoverContainer.innerHTML).toContain('Presets Library');

    currentWorkflow = 'technical';
    await picker.setWorkflowMode('technical');
    expect(popoverContainer.innerHTML).toContain('Technical Dielines');
  });

  it('closes cleanly when close() is called', () => {
    const picker = createPresetPicker({
      triggerButton,
      popoverContainer,
      model,
      getWorkflowMode: () => currentWorkflow,
      getCurrentTechnicalDocument: () => currentTechnicalDoc,
      onApplyPreset,
      onApplyTechnicalPreset,
      showToast,
      announce,
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    picker.togglePopover(true);
    expect(popoverContainer.hidden).toBe(false);

    picker.close();
    expect(popoverContainer.hidden).toBe(true);
  });

  it('calls onApplyPreset when a quick preset is applied', async () => {
    let clickHandler;
    popoverContainer.querySelectorAll = vi.fn((sel) => {
      if (sel === '[data-action="apply"]') {
        return [{
          dataset: { id: 'preset-standard' },
          addEventListener: (evt, fn) => { clickHandler = fn; },
        }];
      }
      return [];
    });

    const picker = createPresetPicker({
      triggerButton,
      popoverContainer,
      model,
      getWorkflowMode: () => 'quick',
      getCurrentTechnicalDocument: () => null,
      onApplyPreset,
      onApplyTechnicalPreset,
      showToast,
      announce,
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    await picker.togglePopover(true);
    expect(clickHandler).toBeDefined();

    clickHandler({ currentTarget: { dataset: { id: 'preset-standard' } } });
    expect(onApplyPreset).toHaveBeenCalledTimes(1);
    expect(onApplyPreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'preset-standard' }));
    expect(onApplyTechnicalPreset).not.toHaveBeenCalled();
    expect(popoverContainer.hidden).toBe(true);
  });

  it('calls onApplyTechnicalPreset when a technical preset is applied', async () => {
    let clickHandler;
    popoverContainer.querySelectorAll = vi.fn((sel) => {
      if (sel === '[data-action="apply"]') {
        return [{
          dataset: { id: 'preset-tech-rte' },
          addEventListener: (evt, fn) => { clickHandler = fn; },
        }];
      }
      return [];
    });

    const picker = createPresetPicker({
      triggerButton,
      popoverContainer,
      model,
      getWorkflowMode: () => 'technical',
      getCurrentTechnicalDocument: () => null,
      onApplyPreset,
      onApplyTechnicalPreset,
      showToast,
      announce,
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    await picker.togglePopover(true);
    expect(clickHandler).toBeDefined();

    clickHandler({ currentTarget: { dataset: { id: 'preset-tech-rte' } } });
    expect(onApplyTechnicalPreset).toHaveBeenCalledTimes(1);
    expect(onApplyTechnicalPreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'preset-tech-rte', cartonType: 'RTE' }));
    expect(onApplyPreset).not.toHaveBeenCalled();
    expect(popoverContainer.hidden).toBe(true);
  });
});
