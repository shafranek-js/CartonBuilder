import { describe, expect, it } from 'vitest';

import { sha256 } from '../../src/artwork/fileValidation.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import {
  migrateProjectSnapshot,
  validateProjectBundle,
} from '../../src/project/projectSchema.js';

async function createBundle() {
  const originalBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]),
  ], { type: 'image/png' });
  const previewBlob = new Blob([
    Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 8]),
  ], { type: 'image/jpeg' });
  const sourceHash = await sha256(originalBlob);

  return {
    originalBlob,
    previewBlob,
    snapshot: {
      schemaVersion: 1,
      workflowStep: 'preview',
      box: new BoxNetModel().toJSON(),
      artwork: {
        source: {
          id: 'asset',
          fileName: 'asset.png',
          mimeType: 'image/png',
          byteLength: originalBlob.size,
          widthPx: 200,
          heightPx: 100,
          previewWidthPx: 200,
          previewHeightPx: 100,
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

describe('project schema', () => {
  it('normalizes version 1 into an independent snapshot', async () => {
    const { snapshot } = await createBundle();
    const migrated = migrateProjectSnapshot(snapshot);

    expect(migrated).toEqual(snapshot);
    expect(migrated).not.toBe(snapshot);
    migrated.artwork.centerXmm = 1;
    expect(snapshot.artwork.centerXmm).toBe(75);
  });

  it('normalizes unknown workflow modes and rejects unknown schema versions', async () => {
    const { snapshot } = await createBundle();
    expect(migrateProjectSnapshot({ ...snapshot, workflowStep: 'box' }).workflowStep).toBe('artwork');
    expect(() => migrateProjectSnapshot({ ...snapshot, schemaVersion: 2 })).toThrowError(
      expect.objectContaining({ code: 'projectVersionUnsupported' }),
    );
  });

  it('validates blobs, metadata and checksum before restoration', async () => {
    const bundle = await createBundle();
    const valid = await validateProjectBundle(bundle);
    expect(valid.snapshot.workflowStep).toBe('preview');
    expect(valid.originalBlob.type).toBe('image/png');
    expect(valid.previewBlob.type).toBe('image/jpeg');

    await expect(validateProjectBundle({
      ...bundle,
      originalBlob: null,
    })).rejects.toMatchObject({ code: 'projectArtworkMissing' });

    await expect(validateProjectBundle({
      ...bundle,
      snapshot: {
        ...bundle.snapshot,
        artwork: {
          ...bundle.snapshot.artwork,
          source: { ...bundle.snapshot.artwork.source, byteLength: 999 },
        },
      },
    })).rejects.toMatchObject({ code: 'projectArtworkSizeMismatch' });

    await expect(validateProjectBundle({
      ...bundle,
      snapshot: {
        ...bundle.snapshot,
        artwork: {
          ...bundle.snapshot.artwork,
          source: { ...bundle.snapshot.artwork.source, sha256: 'bad-hash' },
        },
      },
    })).rejects.toMatchObject({ code: 'projectArtworkChecksumMismatch' });
  });
});
