import { AppError } from '../errors.js';
import { getMuPdfClient } from '../pdf-renderer/mupdfClient.js';

export const PAGE_BOXES = ['MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox'];
export const DEFAULT_PAGE_BOX = 'CropBox';

const MAX_PREVIEW_EDGE = 4096;
const MAX_PREVIEW_PIXELS = 16_000_000;

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Artwork processing was cancelled.', 'AbortError');
  }
}

export function getPreviewScale(width, height) {
  return Math.min(
    1,
    MAX_PREVIEW_EDGE / Math.max(width, height),
    Math.sqrt(MAX_PREVIEW_PIXELS / (width * height)),
  );
}

export function pageBoxDims(box) {
  if (!box) return { width: 0, height: 0 };
  return { width: Math.abs(box.width), height: Math.abs(box.height) };
}

export function computeRenderScale({ width, height, rotation = 0, dpi = null, targetWidthMm = null }) {
  const baseScale = getPreviewScale(width * 2, height * 2) * 2;
  const requestedWidthPx = dpi && targetWidthMm ? (targetWidthMm / 25.4) * dpi : null;
  return Math.max(0.05, requestedWidthPx ? requestedWidthPx / width : baseScale);
}

export function getFileKind(file) {
  return /\.ai$/i.test(file?.name || '') ? 'ai' : 'pdf';
}

const passwordCache = new Map();

async function hashBytes(bytes) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => (
      byte.toString(16).padStart(2, '0')
    )).join('');
  } catch {
    return '';
  }
}

async function resolvePassword(promptPassword, key) {
  if (key && passwordCache.has(key)) return passwordCache.get(key);
  const password = await promptPassword?.();
  if (password == null) return null;
  if (key) passwordCache.set(key, password);
  return password;
}

async function openPdf(file, signal, extension, promptPassword, passwordKey) {
  throwIfAborted(signal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(signal);
  const sourceHash = await hashBytes(bytes);
  const client = getMuPdfClient();
  const docId = crypto.randomUUID();
  let opened;
  try {
    opened = await client.openDocument(bytes, docId, { extension });
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
  if (opened.needsPassword) {
    const key = passwordKey || sourceHash;
    try {
      const password = await resolvePassword(promptPassword, key);
      if (password == null) {
        throw new AppError(
          promptPassword ? 'pdfPasswordCancelled' : 'pdfPasswordProtected',
        );
      }
      const auth = await client.authenticate(docId, password);
      if (!auth.ok) {
        if (key) passwordCache.delete(key);
        throw new AppError('pdfInvalidPassword');
      }
      opened = { ...opened, needsPassword: false, pageCount: auth.pageCount };
    } catch (error) {
      try {
        await client.closeDocument(docId);
      } catch {
        // keep the original error
      }
      throwIfAborted(signal);
      throw error;
    }
  }
  return { client, docId, bytes, opened, sourceHash };
}

async function withPdf(file, signal, extension, promptPassword, passwordKey, callback) {
  const { client, docId, opened, sourceHash } = await openPdf(
    file,
    signal,
    extension,
    promptPassword,
    passwordKey,
  );
  try {
    return await callback({ client, docId, opened, sourceHash });
  } finally {
    try {
      await client.closeDocument(docId);
    } catch {
      // closing the document is best-effort
    }
  }
}

export async function loadPdfArtwork(file, {
  choosePage = async () => 0,
  signal,
  pageBox = DEFAULT_PAGE_BOX,
  promptPassword = null,
  passwordKey = '',
  session = null,
  overprintMode = 0,
} = {}) {
  const extension = getFileKind(file);
  return withPdf(file, signal, extension, promptPassword, passwordKey, async ({ client, docId, opened, sourceHash }) => {
    const pageCount = opened.pageCount;
    const pageIndex = pageCount > 1 ? await choosePage(pageCount) : 0;
    throwIfAborted(signal);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
      throw new AppError('pdfPageInvalid');
    }

    const [info, layers] = await Promise.all([
      client.getPageInfo(docId, pageIndex),
      client.getLayers(docId),
    ]);
    throwIfAborted(signal);
    const box = info.boxes[pageBox] || info.boxes.CropBox || info.mediaBox;
    const dims = pageBoxDims(box);
    const scale = computeRenderScale({
      width: dims.width,
      height: dims.height,
      rotation: info.rotation,
    });
    const rendered = await client.renderPage(docId, {
      pageIndex,
      scale,
      box: pageBox,
      visibility: layers.pdfLayerVisibility,
      overprintMode,
    }, { session });
    throwIfAborted(signal);

    return {
      previewBlob: rendered.blob,
      widthPx: rendered.width,
      heightPx: rendered.height,
      previewWidthPx: rendered.width,
      previewHeightPx: rendered.height,
      sha256: sourceHash,
      pageIndex,
      pageCount,
      vector: true,
      pdfPageRotation: info.rotation,
      mediaBox: info.mediaBox,
      pdfLayers: layers.pdfLayers,
      pdfLayerVisibility: layers.pdfLayerVisibility,
      hasOverprint: overprintMode > 0,
      pageBox,
    };
  });
}

export async function getPdfSeparations(file, {
  pageIndex = 0,
  signal,
  overprintMode = 2,
} = {}) {
  const extension = getFileKind(file);
  return withPdf(file, signal, extension, null, '', async ({ client, docId }) => {
    const result = await client.getSeparations(docId, pageIndex, overprintMode);
    throwIfAborted(signal);
    return result;
  });
}

export async function renderPdfArtwork(file, {
  pageIndex = 0,
  visibility = null,
  dpi = null,
  targetWidthMm = null,
  signal,
  pageBox = DEFAULT_PAGE_BOX,
  promptPassword = null,
  passwordKey = '',
  session = null,
  overprintMode = 0,
  separationBehaviors = null,
} = {}) {
  const extension = getFileKind(file);
  return withPdf(file, signal, extension, promptPassword, passwordKey, async ({ client, docId }) => {
    const info = await client.getPageInfo(docId, pageIndex);
    throwIfAborted(signal);
    const box = info.boxes[pageBox] || info.boxes.CropBox || info.mediaBox;
    const dims = pageBoxDims(box);
    const scale = computeRenderScale({
      width: dims.width,
      height: dims.height,
      rotation: info.rotation,
      dpi,
      targetWidthMm,
    });
    const rendered = await client.renderPage(docId, {
      pageIndex,
      scale,
      box: pageBox,
      visibility,
      overprintMode,
      separationBehaviors,
    }, { session });
    throwIfAborted(signal);
    return {
      previewBlob: rendered.blob,
      previewWidthPx: rendered.width,
      previewHeightPx: rendered.height,
      widthPx: rendered.width,
      heightPx: rendered.height,
      hasOverprint: overprintMode > 0,
    };
  });
}
