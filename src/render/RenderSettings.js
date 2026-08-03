export const RENDER_ASPECTS = Object.freeze({
  square: Object.freeze({ width: 1, height: 1 }),
  landscape: Object.freeze({ width: 4, height: 3 }),
  wide: Object.freeze({ width: 16, height: 9 }),
  portrait: Object.freeze({ width: 3, height: 4 }),
  custom: Object.freeze({ width: 1, height: 1 }),
});

export const RENDER_LONG_EDGES = Object.freeze([2048, 4096]);
export const RENDER_OUTPUT_FORMATS = Object.freeze(['png', 'jpg']);
export const RENDER_OUTPUT_SIZING_MODES = Object.freeze(['preset', 'pixels', 'print']);
export const RENDER_PRINT_UNITS = Object.freeze(['cm', 'in']);
export const RENDER_PIXEL_LIMITS = Object.freeze({ min: 256, max: 4096 });
export const RENDER_OUTPUT_KINDS = Object.freeze(['image', 'sequence', 'glb']);
export const RENDER_SEQUENCE_FRAME_OPTIONS = Object.freeze([24, 36, 72]);
export const RENDER_SEQUENCE_LONG_EDGES = Object.freeze([512, 1024, 2048]);
export const RENDER_SEQUENCE_FORMATS = Object.freeze(['png', 'jpg']);
export const RENDER_GLB_TEXTURE_SIZES = Object.freeze(['auto', 1024, 2048, 4096]);
export const RENDER_GLB_MATERIAL_MODES = Object.freeze(['full-pbr', 'basic-compatibility']);

