export const RENDER_ASPECTS = Object.freeze({
  square: Object.freeze({ width: 1, height: 1 }),
  landscape: Object.freeze({ width: 4, height: 3 }),
  wide: Object.freeze({ width: 16, height: 9 }),
  portrait: Object.freeze({ width: 3, height: 4 }),
});

export const RENDER_LONG_EDGES = Object.freeze([2048, 4096]);

export const RENDER_MATERIAL_PROFILES = Object.freeze(['uncoated', 'matte', 'gloss']);
export const RENDER_PRESETS = Object.freeze(['clean-studio', 'catalogue', 'soft-grey', 'transparent']);
export const HTML_EXPORT_QUALITY_OPTIONS = Object.freeze(['auto', 600, 1200, 2400]);
export const RENDER_CAMERA_PRESETS = Object.freeze([
  'front',
  'front-right',
  'front-left',
  'top-front',
  'isometric',
  'custom',
]);

export const DEFAULT_RENDER_SETTINGS = Object.freeze({
  presetId: 'clean-studio',
  aspect: 'square',
  longEdge: 2048,
  camera: Object.freeze({
    preset: 'isometric',
    projection: 'perspective',
    fov: 35,
    position: Object.freeze([1, 1, 1]),
    target: Object.freeze([0, 0, 0]),
  }),
  background: Object.freeze({
    mode: 'solid',
    color: '#e8eaeb',
  }),
  lighting: Object.freeze({
    azimuth: 63,
    elevation: 48,
    intensity: 2.6,
    environment: 'studio',
    environmentIntensity: 0.65,
    exposure: 1,
  }),
  shadows: Object.freeze({
    enabled: true,
    intensity: 0.25,
    blur: 1.5,
    mapSize: 1024,
    includeInTransparentExport: true,
  }),
  material: Object.freeze({
    profile: 'matte',
  }),
  quality: Object.freeze({
    interactive: 'balanced',
    export: 'high',
    html: 'auto',
  }),
  effects: Object.freeze({
    gtao: Object.freeze({
      enabled: true,
      intensity: 0.45,
      radius: 0.22,
      resolution: 'half',
    }),
    antialiasing: Object.freeze({
      interactive: 'smaa',
      settled: 'taa',
      export: 'taa',
      taaSamples: 16,
    }),
    dof: Object.freeze({
      enabled: false,
      focusMode: 'carton-center',
      focusDistance: 1,
      aperture: 0.025,
      maxBlur: 0.01,
    }),
  }),
});

