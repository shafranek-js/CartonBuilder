import { AppError } from '../errors.js';
import { classifyArtworkWithMuPdf } from './aiCompatibility.js';
import { createDocumentRegistry } from './documentRegistry.js';
import { pixmapToRgba } from './pixelConverter.js';
import { RendererRequestType, serializeRendererError } from './protocol.js';
import { invertMatrix, planTiles, snapRect, transformRect } from './tileMath.js';

const registry = createDocumentRegistry();

const RENDER_TILE_EDGE = 2048;
const RENDER_TILE_OVERSCAN = 1;
const RENDER_MAX_PIXELS = 32_000_000;
const MAX_PDF_PAGES = 5000;

let mupdf = null;
let RENDERER_VERSION = 'mupdf';

async function initRenderer() {
  try {
    const custom = await import('./custom/mupdf.js');
    mupdf = custom;
    RENDERER_VERSION = 'mupdf-custom';
  } catch {
    const stock = await import('mupdf');
    mupdf = stock;
    RENDERER_VERSION = 'mupdf';
  }
}

const rendererReady = initRenderer();

function sendOk(id, result, transfer = []) {
  self.postMessage({ id, type: 'ok', result }, transfer);
}

function sendError(id, error) {
  self.postMessage({ id, type: 'error', error: serializeRendererError(error) });
}

function normalizeRect(rect) {
  if (!Array.isArray(rect) || rect.length < 4) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: rect[0],
    y: rect[1],
    width: rect[2] - rect[0],
    height: rect[3] - rect[1],
  };
}

function getDocument(docId) {
  const document = registry.get(docId);
  if (!document) throw new AppError('pdfDocumentClosed');
  return document;
}

function mapOpenError(error, extension) {
  if (error?.name === 'AppError') return error;
  return new AppError(
    extension === 'ai' ? 'aiNotPdfCompatible' : 'pdfDamaged',
    {},
    { cause: error },
  );
}

async function handleOpen(payload) {
  const { docId, bytes, extension } = payload;
  let document;
  try {
    document = mupdf.Document.openDocument(bytes, 'application/pdf');
  } catch (error) {
    throw mapOpenError(error, extension);
  }
  registry.open(docId, document);
  if (document.isPDF()) {
    try {
      document.asPDF()?.disableJS?.();
    } catch {
      // disabling document JavaScript is best-effort
    }
  }
  if (document.needsPassword()) {
    return {
      needsPassword: true,
      pageCount: null,
      isPDF: document.isPDF(),
      version: RENDERER_VERSION,
    };
  }
  const pageCount = document.countPages();
  if (pageCount > MAX_PDF_PAGES) {
    registry.close(docId);
    throw new AppError('pdfTooManyPages', { count: pageCount, max: MAX_PDF_PAGES });
  }
  return {
    needsPassword: false,
    pageCount,
    isPDF: document.isPDF(),
    version: RENDERER_VERSION,
  };
}

async function handleAuthenticate(payload) {
  const { docId, password } = payload;
  const document = getDocument(docId);
  const ok = document.authenticatePassword(password) !== 0;
  return {
    ok,
    pageCount: ok ? document.countPages() : null,
  };
}

async function handleClose(payload) {
  return registry.close(payload.docId);
}

async function handleRecognize(payload) {
  const { bytes, extension } = payload;
  return classifyArtworkWithMuPdf(mupdf, bytes, extension);
}

async function handleInfo(payload) {
  const { docId, pageIndex } = payload;
  const document = getDocument(docId);
  const page = document.loadPage(pageIndex);
  try {
    let rotation = 0;
    try {
      rotation = Number(page.getObject()?.get?.('Rotate')?.asNumber?.()) || 0;
    } catch {
      rotation = 0;
    }
    const boxNames = ['MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox'];
    const boxes = {};
    for (const name of boxNames) {
      try {
        boxes[name] = normalizeRect(page.getBounds(name));
      } catch {
        boxes[name] = null;
      }
    }
    return {
      rotation: ((rotation % 360) + 360) % 360,
      mediaBox: boxes.MediaBox,
      boxes,
    };
  } finally {
    page.destroy();
  }
}

async function handleLayers(payload) {
  const { docId } = payload;
  const document = getDocument(docId);
  const pdfDocument = document.isPDF() ? document.asPDF() : null;
  if (!pdfDocument || pdfDocument.countLayers() === 0) {
    return { pdfLayers: [], pdfLayerVisibility: null };
  }
  const pdfLayers = [];
  const pdfLayerVisibility = {};
  const count = pdfDocument.countLayers();
  for (let index = 0; index < count; index += 1) {
    const id = String(index);
    pdfLayers.push({
      id,
      name: pdfDocument.getLayerName(index) || `Layer ${index + 1}`,
      group: null,
    });
    pdfLayerVisibility[id] = pdfDocument.isLayerVisible(index);
  }
  return { pdfLayers, pdfLayerVisibility };
}

