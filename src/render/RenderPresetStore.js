import { getDatabase, RENDER_PRESETS_STORE } from '../project/db.js';
import { cloneBoardAppearance, sanitizeBoardAppearance } from './BoardAppearance.js';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from './RenderSettings.js';

const LOCAL_STORAGE_KEY = 'carton_builder_render_presets';
const ACTIVE_PRESET_KEY = 'carton_builder_active_render_preset';

let memoryPresets = [];

function clone(value) {
  return structuredClone(value);
}

function normalizePreset(preset) {
  return {
    id: String(preset?.id || ''),
    name: String(preset?.name || 'Render preset').trim() || 'Render preset',
    version: 1,
    renderSettings: sanitizeRenderSettings(preset?.renderSettings || DEFAULT_RENDER_SETTINGS),
    boardAppearance: cloneBoardAppearance(preset?.boardAppearance),
    createdAt: preset?.createdAt || new Date().toISOString(),
  };
}

function loadLocalStoragePresets() {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(LOCAL_STORAGE_KEY)
      : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(normalizePreset);
    }
  } catch {
    // Fall back to the in-memory store.
  }
  return memoryPresets.map(normalizePreset);
}

function saveLocalStoragePresets(presets) {
  memoryPresets = presets.map(normalizePreset);
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(memoryPresets));
    }
  } catch {
    // Local storage is optional; memory remains the fallback.
  }
}

export async function getRenderPresets() {
  try {
    const database = await getDatabase();
    const presets = await database.getAll(RENDER_PRESETS_STORE);
    if (presets?.length) {
      saveLocalStoragePresets(presets);
      return presets.map(normalizePreset);
    }
  } catch {
    // Fall back to localStorage.
  }
  return loadLocalStoragePresets();
}

export async function saveRenderPreset({ name, renderSettings, boardAppearance }) {
  const preset = normalizePreset({
    id: `render-preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    renderSettings,
    boardAppearance: sanitizeBoardAppearance(boardAppearance),
    createdAt: new Date().toISOString(),
  });

  try {
    const database = await getDatabase();
    await database.put(RENDER_PRESETS_STORE, preset);
  } catch {
    // localStorage fallback below remains authoritative for this session.
  }

  const current = loadLocalStoragePresets();
  saveLocalStoragePresets([preset, ...current.filter((entry) => entry.id !== preset.id)]);
  setActiveRenderPresetId(preset.id);
  return clone(preset);
}

export async function deleteRenderPreset(presetId) {
  try {
    const database = await getDatabase();
    await database.delete(RENDER_PRESETS_STORE, presetId);
  } catch {
    // localStorage cleanup below remains best effort.
  }

  saveLocalStoragePresets(loadLocalStoragePresets().filter((entry) => entry.id !== presetId));
  if (getActiveRenderPresetId() === presetId) setActiveRenderPresetId('');
}

export function getActiveRenderPresetId() {
  try {
    return typeof localStorage !== 'undefined' && localStorage
      ? localStorage.getItem(ACTIVE_PRESET_KEY) || ''
      : '';
  } catch {
    return '';
  }
}

export function setActiveRenderPresetId(id) {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    if (id) localStorage.setItem(ACTIVE_PRESET_KEY, String(id));
    else localStorage.removeItem(ACTIVE_PRESET_KEY);
  } catch {
    // optional persistence
  }
}
