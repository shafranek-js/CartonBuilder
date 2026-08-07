import { describe, expect, it, vi } from 'vitest';

import { createMuPdfClient } from '../../src/pdf-renderer/mupdfClient.js';

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

function createClient({ timeoutMs } = {}) {
  let worker = null;
  const client = createMuPdfClient({
    workerFactory: () => {
      worker = new WorkerMock();
      queueMicrotask(() => worker.emit({ type: 'ready' }));
      return worker;
    },
    encodePng: async () => new Blob(['png'], { type: 'image/png' }),
    timeoutMs,
  });
  return { client, getWorker: () => worker };
}

function renderResult() {
  return {
    rgba: new Uint8ClampedArray([1, 2, 3, 255]),
    width: 1,
    height: 1,
    durationMs: 2,
  };
}

async function waitForWorker(getWorker) {
  return vi.waitFor(() => {
    const worker = getWorker();
    if (!worker) throw new Error('worker not created yet');
    return worker;
  });
}

async function waitForMessage(worker, type) {
  return vi.waitFor(() => {
    const message = worker.messages.find((m) => m.type === type);
    if (!message) throw new Error(`no ${type} message`);
    return message;
  });
}

describe('MuPdfClient', () => {
  it('waits for the worker ready handshake before posting requests', async () => {
    const { client, getWorker } = createClient();
    const promise = client.openDocument(new Uint8Array(4), 'doc-1');
    expect(getWorker()).not.toBeNull();
    const worker = getWorker();
    expect(worker.messages).toHaveLength(0);

    const message = await waitForMessage(worker, 'open');
    worker.emit({ id: message.id, type: 'ok', result: { pageCount: 1, isPDF: true } });
    await expect(promise).resolves.toMatchObject({ pageCount: 1 });
  });

  it('round-trips a render request into a PNG value', async () => {
    const { client, getWorker } = createClient();
    const promise = client.renderPage('doc-1', { pageIndex: 0, scale: 1 });
    const worker = await waitForWorker(getWorker);
    const message = await waitForMessage(worker, 'render');
    worker.emit({ id: message.id, type: 'ok', result: renderResult() });

    const value = await promise;
    expect(value.width).toBe(1);
    expect(value.height).toBe(1);
    expect(value.blob.type).toBe('image/png');
  });

  it('coalesces concurrent identical renders into one worker request', async () => {
    const { client, getWorker } = createClient();
    const options = { pageIndex: 0, scale: 1, box: 'CropBox', usage: 'Print' };
    const first = client.renderPage('doc-1', options);
    const second = client.renderPage('doc-1', options);
    const worker = await waitForWorker(getWorker);

    await waitForMessage(worker, 'render');
    const renders = worker.messages.filter((m) => m.type === 'render');
    expect(renders).toHaveLength(1);
    const message = renders[0];
    worker.emit({ id: message.id, type: 'ok', result: renderResult() });

    const [a, b] = await Promise.all([first, second]);
    expect(a.width).toBe(1);
    expect(b.width).toBe(1);
  });

  it('serves repeated renders from the cache without a new worker request', async () => {
    const { client, getWorker } = createClient();
    const options = { pageIndex: 0, scale: 1 };
    const promise = client.renderPage('doc-1', options);
    const worker = await waitForWorker(getWorker);
    const message = await waitForMessage(worker, 'render');
    worker.emit({ id: message.id, type: 'ok', result: renderResult() });
    await promise;

    const cached = await client.renderPage('doc-1', options);
    expect(cached.width).toBe(1);
    expect(worker.messages.filter((m) => m.type === 'render')).toHaveLength(1);
  });

  it('cancels a superseded render for the same session', async () => {
    const { client, getWorker } = createClient();
    const first = client
      .renderPage('doc-1', { pageIndex: 0, scale: 1 }, { session: 's' })
      .catch(() => {});
    const worker = await waitForWorker(getWorker);
    const firstMessage = await waitForMessage(worker, 'render');

    const second = client.renderPage('doc-1', { pageIndex: 0, scale: 2 }, { session: 's' });
    await vi.waitFor(() => {
      const renders = worker.messages.filter((m) => m.type === 'render');
      if (renders.length < 2) throw new Error('second render missing');
      return renders;
    });
    const renderMessages = worker.messages.filter((m) => m.type === 'render');
    const secondMessage = renderMessages[1];
    expect(secondMessage).not.toBe(firstMessage);

    const cancel = worker.messages.find((m) => m.type === 'cancel');
    expect(cancel).toBeDefined();
    expect(cancel.payload.requestId).toBe(firstMessage.id);

    worker.emit({ id: secondMessage.id, type: 'ok', result: renderResult() });
    await expect(second).resolves.toMatchObject({ width: 1 });
    await first;
  });

  it('rejects with the classified code on a worker error', async () => {
    const { client, getWorker } = createClient();
    const promise = client.openDocument(new Uint8Array(4), 'doc-1');
    const worker = await waitForWorker(getWorker);
    const message = await waitForMessage(worker, 'open');
    worker.emit({ id: message.id, type: 'error', error: { code: 'pdfDamaged', parameters: {} } });

    await expect(promise).rejects.toMatchObject({ code: 'pdfDamaged' });
  });

  it('terminates a hung render after the timeout and recovers with a fresh worker', async () => {
    const { client, getWorker } = createClient({ timeoutMs: 50 });
    const promise = client.renderPage('doc-1', { pageIndex: 0, scale: 1 });
    const worker = await waitForWorker(getWorker);
    await waitForMessage(worker, 'render');

    await expect(promise).rejects.toMatchObject({ code: 'pdfRenderTimeout' });
    expect(worker.terminate).toHaveBeenCalled();

    const second = client.renderPage('doc-1', { pageIndex: 0, scale: 1 });
    const recovered = await vi.waitFor(() => {
      const candidate = getWorker();
      if (!candidate || candidate === worker) throw new Error('no fresh worker yet');
      return candidate;
    });
    const message = await waitForMessage(recovered, 'render');
    recovered.emit({ id: message.id, type: 'ok', result: renderResult() });
    await expect(second).resolves.toMatchObject({ width: 1 });
  });
});