export const RENDER_MATERIAL_PROFILES = Object.freeze(['uncoated', 'matte', 'gloss']);
export const RENDER_PRESETS = Object.freeze(['clean-studio', 'catalogue', 'soft-grey', 'transparent', 'glossy-product', 'warm-retail']);
export const HTML_EXPORT_QUALITY_OPTIONS = Object.freeze(['auto', 600, 1200, 2400]);
export const RENDER_CAMERA_PRESETS = Object.freeze([
  'back',
  'front',
  'left',
  'right',
  'top',
  'bottom',
  'front-left',
  'front-right',
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
    focalLength: 35,
    lens: '35',
    heading: 45,
    elevation: 35.264,
    horizontalPan: 0,
    verticalPan: 0,
    cameraDistance: 4,
    frameHeight: 4,
    orthographicHeight: 4,
    verticalCorrection: false,
    keepVerticalsParallel: false,
    position: Object.freeze([1, 1, 1]),
    target: Object.freeze([0, 0, 0]),
  }),
  activeViewPresetId: '',
  viewPresetBaseId: '',
  background: Object.freeze({
    mode: 'solid',
    color: '#d9dcde',
    image: Object.freeze({
      assetId: '',
      fileName: '',
      mimeType: '',
      width: 0,
      height: 0,
      fit: 'cover',
      positionX: 0.5,
      positionY: 0.5,
      zoom: 1,
      blur: 0,
      brightness: 1,
      overlayColor: '#000000',
      overlayOpacity: 0,
    }),
  }),
  lighting: Object.freeze({
    azimuth: 63,
    elevation: 48,
    intensity: 1.7,
    environment: 'studio',
    environmentIntensity: 0.4,
    exposure: 0.85,
  }),
  shadows: Object.freeze({
    enabled: true,
    intensity: 0.34,
    blur: 2,
    mapSize: 1024,
    includeInTransparentExport: true,
  }),
  floor: Object.freeze({
    reflection: Object.freeze({
      enabled: false,
      strength: 0.08,
      blur: 0.65,
      fadeDistance: 0.65,
      includeInTransparentExport: false,
    }),
  }),
  material: Object.freeze({
    profile: 'matte',
  }),
  quality: Object.freeze({
    interactive: 'balanced',
    export: 'high',
    html: 'auto',
  }),
  output: Object.freeze({
    kind: 'image',
    format: 'png',
    sizingMode: 'preset',
    widthPx: 2048,
    heightPx: 2048,
    lockAspect: true,
    printUnit: 'cm',
    printWidth: 20,
    printHeight: 20,
    ppi: 300,
    jpegQuality: 0.94,
    sequence: Object.freeze({
      frames: 36,
      longEdge: 1024,
      format: 'png',
    }),
    glb: Object.freeze({
      textureSize: 'auto',
      materialMode: 'full-pbr',
      includeCamera: true,
    }),
  }),
  effects: Object.freeze({
    gtao: Object.freeze({
      enabled: true,
      intensity: 0.5,
      radius: 0.18,
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
const BACKGROUND_MODES = new Set(['solid', 'transparent', 'image']);
const BACKGROUND_FITS = new Set(['cover', 'contain']);
const OUTPUT_FORMATS = new Set(RENDER_OUTPUT_FORMATS);
const OUTPUT_SIZING_MODES = new Set(RENDER_OUTPUT_SIZING_MODES);
const PRINT_UNITS = new Set(RENDER_PRINT_UNITS);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const CAMERA_LENS_VALUES = new Set(['35', '50', '85', 'custom']);
const OUTPUT_KINDS = new Set(RENDER_OUTPUT_KINDS);
const SEQUENCE_FRAME_OPTIONS = new Set(RENDER_SEQUENCE_FRAME_OPTIONS);
const SEQUENCE_LONG_EDGES = new Set(RENDER_SEQUENCE_LONG_EDGES);
const SEQUENCE_FORMATS = new Set(RENDER_SEQUENCE_FORMATS);
const GLB_TEXTURE_SIZES = new Set(RENDER_GLB_TEXTURE_SIZES.filter((value) => value !== 'auto'));
const GLB_MATERIAL_MODES = new Set(RENDER_GLB_MATERIAL_MODES);

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
  const floor = source.floor && typeof source.floor === 'object' ? source.floor : {};
  const reflection = floor.reflection && typeof floor.reflection === 'object' ? floor.reflection : {};
  const material = source.material && typeof source.material === 'object' ? source.material : {};
  const quality = source.quality && typeof source.quality === 'object' ? source.quality : {};
  const output = source.output && typeof source.output === 'object' ? source.output : {};
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
      focalLength: numberInRange(camera.focalLength, fallback.camera.focalLength, 10, 300),
      lens: CAMERA_LENS_VALUES.has(String(camera.lens)) ? String(camera.lens) : fallback.camera.lens,
      heading: numberInRange(camera.heading, fallback.camera.heading, -360, 360),
      elevation: numberInRange(camera.elevation, fallback.camera.elevation, -89, 89),
      horizontalPan: numberInRange(camera.horizontalPan, fallback.camera.horizontalPan, -10000, 10000),
      verticalPan: numberInRange(camera.verticalPan, fallback.camera.verticalPan, -10000, 10000),
      cameraDistance: numberInRange(camera.cameraDistance, fallback.camera.cameraDistance, 0.01, 100000),
      frameHeight: numberInRange(camera.frameHeight, fallback.camera.frameHeight, 0.01, 100000),
      orthographicHeight: numberInRange(camera.orthographicHeight, fallback.camera.orthographicHeight, 0.01, 100000),
      verticalCorrection: camera.verticalCorrection === true || camera.keepVerticalsParallel === true,
      keepVerticalsParallel: camera.verticalCorrection === true || camera.keepVerticalsParallel === true,
      position: finiteVector(camera.position, fallback.camera.position),
      target: finiteVector(camera.target, fallback.camera.target),
    },
    activeViewPresetId: typeof source.activeViewPresetId === 'string'
      ? source.activeViewPresetId.slice(0, 128)
      : fallback.activeViewPresetId,
    viewPresetBaseId: typeof source.viewPresetBaseId === 'string'
      ? source.viewPresetBaseId.slice(0, 128)
      : fallback.viewPresetBaseId,
    background: {
      mode: enumValue(background.mode, BACKGROUND_MODES, fallback.background.mode),
      color: colorValue(background.color, fallback.background.color),
      image: {
        assetId: typeof background.image?.assetId === 'string'
          ? background.image.assetId.slice(0, 128)
          : fallback.background.image.assetId,
        fileName: typeof background.image?.fileName === 'string'
          ? background.image.fileName.slice(0, 255)
          : fallback.background.image.fileName,
        mimeType: IMAGE_MIME_TYPES.has(background.image?.mimeType)
          ? background.image.mimeType
          : fallback.background.image.mimeType,
        width: Math.round(numberInRange(background.image?.width, fallback.background.image.width, 0, 100000)),
        height: Math.round(numberInRange(background.image?.height, fallback.background.image.height, 0, 100000)),
        fit: enumValue(background.image?.fit, BACKGROUND_FITS, fallback.background.image.fit),
        positionX: numberInRange(background.image?.positionX, fallback.background.image.positionX, 0, 1),
        positionY: numberInRange(background.image?.positionY, fallback.background.image.positionY, 0, 1),
        zoom: numberInRange(background.image?.zoom, fallback.background.image.zoom, 0.1, 4),
        blur: numberInRange(background.image?.blur, fallback.background.image.blur, 0, 40),
        brightness: numberInRange(background.image?.brightness, fallback.background.image.brightness, 0, 2),
        overlayColor: colorValue(background.image?.overlayColor, fallback.background.image.overlayColor),
        overlayOpacity: numberInRange(background.image?.overlayOpacity, fallback.background.image.overlayOpacity, 0, 1),
      },
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
    floor: {
      reflection: {
        enabled: reflection.enabled === true,
        strength: numberInRange(reflection.strength, fallback.floor.reflection.strength, 0, 1),
        blur: numberInRange(reflection.blur, fallback.floor.reflection.blur, 0, 1),
        fadeDistance: numberInRange(reflection.fadeDistance, fallback.floor.reflection.fadeDistance, 0.05, 5),
        includeInTransparentExport: reflection.includeInTransparentExport === true,
      },
    },
    material: {
      profile: enumValue(material.profile, MATERIAL_PROFILES, fallback.material.profile),
    },
    quality: {
      interactive: enumValue(quality.interactive, QUALITIES, fallback.quality.interactive),
      export: enumValue(quality.export, QUALITIES, fallback.quality.export),
      html: htmlExportQualityValue(quality.html, fallback.quality.html),
    },
    output: {
      kind: enumValue(output.kind, OUTPUT_KINDS, fallback.output.kind),
      format: enumValue(output.format, OUTPUT_FORMATS, fallback.output.format),
      sizingMode: enumValue(output.sizingMode, OUTPUT_SIZING_MODES, fallback.output.sizingMode),
      widthPx: Math.round(numberInRange(
        output.widthPx,
        fallback.output.widthPx,
        RENDER_PIXEL_LIMITS.min,
        RENDER_PIXEL_LIMITS.max,
      )),
      heightPx: Math.round(numberInRange(
        output.heightPx,
        fallback.output.heightPx,
        RENDER_PIXEL_LIMITS.min,
        RENDER_PIXEL_LIMITS.max,
      )),
      lockAspect: output.lockAspect !== false,
      printUnit: enumValue(output.printUnit, PRINT_UNITS, fallback.output.printUnit),
      printWidth: numberInRange(output.printWidth, fallback.output.printWidth, 1, 200),
      printHeight: numberInRange(output.printHeight, fallback.output.printHeight, 1, 200),
      ppi: Math.round(numberInRange(output.ppi, fallback.output.ppi, 30, 1200)),
      jpegQuality: numberInRange(output.jpegQuality, fallback.output.jpegQuality, 0.5, 1),
      sequence: {
        frames: SEQUENCE_FRAME_OPTIONS.has(Number(output.sequence?.frames))
          ? Number(output.sequence.frames)
          : fallback.output.sequence.frames,
        longEdge: SEQUENCE_LONG_EDGES.has(Number(output.sequence?.longEdge))
          ? Number(output.sequence.longEdge)
          : fallback.output.sequence.longEdge,
        format: enumValue(output.sequence?.format, SEQUENCE_FORMATS, fallback.output.sequence.format),
      },
      glb: {
        textureSize: output.glb?.textureSize === 'auto'
          || GLB_TEXTURE_SIZES.has(Number(output.glb?.textureSize))
          ? output.glb.textureSize === 'auto' ? 'auto' : Number(output.glb.textureSize)
          : fallback.output.glb.textureSize,
        materialMode: enumValue(output.glb?.materialMode, GLB_MATERIAL_MODES, fallback.output.glb.materialMode),
        includeCamera: output.glb?.includeCamera !== false,
      },
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
  if (sanitized.output.sizingMode === 'pixels') {
    return {
      width: sanitized.output.widthPx,
      height: sanitized.output.heightPx,
    };
  }
  if (sanitized.output.sizingMode === 'print') {
    const unitScale = sanitized.output.printUnit === 'in' ? 1 : 1 / 2.54;
    return {
      width: Math.round(sanitized.output.printWidth * unitScale * sanitized.output.ppi),
      height: Math.round(sanitized.output.printHeight * unitScale * sanitized.output.ppi),
    };
  }
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
