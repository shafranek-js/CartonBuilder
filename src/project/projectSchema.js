import { ArtworkModel } from '../artwork/ArtworkModel.js';
import { detectArtworkType, sha256 } from '../artwork/fileValidation.js';
import { AppError } from '../errors.js';
import { BoxNetModel } from '../model/BoxNetModel.js';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from '../render/RenderSettings.js';

export const CURRENT_PROJECT_SCHEMA_VERSION = 3;

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
