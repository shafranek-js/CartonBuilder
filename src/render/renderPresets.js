import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from './RenderSettings.js';
import leftViewPresetJson from '../../Preset left view.json?raw';
import rightViewPresetJson from '../../Preset right vew.json?raw';

const BASE = DEFAULT_RENDER_SETTINGS;

function readImportedRenderSettings(raw, presetId) {
  try {
    const parsed = JSON.parse(raw);
    const settings = parsed?.renderSettings || parsed;
    return Object.freeze({
      ...settings,
      presetId,
      activeViewPresetId: '',
      viewPresetBaseId: '',
    });
  } catch {
    return Object.freeze({ presetId });
  }
}

const LEFT_VIEW_SETTINGS = readImportedRenderSettings(leftViewPresetJson, 'left-view');
const RIGHT_VIEW_SETTINGS = readImportedRenderSettings(rightViewPresetJson, 'right-view');

export const RENDER_PRESET_DEFINITIONS = Object.freeze({
  'clean-studio': Object.freeze({
    labelKey: 'renderPresetCleanStudio',
    settings: Object.freeze({
      presetId: 'clean-studio',
      aspect: 'square', longEdge: 2048,
      camera: { preset: 'isometric', projection: 'perspective', fov: 35 },
      output: { format: 'png', sizingMode: 'preset', widthPx: 2048, heightPx: 2048, lockAspect: true },
      background: { mode: 'solid', color: '#d9dcde' },
      material: { profile: 'matte' },
      lighting: { environment: 'studio', environmentIntensity: 0.4, azimuth: 63, elevation: 48, intensity: 1.7, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.34, blur: 2 },
      floor: { reflection: { enabled: false, strength: 0.08, blur: 0.65, fadeDistance: 0.65 } },
    }),
  }),
  catalogue: Object.freeze({
    labelKey: 'renderPresetCatalogue',
    settings: Object.freeze({
      presetId: 'catalogue',
      aspect: 'landscape', longEdge: 2048,
      camera: { preset: 'front-right', projection: 'perspective', fov: 42 },
      output: { format: 'png', sizingMode: 'preset', widthPx: 2048, heightPx: 1536, lockAspect: true },
      background: { mode: 'solid', color: '#f5f5f3' },
      material: { profile: 'gloss' },
      lighting: { environment: 'studio', environmentIntensity: 0.45, azimuth: 48, elevation: 55, intensity: 1.9, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.24, blur: 2.4 },
      floor: { reflection: { enabled: true, strength: 0.08, blur: 0.7, fadeDistance: 0.8 } },
    }),
  }),
  'soft-grey': Object.freeze({
    labelKey: 'renderPresetSoftGrey',
    settings: Object.freeze({
      presetId: 'soft-grey',
      aspect: 'square', longEdge: 2048,
      camera: { preset: 'isometric', projection: 'perspective', fov: 35 },
      output: { format: 'png', sizingMode: 'preset', widthPx: 2048, heightPx: 2048, lockAspect: true },
      background: { mode: 'solid', color: '#c8cdd1' },
      material: { profile: 'matte' },
      lighting: { environment: 'neutral', environmentIntensity: 0.4, azimuth: 72, elevation: 42, intensity: 1.5, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.38, blur: 2.8 },
      floor: { reflection: { enabled: false, strength: 0.06, blur: 0.7, fadeDistance: 0.7 } },
    }),
  }),
  transparent: Object.freeze({
    labelKey: 'renderPresetTransparent',
    settings: Object.freeze({
      presetId: 'transparent',
      aspect: 'square', longEdge: 2048,
      camera: { preset: 'isometric', projection: 'perspective', fov: 35 },
      output: { format: 'png', sizingMode: 'preset', widthPx: 2048, heightPx: 2048, lockAspect: true },
      background: { mode: 'transparent', color: '#ffffff' },
      material: { profile: 'matte' },
      lighting: { environment: 'studio', environmentIntensity: 0.4, azimuth: 63, elevation: 48, intensity: 1.7, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.32, blur: 2, includeInTransparentExport: true },
      floor: { reflection: { enabled: false, strength: 0.05, blur: 0.7, fadeDistance: 0.65, includeInTransparentExport: false } },
    }),
  }),
  'glossy-product': Object.freeze({
    labelKey: 'renderPresetGlossyProduct',
    settings: Object.freeze({
      presetId: 'glossy-product', aspect: 'landscape', longEdge: 2048,
      camera: { preset: 'front-right', projection: 'perspective', fov: 42 },
      output: { format: 'png', sizingMode: 'preset', widthPx: 2048, heightPx: 1536, lockAspect: true },
      background: { mode: 'solid', color: '#eef0f1' }, material: { profile: 'gloss' },
      lighting: { environment: 'studio', environmentIntensity: 0.5, azimuth: 48, elevation: 55, intensity: 2, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.28, blur: 2 }, floor: { reflection: { enabled: true, strength: 0.1 } },
    }),
  }),
  'warm-retail': Object.freeze({
    labelKey: 'renderPresetWarmRetail',
    settings: Object.freeze({
      presetId: 'warm-retail', aspect: 'landscape', longEdge: 2048,
      camera: { preset: 'front-left', projection: 'perspective', fov: 42 },
      output: { format: 'jpg', sizingMode: 'preset', widthPx: 2048, heightPx: 1536, lockAspect: true, jpegQuality: 0.94 },
      background: { mode: 'solid', color: '#efe6db' }, material: { profile: 'matte' },
      lighting: { environment: 'warm', environmentIntensity: 0.5, azimuth: 35, elevation: 50, intensity: 1.8, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.3, blur: 3 }, floor: { reflection: { enabled: false } },
    }),
  }),
  'left-view': Object.freeze({
    labelKey: 'renderPresetLeftView',
    settings: LEFT_VIEW_SETTINGS,
  }),
  'right-view': Object.freeze({
    labelKey: 'renderPresetRightView',
    settings: RIGHT_VIEW_SETTINGS,
  }),
});

