import { describe, expect, it } from 'vitest';

import { sha256 } from '../../src/artwork/fileValidation.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import {
  createProjectArchive,
  readProjectArchive,
} from '../../src/project/projectArchive.js';

async function createArtworkEntry(fileName) {
  const originalBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
  ], { type: 'image/png' });
  const previewBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]),
  ], { type: 'image/png' });
  const sourceHash = await sha256(originalBlob);
  return {
    artwork: {
      source: {
        id: `asset-${fileName}`,
        fileName,
        mimeType: 'image/png',
        byteLength: originalBlob.size,
        widthPx: 100,
        heightPx: 50,
        previewWidthPx: 100,
        previewHeightPx: 50,
        pageIndex: null,
        pageCount: null,
        vector: false,
        pdfPageRotation: 0,
        mediaBox: null,
        sha256: sourceHash,
      },
      centerXmm: 75,
      centerYmm: 45,
      initialWidthMm: 150,
      initialHeightMm: 75,
      scale: 1,
      rotation: 0,
      opacity: 1,
      modified: false,
    },
    originalBlob,
    previewBlob,
  };
}

async function createFixture() {
  const first = await createArtworkEntry('top.png');
  const second = await createArtworkEntry('bottom.png');
  const snapshot = {
    schemaVersion: 2,
    meta: { name: 'Unit project' },
    workflowStep: 'artwork',
    box: new BoxNetModel().toJSON(),
    artworks: [
      { artwork: first.artwork, visible: true },
      { artwork: second.artwork, visible: true },
    ],
    activeArtworkIndex: 0,
    view: {},
    history: { undo: [], redo: [] },
  };
  return {
    snapshot,
    artworkBlobs: [
      { originalBlob: first.originalBlob, previewBlob: first.previewBlob },
      { originalBlob: second.originalBlob, previewBlob: second.previewBlob },
    ],
  };
}

describe('.carton project archive', () => {
  it('round-trips the snapshot, multiple assets and previews', async () => {
    const { snapshot, artworkBlobs } = await createFixture();
    const archive = await createProjectArchive({ snapshot, artworkBlobs });
    const restored = await readProjectArchive(archive);

    expect(restored.snapshot).toEqual(snapshot);
    expect(restored.snapshot.artworks).toHaveLength(2);
    expect(restored.artworkBlobs).toHaveLength(2);
    for (let index = 0; index < artworkBlobs.length; index += 1) {
      expect(new Uint8Array(await restored.artworkBlobs[index].originalBlob.arrayBuffer())).toEqual(
        new Uint8Array(await artworkBlobs[index].originalBlob.arrayBuffer()),
      );
      expect(new Uint8Array(await restored.artworkBlobs[index].previewBlob.arrayBuffer())).toEqual(
        new Uint8Array(await artworkBlobs[index].previewBlob.arrayBuffer()),
      );
    }
  });

  it('rejects non-project ZIP data', async () => {
    await expect(readProjectArchive(new Blob(['not a zip']))).rejects.toMatchObject({
      code: 'projectArchiveInvalid',
    });
  });
});
