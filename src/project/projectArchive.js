import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

import { MAX_ARTWORK_BYTES, sha256 } from '../artwork/fileValidation.js';
import { AppError } from '../errors.js';
import { CURRENT_PROJECT_SCHEMA_VERSION, validateProjectBundle } from './projectSchema.js';

const FORMAT = 'carton-builder-project';
const VERSION = CURRENT_PROJECT_SCHEMA_VERSION;
const MAX_ARCHIVE_BYTES = 120 * 1024 * 1024;

function safeAssetName(fileName) {
  const extension = String(fileName || '').split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `artwork.${extension || 'bin'}`;
}

export async function createProjectArchive({ snapshot, originalBlob, previewBlob }) {
  const validated = await validateProjectBundle({ snapshot, originalBlob, previewBlob });
  const assetName = safeAssetName(validated.snapshot.artwork.source.fileName);
  const assetHash = validated.snapshot.artwork.source.sha256;
  const manifest = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    asset: `assets/${assetName}`,
    assetSha256: assetHash,
    preview: previewBlob ? 'preview/artwork.png' : null,
  };

  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('manifest.json', new TextReader(JSON.stringify(manifest, null, 2)));
  await writer.add('project.json', new TextReader(JSON.stringify(validated.snapshot, null, 2)));
  await writer.add(manifest.asset, new BlobReader(validated.originalBlob));
  await writer.add(manifest.preview, new BlobReader(validated.previewBlob));
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
    if (manifest.format !== FORMAT || manifest.version !== VERSION) {
      throw new AppError('projectVersionUnsupported');
    }
    if (!/^assets\/[^/]+$/.test(manifest.asset)) throw new AppError('projectAssetPathInvalid');
    if (manifest.preview !== 'preview/artwork.png') throw new AppError('projectPreviewMissing');

    const assetEntry = byName.get(manifest.asset);
    if (!assetEntry) throw new AppError('projectArtworkMissing');
    if (assetEntry.uncompressedSize > MAX_ARTWORK_BYTES) {
      throw new AppError('projectArtworkTooLarge');
    }
    const originalBlob = await assetEntry.getData(new BlobWriter());

    const previewEntry = byName.get(manifest.preview);
    if (!previewEntry) throw new AppError('projectPreviewMissing');
    if (previewEntry.uncompressedSize > 32 * 1024 * 1024) {
      throw new AppError('projectPreviewTooLarge');
    }
    const snapshot = JSON.parse(await projectEntry.getData(new TextWriter()));
    if (
      !snapshot?.artwork?.source
      || snapshot.artwork.source.sha256 !== manifest.assetSha256
      || await sha256(originalBlob) !== manifest.assetSha256
    ) {
      throw new AppError('projectArtworkChecksumMismatch');
    }
    return validateProjectBundle({
      snapshot,
      originalBlob,
      previewBlob: await previewEntry.getData(new BlobWriter()),
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('projectArchiveInvalid', {}, { cause: error });
  } finally {
    await reader.close();
  }
}
