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
import { sanitizeConstruction } from '../model/ConstructionTemplates.js';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from '../render/RenderSettings.js';
import { sanitizeBoardAppearance } from '../render/BoardAppearance.js';
import { validateRenderAssets } from '../render/renderAssets.js';
import { sanitizeArtworkFinish } from '../render/FinishConfig.js';
import { sanitizePrepressSettings } from '../prepress/prepressState.js';
import { validateCartonWorkflowBundle } from '../workflow/index.js';

export const CURRENT_PROJECT_SCHEMA_VERSION = 17;

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
  ...(snapshot.cartonSource?.mode === 'quick'
    ? {
        cartonSource: {
          ...snapshot.cartonSource,
          box: {
            ...snapshot.cartonSource.box,
            board: sanitizeBoardConstruction({
              caliperMm: snapshot.cartonSource.box?.board?.caliperMm ?? snapshot.renderAppearance?.thicknessMm,
            }, snapshot.cartonSource.box?.dimensions),
          },
        },
      }
    : {
        box: {
          ...snapshot.box,
          board: sanitizeBoardConstruction({
            caliperMm: snapshot.box?.board?.caliperMm ?? snapshot.renderAppearance?.thicknessMm,
          }, snapshot.box?.dimensions),
        },
      }),
}));

// Wave 8B keeps legacy six-panel projects byte-for-byte compatible while
// making construction explicit. Generated STE/RTE elements are always
// derived from the canonical dimensions/board/parameters on restore.
MIGRATIONS.set(13, (snapshot) => {
  const migrated = { ...snapshot };
  const sourceBox = snapshot.cartonSource?.mode === 'quick' ? snapshot.cartonSource.box : snapshot.box;
  const dimensions = sourceBox?.dimensions;
  const board = sanitizeBoardConstruction(sourceBox?.board, dimensions);
  const construction = sanitizeConstruction(sourceBox?.construction, dimensions, board);
  migrated.schemaVersion = 14;
  if (snapshot.cartonSource?.mode === 'quick') {
    migrated.cartonSource = {
      ...snapshot.cartonSource,
      box: { ...sourceBox, board, construction },
    };
  } else {
    migrated.box = { ...sourceBox, board, construction };
  }
  return migrated;
});

MIGRATIONS.set(14, (snapshot) => ({
  ...snapshot,
  schemaVersion: 15,
  prepress: sanitizePrepressSettings({
    mode: 'technical-proof',
    ...(snapshot.prepress || {}),
  }),
}));

MIGRATIONS.set(15, (snapshot) => {
  const migrated = { ...snapshot };
  migrated.schemaVersion = 16;
  if (snapshot.box && !snapshot.cartonSource) {
    migrated.cartonSource = {
      mode: 'quick',
      box: { ...snapshot.box },
    };
  }
  delete migrated.box;
  return migrated;
});

