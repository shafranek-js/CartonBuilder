import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

import { MAX_ARTWORK_BYTES, sha256 } from '../artwork/fileValidation.js';

const FORMAT = 'carton-builder-project';
const VERSION = 1;
const MAX_ARCHIVE_BYTES = 120 * 1024 * 1024;

function safeAssetName(fileName) {
  const extension = String(fileName || '').split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `artwork.${extension || 'bin'}`;
}

export async function createProjectArchive({ snapshot, originalBlob, previewBlob }) {
  if (!snapshot || !originalBlob || !previewBlob) {
    throw new Error('A project, artwork and preview are required.');
  }
  const assetName = safeAssetName(snapshot.artwork?.source?.fileName);
  const assetHash = await sha256(originalBlob);
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
  await writer.add('project.json', new TextReader(JSON.stringify(snapshot, null, 2)));
  await writer.add(manifest.asset, new BlobReader(originalBlob));
  if (previewBlob) await writer.add(manifest.preview, new BlobReader(previewBlob));
  return writer.close();
}

export async function readProjectArchive(blob) {
  if (!(blob instanceof Blob) || blob.size === 0 || blob.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Choose a valid .carton project up to 120 MB.');
  }
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const byName = new Map(entries.map((entry) => [entry.filename, entry]));
    const manifestEntry = byName.get('manifest.json');
    const projectEntry = byName.get('project.json');
    if (!manifestEntry || !projectEntry) throw new Error('The project archive is incomplete.');
    if (manifestEntry.uncompressedSize > 64 * 1024 || projectEntry.uncompressedSize > 2 * 1024 * 1024) {
      throw new Error('The project metadata is too large.');
    }

    const manifest = JSON.parse(await manifestEntry.getData(new TextWriter()));
    if (manifest.format !== FORMAT || manifest.version !== VERSION) {
      throw new Error('Unsupported project format.');
    }
    if (!/^assets\/[^/]+$/.test(manifest.asset)) throw new Error('Invalid project asset path.');
    if (manifest.preview !== 'preview/artwork.png') throw new Error('The project preview is missing.');

    const assetEntry = byName.get(manifest.asset);
    if (!assetEntry) throw new Error('The project artwork is missing.');
    if (assetEntry.uncompressedSize > MAX_ARTWORK_BYTES) {
      throw new Error('The project artwork exceeds 100 MB.');
    }
    const originalBlob = await assetEntry.getData(new BlobWriter());
    if (await sha256(originalBlob) !== manifest.assetSha256) {
      throw new Error('The project artwork checksum does not match.');
    }

    const previewEntry = byName.get(manifest.preview);
    if (!previewEntry) throw new Error('The project preview is missing.');
    if (previewEntry.uncompressedSize > 32 * 1024 * 1024) {
      throw new Error('The project preview is too large.');
    }
    const snapshot = JSON.parse(await projectEntry.getData(new TextWriter()));
    if (
      snapshot?.schemaVersion !== 1
      || !snapshot.box
      || !snapshot.artwork?.source
      || snapshot.artwork.source.sha256 !== manifest.assetSha256
    ) {
      throw new Error('The project data does not match its artwork.');
    }
    return {
      snapshot,
      originalBlob,
      previewBlob: await previewEntry.getData(new BlobWriter('image/png')),
    };
  } finally {
    await reader.close();
  }
}