const activeRenders = new Map();

function normalizeProcessMask(processMask) {
  const value = Number(processMask);
  return Number.isInteger(value) ? value & 0x0f : 0x0f;
}

function renderSingle(page, matrix, usage, box, overprintMode, processMask, separationBehaviors) {
  if (overprintMode > 0 && RENDERER_VERSION === 'mupdf-custom') {
    let cmyk;
    if (separationBehaviors && separationBehaviors.length > 0) {
      cmyk = page.toPixmapWithOverprintAndBehaviors(
        matrix,
        mupdf.ColorSpace.DeviceCMYK,
        false,
        usage,
        box,
        overprintMode,
        Int32Array.from(separationBehaviors),
      );
    } else {
      cmyk = page.toPixmapWithOverprint(
        matrix,
        mupdf.ColorSpace.DeviceCMYK,
        false,
        true,
        usage,
        box,
        overprintMode,
      );
    }
    try {
      const rgb = cmyk.toRgbWithProcessMask(normalizeProcessMask(processMask));
      try {
        return {
          rgba: pixmapToRgba(rgb),
          width: rgb.getWidth(),
          height: rgb.getHeight(),
        };
      } finally {
        rgb.destroy();
      }
    } finally {
      cmyk.destroy();
    }
  }
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true, usage, box);
  try {
    return {
      rgba: pixmapToRgba(pixmap),
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
    };
  } finally {
    pixmap.destroy();
  }
}

function renderTiled(page, matrix, bounds, usage, box, overprintMode, processMask, separationBehaviors) {
  const width = bounds.x1 - bounds.x0;
  const height = bounds.y1 - bounds.y0;
  if (RENDERER_VERSION !== 'mupdf-custom') {
    if (overprintMode > 0) throw new AppError('overprintUnavailable');
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true, usage, box);
    try {
      const rgba = new Uint8ClampedArray(width * height * 4);
      const pixels = pixmap.getPixels();
      const stride = pixmap.getStride();
      const offsetX = bounds.x0 - pixmap.getX();
      const offsetY = bounds.y0 - pixmap.getY();
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const source = (y + offsetY) * stride + (x + offsetX) * 3;
          const target = (y * width + x) * 4;
          rgba[target] = pixels[source];
          rgba[target + 1] = pixels[source + 1];
          rgba[target + 2] = pixels[source + 2];
          rgba[target + 3] = 255;
        }
      }
      return { rgba, width, height };
    } finally {
      pixmap.destroy();
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const overprint = overprintMode > 0 && RENDERER_VERSION === 'mupdf-custom';
  const colorspace = overprint ? mupdf.ColorSpace.DeviceCMYK : mupdf.ColorSpace.DeviceRGB;
  const behaviors = separationBehaviors?.length ? Int32Array.from(separationBehaviors) : null;
  for (const tile of planTiles(bounds, RENDER_TILE_EDGE)) {
    const tileWidth = tile.x1 - tile.x0;
    const tileHeight = tile.y1 - tile.y0;
    const x0 = Math.max(bounds.x0, tile.x0 - RENDER_TILE_OVERSCAN);
    const y0 = Math.max(bounds.y0, tile.y0 - RENDER_TILE_OVERSCAN);
    const x1 = Math.min(bounds.x1, tile.x1 + RENDER_TILE_OVERSCAN);
    const y1 = Math.min(bounds.y1, tile.y1 + RENDER_TILE_OVERSCAN);
    const pixmap = page.toPixmapWithOverprintTile(
      matrix,
      colorspace,
      [x0, y0, x1, y1],
      false,
      usage,
      box,
      overprintMode,
      behaviors,
    );
    const rgb = overprint ? pixmap.toRgbWithProcessMask(normalizeProcessMask(processMask)) : pixmap;
    try {
      const pixels = rgb.getPixels();
      const stride = rgb.getStride();
      const offsetX = tile.x0 - x0;
      const offsetY = tile.y0 - y0;
      const bufCol = tile.x0 - bounds.x0;
      const bufRow = tile.y0 - bounds.y0;
      for (let y = 0; y < tileHeight; y += 1) {
        const source = (y + offsetY) * stride + offsetX * 3;
        const target = ((bufRow + y) * width + bufCol) * 4;
        for (let x = 0; x < tileWidth; x += 1) {
          const sourcePixel = source + x * 3;
          const targetPixel = target + x * 4;
          rgba[targetPixel] = pixels[sourcePixel];
          rgba[targetPixel + 1] = pixels[sourcePixel + 1];
          rgba[targetPixel + 2] = pixels[sourcePixel + 2];
          rgba[targetPixel + 3] = 255;
        }
      }
    } finally {
      if (rgb !== pixmap) rgb.destroy();
      pixmap.destroy();
    }
  }
  return { rgba, width, height };
}

