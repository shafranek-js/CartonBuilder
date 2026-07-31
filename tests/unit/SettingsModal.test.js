import { describe, expect, it, beforeEach } from 'vitest';
import { getShowHistory, setShowHistory, applyHistoryVisibility } from '../../src/ui/SettingsModal.js';

describe('SettingsModal History Panel toggle', () => {
  let mockStorage;
  let mockWindow;
  let mockDocument;
  let historySection;

  beforeEach(() => {
    mockStorage = new Map();
    mockWindow = {
      localStorage: {
        getItem: (key) => mockStorage.get(key) || null,
        setItem: (key, value) => mockStorage.set(key, String(value)),
      },
    };
    historySection = { hidden: true };
    mockDocument = {
      getElementById: (id) => (id === 'historySection' ? historySection : null),
    };
  });

  it('defaults to hidden History panel (false)', () => {
    expect(getShowHistory(mockWindow)).toBe(false);
    applyHistoryVisibility(mockDocument, mockWindow);
    expect(historySection.hidden).toBe(true);
  });

  it('persists and applies History panel visibility when enabled', () => {
    setShowHistory(true, mockWindow, mockDocument);

    expect(getShowHistory(mockWindow)).toBe(true);
    expect(historySection.hidden).toBe(false);
  });

  it('persists and hides History panel when disabled', () => {
    setShowHistory(true, mockWindow, mockDocument);
    expect(historySection.hidden).toBe(false);

    setShowHistory(false, mockWindow, mockDocument);
    expect(getShowHistory(mockWindow)).toBe(false);
    expect(historySection.hidden).toBe(true);
  });
});
