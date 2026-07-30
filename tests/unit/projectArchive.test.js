import { describe, expect, it } from 'vitest';

import { sha256 } from '../../src/artwork/fileValidation.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import {
  createProjectArchive,
  readProjectArchive,
} from '../../src/project/projectArchive.js';

async function createFixture() {
  const originalBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
  ], { type: 'image/png' });
  const previewBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]),
  ], { type: 'image/png' });
  const sourceHash = await sha256(originalBlob);

  return {
    originalBlob,
    previewBlob,
    snapshot: {
      schemaVersion: 1,
      meta: { name: 'Unit project' },
      workflowStep: 'artwork',
      box: new BoxNetModel().toJSON(),
      artwork: {
        source: {
          id: 'asset',
          fileName: 'private-name.png',
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
      view: {},
      history: { undo: [], redo: [] },
    },
  };
}

describe('.carton project archive', () => {
  it('round-trips the snapshot, original asset and preview', async () => {
    const { snapshot, originalBlob, previewBlob } = await createFixture();
    const archive = await createProjectArchive({ snapshot, originalBlob, previewBlob });
    const restored = await readProjectArchive(archive);

    expect(restored.snapshot).toEqual(snapshot);
    expect(new Uint8Array(await restored.originalBlob.arrayBuffer())).toEqual(
      new Uint8Array(await originalBlob.arrayBuffer()),
    );
    expect(new Uint8Array(await restored.previewBlob.arrayBuffer())).toEqual(
      new Uint8Array(await previewBlob.arrayBuffer()),
    );
  });

  it('rejects non-project ZIP data', async () => {
    await expect(readProjectArchive(new Blob(['not a zip']))).rejects.toMatchObject({
      code: 'projectArchiveInvalid',
    });
  });
});