async function handleRender(id, payload) {
  const {
    docId,
    pageIndex,
    scale = 1,
    box = 'CropBox',
    visibility = null,
    usage = 'Print',
    overprintMode = 0,
    processMask = 15,
    spotBehaviors = null,
    separationBehaviors = null,
  } = payload;
  const effectiveSpotBehaviors = spotBehaviors ?? separationBehaviors;
  const document = getDocument(docId);
  const pdfDocument = document.isPDF() ? document.asPDF() : null;
  if (pdfDocument && visibility) {
    const count = pdfDocument.countLayers();
    for (let index = 0; index < count; index += 1) {
      pdfDocument.setLayerVisible(index, visibility[String(index)] !== false);
    }
  }
  const page = document.loadPage(pageIndex);
  activeRenders.set(id, { cancelled: false });
  const started = performance.now();
  try {
    let rotation = 0;
    try {
      rotation = Number(page.getObject()?.get?.('Rotate')?.asNumber?.()) || 0;
    } catch {
      rotation = 0;
    }
    rotation = ((rotation % 360) + 360) % 360;
    const baseMatrix = mupdf.Matrix.scale(scale, scale);
    const matrix = rotation
      ? mupdf.Matrix.concat(baseMatrix, mupdf.Matrix.rotate(-rotation))
      : baseMatrix;

    const pageCtm = page.getTransform();
    const rotatedBox = page.getBounds(box);
    const unrotatedBox = transformRect(rotatedBox, invertMatrix(pageCtm));
    const bounds = snapRect(transformRect(unrotatedBox, mupdf.Matrix.concat(pageCtm, matrix)));
    const width = bounds.x1 - bounds.x0;
    const height = bounds.y1 - bounds.y0;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new AppError('pdfRenderFailed', { reason: 'invalidBounds' });
    }
    if (width * height > RENDER_MAX_PIXELS) {
      throw new AppError('pdfRenderTooLarge', { width, height, maxPixels: RENDER_MAX_PIXELS });
    }
    const tiled = width > RENDER_TILE_EDGE || height > RENDER_TILE_EDGE;
    const rendered = tiled
      ? renderTiled(page, matrix, bounds, usage, box, overprintMode, processMask, effectiveSpotBehaviors)
      : renderSingle(page, matrix, usage, box, overprintMode, processMask, effectiveSpotBehaviors);
    if (activeRenders.get(id)?.cancelled) return;
    const rgba = rendered.rgba;
    if (activeRenders.get(id)?.cancelled) return;
    const durationMs = Math.round(performance.now() - started);
    sendOk(id, {
      rgba,
      width: rendered.width,
      height: rendered.height,
      durationMs,
      overprintApplied: overprintMode > 0 && RENDERER_VERSION === 'mupdf-custom',
    }, [rgba.buffer]);
  } finally {
    activeRenders.delete(id);
    page.destroy();
  }
}

async function handleSeparations(payload) {
  const { docId, pageIndex, overprintMode = 2 } = payload;
  const document = getDocument(docId);
  const page = document.loadPage(pageIndex);
  try {
    if (RENDERER_VERSION !== 'mupdf-custom' || typeof page.separationCount !== 'function') {
      return {
        supported: false,
        process: [],
        spots: [],
        count: 0,
        names: [],
        coverage: [],
      };
    }
    const count = page.separationCount();
    const names = page.separationNames();
    const coverage = page.separationCoverage(overprintMode);
    const processNames = ['Cyan', 'Magenta', 'Yellow', 'Black'];
    return {
      supported: true,
      process: processNames.map((name, index) => ({
        index,
        name,
        coverage: coverage[index] ?? 0,
      })),
      spots: names.map((name, index) => ({
        index,
        name,
        coverage: coverage[4 + index] ?? 0,
      })),
      count,
      names,
      coverage,
    };
  } finally {
    page.destroy();
  }
}

self.addEventListener('message', async (event) => {
  const { id, type, payload = {} } = event.data || {};
  if (!id || !type) return;
  await rendererReady;
  try {
    let result;
    switch (type) {
      case RendererRequestType.recognize:
        result = await handleRecognize(payload);
        break;
      case RendererRequestType.open:
        result = await handleOpen(payload);
        break;
      case RendererRequestType.authenticate:
        result = await handleAuthenticate(payload);
        break;
      case RendererRequestType.close:
        result = await handleClose(payload);
        break;
      case RendererRequestType.info:
        result = await handleInfo(payload);
        break;
      case RendererRequestType.layers:
        result = await handleLayers(payload);
        break;
      case RendererRequestType.separations:
        result = await handleSeparations(payload);
        break;
      case RendererRequestType.render:
        await handleRender(id, payload);
        return;
      case RendererRequestType.cancel:
        {
          const active = activeRenders.get(payload.requestId);
          if (active) active.cancelled = true;
        }
        result = true;
        break;
      default:
        throw new AppError('rendererUnknownCommand');
    }
    sendOk(id, result);
  } catch (error) {
    sendError(id, error);
  }
});

self.postMessage({ type: 'ready' });
