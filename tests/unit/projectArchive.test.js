import { describe, expect, it } from 'vitest';

import {
  createProjectArchive,
  readProjectArchive,
} from '../../src/project/projectArchive.js';

const snapshot = {
  schemaVersion: 1,
  meta: { name: 'Unit project' },
  box: { dimensions: { width: 150, height: 90, depth: 40 } },
  artwork: {
    source: {
      fileName: 'private-name.png',
      mimeType: 'image/png',
      sha256: '0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5',
    },
  },
  view: {},
  history: { undo: [], redo: [] },
};

describe('.carton project archive', () => {
  it('round-trips the snapshot, original asset and preview', async () => {
    const originalBlob = new Blob(['original'], { type: 'image/png' });
    const previewBlob = new Blob(['preview'], { type: 'image/png' });
    const archive = await createProjectArchive({ snapshot, originalBlob, previewBlob });
    const restored = await readProjectArchive(archive);

    expect(restored.snapshot).toEqual(snapshot);
    expect(await restored.originalBlob.text()).toBe('original');
    expect(await restored.previewBlob.text()).toBe('preview');
  });

  it('rejects non-project ZIP data', async () => {
    await expect(readProjectArchive(new Blob(['not a zip']))).rejects.toThrow();
  });
});
