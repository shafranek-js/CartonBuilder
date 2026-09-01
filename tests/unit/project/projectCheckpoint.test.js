import { describe, expect, it } from 'vitest';

import { ProjectCheckpointStore } from '../../../src/project/ProjectCheckpoint.js';

describe('ProjectCheckpointStore', () => {
  it('clones the complete checkpoint payload before storing it', async () => {
    const store = new ProjectCheckpointStore();
    const payload = {
      snapshot: { workflowSelection: 'technical', cartonSource: { mode: 'quick' } },
      artworkBlobs: [{ originalBlob: new Blob(['original'], { type: 'image/png' }) }],
      technicalAssets: { modelBlob: new Blob(['model'], { type: 'application/json' }) },
      renderAssets: [{ assetId: 'render-1', blob: new Blob(['render']) }],
    };

    await store.createProjectCheckpoint(payload);
    payload.snapshot.workflowSelection = 'quick';
    payload.artworkBlobs[0].originalBlob = new Blob(['changed']);

    const checkpoint = store.getProjectCheckpoint();
    expect(checkpoint.snapshot.workflowSelection).toBe('technical');
    expect(await checkpoint.artworkBlobs[0].originalBlob.text()).toBe('original');
    expect(await checkpoint.technicalAssets.modelBlob.text()).toBe('model');
    expect(await checkpoint.renderAssets[0].blob.text()).toBe('render');
  });

  it('retains canonical Technical Viewer state across restore and recreation', async () => {
    const store = new ProjectCheckpointStore();
    const payload = {
      snapshot: {
        schemaVersion: 18,
        workflowSelection: 'technical',
        cartonSource: { mode: 'technical' },
        technicalViewer: {
          version: 1,
          animationName: 'assembly',
          foldProgress: 0.65,
          camera: {
            projection: 'perspective',
            heading: 20,
            elevation: 30,
            horizontalPan: 0,
            verticalPan: 0,
            distanceFactor: 4,
            frameHeightFactor: 0,
            fov: 42,
            verticalCorrection: false,
          },
        },
      },
      artworkBlobs: [],
      renderAssets: [],
      technicalAssets: null,
    };

    await store.createProjectCheckpoint(payload);
    const restored = await store.restoreProjectCheckpoint();
    await store.createProjectCheckpoint(restored);

    expect(store.getProjectCheckpoint()).toEqual(payload);
  });

  it('keeps the previous checkpoint when verification or persistence fails', async () => {
    const store = new ProjectCheckpointStore();
    await store.createProjectCheckpoint({ snapshot: { id: 'stable' } });

    await expect(store.createProjectCheckpoint(
      { snapshot: { id: 'rejected-by-verify' } },
      { verify: () => { throw new Error('VERIFY_FAIL'); } },
    )).rejects.toThrow('VERIFY_FAIL');
    expect(store.getProjectCheckpoint().snapshot.id).toBe('stable');

    await expect(store.createProjectCheckpoint(
      { snapshot: { id: 'rejected-by-write' } },
      { write: () => { throw new Error('WRITE_FAIL'); } },
    )).rejects.toThrow('WRITE_FAIL');
    expect(store.getProjectCheckpoint().snapshot.id).toBe('stable');
  });

  it('does not discard a checkpoint when restore validation fails', async () => {
    const store = new ProjectCheckpointStore();
    await store.createProjectCheckpoint({ snapshot: { id: 'recoverable' } });

    await expect(store.restoreProjectCheckpoint({
      verify: () => { throw new Error('RESTORE_VERIFY_FAIL'); },
    })).rejects.toThrow('RESTORE_VERIFY_FAIL');
    expect(store.hasProjectCheckpoint()).toBe(true);
    expect(store.getProjectCheckpoint().snapshot.id).toBe('recoverable');
  });

  it('supports explicit discard after a successful restore', async () => {
    const store = new ProjectCheckpointStore();
    await store.createProjectCheckpoint({ snapshot: { id: 'discard-me' } });
    expect((await store.restoreProjectCheckpoint()).snapshot.id).toBe('discard-me');
    store.discardProjectCheckpoint();
    expect(store.hasProjectCheckpoint()).toBe(false);
    await expect(store.restoreProjectCheckpoint()).resolves.toBeNull();
  });
});
