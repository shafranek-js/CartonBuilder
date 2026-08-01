import { getDatabase, SCENE_PRESETS_STORE } from '../project/db.js';

const LOCAL_STORAGE_KEY = 'carton_builder_scene_presets';

let memoryPresets = [];

function loadLocalStoragePresets() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : memoryPresets;
    }
  } catch {
    // fallback
  }
  return memoryPresets;
}

function saveLocalStoragePresets(presets) {
  memoryPresets = presets;
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(presets));
    }
  } catch {
    // ignore
  }
}

export async function getUserScenePresets() {
  try {
    const database = await getDatabase();
    const presets = await database.getAll(SCENE_PRESETS_STORE);
    if (presets && presets.length > 0) {
      saveLocalStoragePresets(presets);
      return presets;
    }
  } catch {
    // fallback to localStorage
  }
  return loadLocalStoragePresets();
}

export async function saveScenePreset({ name, settings }) {
  const preset = {
    id: `scene-preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(name || '').trim() || 'Scene preset',
    settings: settings && typeof settings === 'object' ? { ...settings } : {},
    isBuiltIn: false,
    createdAt: new Date().toISOString(),
  };

  try {
    const database = await getDatabase();
    await database.put(SCENE_PRESETS_STORE, preset);
  } catch {
    // ignore DB error
  }

  const currentLocal = loadLocalStoragePresets();
  const updatedLocal = [preset, ...currentLocal.filter((p) => p.id !== preset.id)];
  saveLocalStoragePresets(updatedLocal);

  return preset;
}

export async function deleteScenePreset(presetId) {
  try {
    const database = await getDatabase();
    await database.delete(SCENE_PRESETS_STORE, presetId);
  } catch {
    // ignore
  }

  const currentLocal = loadLocalStoragePresets();
  const updatedLocal = currentLocal.filter((p) => p.id !== presetId);
  saveLocalStoragePresets(updatedLocal);
}
