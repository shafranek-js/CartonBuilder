import { getDatabase, RENDER_PRESETS_STORE } from '../project/db.js';
import { cloneBoardAppearance, sanitizeBoardAppearance } from './BoardAppearance.js';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from './RenderSettings.js';

const LOCAL_STORAGE_KEY = 'carton_builder_render_presets';
const ACTIVE_PRESET_KEY = 'carton_builder_active_render_preset';

let memoryPresets = [];
let lastDeletedPreset = null;

function clone(value) {
  return structuredClone(value);
}

function normalizePreset(preset) {
  return {
    id: String(preset?.id || ''),
    name: String(preset?.name || 'Render preset').trim() || 'Render preset',
    version: 3,
    scope: 'render',
    builtIn: preset?.builtIn === true,
    thumbnailId: typeof preset?.thumbnailId === 'string' ? preset.thumbnailId : '',
    modifiedFromId: typeof preset?.modifiedFromId === 'string' ? preset.modifiedFromId : '',
    renderSettings: sanitizeRenderSettings(preset?.renderSettings || DEFAULT_RENDER_SETTINGS),
    boardAppearance: cloneBoardAppearance(preset?.boardAppearance),
    createdAt: preset?.createdAt || new Date().toISOString(),
    updatedAt: preset?.updatedAt || preset?.createdAt || new Date().toISOString(),
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

export async function saveRenderPreset({ id = '', name, renderSettings, boardAppearance, thumbnailId = '', modifiedFromId = '' }) {
  const current = await getRenderPresets();
  const normalizedName = String(name || '').trim().slice(0, 64) || 'Render preset';
  const duplicate = current.some((entry) => entry.id !== id && entry.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
  if (duplicate) throw new Error('A render preset with this name already exists.');
  const existing = current.find((entry) => entry.id === id);
  const preset = normalizePreset({
    ...existing,
    id: id || `render-preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: normalizedName,
    renderSettings,
    boardAppearance: sanitizeBoardAppearance(boardAppearance),
    thumbnailId,
    modifiedFromId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  try {
    const database = await getDatabase();
    await database.put(RENDER_PRESETS_STORE, preset);
  } catch {
    // localStorage fallback below remains authoritative for this session.
  }

  const storedCurrent = loadLocalStoragePresets();
  saveLocalStoragePresets([preset, ...storedCurrent.filter((entry) => entry.id !== preset.id)]);
  setActiveRenderPresetId(preset.id);
  return clone(preset);
}

export async function renameRenderPreset(id, name) {
  const current = await getRenderPresets();
  const existing = current.find((entry) => entry.id === id);
  if (!existing) return null;
  return saveRenderPreset({ id, name, renderSettings: existing.renderSettings, boardAppearance: existing.boardAppearance, thumbnailId: existing.thumbnailId, modifiedFromId: existing.modifiedFromId });
}

export async function duplicateRenderPreset(id, name = '') {
  const current = await getRenderPresets();
  const existing = current.find((entry) => entry.id === id);
  if (!existing) return null;
  const baseName = String(name || existing.name).trim().slice(0, 58) || 'Render preset';
  let candidate = `${baseName} (2)`;
  let index = 3;
  while (current.some((entry) => entry.name.toLocaleLowerCase() === candidate.toLocaleLowerCase())) {
    candidate = `${baseName} (${index})`;
    index += 1;
  }
  return saveRenderPreset({ name: candidate, renderSettings: existing.renderSettings, boardAppearance: existing.boardAppearance, modifiedFromId: existing.id });
}

export async function deleteRenderPreset(presetId) {
  const current = await getRenderPresets();
  lastDeletedPreset = current.find((entry) => entry.id === presetId) || null;
  try {
    const database = await getDatabase();
    await database.delete(RENDER_PRESETS_STORE, presetId);
  } catch {
    // localStorage cleanup below remains best effort.
  }

  saveLocalStoragePresets(loadLocalStoragePresets().filter((entry) => entry.id !== presetId));
  if (getActiveRenderPresetId() === presetId) setActiveRenderPresetId('');
}

export async function undoDeleteRenderPreset() {
  if (!lastDeletedPreset) return null;
  const preset = lastDeletedPreset;
  lastDeletedPreset = null;
  try {
    const database = await getDatabase();
    await database.put(RENDER_PRESETS_STORE, preset);
  } catch {
    // Fallback below.
  }
  saveLocalStoragePresets([preset, ...loadLocalStoragePresets().filter((entry) => entry.id !== preset.id)]);
  setActiveRenderPresetId(preset.id);
  return clone(preset);
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
