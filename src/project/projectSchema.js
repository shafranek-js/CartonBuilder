import {
  ArtworkModel,
  ARTWORK_PREVIEW_QUALITY_OPTIONS,
  ARTWORK_RENDER_QUALITY_OPTIONS,
  DEFAULT_ARTWORK_QUALITY_SETTINGS,
} from '../artwork/ArtworkModel.js';
import { detectArtworkType, sha256 } from '../artwork/fileValidation.js';
import { AppError } from '../errors.js';
import { BoxNetModel } from '../model/BoxNetModel.js';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from '../render/RenderSettings.js';
import { sanitizeBoardAppearance } from '../render/BoardAppearance.js';

export const CURRENT_PROJECT_SCHEMA_VERSION = 6;

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
}) {
  const snapshot = migrateProjectSnapshot(inputSnapshot);
  if (!snapshot.artworks.length) {
    return { snapshot, artworkBlobs: [] };
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
    if (!detectedOriginalType || detectedOriginalType !== source.mimeType) {
      throw new AppError('projectArtworkTypeMismatch');
    }

    const detectedPreviewType = await detectBlobType(entry.previewBlob);
    if (!['image/png', 'image/jpeg'].includes(detectedPreviewType)) {
      throw new AppError('projectPreviewInvalid');
    }

    if (!source.sha256 || await sha256(entry.originalBlob) !== source.sha256) {
      throw new AppError('projectArtworkChecksumMismatch');
    }

    validated.push({
      originalBlob: new Blob([entry.originalBlob], { type: detectedOriginalType }),
      previewBlob: new Blob([entry.previewBlob], { type: detectedPreviewType }),
    });
  }

  return { snapshot, artworkBlobs: validated };
}

export const PROJECT_PREVIEW_LIMITS = Object.freeze({
  maxBytes: MAX_PREVIEW_BYTES,
});
