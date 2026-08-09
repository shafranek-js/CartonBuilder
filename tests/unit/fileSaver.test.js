import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  requestSaveDestination,
  saveOrDownloadFile,
  writeSaveDestination,
} from '../../src/utils/fileSaver.js';

describe('fileSaver module', () => {
  let mockBlob;
  let mockWindow;
  let mockDocument;
  let mockAnchor;

  beforeEach(() => {
    mockBlob = new Blob(['test content'], { type: 'text/plain' });
    mockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
      remove: vi.fn(),
    };
    mockDocument = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: vi.fn(),
      },
    };
    mockWindow = {
      URL: {
        createObjectURL: vi.fn().mockReturnValue('blob:http://localhost/123'),
        revokeObjectURL: vi.fn(),
      },
      setTimeout: vi.fn((fn) => fn()),
    };
  });

  it('uses showSaveFilePicker if available and user approves', async () => {
    const mockWritable = {
      write: vi.fn().mockResolvedValue(),
      close: vi.fn().mockResolvedValue(),
    };
    const mockHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };
    mockWindow.showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);

    const result = await saveOrDownloadFile({
      blob: mockBlob,
      suggestedName: 'test.carton',
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    expect(result).toBe(true);
    expect(mockWindow.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'test.carton' })
    );
    expect(mockWritable.write).toHaveBeenCalledWith(mockBlob);
    expect(mockWritable.close).toHaveBeenCalled();
  });

  it('handles AbortError gracefully if user cancels native save dialog', async () => {
    const abortError = new Error('User cancelled');
    abortError.name = 'AbortError';
    mockWindow.showSaveFilePicker = vi.fn().mockRejectedValue(abortError);

    const result = await saveOrDownloadFile({
      blob: mockBlob,
      suggestedName: 'test.carton',
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    expect(result).toBe(false);
    expect(mockDocument.createElement).not.toHaveBeenCalled();
  });

  it('falls back to standard anchor download if showSaveFilePicker is missing', async () => {
    const result = await saveOrDownloadFile({
      blob: mockBlob,
      suggestedName: 'test.carton',
      windowRef: mockWindow,
      documentRef: mockDocument,
    });

    expect(result).toBe(true);
    expect(mockDocument.createElement).toHaveBeenCalledWith('a');
    expect(mockAnchor.download).toBe('test.carton');
    expect(mockAnchor.click).toHaveBeenCalled();
  });

  it('reserves a native destination separately and reports chunked write progress', async () => {
    const writes = [];
    const progress = [];
    const mockWritable = {
      write: vi.fn(async (chunk) => writes.push(chunk)),
      close: vi.fn().mockResolvedValue(),
      abort: vi.fn().mockResolvedValue(),
    };
    const mockHandle = { createWritable: vi.fn().mockResolvedValue(mockWritable) };
    mockWindow.showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);
    const destination = await requestSaveDestination({ suggestedName: 'large.carton', windowRef: mockWindow });
    expect(destination.kind).toBe('native');
    await writeSaveDestination({
      destination,
      blob: new Blob(['a'.repeat(32)]),
      windowRef: mockWindow,
      documentRef: mockDocument,
      onProgress: (written, total) => progress.push([written, total]),
    });
    expect(writes.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toEqual([32, 32]);
    expect(mockWritable.close).toHaveBeenCalledTimes(1);
  });

  it('aborts native writes without closing a partial destination', async () => {
    const mockWritable = {
      write: vi.fn().mockResolvedValue(),
      close: vi.fn().mockResolvedValue(),
      abort: vi.fn().mockResolvedValue(),
    };
    const destination = {
      kind: 'native',
      handle: { createWritable: vi.fn().mockResolvedValue(mockWritable) },
    };
    const signal = AbortSignal.abort();
    await expect(writeSaveDestination({
      destination,
      blob: mockBlob,
      signal,
      windowRef: mockWindow,
      documentRef: mockDocument,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockWritable.abort).toHaveBeenCalledTimes(1);
    expect(mockWritable.close).not.toHaveBeenCalled();
  });
});
