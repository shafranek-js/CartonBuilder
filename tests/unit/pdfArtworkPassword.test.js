import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../src/errors.js';
import { loadPdfArtwork, renderPdfArtwork } from '../../src/artwork/pdfArtworkLoader.js';

const client = {
  openDocument: vi.fn(),
  authenticate: vi.fn(),
  closeDocument: vi.fn(),
  getPageInfo: vi.fn(),
  getLayers: vi.fn(),
  renderPage: vi.fn(),
};

vi.mock('../../src/pdf-renderer/mupdfClient.js', () => ({
  getMuPdfClient: () => client,
}));

function pdfBlob() {
  return new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], { type: 'application/pdf' });
}

function pageInfo() {
  return {
    rotation: 0,
    mediaBox: { x: 0, y: 0, width: 200, height: 200 },
    boxes: {
      MediaBox: { x: 0, y: 0, width: 200, height: 200 },
      CropBox: { x: 0, y: 0, width: 200, height: 200 },
      BleedBox: null,
      TrimBox: null,
      ArtBox: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client.closeDocument.mockResolvedValue(true);
  client.getPageInfo.mockResolvedValue(pageInfo());
  client.getLayers.mockResolvedValue({ pdfLayers: [], pdfLayerVisibility: null });
  client.renderPage.mockResolvedValue({
    blob: new Blob(['preview'], { type: 'image/png' }),
    width: 200,
    height: 200,
  });
});

describe('pdfArtworkLoader password flow', () => {
  it('prompts for a password, authenticates and loads the document', async () => {
    client.openDocument.mockResolvedValue({ needsPassword: true, pageCount: null, isPDF: true });
    client.authenticate.mockResolvedValue({ ok: true, pageCount: 2 });
    const promptPassword = vi.fn().mockResolvedValue('secret');

    const loaded = await loadPdfArtwork(pdfBlob(), {
      promptPassword,
      passwordKey: 'key-1',
      pageBox: 'CropBox',
    });

    expect(promptPassword).toHaveBeenCalledOnce();
    expect(client.authenticate).toHaveBeenCalledWith(expect.any(String), 'secret');
    expect(loaded.pageCount).toBe(2);
    expect(client.closeDocument).toHaveBeenCalled();
  });

  it('rejects with pdfInvalidPassword when authentication fails', async () => {
    client.openDocument.mockResolvedValue({ needsPassword: true, pageCount: null, isPDF: true });
    client.authenticate.mockResolvedValue({ ok: false, pageCount: null });
    const promptPassword = vi.fn().mockResolvedValue('wrong');

    await expect(loadPdfArtwork(pdfBlob(), { promptPassword, passwordKey: 'key-2' }))
      .rejects.toMatchObject({ code: 'pdfInvalidPassword' });
    expect(client.closeDocument).toHaveBeenCalled();
  });

  it('rejects with pdfPasswordCancelled when the prompt is dismissed', async () => {
    client.openDocument.mockResolvedValue({ needsPassword: true, pageCount: null, isPDF: true });
    const promptPassword = vi.fn().mockRejectedValue(new AppError('pdfPasswordCancelled'));

    await expect(loadPdfArtwork(pdfBlob(), { promptPassword }))
      .rejects.toMatchObject({ code: 'pdfPasswordCancelled' });
  });

  it('keeps pdfPasswordProtected when no prompt is available', async () => {
    client.openDocument.mockResolvedValue({ needsPassword: true, pageCount: null, isPDF: true });

    await expect(loadPdfArtwork(pdfBlob(), {}))
      .rejects.toMatchObject({ code: 'pdfPasswordProtected' });
  });

  it('reuses the cached password for re-renders without prompting', async () => {
    client.openDocument.mockResolvedValue({ needsPassword: true, pageCount: null, isPDF: true });
    client.authenticate.mockResolvedValue({ ok: true, pageCount: 1 });
    const promptPassword = vi.fn().mockResolvedValue('secret');

    await loadPdfArtwork(pdfBlob(), { promptPassword, passwordKey: 'key-cached', pageBox: 'CropBox' });
    await renderPdfArtwork(pdfBlob(), { promptPassword, passwordKey: 'key-cached', pageBox: 'CropBox' });

    expect(promptPassword).toHaveBeenCalledTimes(1);
  });
});
