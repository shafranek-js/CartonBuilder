import { ArtworkModel } from '../artwork/ArtworkModel.js';
import { detectArtworkType, sha256 } from '../artwork/fileValidation.js';
import { AppError } from '../errors.js';
import { BoxNetModel } from '../model/BoxNetModel.js';

export const CURRENT_PROJECT_SCHEMA_VERSION = 1;

const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const MIGRATIONS = new Map();

function clone(value) {
  return structuredClone(value);
}

function normalizeWorkflowStep(value) {
  return value === 'preview' ? 'preview' : 'artwork';
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

  if (!snapshot.box || !snapshot.artwork?.source) {
    throw new AppError('projectIncomplete');
  }

  snapshot.workflowStep = normalizeWorkflowStep(snapshot.workflowStep);

  // Validate domain state before any live model is mutated.
  try {
    BoxNetModel.fromJSON(snapshot.box);
    new ArtworkModel(snapshot.artwork);
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
  originalBlob,
  previewBlob,
}) {
  const snapshot = migrateProjectSnapshot(inputSnapshot);
  const source = snapshot.artwork.source;

  if (!(originalBlob instanceof Blob) || originalBlob.size === 0) {
    throw new AppError('projectArtworkMissing');
  }
  if (!(previewBlob instanceof Blob) || previewBlob.size === 0) {
    throw new AppError('projectPreviewMissing');
  }
  if (previewBlob.size > MAX_PREVIEW_BYTES) {
    throw new AppError('projectPreviewTooLarge');
  }
  if (Number(source.byteLength) !== originalBlob.size) {
    throw new AppError('projectArtworkSizeMismatch');
  }

  const detectedOriginalType = await detectBlobType(originalBlob);
  if (!detectedOriginalType || detectedOriginalType !== source.mimeType) {
    throw new AppError('projectArtworkTypeMismatch');
  }

  const detectedPreviewType = await detectBlobType(previewBlob);
  if (!['image/png', 'image/jpeg'].includes(detectedPreviewType)) {
    throw new AppError('projectPreviewInvalid');
  }

  if (!source.sha256 || await sha256(originalBlob) !== source.sha256) {
    throw new AppError('projectArtworkChecksumMismatch');
  }

  return {
    snapshot,
    originalBlob: new Blob([originalBlob], { type: detectedOriginalType }),
    previewBlob: new Blob([previewBlob], { type: detectedPreviewType }),
  };
}

export const PROJECT_PREVIEW_LIMITS = Object.freeze({
  maxBytes: MAX_PREVIEW_BYTES,
});
