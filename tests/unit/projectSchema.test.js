import { describe, expect, it } from 'vitest';

import { sha256 } from '../../src/artwork/fileValidation.js';
import { ArtworkModel } from '../../src/artwork/ArtworkModel.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
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

  const artwork = {
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
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    quality: { preview: 'auto', render: 'auto' },
    modified: false,
  };

  return {
    originalBlob,
    previewBlob,
    artwork,
    snapshot: {
      schemaVersion: 1,
      workflowStep: 'preview',
      box: new BoxNetModel().toJSON(),
      artwork,
      view: {},
      history: { undo: [], redo: [] },
    },
  };
}

describe('project schema', () => {
  it('migrates version 1 into an independent v2 snapshot with artworks', async () => {
    const { snapshot, artwork } = await createBundle();
    const migrated = migrateProjectSnapshot(snapshot);

    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migrated.render).toMatchObject({ presetId: 'clean-studio', aspect: 'square', longEdge: 2048 });
    expect(migrated.artworks).toEqual([{ artwork, visible: true, outputRole: 'print', finish: null }]);
    expect(migrated.activeArtworkIndex).toBe(0);
    expect(migrated).not.toBe(snapshot);
    migrated.artworks[0].artwork.centerXmm = 1;
    expect(snapshot.artwork.centerXmm).toBe(75);
  });

  it('migrates v2 snapshots through v6 without changing uncropped artwork and box data', async () => {
    const { snapshot } = await createBundle();
    const v2 = migrateProjectSnapshot(snapshot);
    const canonical = {
      box: structuredClone(v2.cartonSource.box),
      artworks: structuredClone(v2.artworks),
      history: structuredClone(v2.history),
      view: structuredClone(v2.view),
    };
    delete v2.render;
    v2.schemaVersion = 2;
    const migrated = migrateProjectSnapshot(v2);

    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migrated.render).toMatchObject({ presetId: 'clean-studio', longEdge: 2048 });
    expect(migrated.render.effects).toMatchObject({ gtao: { enabled: true }, dof: { enabled: false } });
    expect(migrated.render.boardAppearance).toBeUndefined();
    expect(migrated.cartonSource.box).toEqual(canonical.box);
    expect(migrated.artworks).toEqual(canonical.artworks);
    expect(migrated.history).toEqual(canonical.history);
    expect(migrated.view).toEqual(canonical.view);
  });

  it('rebases v4 cropped artwork and history to a visual-equivalent 100 percent baseline', async () => {
    const { snapshot } = await createBundle();
    const v4 = migrateProjectSnapshot(snapshot);
    const cropped = {
      ...v4.artworks[0].artwork,
      initialWidthMm: 150,
      initialHeightMm: 75,
      scaleX: 0.5,
      scaleY: 0.75,
      scale: undefined,
      crop: { x: 10, y: 8, width: 40, height: 30 },
    };
    const historyState = {
      artworks: [{ artwork: cropped, visible: true }],
      activeArtworkIndex: 0,
    };
    v4.schemaVersion = 4;
    v4.artworks = [{ artwork: cropped, visible: true }];
    v4.history = {
      undo: [{ label: 'Crop artwork', before: historyState, after: historyState }],
      redo: [{ label: 'Crop artwork', before: historyState, after: historyState }],
    };

    const migrated = migrateProjectSnapshot(v4);
    const current = migrated.artworks[0].artwork;
    const historyArtwork = migrated.history.undo[0].after.artworks[0].artwork;

    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(current).toMatchObject({
      initialWidthMm: 75,
      initialHeightMm: 56.25,
      scaleX: 1,
      scaleY: 1,
      crop: { x: 10, y: 8, width: 40, height: 30 },
    });
    expect(historyArtwork).toMatchObject({
      initialWidthMm: 75,
      initialHeightMm: 56.25,
      scaleX: 1,
      scaleY: 1,
    });
    expect(migrated.history.redo[0].before.artworks[0].artwork.scaleX).toBe(1);
  });

  it('adds independent quality defaults to v5 artwork and history snapshots', async () => {
    const { snapshot } = await createBundle();
    const v5 = migrateProjectSnapshot(snapshot);
    delete v5.artworks[0].artwork.quality;
    const historyState = {
      artworks: [{ artwork: { ...v5.artworks[0].artwork }, visible: true }],
      activeArtworkIndex: 0,
    };
    delete historyState.artworks[0].artwork.quality;
    v5.schemaVersion = 5;
    v5.history = { undo: [{ label: 'legacy', before: historyState, after: historyState }], redo: [] };

    const migrated = migrateProjectSnapshot(v5);

    expect(migrated.artworks[0].artwork.quality).toEqual({ preview: 'auto', render: 'auto' });
    expect(migrated.history.undo[0].before.artworks[0].artwork.quality)
      .toEqual({ preview: 'auto', render: 'auto' });
  });

  it('normalizes unknown workflow modes and rejects unknown schema versions', async () => {
    const { snapshot } = await createBundle();
    expect(migrateProjectSnapshot({ ...snapshot, workflowStep: 'unknown' }).workflowStep).toBe('box');
    expect(migrateProjectSnapshot({ ...snapshot, workflowStep: 'box' }).workflowStep).toBe('box');
    expect(() => migrateProjectSnapshot({ ...snapshot, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION + 1 })).toThrowError(
      expect.objectContaining({ code: 'projectVersionUnsupported' }),
    );
  });

  it('migrates v12 render thickness into canonical v13 board caliper', async () => {
    const { snapshot } = await createBundle();
    const v12 = migrateProjectSnapshot(snapshot);
    v12.schemaVersion = 12;
    delete v12.cartonSource.box.board;
    v12.renderAppearance = { thicknessMm: 0.82, bevelRadiusMm: 0.1, interiorColor: '#f4f2ec', edgeColor: '#c8c1b5' };
    const migrated = migrateProjectSnapshot(v12);
    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migrated.cartonSource.box.board).toEqual({ caliperMm: 0.82 });
    expect(migrated.renderAppearance.thicknessMm).toBeCloseTo(0.82);
  });

  it('migrates v8 output settings additively to the v9 export contract', async () => {
    const { snapshot } = await createBundle();
    const v8 = migrateProjectSnapshot(snapshot);
    v8.schemaVersion = 8;
    delete v8.render.output;

    const migrated = migrateProjectSnapshot(v8);

    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migrated.render.output).toMatchObject({
      kind: 'image',
      sequence: { frames: 36, longEdge: 1024, format: 'png' },
      glb: { textureSize: 'auto', materialMode: 'full-pbr', includeCamera: true },
    });
  });

  it('migrates v9 artwork entries to schema v10 finish defaults without losing history', async () => {
    const { snapshot } = await createBundle();
    const v9 = migrateProjectSnapshot(snapshot);
    v9.schemaVersion = 9;
    v9.artworks[0].outputRole = 'finish';
    v9.artworks[0].finish = { type: 'emboss', reliefStrength: 0.6 };
    v9.history = {
      undo: [{
        label: 'finish',
        before: { artworks: [{ artwork: v9.artworks[0].artwork, visible: true }], activeArtworkIndex: 0 },
        after: { artworks: [{ ...v9.artworks[0] }], activeArtworkIndex: 0 },
      }],
      redo: [],
    };

    const migrated = migrateProjectSnapshot(v9);

    expect(migrated.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(migrated.artworks[0]).toMatchObject({
      outputRole: 'finish',
      finish: { type: 'emboss', reliefStrength: 0.6 },
    });
    expect(migrated.history.undo[0].before.artworks[0]).toMatchObject({
      outputRole: 'print',
      finish: null,
    });
    expect(migrated.history.undo[0].after.artworks[0]).toMatchObject({
      outputRole: 'finish',
      finish: { type: 'emboss', reliefStrength: 0.6 },
    });
  });

  it('validates blobs, metadata and checksum before restoration', async () => {
    const bundle = await createBundle();
    const valid = await validateProjectBundle(bundle);
    expect(valid.snapshot.workflowStep).toBe('preview');
    expect(valid.snapshot.artworks).toHaveLength(1);
    expect(valid.artworkBlobs).toHaveLength(1);
    expect(valid.artworkBlobs[0].originalBlob.type).toBe('image/png');
    expect(valid.artworkBlobs[0].previewBlob.type).toBe('image/jpeg');

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

    const expectedHash = bundle.snapshot.artwork.source.sha256;
    const staleHash = await validateProjectBundle({
      ...bundle,
      snapshot: {
        ...bundle.snapshot,
        artwork: {
          ...bundle.snapshot.artwork,
          source: { ...bundle.snapshot.artwork.source, sha256: 'stale-hash' },
        },
      },
    });
    expect(staleHash.snapshot.artworks[0].artwork.source.sha256).toBe(expectedHash);

    const missingHash = await validateProjectBundle({
      ...bundle,
      snapshot: {
        ...bundle.snapshot,
        artwork: {
          ...bundle.snapshot.artwork,
          source: { ...bundle.snapshot.artwork.source, sha256: '' },
        },
      },
    });
    expect(missingHash.snapshot.artworks[0].artwork.source.sha256).toBe(expectedHash);

    const staleType = await validateProjectBundle({
      ...bundle,
      snapshot: {
        ...bundle.snapshot,
        artwork: {
          ...bundle.snapshot.artwork,
          source: { ...bundle.snapshot.artwork.source, mimeType: 'application/postscript' },
        },
      },
    });
    expect(staleType.snapshot.artworks[0].artwork.source.mimeType).toBe('image/png');
  });

  it('validates multiple artworks with aligned blobs', async () => {
    const first = await createBundle();
    const second = await createBundle();
    const snapshot = migrateProjectSnapshot(first.snapshot);
    snapshot.artworks.push({
      artwork: { ...second.artwork, source: { ...second.artwork.source, id: 'asset-2' } },
      visible: true,
    });
    const valid = await validateProjectBundle({
      snapshot,
      artworkBlobs: [
        { originalBlob: first.originalBlob, previewBlob: first.previewBlob },
        { originalBlob: second.originalBlob, previewBlob: second.previewBlob },
      ],
    });
    expect(valid.snapshot.artworks).toHaveLength(2);
    expect(valid.artworkBlobs).toHaveLength(2);

    await expect(validateProjectBundle({
      snapshot,
      artworkBlobs: [{ originalBlob: first.originalBlob, previewBlob: first.previewBlob }],
    })).rejects.toMatchObject({ code: 'projectArtworkMissing' });
  });

  it('supports artwork-free box net snapshots', async () => {
    const snapshot = {
      schemaVersion: 1,
      workflowStep: 'artwork',
      box: new BoxNetModel({ width: 220, height: 110, depth: 55 }).toJSON(),
      artwork: null,
      view: {},
      history: { undo: [], redo: [] },
    };

    const valid = await validateProjectBundle({ snapshot, originalBlob: null, previewBlob: null });
    expect(valid.snapshot.cartonSource.box.dimensions).toEqual({ width: 220, height: 110, depth: 55 });
    expect(valid.snapshot.artworks).toEqual([]);
    expect(valid.snapshot.activeArtworkIndex).toBe(-1);
    expect(valid.artworkBlobs).toEqual([]);
  });

  it('migrates and validates versioned Technical Viewer state fail-closed', async () => {
    const { snapshot } = await createBundle();
    const migrated = migrateProjectSnapshot(snapshot);
    expect(migrated.technicalViewer).toBeNull();

    const technical = {
      ...migrated,
      cartonSource: {
        mode: 'technical',
        source: { modelSchemaVersion: 'pbd.model.v1', svgSchemaVersion: 'pbd.svg.v4' },
        modelSha256: 'a'.repeat(64),
        svgSha256: 'b'.repeat(64),
      },
      workflowSelection: 'technical',
      technicalViewer: {
        version: 1,
        animationName: 'assembly',
        foldProgress: 0.65,
        camera: {
          projection: 'perspective', heading: 20, elevation: 30,
          horizontalPan: 0, verticalPan: 0, distanceFactor: 4,
          frameHeightFactor: 0, fov: 42, verticalCorrection: false,
        },
      },
    };
    expect(migrateProjectSnapshot(technical).technicalViewer.foldProgress).toBe(0.65);
    expect(() => migrateProjectSnapshot({ ...technical, technicalViewer: { version: 1, foldProgress: 2 } }))
      .toThrow();
  });

  it('migrates flat separation visibility into process and spot plates', async () => {
    const { snapshot } = await createBundle();
    snapshot.schemaVersion = 11;
    snapshot.artworks = [{
      artwork: { ...snapshot.artwork, pdfSeparationVisibility: { '0': false } },
      visible: true,
    }];
    const migrated = migrateProjectSnapshot(snapshot);
    expect(migrated.artworks[0].artwork.pdfSeparationVisibility).toEqual({
      process: [true, true, true, true],
      spots: { '0': false },
    });
    const model = new ArtworkModel(migrated.artworks[0].artwork);
    expect(model.toJSON().pdfSeparationVisibility).toEqual({
      process: [true, true, true, true],
      spots: { '0': false },
    });
  });
});
