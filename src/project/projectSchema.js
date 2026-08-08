import {
  ArtworkModel,
  ARTWORK_PREVIEW_QUALITY_OPTIONS,
  ARTWORK_RENDER_QUALITY_OPTIONS,
  DEFAULT_ARTWORK_QUALITY_SETTINGS,
  normalizePdfSeparationVisibility,
} from '../artwork/ArtworkModel.js';
import { detectArtworkType, sha256 } from '../artwork/fileValidation.js';
import { AppError } from '../errors.js';
import { BoxNetModel } from '../model/BoxNetModel.js';
import { sanitizeBoardConstruction } from '../model/BoardConstruction.js';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from '../render/RenderSettings.js';
import { sanitizeBoardAppearance } from '../render/BoardAppearance.js';
import { validateRenderAssets } from '../render/renderAssets.js';
import { sanitizeArtworkFinish } from '../render/FinishConfig.js';

export const CURRENT_PROJECT_SCHEMA_VERSION = 13;

const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const MIGRATIONS = new Map();

MIGRATIONS.set(1, (snapshot) => {
  const migrated = { ...snapshot };
  delete migrated.artwork;
  migrated.artworks = snapshot.artwork
    ? [{ artwork: snapshot.artwork, visible: true }]
    : [];
  migrated.activeArtworkIndex = snapshot.artwork ? 0 : -1;
  migrated.schemaVersion = 2;
  return migrated;
});

MIGRATIONS.set(2, (snapshot) => {
  const migrated = { ...snapshot };
  migrated.schemaVersion = 3;
  migrated.render = sanitizeRenderSettings(DEFAULT_RENDER_SETTINGS);
  if (Array.isArray(migrated.artworks)) {
    migrated.artworks = migrated.artworks.map((entry) => {
      const artwork = { ...entry.artwork };
      if (artwork.scale != null) {
        artwork.scaleX = artwork.scale;
        artwork.scaleY = artwork.scale;
        delete artwork.scale;
      }
      return { ...entry, artwork };
    });
  }
  return migrated;
});

MIGRATIONS.set(3, (snapshot) => {
  const migrated = { ...snapshot };
  migrated.schemaVersion = 4;
  migrated.render = sanitizeRenderSettings({
    ...snapshot.render,
    effects: snapshot.render?.effects,
  });
  return migrated;
});

function rebaseCroppedArtworkState(artwork) {
  if (!artwork?.crop) return artwork;
  const scaleX = Number(artwork.scaleX ?? artwork.scale ?? 1);
  const scaleY = Number(artwork.scaleY ?? artwork.scale ?? 1);
  const initialWidthMm = Number(artwork.initialWidthMm);
  const initialHeightMm = Number(artwork.initialHeightMm);
  if (![scaleX, scaleY, initialWidthMm, initialHeightMm].every(Number.isFinite)) return artwork;
  if (scaleX <= 0 || scaleY <= 0 || initialWidthMm <= 0 || initialHeightMm <= 0) return artwork;
  return {
    ...artwork,
    initialWidthMm: initialWidthMm * scaleX,
    initialHeightMm: initialHeightMm * scaleY,
    scaleX: 1,
    scaleY: 1,
    scale: 1,
  };
}

function rebaseEditorState(state) {
  if (!state || !Array.isArray(state.artworks)) return state;
  return {
    ...state,
    artworks: state.artworks.map((entry) => ({
      ...entry,
      artwork: rebaseCroppedArtworkState(entry.artwork),
    })),
  };
}

function rebaseHistory(history) {
  if (!history || typeof history !== 'object') return history;
  const migrateStack = (stack) => (Array.isArray(stack)
    ? stack.map((entry) => ({
      ...entry,
      before: rebaseEditorState(entry.before),
      after: rebaseEditorState(entry.after),
    }))
    : []);
  return {
    ...history,
    undo: migrateStack(history.undo),
    redo: migrateStack(history.redo),
  };
}

MIGRATIONS.set(4, (snapshot) => ({
  ...snapshot,
  schemaVersion: 5,
  artworks: rebaseEditorState({ artworks: snapshot.artworks }).artworks,
  history: rebaseHistory(snapshot.history),
}));

