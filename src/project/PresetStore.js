import { getDatabase, PRESETS_STORE } from './db.js';
import { normalizeQuickBoxState } from '../model/quickCustomNet.js';
import rteFixture from '../workflow/fixtures/rte-workflow.v1.json';
import steFixture from '../workflow/fixtures/ste-workflow.v1.json';
import ttSl123Fixture from '../workflow/fixtures/tt_sl123-workflow.v1.json';

const LOCAL_STORAGE_KEY = 'carton_builder_user_presets';

export const BUILT_IN_PRESETS = Object.freeze([
  {
    id: 'preset-standard',
    name: 'Standard Box',
    dimensions: { width: 150, height: 90, depth: 40 },
    workflow: 'quick',
    isBuiltIn: true,
  },
  {
    id: 'preset-cube',
    name: 'Cube Box',
    dimensions: { width: 100, height: 100, depth: 100 },
    workflow: 'quick',
    isBuiltIn: true,
  },
  {
    id: 'preset-tuck',
    name: 'Small Box',
    dimensions: { width: 80, height: 50, depth: 25 },
    workflow: 'quick',
    isBuiltIn: true,
  },
  {
    id: 'preset-shipping',
    name: 'Medium Shipping Box',
    dimensions: { width: 250, height: 160, depth: 90 },
    workflow: 'quick',
    isBuiltIn: true,
  },
  {
    id: 'preset-flat',
    name: 'Flat Gift Box',
    dimensions: { width: 200, height: 200, depth: 50 },
    workflow: 'quick',
    isBuiltIn: true,
  },
]);

export const BUILT_IN_TECHNICAL_PRESETS = Object.freeze([
  {
    id: 'preset-tech-rte',
    name: 'RTE Box (Reverse Tuck End)',
    cartonType: 'RTE',
    dimensions: { width: 120.6, height: 161.1, depth: 60.6 },
    thickness: 0.46,
    workflow: 'technical',
    bundle: rteFixture,
    isBuiltIn: true,
  },
  {
    id: 'preset-tech-ste',
    name: 'STE Box (Straight Tuck End)',
    cartonType: 'STE',
    dimensions: { width: 120.6, height: 161.1, depth: 60.6 },
    thickness: 0.46,
    workflow: 'technical',
    bundle: steFixture,
    isBuiltIn: true,
  },
  {
    id: 'preset-tech-tt-sl123',
    name: 'Snap-Lock Bottom (TT_SL123)',
    cartonType: 'TT_SL123',
    dimensions: { width: 120.6, height: 161.1, depth: 60.6 },
    thickness: 0.46,
    workflow: 'technical',
    bundle: ttSl123Fixture,
    isBuiltIn: true,
  },
]);

export function getBuiltInPresets(workflow = 'quick') {
  return workflow === 'technical' ? BUILT_IN_TECHNICAL_PRESETS : BUILT_IN_PRESETS;
}

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
  const isTechnical = preset?.workflow === 'technical';
  if (isTechnical) {
    return {
      ...preset,
      workflow: 'technical',
      cartonType: preset.cartonType || preset.bundle?.modelJson?.cartonType || 'RTE',
      bundle: preset.bundle || null,
      dimensions: preset.dimensions || { width: 120.6, height: 161.1, depth: 60.6 },
      thickness: preset.thickness ?? 0.46,
    };
  }
  const netState = preset?.netState
    ? normalizeQuickBoxState(preset.netState).box
    : null;
  return {
    ...preset,
    workflow: 'quick',
    netState,
    construction: netState?.construction || null,
  };
}

function normalizePresetList(presets) {
  return (Array.isArray(presets) ? presets : []).map(normalizePreset);
}

export async function getUserPresets(workflow = 'quick') {
  let all = [];
  try {
    const database = await getPresetDatabase();
    const presets = await database.getAll(PRESETS_STORE);
    if (presets && presets.length > 0) {
      all = normalizePresetList(presets);
      saveLocalStoragePresets(all);
      await Promise.all(all.map((preset) => database.put(PRESETS_STORE, preset)));
    }
  } catch {
    // fallback to localStorage
  }
  if (!all.length) {
    all = normalizePresetList(loadLocalStoragePresets());
    saveLocalStoragePresets(all);
  }

  return all.filter((preset) => {
    if (workflow === 'technical') return preset.workflow === 'technical';
    return !preset.workflow || preset.workflow === 'quick';
  });
}

export async function savePreset(presetData, workflow = 'quick') {
  const targetWorkflow = presetData.workflow || workflow || 'quick';
  const isTechnical = targetWorkflow === 'technical';
  const { width, height, depth } = presetData.dimensions || {};
  const defaultName = isTechnical
    ? `${presetData.cartonType || 'Technical'} ${width || 120.6} × ${height || 161.1} × ${depth || 60.6} mm`
    : `${width || 150} × ${height || 90} × ${depth || 40} mm`;
  const name = presetData.name?.trim() || defaultName;

  let preset;
  if (isTechnical) {
    preset = {
      id: presetData.id || `preset-tech-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      workflow: 'technical',
      cartonType: presetData.cartonType || 'RTE',
      dimensions: {
        width: Number(width) || 120.6,
        height: Number(height) || 161.1,
        depth: Number(depth) || 60.6,
      },
      thickness: Number(presetData.thickness) || 0.46,
      bundle: presetData.bundle || null,
      isBuiltIn: false,
      createdAt: presetData.createdAt || new Date().toISOString(),
    };
  } else {
    const netState = presetData.netState ? normalizeQuickBoxState(presetData.netState).box : null;
    preset = {
      id: presetData.id || `preset-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      workflow: 'quick',
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
  }

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
      if (p.workflow === 'technical') {
        return {
          id: p.id,
          name: p.name,
          workflow: 'technical',
          cartonType: p.cartonType,
          dimensions: p.dimensions,
          thickness: p.thickness,
          bundle: p.bundle,
          createdAt: p.createdAt || new Date().toISOString(),
        };
      }
      return {
        id: p.id,
        name: p.name,
        workflow: 'quick',
        dimensions: p.dimensions,
        netState: p.netState || null,
        construction: p.construction || p.netState?.construction || null,
        createdAt: p.createdAt || new Date().toISOString(),
      };
    }),
  };
  return JSON.stringify(data, null, 2);
}

export async function importPresetsFromJson(jsonString, defaultWorkflow = 'quick') {
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
      const wf = item.workflow || defaultWorkflow || 'quick';
      await savePreset({
        name: item.name,
        workflow: wf,
        cartonType: item.cartonType,
        dimensions: item.dimensions,
        thickness: item.thickness,
        bundle: item.bundle || null,
        netState: item.netState || null,
        construction: item.construction || item.netState?.construction || null,
      }, wf);
      count++;
    }
  }

  if (count === 0) {
    throw new Error('No valid presets could be imported.');
  }

  return count;
}
