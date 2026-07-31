import { describe, expect, it, beforeEach } from 'vitest';
import { COLOR_THEMES, applyTheme, getSavedTheme } from '../../src/ui/ThemeManager.js';

describe('ThemeManager', () => {
  let mockStorage;
  let mockDocument;
  let styleStore;
  let bodyAttrs;

  beforeEach(() => {
    const store = {};
    mockStorage = {
      getItem: (key) => store[key] || null,
      setItem: (key, value) => { store[key] = String(value); },
      clear: () => { for (const k in store) delete store[k]; },
    };

    styleStore = {};
    bodyAttrs = {};
    mockDocument = {
      documentElement: {
        style: {
          setProperty: (key, value) => { styleStore[key] = value; },
          getPropertyValue: (key) => styleStore[key] || '',
        },
      },
      body: {
        setAttribute: (key, value) => { bodyAttrs[key] = value; },
        getAttribute: (key) => bodyAttrs[key] || null,
      },
    };
  });

  it('contains 5 curated modern color themes', () => {
    expect(COLOR_THEMES.length).toBe(5);
    const themeIds = COLOR_THEMES.map((t) => t.id);
    expect(themeIds).toEqual([
      'dark-studio',
      'midnight-oled',
      'nordic-frost',
      'cyberpunk-neon',
      'clean-light',
    ]);
  });

  it('returns default dark-studio theme when nothing is saved in storage', () => {
    expect(getSavedTheme(mockStorage)).toBe('dark-studio');
  });

  it('applies theme variables to document root and body data-theme attribute', () => {
    const applied = applyTheme('midnight-oled', mockDocument, mockStorage);
    expect(applied.id).toBe('midnight-oled');
    expect(mockDocument.body.getAttribute('data-theme')).toBe('midnight-oled');
    expect(mockDocument.documentElement.style.getPropertyValue('--accent')).toBe('#00f0ff');
    expect(getSavedTheme(mockStorage)).toBe('midnight-oled');
  });

  it('falls back to default theme if invalid theme id is provided', () => {
    const applied = applyTheme('non-existent-theme', mockDocument, mockStorage);
    expect(applied.id).toBe('dark-studio');
    expect(mockDocument.body.getAttribute('data-theme')).toBe('dark-studio');
  });
});