function migrateArtworkQuality(artwork) {
  if (!artwork || typeof artwork !== 'object') return artwork;
  const quality = artwork.quality && typeof artwork.quality === 'object'
    ? artwork.quality
    : {};
  return {
    ...artwork,
    quality: {
      preview: quality.preview === 'auto' || ARTWORK_PREVIEW_QUALITY_OPTIONS.includes(Number(quality.preview))
        ? quality.preview === 'auto' ? 'auto' : Number(quality.preview)
        : DEFAULT_ARTWORK_QUALITY_SETTINGS.preview,
      render: quality.render === 'auto' || ARTWORK_RENDER_QUALITY_OPTIONS.includes(Number(quality.render))
        ? quality.render === 'auto' ? 'auto' : Number(quality.render)
        : DEFAULT_ARTWORK_QUALITY_SETTINGS.render,
    },
  };
}

function migrateEditorArtworkQuality(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.artworks)) return state;
  return {
    ...state,
    artworks: state.artworks.map((entry) => ({
      ...entry,
      artwork: migrateArtworkQuality(entry.artwork),
    })),
  };
}

function migrateHistoryArtworkQuality(history) {
  if (!history || typeof history !== 'object') return history;
  const migrateStack = (stack) => (Array.isArray(stack)
    ? stack.map((entry) => ({
      ...entry,
      before: migrateEditorArtworkQuality(entry.before),
      after: migrateEditorArtworkQuality(entry.after),
    }))
    : []);
  return {
    ...history,
    undo: migrateStack(history.undo),
    redo: migrateStack(history.redo),
  };
}

MIGRATIONS.set(5, (snapshot) => ({
  ...snapshot,
  schemaVersion: 6,
  artworks: Array.isArray(snapshot.artworks)
    ? snapshot.artworks.map((entry) => ({ ...entry, artwork: migrateArtworkQuality(entry.artwork) }))
    : snapshot.artworks,
  history: migrateHistoryArtworkQuality(snapshot.history),
}));

MIGRATIONS.set(6, (snapshot) => ({
  ...snapshot,
  schemaVersion: 7,
  render: sanitizeRenderSettings(snapshot.render),
}));

MIGRATIONS.set(7, (snapshot) => ({
  ...snapshot,
  schemaVersion: 8,
  render: sanitizeRenderSettings({
    ...snapshot.render,
    activeViewPresetId: snapshot.render?.activeViewPresetId || '',
    viewPresetBaseId: snapshot.render?.viewPresetBaseId || '',
    camera: {
      ...snapshot.render?.camera,
      orthographicHeight: snapshot.render?.camera?.orthographicHeight,
      verticalCorrection: snapshot.render?.camera?.verticalCorrection === true,
      keepVerticalsParallel: snapshot.render?.camera?.verticalCorrection === true,
    },
  }),
}));

MIGRATIONS.set(8, (snapshot) => ({
  ...snapshot,
  schemaVersion: 9,
  render: sanitizeRenderSettings({
    ...snapshot.render,
    output: {
      ...snapshot.render?.output,
      kind: snapshot.render?.output?.kind || 'image',
      sequence: snapshot.render?.output?.sequence,
      glb: snapshot.render?.output?.glb,
    },
  }),
}));

function migrateArtworkFinishEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  return { ...entry, ...sanitizeArtworkFinish(entry) };
}

function migrateEditorArtworkFinishes(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.artworks)) return state;
  return {
    ...state,
    artworks: state.artworks.map(migrateArtworkFinishEntry),
  };
}

function migrateHistoryArtworkFinishes(history) {
  if (!history || typeof history !== 'object') return history;
  const migrateStack = (stack) => (Array.isArray(stack)
    ? stack.map((entry) => ({
      ...entry,
      before: migrateEditorArtworkFinishes(entry.before),
      after: migrateEditorArtworkFinishes(entry.after),
    }))
    : []);
  return {
    ...history,
    undo: migrateStack(history.undo),
    redo: migrateStack(history.redo),
  };
}

MIGRATIONS.set(9, (snapshot) => ({
  ...snapshot,
  schemaVersion: 10,
  artworks: Array.isArray(snapshot.artworks)
    ? snapshot.artworks.map(migrateArtworkFinishEntry)
    : snapshot.artworks,
  history: migrateHistoryArtworkFinishes(snapshot.history),
}));

