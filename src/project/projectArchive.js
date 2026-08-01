import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

import { MAX_ARTWORK_BYTES } from '../artwork/fileValidation.js';
import { AppError } from '../errors.js';
import { CURRENT_PROJECT_SCHEMA_VERSION, validateProjectBundle } from './projectSchema.js';

const FORMAT = 'carton-builder-project';
const FORMAT_VERSION = 2;
const LEGACY_FORMAT_VERSION = 1;
const MAX_ARCHIVE_BYTES = 120 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;

function safeExtension(fileName) {
  return String(fileName || '')
    .split('.')
    .pop()
    ?.replace(/[^a-z0-9]/gi, '')
    .toLowerCase() || 'bin';
}

export async function createProjectArchive({ snapshot, artworkBlobs }) {
  const validated = await validateProjectBundle({ snapshot, artworkBlobs });
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
  };

  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('manifest.json', new TextReader(JSON.stringify(manifest, null, 2)));
  await writer.add('project.json', new TextReader(JSON.stringify(validated.snapshot, null, 2)));
  for (let index = 0; index < validated.artworkBlobs.length; index += 1) {
    await writer.add(manifest.assets[index].path, new BlobReader(validated.artworkBlobs[index].originalBlob));
    await writer.add(manifest.previews[index], new BlobReader(validated.artworkBlobs[index].previewBlob));
  }
  return writer.close();
}

export async function readProjectArchive(blob) {
  if (!(blob instanceof Blob) || blob.size === 0 || blob.size > MAX_ARCHIVE_BYTES) {
    throw new AppError('projectArchiveInvalid');
  }
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const byName = new Map(entries.map((entry) => [entry.filename, entry]));
    const manifestEntry = byName.get('manifest.json');
    const projectEntry = byName.get('project.json');
    if (!manifestEntry || !projectEntry) throw new AppError('projectIncomplete');
    if (manifestEntry.uncompressedSize > 64 * 1024 || projectEntry.uncompressedSize > 2 * 1024 * 1024) {
      throw new AppError('projectMetadataTooLarge');
    }

    const manifest = JSON.parse(await manifestEntry.getData(new TextWriter()));
    if (manifest.format !== FORMAT) throw new AppError('projectVersionUnsupported');
    const snapshot = JSON.parse(await projectEntry.getData(new TextWriter()));

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
      return validateProjectBundle({
        snapshot,
        originalBlob: await assetEntry.getData(new BlobWriter()),
        previewBlob: await previewEntry.getData(new BlobWriter()),
      });
    }

    if (manifest.version !== FORMAT_VERSION) throw new AppError('projectVersionUnsupported');
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
        originalBlob: await assetEntry.getData(new BlobWriter()),
        previewBlob: await previewEntry.getData(new BlobWriter()),
      });
    }
    return validateProjectBundle({ snapshot, artworkBlobs });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('projectArchiveInvalid', {}, { cause: error });
  } finally {
    await reader.close();
  }
}