function mergeSettings(base, patch) {
  return sanitizeRenderSettings({
    ...base,
    ...patch,
    camera: { ...base.camera, ...patch.camera },
    background: {
      ...base.background,
      ...patch.background,
      image: { ...base.background.image, ...patch.background?.image },
    },
    lighting: { ...base.lighting, ...patch.lighting },
    shadows: { ...base.shadows, ...patch.shadows },
    floor: {
      ...base.floor,
      ...patch.floor,
      reflection: { ...base.floor.reflection, ...patch.floor?.reflection },
    },
    material: { ...base.material, ...patch.material },
    quality: { ...base.quality, ...patch.quality },
    output: { ...base.output, ...patch.output },
    effects: {
      ...base.effects,
      ...patch.effects,
      gtao: { ...base.effects.gtao, ...patch.effects?.gtao },
      antialiasing: { ...base.effects.antialiasing, ...patch.effects?.antialiasing },
      dof: { ...base.effects.dof, ...patch.effects?.dof },
    },
  });
}

export function getRenderPreset(id) {
  const definition = RENDER_PRESET_DEFINITIONS[id] || RENDER_PRESET_DEFINITIONS['clean-studio'];
  return mergeSettings(BASE, definition.settings);
}

export function applyRenderPreset(current, id, { preserveProjectSpecific = true } = {}) {
  const definition = RENDER_PRESET_DEFINITIONS[id] || RENDER_PRESET_DEFINITIONS['clean-studio'];
  const base = preserveProjectSpecific ? (current || BASE) : BASE;
  const merged = mergeSettings(base, {
    ...definition.settings,
    presetId: id,
  });
  if (preserveProjectSpecific && current) {
    merged.aspect = current.aspect;
    merged.longEdge = current.longEdge;
    merged.camera = sanitizeRenderSettings({ ...merged, camera: current.camera }).camera;
    merged.output = sanitizeRenderSettings({ ...merged, output: current.output }).output;
  }
  return merged;
}
