export const COLOR_THEMES = Object.freeze([
  {
    id: 'dark-studio',
    nameEn: 'Dark Studio (Classic)',
    nameRu: 'Dark Studio (Классика)',
    colors: {
      bodyBg: '#343434',
      appBg: '#535353',
      stepperBg: '#494949',
      stepperBorder: '#414141',
      textColor: '#ffffff',
      mutedText: '#c8c8c8',
      panelBg: '#3e3e3e',
      panelBorder: '#5a5a5a',
      accent: '#afca42',
      accentHover: '#bfd956',
      accentText: '#1d2500',
      focus: '#d8ef79',
      front: '#b7dcef',
      base: '#efa6ec',
      panel: '#ffffff',
      line: '#101010',
      frameBorder: '#70817c',
    },
  },
  {
    id: 'midnight-oled',
    nameEn: 'Midnight OLED',
    nameRu: 'Midnight OLED',
    colors: {
      bodyBg: '#0f1115',
      appBg: '#181b20',
      stepperBg: '#121418',
      stepperBorder: '#262a33',
      textColor: '#f1f5f9',
      mutedText: '#94a3b8',
      panelBg: '#21252d',
      panelBorder: '#333946',
      accent: '#00f0ff',
      accentHover: '#33f3ff',
      accentText: '#00252e',
      focus: '#80f8ff',
      front: '#1e3a8a',
      base: '#831843',
      panel: '#2a2e39',
      line: '#00f0ff',
      frameBorder: '#3b4252',
    },
  },
  {
    id: 'nordic-frost',
    nameEn: 'Nordic Frost',
    nameRu: 'Nordic Frost',
    colors: {
      bodyBg: '#242933',
      appBg: '#2e3440',
      stepperBg: '#272c36',
      stepperBorder: '#3b4252',
      textColor: '#eceff4',
      mutedText: '#d8dee9',
      panelBg: '#3b4252',
      panelBorder: '#4c566a',
      accent: '#88c0d0',
      accentHover: '#8fbcbb',
      accentText: '#1d2d35',
      focus: '#a3be8c',
      front: '#5e81ac',
      base: '#b48ead',
      panel: '#d8dee9',
      line: '#2e3440',
      frameBorder: '#434c5e',
    },
  },
  {
    id: 'cyberpunk-neon',
    nameEn: 'Cyberpunk Neon',
    nameRu: 'Cyberpunk Neon',
    colors: {
      bodyBg: '#0d0a17',
      appBg: '#161224',
      stepperBg: '#120e1e',
      stepperBorder: '#2a2142',
      textColor: '#f8f9fa',
      mutedText: '#b8b5c9',
      panelBg: '#211a33',
      panelBorder: '#3d305c',
      accent: '#ffe600',
      accentHover: '#fff066',
      accentText: '#1a1600',
      focus: '#ffff80',
      front: '#00f5d4',
      base: '#ff007f',
      panel: '#ffffff',
      line: '#ff0055',
      frameBorder: '#543d80',
    },
  },
  {
    id: 'clean-light',
    nameEn: 'Clean Light',
    nameRu: 'Clean Light',
    colors: {
      bodyBg: '#e5e7eb',
      appBg: '#f3f4f6',
      stepperBg: '#ffffff',
      stepperBorder: '#e5e7eb',
      textColor: '#111827',
      mutedText: '#4b5563',
      panelBg: '#ffffff',
      panelBorder: '#d1d5db',
      accent: '#10b981',
      accentHover: '#059669',
      accentText: '#ffffff',
      focus: '#34d399',
      front: '#93c5fd',
      base: '#f472b6',
      panel: '#ffffff',
      line: '#111827',
      frameBorder: '#cbd5e1',
    },
  },
]);

const THEME_STORAGE_KEY = 'carton-builder-theme';

export function getSavedTheme(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try {
    return (storage && storage.getItem(THEME_STORAGE_KEY)) || 'dark-studio';
  } catch {
    return 'dark-studio';
  }
}

export function applyTheme(
  themeId,
  documentRef = typeof document !== 'undefined' ? document : null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
) {
  const theme = COLOR_THEMES.find((t) => t.id === themeId) || COLOR_THEMES[0];
  if (documentRef && documentRef.documentElement) {
    const root = documentRef.documentElement;
    if (documentRef.body) {
      documentRef.body.setAttribute('data-theme', theme.id);
    }
    if (root.style && typeof root.style.setProperty === 'function') {
      root.style.setProperty('--body-bg', theme.colors.bodyBg);
      root.style.setProperty('--surface', theme.colors.appBg);
      root.style.setProperty('--stepper-bg', theme.colors.stepperBg);
      root.style.setProperty('--stepper-border', theme.colors.stepperBorder);
      root.style.setProperty('--text', theme.colors.textColor);
      root.style.setProperty('--muted-text', theme.colors.mutedText);
      root.style.setProperty('--panel-bg', theme.colors.panelBg);
      root.style.setProperty('--panel-border', theme.colors.panelBorder);
      root.style.setProperty('--accent', theme.colors.accent);
      root.style.setProperty('--accent-hover', theme.colors.accentHover);
      root.style.setProperty('--accent-text', theme.colors.accentText);
      root.style.setProperty('--focus', theme.colors.focus);
      root.style.setProperty('--front', theme.colors.front);
      root.style.setProperty('--base', theme.colors.base);
      root.style.setProperty('--panel', theme.colors.panel);
      root.style.setProperty('--line', theme.colors.line);
      root.style.setProperty('--frame-border', theme.colors.frameBorder);
    }
  }

  try {
    if (storage) storage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // fallback
  }

  return theme;
}
