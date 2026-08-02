import {
  DEFAULT_RENDER_SETTINGS,
  sanitizeRenderSettings,
} from './RenderSettings.js';
import {
  DEFAULT_BOARD_APPEARANCE,
  sanitizeBoardAppearance,
} from './BoardAppearance.js';

export const RENDER_SETTINGS_STORAGE_KEY = 'cartonBuilder.renderSettings.v1';

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readRenderSettings(storage) {
  const resolvedStorage = resolveStorage(storage);
  try {
    const raw = resolvedStorage?.getItem?.(RENDER_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      renderSettings: sanitizeRenderSettings(parsed.renderSettings || parsed.settings || parsed),
      boardAppearance: sanitizeBoardAppearance(parsed.boardAppearance || DEFAULT_BOARD_APPEARANCE),
    };
  } catch {
    // Malformed or unavailable browser storage should never block the app.
    return null;
  }
}

export function writeRenderSettings(
  { renderSettings = DEFAULT_RENDER_SETTINGS, boardAppearance = DEFAULT_BOARD_APPEARANCE } = {},
  storage,
) {
  const resolvedStorage = resolveStorage(storage);
  try {
    resolvedStorage?.setItem?.(RENDER_SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      renderSettings: sanitizeRenderSettings(renderSettings),
      boardAppearance: sanitizeBoardAppearance(boardAppearance),
    }));
    return true;
  } catch {
    // Settings remain available for the current session when storage is restricted.
    return false;
  }
}

export function clearRenderSettings(storage) {
  const resolvedStorage = resolveStorage(storage);
  try {
    resolvedStorage?.removeItem?.(RENDER_SETTINGS_STORAGE_KEY);
  } catch {
    // Ignore unavailable browser storage.
  }
}
