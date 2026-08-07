import { t } from '../i18n.js';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from './RenderSettings.js';
import { sanitizeBoardAppearance } from './BoardAppearance.js';

const SNAPSHOT_VERSION = 1;

export function createRenderSettingsSnapshot({ renderSettings, boardAppearance }) {
  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    renderSettings: sanitizeRenderSettings(renderSettings || DEFAULT_RENDER_SETTINGS),
    boardAppearance: sanitizeBoardAppearance(boardAppearance),
  }, null, 2);
}

export function parseRenderSettingsSnapshot(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error(t('invalidRenderSettingsJson') || 'Invalid JSON format.');
  }
  const source = parsed && typeof parsed === 'object' ? parsed : null;
  if (!source?.renderSettings || typeof source.renderSettings !== 'object') {
    throw new Error(t('noRenderSettingsFound') || 'No render settings found in file.');
  }
  return {
    renderSettings: sanitizeRenderSettings(source.renderSettings),
    boardAppearance: sanitizeBoardAppearance(source.boardAppearance),
  };
}