const ENVIRONMENTS = new Set(['none', 'studio', 'neutral', 'warm', 'cool', 'bright', 'night']);
const PROJECTIONS = new Set(['perspective', 'orthographic']);
const QUALITIES = new Set(['fast', 'balanced', 'high']);
const HTML_EXPORT_QUALITIES = new Set(HTML_EXPORT_QUALITY_OPTIONS.filter((value) => value !== 'auto'));
const AO_RESOLUTIONS = new Set(['half', 'full']);
const AA_MODES = new Set(['native', 'smaa', 'taa']);
const FOCUS_MODES = new Set(['carton-center', 'custom']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MATERIAL_PROFILES = new Set(RENDER_MATERIAL_PROFILES);

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function enumValue(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function htmlExportQualityValue(value, fallback) {
  if (value === 'auto') return 'auto';
  const number = Number(value);
  return HTML_EXPORT_QUALITIES.has(number) ? number : fallback;
}

function finiteVector(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  const vector = value.map(Number);
  return vector.every(Number.isFinite) ? vector : [...fallback];
}

function colorValue(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

export function cloneRenderSettings(settings) {
  return structuredClone(settings || DEFAULT_RENDER_SETTINGS);
}

export function sanitizeRenderSettings(input = null) {
  const source = input && typeof input === 'object' ? input : {};
  const camera = source.camera && typeof source.camera === 'object' ? source.camera : {};
  const background = source.background && typeof source.background === 'object'
    ? source.background
    : {};
  const lighting = source.lighting && typeof source.lighting === 'object' ? source.lighting : {};
  const shadows = source.shadows && typeof source.shadows === 'object' ? source.shadows : {};
  const material = source.material && typeof source.material === 'object' ? source.material : {};
  const quality = source.quality && typeof source.quality === 'object' ? source.quality : {};
  const effects = source.effects && typeof source.effects === 'object' ? source.effects : {};
  const gtao = effects.gtao && typeof effects.gtao === 'object' ? effects.gtao : {};
  const antialiasing = effects.antialiasing && typeof effects.antialiasing === 'object'
    ? effects.antialiasing
    : {};
  const dof = effects.dof && typeof effects.dof === 'object' ? effects.dof : {};

  const fallback = DEFAULT_RENDER_SETTINGS;
  return {
    presetId: RENDER_PRESETS.includes(source.presetId) ? source.presetId : fallback.presetId,
    aspect: Object.hasOwn(RENDER_ASPECTS, source.aspect) ? source.aspect : fallback.aspect,
    longEdge: RENDER_LONG_EDGES.includes(Number(source.longEdge))
      ? Number(source.longEdge)
      : fallback.longEdge,
    camera: {
      preset: RENDER_CAMERA_PRESETS.includes(camera.preset) ? camera.preset : fallback.camera.preset,
      projection: enumValue(camera.projection, PROJECTIONS, fallback.camera.projection),
      fov: numberInRange(camera.fov, fallback.camera.fov, 10, 120),
      position: finiteVector(camera.position, fallback.camera.position),
      target: finiteVector(camera.target, fallback.camera.target),
    },
    background: {
      mode: background.mode === 'transparent'
        ? 'transparent'
        : 'solid',
      color: colorValue(background.color, fallback.background.color),
    },
    lighting: {
      azimuth: numberInRange(lighting.azimuth, fallback.lighting.azimuth, 0, 360),
      elevation: numberInRange(lighting.elevation, fallback.lighting.elevation, 5, 85),
      intensity: numberInRange(lighting.intensity, fallback.lighting.intensity, 0, 10),
      environment: enumValue(lighting.environment, ENVIRONMENTS, fallback.lighting.environment),
      environmentIntensity: numberInRange(
        lighting.environmentIntensity,
        fallback.lighting.environmentIntensity,
        0,
        5,
      ),
      exposure: numberInRange(lighting.exposure, fallback.lighting.exposure, 0.1, 3),
    },
    shadows: {
      enabled: shadows.enabled !== false,
      intensity: numberInRange(shadows.intensity, fallback.shadows.intensity, 0, 1),
      blur: numberInRange(shadows.blur, fallback.shadows.blur, 0, 8),
      mapSize: [512, 1024, 2048].includes(Number(shadows.mapSize))
        ? Number(shadows.mapSize)
        : fallback.shadows.mapSize,
      includeInTransparentExport: shadows.includeInTransparentExport !== false,
    },
    material: {
      profile: enumValue(material.profile, MATERIAL_PROFILES, fallback.material.profile),
    },
    quality: {
      interactive: enumValue(quality.interactive, QUALITIES, fallback.quality.interactive),
      export: enumValue(quality.export, QUALITIES, fallback.quality.export),
      html: htmlExportQualityValue(quality.html, fallback.quality.html),
    },
    effects: {
      gtao: {
        enabled: gtao.enabled !== false,
        intensity: numberInRange(gtao.intensity, fallback.effects.gtao.intensity, 0, 1),
        radius: numberInRange(gtao.radius, fallback.effects.gtao.radius, 0.01, 2),
        resolution: enumValue(gtao.resolution, AO_RESOLUTIONS, fallback.effects.gtao.resolution),
      },
      antialiasing: {
        interactive: enumValue(
          antialiasing.interactive,
          AA_MODES,
          fallback.effects.antialiasing.interactive,
        ),
        settled: enumValue(antialiasing.settled, AA_MODES, fallback.effects.antialiasing.settled),
        export: enumValue(antialiasing.export, AA_MODES, fallback.effects.antialiasing.export),
        taaSamples: Math.round(numberInRange(
          antialiasing.taaSamples,
          fallback.effects.antialiasing.taaSamples,
          1,
          64,
        )),
      },
      dof: {
        enabled: dof.enabled === true,
        focusMode: enumValue(dof.focusMode, FOCUS_MODES, fallback.effects.dof.focusMode),
        focusDistance: numberInRange(dof.focusDistance, fallback.effects.dof.focusDistance, 0.01, 1000),
        aperture: numberInRange(dof.aperture, fallback.effects.dof.aperture, 0, 0.2),
        maxBlur: numberInRange(dof.maxBlur, fallback.effects.dof.maxBlur, 0, 1),
      },
    },
  };
}

export function getRenderOutputDimensions(settings = DEFAULT_RENDER_SETTINGS) {
  const sanitized = sanitizeRenderSettings(settings);
  const aspect = RENDER_ASPECTS[sanitized.aspect];
  const longEdge = sanitized.longEdge;
  if (aspect.width >= aspect.height) {
    return {
      width: longEdge,
      height: Math.round(longEdge * aspect.height / aspect.width),
    };
  }
  return {
    width: Math.round(longEdge * aspect.width / aspect.height),
    height: longEdge,
  };
}

export function getRenderFrameAspect(settings = DEFAULT_RENDER_SETTINGS) {
  const dimensions = getRenderOutputDimensions(settings);
  return dimensions.width / dimensions.height;
}

export function isRenderSettings(value) {
  if (!value || typeof value !== 'object') return false;
  return JSON.stringify(sanitizeRenderSettings(value)) === JSON.stringify(value);
}
