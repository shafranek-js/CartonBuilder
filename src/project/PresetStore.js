import { openDB } from 'idb';

const DATABASE_NAME = 'carton-builder';
const DATABASE_VERSION = 2;
const PRESETS_STORE_NAME = 'presets';
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
    name: 'Small Tuck Box',
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

async function getDatabase() {
  return openDB(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('projects')) {
        database.createObjectStore('projects');
      }
      if (!database.objectStoreNames.contains(PRESETS_STORE_NAME)) {
        database.createObjectStore(PRESETS_STORE_NAME, { keyPath: 'id' });
      }
    },
  });
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

export async function getUserPresets() {
  try {
    const database = await getDatabase();
    const presets = await database.getAll(PRESETS_STORE_NAME);
    if (presets && presets.length > 0) {
      saveLocalStoragePresets(presets);
      return presets;
    }
  } catch {
    // fallback to localStorage
  }
  return loadLocalStoragePresets();
}

export async function savePreset(presetData) {
  const { width, height, depth } = presetData.dimensions || {};
  const defaultName = `${width || 150} × ${height || 90} × ${depth || 40} mm`;
  const name = presetData.name?.trim() || defaultName;

  const preset = {
    id: presetData.id || `preset-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    dimensions: {
      width: Number(width) || 150,
      height: Number(height) || 90,
      depth: Number(depth) || 40,
    },
    netState: presetData.netState || null,
    isBuiltIn: false,
    createdAt: presetData.createdAt || new Date().toISOString(),
  };

  try {
    const database = await getDatabase();
    await database.put(PRESETS_STORE_NAME, preset);
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
    const database = await getDatabase();
    await database.delete(PRESETS_STORE_NAME, presetId);
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
