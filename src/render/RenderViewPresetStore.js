import { getDatabase, RENDER_VIEW_PRESETS_STORE } from '../project/db.js';
import { normalizeCameraPresetState } from './cameraState.js';

const LOCAL_STORAGE_KEY = 'carton_builder_render_view_presets';
const ACTIVE_KEY = 'carton_builder_active_render_view_preset';
let memoryPresets = [];
let lastDeletedPreset = null;

function clone(value) {
  return structuredClone(value);
}

function normalizeName(value) {
  const name = String(value || '').trim().slice(0, 64);
  if (!name) throw new Error('View preset name is required.');
  return name;
}

export function normalizeRenderViewPreset(preset = {}) {
  return {
    id: String(preset.id || `view-preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    name: normalizeName(preset.name || 'View preset'),
    version: 1,
    scope: 'global',
    camera: normalizeCameraPresetState(preset.camera || preset.cameraState || {}),
    thumbnailId: typeof preset.thumbnailId === 'string' ? preset.thumbnailId : '',
    createdAt: preset.createdAt || new Date().toISOString(),
    updatedAt: preset.updatedAt || preset.createdAt || new Date().toISOString(),
  };
}

function readFallback() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCAL_STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.map(normalizeRenderViewPreset);
  } catch {
    // IndexedDB/memory is the fallback.
  }
  return memoryPresets.map(normalizeRenderViewPreset);
}

function writeFallback(presets) {
  memoryPresets = presets.map(normalizeRenderViewPreset);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(memoryPresets));
  } catch {
    // Optional persistence.
  }
}

function assertUniqueName(name, presets, ignoreId = '') {
  const normalized = name.trim().toLocaleLowerCase();
  if (presets.some((entry) => entry.id !== ignoreId && entry.name.toLocaleLowerCase() === normalized)) {
    throw new Error('A view preset with this name already exists.');
  }
}

export function suggestViewPresetName(name, presets = []) {
  const base = String(name || 'View preset').trim().slice(0, 58) || 'View preset';
  let candidate = base;
  let index = 2;
  while (presets.some((entry) => entry.name.toLocaleLowerCase() === candidate.toLocaleLowerCase())) {
    candidate = `${base} (${index})`;
    index += 1;
  }
  return candidate;
}

export async function getRenderViewPresets() {
  try {
    const database = await getDatabase();
    const presets = await database.getAll(RENDER_VIEW_PRESETS_STORE);
    if (presets?.length) {
      writeFallback(presets);
      return presets.map(normalizeRenderViewPreset);
    }
  } catch {
    // Fallback below.
  }
  return readFallback();
}

export async function saveRenderViewPreset({ id = '', name, camera, thumbnailId = '' } = {}) {
  const current = await getRenderViewPresets();
  const normalizedName = normalizeName(name);
  assertUniqueName(normalizedName, current, id);
  const existing = current.find((entry) => entry.id === id);
  const preset = normalizeRenderViewPreset({
    ...existing,
    id: id || undefined,
    name: normalizedName,
    camera,
    thumbnailId,
    createdAt: existing?.createdAt,
    updatedAt: new Date().toISOString(),
  });
  try {
    const database = await getDatabase();
    await database.put(RENDER_VIEW_PRESETS_STORE, preset);
  } catch {
    // Fallback remains authoritative for this session.
  }
  writeFallback([preset, ...current.filter((entry) => entry.id !== preset.id)]);
  setActiveRenderViewPresetId(preset.id);
  return clone(preset);
}

export async function duplicateRenderViewPreset(id, name = '') {
  const current = await getRenderViewPresets();
  const source = current.find((entry) => entry.id === id);
  if (!source) return null;
  return saveRenderViewPreset({ name: suggestViewPresetName(name || source.name, current), camera: source.camera });
}

export async function renameRenderViewPreset(id, name) {
  const current = await getRenderViewPresets();
  const source = current.find((entry) => entry.id === id);
  if (!source) return null;
  return saveRenderViewPreset({ id, name, camera: source.camera, thumbnailId: source.thumbnailId });
}

export async function deleteRenderViewPreset(id) {
  const current = await getRenderViewPresets();
  const source = current.find((entry) => entry.id === id);
  if (!source) return null;
  lastDeletedPreset = clone(source);
  try {
    const database = await getDatabase();
    await database.delete(RENDER_VIEW_PRESETS_STORE, id);
  } catch {
    // Fallback below.
  }
  writeFallback(current.filter((entry) => entry.id !== id));
  if (getActiveRenderViewPresetId() === id) setActiveRenderViewPresetId('');
  return clone(source);
}

export async function undoDeleteRenderViewPreset() {
  if (!lastDeletedPreset) return null;
  const restored = lastDeletedPreset;
  lastDeletedPreset = null;
  try {
    const database = await getDatabase();
    await database.put(RENDER_VIEW_PRESETS_STORE, restored);
  } catch {
    // Fallback below.
  }
  const current = await getRenderViewPresets();
  writeFallback([restored, ...current.filter((entry) => entry.id !== restored.id)]);
  setActiveRenderViewPresetId(restored.id);
  return clone(restored);
}

export function getActiveRenderViewPresetId() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_KEY) || '' : '';
  } catch {
    return '';
  }
}

export function setActiveRenderViewPresetId(id) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (id) localStorage.setItem(ACTIVE_KEY, String(id));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Optional persistence.
  }
}
