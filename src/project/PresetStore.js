import { getDatabase, PRESETS_STORE } from './db.js';
import { normalizeQuickBoxState } from '../model/quickCustomNet.js';

const LOCAL_STORAGE_KEY = 'carton_builder_user_presets';

export const BUILT_IN_PRESETS = Object.freeze([
  {
    id: 'preset-standard',
    name: 'Standard Box',
    dimensions: { width: 150, height: 90, depth: 40 },
    isBuiltIn: true,
  },
  {
    id: 'preset-cube',
    name: 'Cube Box',
    dimensions: { width: 100, height: 100, depth: 100 },
    isBuiltIn: true,
  },
  {
    id: 'preset-tuck',
    name: 'Small Box',
    dimensions: { width: 80, height: 50, depth: 25 },
    isBuiltIn: true,
  },
  {
    id: 'preset-shipping',
    name: 'Medium Shipping Box',
    dimensions: { width: 250, height: 160, depth: 90 },
    isBuiltIn: true,
  },
  {
    id: 'preset-flat',
    name: 'Flat Gift Box',
    dimensions: { width: 200, height: 200, depth: 50 },
    isBuiltIn: true,
  },
]);

async function getPresetDatabase() {
  return getDatabase();
}

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

function normalizePreset(preset) {
  const netState = preset?.netState
    ? normalizeQuickBoxState(preset.netState).box
    : null;
  return {
    ...preset,
    netState,
    construction: netState?.construction || null,
  };
}

function normalizePresetList(presets) {
  return (Array.isArray(presets) ? presets : []).map(normalizePreset);
}

export async function getUserPresets() {
  try {
    const database = await getPresetDatabase();
    const presets = await database.getAll(PRESETS_STORE);
    if (presets && presets.length > 0) {
      const normalized = normalizePresetList(presets);
      saveLocalStoragePresets(normalized);
      await Promise.all(normalized.map((preset) => database.put(PRESETS_STORE, preset)));
      return normalized;
    }
  } catch {
    // fallback to localStorage
  }
  const normalized = normalizePresetList(loadLocalStoragePresets());
  saveLocalStoragePresets(normalized);
  return normalized;
}

export async function savePreset(presetData) {
  const { width, height, depth } = presetData.dimensions || {};
  const defaultName = `${width || 150} × ${height || 90} × ${depth || 40} mm`;
  const name = presetData.name?.trim() || defaultName;

  const netState = presetData.netState ? normalizeQuickBoxState(presetData.netState).box : null;
  const preset = {
    id: presetData.id || `preset-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    dimensions: {
      width: Number(width) || 150,
      height: Number(height) || 90,
      depth: Number(depth) || 40,
    },
    netState,
    construction: netState?.construction || null,
    isBuiltIn: false,
    createdAt: presetData.createdAt || new Date().toISOString(),
  };

  try {
    const database = await getPresetDatabase();
    await database.put(PRESETS_STORE, preset);
  } catch {
    // ignore DB error
  }

  const currentLocal = loadLocalStoragePresets();
  const updatedLocal = [preset, ...currentLocal.filter((p) => p.id !== preset.id)];
  saveLocalStoragePresets(updatedLocal);

  return preset;
}

export async function deletePreset(presetId) {
  try {
    const database = await getPresetDatabase();
    await database.delete(PRESETS_STORE, presetId);
  } catch {
    // ignore
  }

  const currentLocal = loadLocalStoragePresets();
  const updatedLocal = currentLocal.filter((p) => p.id !== presetId);
  saveLocalStoragePresets(updatedLocal);
}

export function formatPresetDimensions(dimensions) {
  if (!dimensions) return '';
  const { width, height, depth } = dimensions;
  return `${width} × ${height} × ${depth} mm`;
}

export function exportPresetsJson(presets) {
  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    presets: presets.map((source) => {
      const p = normalizePreset(source);
      return {
        id: p.id,
        name: p.name,
        dimensions: p.dimensions,
        netState: p.netState || null,
        construction: p.construction || p.netState?.construction || null,
        createdAt: p.createdAt || new Date().toISOString(),
      };
    }),
  };
  return JSON.stringify(data, null, 2);
}

export async function importPresetsFromJson(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON format.');
  }

  const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.presets) ? parsed.presets : null;
  if (!rawList || rawList.length === 0) {
    throw new Error('No presets found in file.');
  }

  let count = 0;
  for (const item of rawList) {
    if (item && item.dimensions && Number(item.dimensions.width) > 0) {
      await savePreset({
        name: item.name,
        dimensions: item.dimensions,
        netState: item.netState || null,
        construction: item.construction || item.netState?.construction || null,
      });
      count++;
    }
  }

  if (count === 0) {
    throw new Error('No valid presets could be imported.');
  }

  return count;
}