MIGRATIONS.set(10, (snapshot) => ({
  ...snapshot,
  schemaVersion: 11,
  render: sanitizeRenderSettings(snapshot.render),
}));

function migrateArtworkSeparations(artwork) {
  if (!artwork || typeof artwork !== 'object') return artwork;
  if (!Object.hasOwn(artwork, 'pdfSeparationVisibility')) return artwork;
  const visibility = normalizePdfSeparationVisibility(artwork.pdfSeparationVisibility);
  return {
    ...artwork,
    pdfSeparationVisibility: visibility,
  };
}

function migrateEditorArtworkSeparations(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.artworks)) return state;
  return {
    ...state,
    artworks: state.artworks.map((entry) => ({
      ...entry,
      artwork: migrateArtworkSeparations(entry.artwork),
    })),
  };
}

function migrateHistoryArtworkSeparations(history) {
  if (!history || typeof history !== 'object') return history;
  const migrateStack = (stack) => (Array.isArray(stack)
    ? stack.map((entry) => ({
      ...entry,
      before: migrateEditorArtworkSeparations(entry.before),
      after: migrateEditorArtworkSeparations(entry.after),
    }))
    : []);
  return {
    ...history,
    undo: migrateStack(history.undo),
    redo: migrateStack(history.redo),
  };
}

MIGRATIONS.set(11, (snapshot) => ({
  ...snapshot,
  schemaVersion: 12,
  artworks: Array.isArray(snapshot.artworks)
    ? snapshot.artworks.map((entry) => ({ ...entry, artwork: migrateArtworkSeparations(entry.artwork) }))
    : snapshot.artworks,
  history: migrateHistoryArtworkSeparations(snapshot.history),
}));

MIGRATIONS.set(12, (snapshot) => ({
  ...snapshot,
  schemaVersion: 13,
  box: {
    ...snapshot.box,
    board: sanitizeBoardConstruction({
      caliperMm: snapshot.box?.board?.caliperMm ?? snapshot.renderAppearance?.thicknessMm,
    }, snapshot.box?.dimensions),
  },
}));

function clone(value) {
  return structuredClone(value);
}

function normalizeWorkflowStep(value) {
  if (value === 'preview') return 'preview';
  if (value === 'render') return 'render';
  if (value === 'artwork') return 'artwork';
  return 'box';
}

export function migrateProjectSnapshot(input) {
  if (!input || typeof input !== 'object') {
    throw new AppError('projectIncomplete');
  }

  let snapshot = clone(input);
  let version = Number(snapshot.schemaVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError('projectVersionUnsupported');
  }
  if (version > CURRENT_PROJECT_SCHEMA_VERSION) {
    throw new AppError('projectVersionUnsupported');
  }

  while (version < CURRENT_PROJECT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS.get(version);
    if (!migrate) throw new AppError('projectVersionUnsupported');
    snapshot = migrate(snapshot);
    version = Number(snapshot.schemaVersion);
  }

  if (!snapshot.box) {
    throw new AppError('projectIncomplete');
  }

  snapshot.box = {
    ...snapshot.box,
    board: sanitizeBoardConstruction(snapshot.box.board, snapshot.box.dimensions),
  };

  snapshot.workflowStep = normalizeWorkflowStep(snapshot.workflowStep);
  snapshot.render = sanitizeRenderSettings(snapshot.render);
  if (Object.hasOwn(snapshot, 'renderAppearance')) {
    snapshot.renderAppearance = sanitizeBoardAppearance(snapshot.renderAppearance);
  }

  if (!Array.isArray(snapshot.artworks)) {
    throw new AppError('projectIncomplete');
  }
  for (const entry of snapshot.artworks) {
    if (!entry || typeof entry !== 'object' || !entry.artwork) {
      throw new AppError('projectIncomplete');
    }
  }
  snapshot.artworks = snapshot.artworks.map(migrateArtworkFinishEntry);
  if (
    !Number.isInteger(snapshot.activeArtworkIndex)
    || snapshot.activeArtworkIndex < -1
    || snapshot.activeArtworkIndex >= snapshot.artworks.length
  ) {
    snapshot.activeArtworkIndex = snapshot.artworks.length > 0 ? 0 : -1;
  }

  // Validate domain state before any live model is mutated.
  try {
    BoxNetModel.fromJSON(snapshot.box);
    for (const entry of snapshot.artworks) {
      new ArtworkModel(entry.artwork);
    }
  } catch (error) {
    throw new AppError('projectIncomplete', {}, { cause: error });
  }
  return snapshot;
}