MIGRATIONS.set(16, (snapshot) => ({
  ...snapshot,
  schemaVersion: 17,
  workflowSelection: snapshot.cartonSource?.mode === 'technical'
    ? 'technical'
    : snapshot.workflowSelection === 'technical' || snapshot.workflowSelection === 'quick'
      ? snapshot.workflowSelection
      : 'quick',
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

function normalizeWorkflowSelection(value, cartonSource) {
  if (cartonSource?.mode === 'technical') return 'technical';
  if (value === 'technical') return 'technical';
  if (value === 'quick') return 'quick';
  return cartonSource?.mode === 'technical' ? 'technical' : 'quick';
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

  if (!snapshot.cartonSource || typeof snapshot.cartonSource !== 'object') {
    if (snapshot.box) {
      snapshot.cartonSource = {
        mode: 'quick',
        box: snapshot.box,
      };
      delete snapshot.box;
    } else {
      throw new AppError('projectIncomplete');
    }
  }

  const cartonSource = snapshot.cartonSource;
  if (cartonSource.mode === 'quick') {
    if (!cartonSource.box || typeof cartonSource.box !== 'object') {
      throw new AppError('projectIncomplete');
    }
    cartonSource.box = {
      ...cartonSource.box,
      board: sanitizeBoardConstruction(cartonSource.box.board, cartonSource.box.dimensions),
    };
    cartonSource.box.construction = sanitizeConstruction(
      cartonSource.box.construction,
      cartonSource.box.dimensions,
      cartonSource.box.board,
    );

    // Validate domain state before any live model is mutated.
    try {
      BoxNetModel.fromJSON(cartonSource.box);
    } catch (error) {
      throw new AppError('projectIncomplete', {}, { cause: error });
    }
  } else if (cartonSource.mode === 'technical') {
    const src = cartonSource.source;
    if (!src || typeof src !== 'object') {
      throw new AppError('projectIncomplete');
    }
    if (src.modelSchemaVersion !== 'pbd.model.v1' || src.svgSchemaVersion !== 'pbd.svg.v4') {
      throw new AppError('projectVersionUnsupported');
    }
    if (
      typeof cartonSource.modelSha256 !== 'string'
      || !/^[a-f0-9]{64}$/i.test(cartonSource.modelSha256)
      || typeof cartonSource.svgSha256 !== 'string'
      || !/^[a-f0-9]{64}$/i.test(cartonSource.svgSha256)
    ) {
      throw new AppError('projectIncomplete');
    }
  } else {
    throw new AppError('projectVersionUnsupported');
  }

  snapshot.workflowStep = normalizeWorkflowStep(snapshot.workflowStep);
  snapshot.workflowSelection = normalizeWorkflowSelection(snapshot.workflowSelection, cartonSource);
  snapshot.render = sanitizeRenderSettings(snapshot.render);
  snapshot.prepress = sanitizePrepressSettings(snapshot.prepress);
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

  try {
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

async function validateTechnicalAssets(snapshot, technicalAssets) {
  if (snapshot.cartonSource?.mode !== 'technical') return technicalAssets;

  const source = snapshot.cartonSource.source;
  const modelMeta = snapshot.cartonSource.modelJson;
  const svgMeta = snapshot.cartonSource.semanticSvg;
  const modelBlob = technicalAssets?.modelBlob || technicalAssets?.modelJsonBlob;
  const svgBlob = technicalAssets?.svgBlob || technicalAssets?.semanticSvgBlob;

  if (!(modelBlob instanceof Blob) || !(svgBlob instanceof Blob)) {
    throw new AppError('projectTechnicalAssetMissing');
  }
  if (!modelMeta || !svgMeta) {
    throw new AppError('projectTechnicalMetadataMissing');
  }

  const [modelSha256, svgSha256] = await Promise.all([sha256(modelBlob), sha256(svgBlob)]);
  const modelExpectedSha = modelMeta.sha256 || snapshot.cartonSource.modelSha256;
  const svgExpectedSha = svgMeta.sha256 || snapshot.cartonSource.svgSha256;
  if (
    modelBlob.size !== Number(modelMeta.byteLength)
    || modelSha256.toLowerCase() !== String(modelExpectedSha).toLowerCase()
    || modelSha256.toLowerCase() !== String(snapshot.cartonSource.modelSha256).toLowerCase()
  ) {
    throw new AppError('projectTechnicalModelChecksumMismatch');
  }
  if (
    svgBlob.size !== Number(svgMeta.byteLength)
    || svgSha256.toLowerCase() !== String(svgExpectedSha).toLowerCase()
    || svgSha256.toLowerCase() !== String(snapshot.cartonSource.svgSha256).toLowerCase()
  ) {
    throw new AppError('projectTechnicalSvgChecksumMismatch');
  }

  const [modelText, svgMarkup] = await Promise.all([modelBlob.text(), svgBlob.text()]);
  const bundle = {
    contractVersion: 'carton-workflow.v1',
    workflowMode: 'technical',
    source,
    modelJson: {
      mediaType: modelMeta.mediaType,
      byteLength: modelBlob.size,
      sha256: modelSha256,
      text: modelText,
    },
    semanticSvg: {
      assetId: svgMeta.assetId,
      mediaType: svgMeta.mediaType,
      byteLength: svgBlob.size,
      sha256: svgSha256,
      units: svgMeta.units || 'mm',
      markup: svgMarkup,
    },
    capabilities: snapshot.cartonSource.capabilities || {
      artwork2d: true,
      flatExport: true,
      foldPreview: true,
      technicalRender: false,
    },
  };
  const validation = await validateCartonWorkflowBundle(bundle);
  if (!validation.valid) {
    throw new AppError('cartonWorkflowInvalid', {
      errors: validation.errors,
      issues: validation.issues,
    });
  }
  return { modelBlob, svgBlob, bundle };
}

export async function validateProjectBundle({
  snapshot: inputSnapshot,
  artworkBlobs,
  originalBlob,
  previewBlob,
  renderAssets = [],
  technicalAssets = null,
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

  const validatedTechnicalAssets = await validateTechnicalAssets(snapshot, technicalAssets);

  if (!snapshot.artworks.length) {
    return { snapshot, artworkBlobs: [], renderAssets: validatedRenderAssets, technicalAssets: validatedTechnicalAssets };
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

  return { snapshot, artworkBlobs: validated, renderAssets: validatedRenderAssets, technicalAssets: validatedTechnicalAssets };
}

export const PROJECT_PREVIEW_LIMITS = Object.freeze({
  maxBytes: MAX_PREVIEW_BYTES,
});
