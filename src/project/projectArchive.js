import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

import { MAX_ARTWORK_BYTES } from '../artwork/fileValidation.js';
import { MAX_RENDER_BACKGROUND_BYTES } from '../render/renderAssets.js';
import { MAX_RENDER_ENVIRONMENT_BYTES } from '../render/environmentAssets.js';
import { AppError } from '../errors.js';
import { CURRENT_PROJECT_SCHEMA_VERSION, validateProjectBundle } from './projectSchema.js';

const FORMAT = 'carton-builder-project';
const FORMAT_VERSION = 5;
const LEGACY_FORMAT_VERSION = 1;
const MAX_ARCHIVE_BYTES = 120 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const MAX_TECHNICAL_MODEL_BYTES = 10 * 1024 * 1024;
const MAX_TECHNICAL_SVG_BYTES = 15 * 1024 * 1024;

function assertNotAborted(signal) {
  if (signal?.aborted) throw new DOMException('Project archive operation aborted.', 'AbortError');
}

function reportProgress(onProgress, fraction, stageKey, stageParams = {}) {
  onProgress?.({ fraction: Math.min(1, Math.max(0, fraction)), stageKey, stageParams });
}

function textSize(value) {
  return new Blob([value]).size;
}

function safeExtension(fileName) {
  return String(fileName || '')
    .split('.')
    .pop()
    ?.replace(/[^a-z0-9]/gi, '')
    .toLowerCase() || 'bin';
}

