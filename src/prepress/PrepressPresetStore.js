import { clonePrepressSettings, sanitizePrepressSettings } from './prepressState.js';

const STORAGE_KEY = 'carton_builder_prepress_presets_v1';
let memory = [];

function read() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : memory;
  } catch {
    return memory;
  }
}

function write(presets) {
  memory = presets;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage is optional; memory remains authoritative for this session.
  }
}

export async function getPrepressPresets() {
  return read().map((preset) => ({
    ...preset,
    version: 1,
    settings: clonePrepressSettings(preset.settings),
  }));
}

export async function savePrepressPreset({ id = '', name = '', settings }) {
  const current = await getPrepressPresets();
  const normalizedName = String(name).trim().slice(0, 64) || 'Prepress preset';
  if (current.some((entry) => entry.id !== id && entry.name.toLowerCase() === normalizedName.toLowerCase())) {
    throw new Error('A prepress preset with this name already exists.');
  }
  const preset = {
    id: id || `prepress-preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: normalizedName,
    version: 1,
    settings: sanitizePrepressSettings(settings),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  write([preset, ...current.filter((entry) => entry.id !== preset.id)]);
  return structuredClone(preset);
}

export async function deletePrepressPreset(id) {
  write((await getPrepressPresets()).filter((entry) => entry.id !== id));
}

export function exportPrepressPresetsJson(presets = []) {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    presets: presets.map((entry) => ({
      id: entry.id,
      name: entry.name,
      version: 1,
      settings: clonePrepressSettings(entry.settings),
    })),
  }, null, 2);
}
