import { describe, expect, it, beforeEach } from 'vitest';
import {
  getSectionKey,
  readSectionStates,
  saveSectionStates,
  initSectionStatePersistence,
} from '../../src/ui/SectionStateManager.js';

describe('SectionStateManager', () => {
  let mockStorage;
  let store;

  beforeEach(() => {
    store = {};
    mockStorage = {
      getItem: (key) => store[key] || null,
      setItem: (key, value) => { store[key] = String(value); },
      clear: () => { for (const k in store) delete store[k]; },
    };
  });

  it('reads empty state when storage is empty or invalid', () => {
    expect(readSectionStates(mockStorage)).toEqual({});
    store['cartonBuilder.ui.sections'] = 'invalid-json';
    expect(readSectionStates(mockStorage)).toEqual({});
  });

  it('saves and reads section states object', () => {
    saveSectionStates({ 'render:lighting': false, 'render:effects': true }, mockStorage);
    expect(readSectionStates(mockStorage)).toEqual({ 'render:lighting': false, 'render:effects': true });
  });

  it('derives section key from data-section-id or id or summary data-i18n', () => {
    const elWithData = { dataset: { sectionId: 'custom-key' } };
    expect(getSectionKey(elWithData)).toBe('custom-key');

    const elWithId = { id: 'renderDiagnosticsDrawer' };
    expect(getSectionKey(elWithId)).toBe('renderDiagnosticsDrawer');

    const mockSummary = { getAttribute: (attr) => attr === 'data-i18n' ? 'renderLighting' : null };
    const mockStep = { id: 'renderStep' };
    const elWithSummary = {
      querySelector: (selector) => selector === 'summary' ? mockSummary : null,
      closest: (selector) => selector === '.workflow-step' ? mockStep : null,
    };
    expect(getSectionKey(elWithSummary)).toBe('renderStep:renderLighting');
  });

  it('initializes persistence and applies saved open states', () => {
    store['cartonBuilder.ui.sections'] = JSON.stringify({
      'sec1': false,
      'sec2': true,
    });

    const listeners = {};
    const elements = [
      { id: 'sec1', open: true, tagName: 'DETAILS' },
      { id: 'sec2', open: false, tagName: 'DETAILS' },
    ];

    const mockDocument = {
      querySelectorAll: (sel) => sel === 'details' ? elements : [],
      addEventListener: (type, handler) => { listeners[type] = handler; },
      removeEventListener: (type, handler) => { if (listeners[type] === handler) delete listeners[type]; },
    };

    const manager = initSectionStatePersistence({
      documentRef: mockDocument,
      storage: mockStorage,
    });

    expect(elements[0].open).toBe(false);
    expect(elements[1].open).toBe(true);

    // Simulate toggle event
    elements[0].open = true;
    listeners['toggle']({ target: elements[0] });

    expect(readSectionStates(mockStorage)).toEqual({
      'sec1': true,
      'sec2': true,
    });

    manager.destroy();
    expect(listeners['toggle']).toBeUndefined();
  });
});