export async function createProjectArchive({
  snapshot,
  artworkBlobs,
  renderAssets = [],
  technicalAssets = null,
  signal,
  onProgress,
}) {
  assertNotAborted(signal);
  const validated = await validateProjectBundle({ snapshot, artworkBlobs, renderAssets, technicalAssets });
  assertNotAborted(signal);
  // Always write the current schema after migration. Older archives remain
  // readable through the normal v1-v3 compatibility path below.
  const assets = validated.snapshot.artworks.map((entry, index) => ({
    path: `assets/artwork-${index}.${safeExtension(entry.artwork.source.fileName)}`,
    sha256: entry.artwork.source.sha256,
  }));
  const manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    assets,
    previews: validated.snapshot.artworks.map((_, index) => `preview/artwork-${index}.png`),
    renderAssets: validated.renderAssets.map((asset) => ({
      path: `render-assets/${asset.assetId}.${safeExtension(asset.fileName)}`,
      assetId: asset.assetId,
      kind: asset.kind || 'background',
      sha256: asset.sha256,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
    })),
  };
  const technicalBundle = validated.technicalAssets?.bundle;
  const technicalManifest = technicalBundle ? {
    format: 'carton-builder-technical-assets',
    version: 1,
    source: technicalBundle.source,
    capabilities: technicalBundle.capabilities,
    model: {
      path: 'technical/model.json',
      mediaType: technicalBundle.modelJson.mediaType,
      byteLength: technicalBundle.modelJson.byteLength,
      sha256: technicalBundle.modelJson.sha256,
    },
    semanticSvg: {
      path: 'technical/dieline.svg',
      assetId: technicalBundle.semanticSvg.assetId,
      mediaType: technicalBundle.semanticSvg.mediaType,
      units: technicalBundle.semanticSvg.units,
      byteLength: technicalBundle.semanticSvg.byteLength,
      sha256: technicalBundle.semanticSvg.sha256,
    },
  } : null;
  if (technicalManifest) {
    manifest.technical = {
      manifestPath: 'technical/manifest.json',
      modelPath: technicalManifest.model.path,
      svgPath: technicalManifest.semanticSvg.path,
    };
  }

  const manifestText = JSON.stringify(manifest, null, 2);
  const snapshotText = JSON.stringify(validated.snapshot, null, 2);
  const entries = [
    { path: 'manifest.json', reader: new TextReader(manifestText), size: textSize(manifestText) },
    { path: 'project.json', reader: new TextReader(snapshotText), size: textSize(snapshotText) },
  ];
  if (technicalManifest) {
    const technicalManifestText = JSON.stringify(technicalManifest, null, 2);
    entries.push({
      path: 'technical/manifest.json',
      reader: new TextReader(technicalManifestText),
      size: textSize(technicalManifestText),
    });
    entries.push({
      path: technicalManifest.model.path,
      reader: new BlobReader(validated.technicalAssets.modelBlob),
      size: validated.technicalAssets.modelBlob.size,
    });
    entries.push({
      path: technicalManifest.semanticSvg.path,
      reader: new BlobReader(validated.technicalAssets.svgBlob),
      size: validated.technicalAssets.svgBlob.size,
    });
  }
  for (let index = 0; index < validated.artworkBlobs.length; index += 1) {
    const artwork = validated.artworkBlobs[index];
    entries.push({
      path: manifest.assets[index].path,
      reader: new BlobReader(artwork.originalBlob),
      size: artwork.originalBlob.size,
    });
    entries.push({
      path: manifest.previews[index],
      reader: new BlobReader(artwork.previewBlob),
      size: artwork.previewBlob.size,
    });
  }
  for (const asset of validated.renderAssets) {
    const manifestAsset = manifest.renderAssets.find((entry) => entry.assetId === asset.assetId);
    entries.push({ path: manifestAsset.path, reader: new BlobReader(asset.blob), size: asset.blob.size });
  }

  const totalBytes = Math.max(1, entries.reduce((sum, entry) => sum + entry.size, 0));
  let completedBytes = 0;
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  let closed = false;
  try {
    reportProgress(onProgress, 0.05, 'projectValidating');
    for (const entry of entries) {
      assertNotAborted(signal);
      await writer.add(entry.path, entry.reader, {
        signal,
        onprogress: (progress, total) => {
          const entryFraction = total > 0 ? progress / total : 0;
          reportProgress(
            onProgress,
            0.05 + ((completedBytes + entry.size * entryFraction) / totalBytes) * 0.9,
            'projectPacking',
            { fileName: entry.path },
          );
        },
      });
      completedBytes += entry.size;
      reportProgress(onProgress, 0.05 + (completedBytes / totalBytes) * 0.9, 'projectPacking', { fileName: entry.path });
    }
    assertNotAborted(signal);
    reportProgress(onProgress, 0.98, 'projectFinalizing');
    const result = await writer.close();
    closed = true;
    reportProgress(onProgress, 1, 'projectReady');
    return result;
  } finally {
    if (!closed) {
      try { await writer.close(); } catch { /* best effort cleanup */ }
    }
  }
}

