import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from './RenderSettings.js';

const BASE = DEFAULT_RENDER_SETTINGS;

export const RENDER_PRESET_DEFINITIONS = Object.freeze({
  'clean-studio': Object.freeze({
    labelKey: 'renderPresetCleanStudio',
    settings: Object.freeze({
      presetId: 'clean-studio',
      background: { mode: 'solid', color: '#d9dcde' },
      material: { profile: 'matte' },
      lighting: { environment: 'studio', environmentIntensity: 0.4, azimuth: 63, elevation: 48, intensity: 1.7, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.34, blur: 2 },
    }),
  }),
  catalogue: Object.freeze({
    labelKey: 'renderPresetCatalogue',
    settings: Object.freeze({
      presetId: 'catalogue',
      background: { mode: 'solid', color: '#f5f5f3' },
      material: { profile: 'gloss' },
      lighting: { environment: 'studio', environmentIntensity: 0.45, azimuth: 48, elevation: 55, intensity: 1.9, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.24, blur: 2.4 },
    }),
  }),
  'soft-grey': Object.freeze({
    labelKey: 'renderPresetSoftGrey',
    settings: Object.freeze({
      presetId: 'soft-grey',
      background: { mode: 'solid', color: '#c8cdd1' },
      material: { profile: 'matte' },
      lighting: { environment: 'neutral', environmentIntensity: 0.4, azimuth: 72, elevation: 42, intensity: 1.5, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.38, blur: 2.8 },
    }),
  }),
  transparent: Object.freeze({
    labelKey: 'renderPresetTransparent',
    settings: Object.freeze({
      presetId: 'transparent',
      background: { mode: 'transparent', color: '#ffffff' },
      material: { profile: 'matte' },
      lighting: { environment: 'studio', environmentIntensity: 0.4, azimuth: 63, elevation: 48, intensity: 1.7, exposure: 0.85 },
      shadows: { enabled: true, intensity: 0.32, blur: 2, includeInTransparentExport: true },
    }),
  }),
});

function mergeSettings(base, patch) {
  return sanitizeRenderSettings({
    ...base,
    ...patch,
    camera: { ...base.camera, ...patch.camera },
    background: { ...base.background, ...patch.background },
    lighting: { ...base.lighting, ...patch.lighting },
    shadows: { ...base.shadows, ...patch.shadows },
    material: { ...base.material, ...patch.material },
    quality: { ...base.quality, ...patch.quality },
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

export function applyRenderPreset(current, id) {
  const definition = RENDER_PRESET_DEFINITIONS[id] || RENDER_PRESET_DEFINITIONS['clean-studio'];
  return mergeSettings(current || BASE, {
    ...definition.settings,
    presetId: id,
  });
}
