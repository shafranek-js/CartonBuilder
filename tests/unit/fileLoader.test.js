import { describe, expect, it, vi } from 'vitest';

import { loadArtworkWithWorker } from '../../src/artwork/fileLoader.js';

class WorkerMock extends EventTarget {
  constructor() {
    super();
    this.messages = [];
    this.terminate = vi.fn();
  }

  postMessage(message) {
    this.messages.push(message);
  }

  emit(data) {
    const event = new Event('message');
    Object.defineProperty(event, 'data', { value: data });
    this.dispatchEvent(event);
  }
}

function workerResult() {
  return {
    previewBlob: new Blob(['preview'], { type: 'image/png' }),
    widthPx: 100,
    heightPx: 50,
    previewWidthPx: 100,
    previewHeightPx: 50,
    pageIndex: null,
    pageCount: null,
    vector: false,
    pdfPageRotation: 0,
    mediaBox: null,
    mimeType: 'image/png',
    extension: 'png',
    sha256: 'hash',
  };
}

describe('artwork worker client', () => {
  it('ignores stale responses and terminates after the active result', async () => {
    const worker = new WorkerMock();
    const file = new Blob(['asset'], { type: 'image/png' });
    const promise = loadArtworkWithWorker(file, {
      workerFactory: () => worker,
      jobId: 'active-job',
    });

    worker.emit({ type: 'complete', jobId: 'stale-job', result: workerResult() });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit({ type: 'complete', jobId: 'active-job', result: workerResult() });

    const loaded = await promise;
    expect(loaded.previewBlob.type).toBe('image/png');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates the worker when the request is aborted', async () => {
    const worker = new WorkerMock();
    const controller = new AbortController();
    const promise = loadArtworkWithWorker(new Blob(['asset']), {
      signal: controller.signal,
      workerFactory: () => worker,
      jobId: 'cancel-job',
    });

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