export async function readProjectArchive(blob, { signal, onProgress } = {}) {
  assertNotAborted(signal);
  if (!(blob instanceof Blob) || blob.size === 0 || blob.size > MAX_ARCHIVE_BYTES) {
    throw new AppError('projectArchiveInvalid');
  }
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries({
      signal,
      onprogress: (index, total) => reportProgress(onProgress, total ? (index / total) * 0.1 : 0.05, 'projectReading'),
    });
    const entryNames = entries.map((entry) => entry.filename);
    if (new Set(entryNames).size !== entryNames.length) {
      throw new AppError('projectArchiveDuplicateEntry');
    }
    const byName = new Map(entries.map((entry) => [entry.filename, entry]));
    const manifestEntry = byName.get('manifest.json');
    const projectEntry = byName.get('project.json');
    if (!manifestEntry || !projectEntry) throw new AppError('projectIncomplete');
    if (manifestEntry.uncompressedSize > 64 * 1024 || projectEntry.uncompressedSize > 2 * 1024 * 1024) {
      throw new AppError('projectMetadataTooLarge');
    }

    const manifest = JSON.parse(await manifestEntry.getData(new TextWriter(), { signal }));
    if (manifest.format !== FORMAT) throw new AppError('projectVersionUnsupported');
    const snapshot = JSON.parse(await projectEntry.getData(new TextWriter(), { signal }));

    if (manifest.version === LEGACY_FORMAT_VERSION) {
      if (!/^assets\/[^/]+$/.test(manifest.asset)) throw new AppError('projectAssetPathInvalid');
      if (manifest.preview !== 'preview/artwork.png') throw new AppError('projectPreviewMissing');
      const assetEntry = byName.get(manifest.asset);
      const previewEntry = byName.get(manifest.preview);
      if (!assetEntry) throw new AppError('projectArtworkMissing');
      if (assetEntry.uncompressedSize > MAX_ARTWORK_BYTES) {
        throw new AppError('projectArtworkTooLarge');
      }
      if (!previewEntry) throw new AppError('projectPreviewMissing');
      if (previewEntry.uncompressedSize > MAX_PREVIEW_BYTES) {
        throw new AppError('projectPreviewTooLarge');
      }
      const result = await validateProjectBundle({
        snapshot,
        originalBlob: await assetEntry.getData(new BlobWriter(), { signal }),
        previewBlob: await previewEntry.getData(new BlobWriter(), { signal }),
      });
      if (Number(snapshot.schemaVersion) === 6) result.snapshot.schemaVersion = 7;
      else if (Number(snapshot.schemaVersion) < 8) result.snapshot.schemaVersion = snapshot.schemaVersion;
      reportProgress(onProgress, 1, 'projectReady');
      return result;
    }

    if (![2, 3, 4, FORMAT_VERSION].includes(manifest.version)) throw new AppError('projectVersionUnsupported');
    if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.previews)) {
      throw new AppError('projectIncomplete');
    }
    if (manifest.assets.some((asset) => !/^assets\/[^/]+$/.test(asset?.path))) {
      throw new AppError('projectAssetPathInvalid');
    }
    if (manifest.previews.some((path) => !/^preview\/[^/]+$/.test(path))) {
      throw new AppError('projectPreviewMissing');
    }

    const artworkBlobs = [];
    const hasTechnical = manifest.version >= 5 && snapshot.cartonSource?.mode === 'technical';
    if (snapshot.cartonSource?.mode === 'technical' && manifest.version < 5) {
      throw new AppError('projectTechnicalAssetMissing');
    }
    if (manifest.version >= 5 && manifest.technical && snapshot.cartonSource?.mode !== 'technical') {
      throw new AppError('projectTechnicalUnexpected');
    }
    const totalAssets = manifest.assets.length * 2
      + (manifest.version >= 3 ? manifest.renderAssets?.length || 0 : 0)
      + (hasTechnical ? 3 : 0);
    let completedAssets = 0;
    const readBlob = async (entry, stageParams) => {
      assertNotAborted(signal);
      const result = await entry.getData(new BlobWriter(), {
        signal,
        onprogress: (progress, total) => {
          const inner = total > 0 ? progress / total : 0;
          reportProgress(onProgress, 0.1 + ((completedAssets + inner) / Math.max(1, totalAssets)) * 0.85, 'projectReading', stageParams);
        },
      });
      completedAssets += 1;
      return result;
    };
    let technicalAssets = null;
    if (hasTechnical) {
      const descriptor = manifest.technical;
      if (!descriptor || descriptor.manifestPath !== 'technical/manifest.json'
        || descriptor.modelPath !== 'technical/model.json'
        || descriptor.svgPath !== 'technical/dieline.svg') {
        throw new AppError('projectTechnicalManifestMissing');
      }
      const technicalManifestEntry = byName.get(descriptor.manifestPath);
      const modelEntry = byName.get(descriptor.modelPath);
      const svgEntry = byName.get(descriptor.svgPath);
      if (!technicalManifestEntry || !modelEntry || !svgEntry) {
        throw new AppError('projectTechnicalAssetMissing');
      }
      if (technicalManifestEntry.uncompressedSize > 64 * 1024) {
        throw new AppError('projectMetadataTooLarge');
      }
      if (modelEntry.uncompressedSize > MAX_TECHNICAL_MODEL_BYTES) {
        throw new AppError('projectTechnicalModelTooLarge');
      }
      if (svgEntry.uncompressedSize > MAX_TECHNICAL_SVG_BYTES) {
        throw new AppError('projectTechnicalSvgTooLarge');
      }
      const technicalManifest = JSON.parse(await technicalManifestEntry.getData(new TextWriter(), { signal }));
      if (technicalManifest.format !== 'carton-builder-technical-assets' || technicalManifest.version !== 1) {
        throw new AppError('projectTechnicalManifestInvalid');
      }
      if (
        technicalManifest.model?.path !== descriptor.modelPath
        || technicalManifest.semanticSvg?.path !== descriptor.svgPath
      ) {
        throw new AppError('projectTechnicalManifestInvalid');
      }
      technicalAssets = {
        modelBlob: await readBlob(modelEntry, { fileName: descriptor.modelPath }),
        svgBlob: await readBlob(svgEntry, { fileName: descriptor.svgPath }),
      };
    }
    for (let index = 0; index < manifest.assets.length; index += 1) {
      const assetEntry = byName.get(manifest.assets[index].path);
      const previewEntry = byName.get(manifest.previews[index]);
      if (!assetEntry) throw new AppError('projectArtworkMissing');
      if (assetEntry.uncompressedSize > MAX_ARTWORK_BYTES) {
        throw new AppError('projectArtworkTooLarge');
      }
      if (!previewEntry) throw new AppError('projectPreviewMissing');
      if (previewEntry.uncompressedSize > MAX_PREVIEW_BYTES) {
        throw new AppError('projectPreviewTooLarge');
      }
      artworkBlobs.push({
        originalBlob: await readBlob(assetEntry, { fileName: manifest.assets[index].path }),
        previewBlob: await readBlob(previewEntry, { fileName: manifest.previews[index] }),
      });
    }
    const renderAssets = [];
    if (manifest.version >= 3) {
      if (!Array.isArray(manifest.renderAssets)) throw new AppError('projectIncomplete');
      if (manifest.renderAssets.some((asset) => !/^render-assets\/[a-f0-9]{64}\.[a-z0-9]+$/i.test(asset?.path))) {
        throw new AppError('projectAssetPathInvalid');
      }
      for (const manifestAsset of manifest.renderAssets) {
        const assetEntry = byName.get(manifestAsset.path);
        if (!assetEntry) throw new AppError('projectRenderAssetMissing');
        const kind = manifestAsset.kind === 'environment' ? 'environment' : 'background';
        const maxBytes = kind === 'environment' ? MAX_RENDER_ENVIRONMENT_BYTES : MAX_RENDER_BACKGROUND_BYTES;
        if (assetEntry.uncompressedSize > maxBytes) {
          throw new AppError(kind === 'environment' ? 'renderEnvironmentTooLarge' : 'renderBackgroundTooLarge');
        }
        renderAssets.push({
          ...manifestAsset,
          kind,
          blob: await readBlob(assetEntry, { fileName: manifestAsset.path }),
        });
      }
    }
    const result = await validateProjectBundle({ snapshot, artworkBlobs, renderAssets, technicalAssets });
    if (Number(snapshot.schemaVersion) === 6) result.snapshot.schemaVersion = 7;
    else if (Number(snapshot.schemaVersion) < 8) result.snapshot.schemaVersion = snapshot.schemaVersion;
    reportProgress(onProgress, 1, 'projectReady');
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (error instanceof AppError) throw error;
    throw new AppError('projectArchiveInvalid', {}, { cause: error });
  } finally {
    await reader.close();
  }
}