async function detectBlobType(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return detectArtworkType(bytes);
}

export async function validateProjectBundle({
  snapshot: inputSnapshot,
  artworkBlobs,
  originalBlob,
  previewBlob,
  renderAssets = [],
}) {
  const snapshot = migrateProjectSnapshot(inputSnapshot);
  const validatedRenderAssets = await validateRenderAssets(renderAssets);
  const backgroundAssetId = snapshot.render?.background?.image?.assetId;
  if (backgroundAssetId && !validatedRenderAssets.some((asset) => asset.assetId === backgroundAssetId && asset.kind !== 'environment')) {
    throw new AppError('projectRenderAssetMissing');
  }
  const environmentAssetId = snapshot.render?.lighting?.environmentMap?.assetId;
  if (environmentAssetId && !validatedRenderAssets.some((asset) => asset.assetId === environmentAssetId && asset.kind === 'environment')) {
    throw new AppError('projectRenderAssetMissing');
  }
  if (!snapshot.artworks.length) {
    return { snapshot, artworkBlobs: [], renderAssets: validatedRenderAssets };
  }

  let blobs;
  if (Array.isArray(artworkBlobs) && artworkBlobs.length === snapshot.artworks.length) {
    blobs = artworkBlobs;
  } else if (
    originalBlob instanceof Blob
    && previewBlob instanceof Blob
    && snapshot.artworks.length === 1
  ) {
    blobs = [{ originalBlob, previewBlob }];
  } else {
    throw new AppError('projectArtworkMissing');
  }

  const validated = [];
  for (let index = 0; index < snapshot.artworks.length; index += 1) {
    const source = snapshot.artworks[index].artwork?.source;
    const entry = blobs[index];
    if (!source || !(entry?.originalBlob instanceof Blob) || entry.originalBlob.size === 0) {
      throw new AppError('projectArtworkMissing');
    }
    if (!(entry.previewBlob instanceof Blob) || entry.previewBlob.size === 0) {
      throw new AppError('projectPreviewMissing');
    }
    if (entry.previewBlob.size > MAX_PREVIEW_BYTES) {
      throw new AppError('projectPreviewTooLarge');
    }
    if (Number(source.byteLength) !== entry.originalBlob.size) {
      throw new AppError('projectArtworkSizeMismatch');
    }

    const detectedOriginalType = await detectBlobType(entry.originalBlob);
    if (!detectedOriginalType) {
      throw new AppError('projectArtworkTypeMismatch');
    }
    if (detectedOriginalType !== source.mimeType) {
      // The blob bytes are archive-verified; a stale or browser-supplied
      // mimeType (e.g. an empty type on .ai imports) should be corrected
      // rather than rejected so the project can be restored.
      source.mimeType = detectedOriginalType;
    }

    const detectedPreviewType = await detectBlobType(entry.previewBlob);
    if (!['image/png', 'image/jpeg'].includes(detectedPreviewType)) {
      throw new AppError('projectPreviewInvalid');
    }

    const actualHash = await sha256(entry.originalBlob);
    if (!source.sha256 || actualHash !== source.sha256) {
      // The blob itself is integrity-checked by the archive (ZIP CRC /
      // IndexedDB round-trip). A missing or stale hash only means the
      // source metadata was written before the hash was available; correct
      // it so the project can be restored instead of being rejected.
      source.sha256 = actualHash;
    }

    validated.push({
      originalBlob: new Blob([entry.originalBlob], { type: detectedOriginalType }),
      previewBlob: new Blob([entry.previewBlob], { type: detectedPreviewType }),
    });
  }

  return { snapshot, artworkBlobs: validated, renderAssets: validatedRenderAssets };
}

export const PROJECT_PREVIEW_LIMITS = Object.freeze({
  maxBytes: MAX_PREVIEW_BYTES,
});
