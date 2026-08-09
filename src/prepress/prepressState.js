const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

export const PREPRESS_SCHEMA_VERSION = 1;

export const DEFAULT_PREPRESS_SETTINGS = Object.freeze({
  version: PREPRESS_SCHEMA_VERSION,
  mode: 'technical-proof',
  profileId: 'generic-folding-carton',
  bleedMm: 3,
  safeMm: 3,
  slugMm: 10,
  requiredDpi: 300,
  allowances: Object.freeze({
    cutOffsetMm: 0,
    creaseOffsetMm: 0,
    glueTabDeltaMm: 0,
    tuckClearanceDeltaMm: 0,
    hingeOverrides: Object.freeze({}),
  }),
  marks: Object.freeze({ crop: true, registration: true, slug: true }),
  technicalLines: Object.freeze({
    cutSpotName: 'CutContour',
    creaseSpotName: 'Crease',
    strokePt: 0.25,
    overprint: true,
  }),
});

function clone(value) {
  return structuredClone(value);
}

function normalizeOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [id, raw] of Object.entries(value)) {
    const number = Number(raw);
    if (Number.isFinite(number)) result[String(id)] = clamp(number, -5, 5, 0);
  }
  return result;
}

export function sanitizePrepressSettings(input = null) {
  const source = input && typeof input === 'object' ? input : {};
  const sourceAllowances = source.allowances && typeof source.allowances === 'object'
    ? source.allowances
    : {};
  const sourceMarks = source.marks && typeof source.marks === 'object' ? source.marks : {};
  const sourceLines = source.technicalLines && typeof source.technicalLines === 'object'
    ? source.technicalLines
    : {};
  const mode = source.mode === 'production-assist' ? 'production-assist' : 'technical-proof';
  const profileId = source.profileId === 'custom' ? 'custom' : 'generic-folding-carton';
  return {
    version: PREPRESS_SCHEMA_VERSION,
    mode,
    profileId,
    bleedMm: clamp(source.bleedMm, 0, 20, DEFAULT_PREPRESS_SETTINGS.bleedMm),
    safeMm: clamp(source.safeMm, 0, 20, DEFAULT_PREPRESS_SETTINGS.safeMm),
    slugMm: clamp(source.slugMm, 0, 30, DEFAULT_PREPRESS_SETTINGS.slugMm),
    requiredDpi: clamp(source.requiredDpi, 30, 1200, DEFAULT_PREPRESS_SETTINGS.requiredDpi),
    allowances: {
      cutOffsetMm: clamp(sourceAllowances.cutOffsetMm, -5, 5, 0),
      creaseOffsetMm: clamp(sourceAllowances.creaseOffsetMm, -5, 5, 0),
      glueTabDeltaMm: clamp(sourceAllowances.glueTabDeltaMm, -10, 10, 0),
      tuckClearanceDeltaMm: clamp(sourceAllowances.tuckClearanceDeltaMm, -10, 10, 0),
      hingeOverrides: normalizeOverrides(sourceAllowances.hingeOverrides),
    },
    marks: {
      crop: sourceMarks.crop !== false,
      registration: sourceMarks.registration !== false,
      slug: sourceMarks.slug !== false,
    },
    technicalLines: {
      cutSpotName: String(sourceLines.cutSpotName || DEFAULT_PREPRESS_SETTINGS.technicalLines.cutSpotName).slice(0, 64),
      creaseSpotName: String(sourceLines.creaseSpotName || DEFAULT_PREPRESS_SETTINGS.technicalLines.creaseSpotName).slice(0, 64),
      strokePt: clamp(sourceLines.strokePt, 0.1, 2, DEFAULT_PREPRESS_SETTINGS.technicalLines.strokePt),
      overprint: sourceLines.overprint !== false,
    },
  };
}

export function clonePrepressSettings(settings = DEFAULT_PREPRESS_SETTINGS) {
  return clone(sanitizePrepressSettings(settings));
}

export function getPrepressPresetId(settings = DEFAULT_PREPRESS_SETTINGS) {
  const sanitized = sanitizePrepressSettings(settings);
  return sanitized.mode === 'production-assist' ? sanitized.profileId : 'technical-proof';
}
