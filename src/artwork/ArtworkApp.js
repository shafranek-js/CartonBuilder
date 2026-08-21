import { createExportSvg, createPrepressSvg, getExportFilename, getPrepressExportFilename } from '../export/svgExport.js';
import { createDiagnosticsBlob, recordDiagnostic } from '../diagnostics.js';
import { AppError } from '../errors.js';
import { getExportWarnings } from '../export/exportChecks.js';
import { getUserErrorMessage, t } from '../i18n.js';
import {
  clearCurrentProject,
  loadCurrentProject,
  saveCurrentProject,
} from '../project/ProjectStore.js';
import { createProjectArchive, readProjectArchive } from '../project/projectArchive.js';
import { CURRENT_PROJECT_SCHEMA_VERSION, validateProjectBundle } from '../project/projectSchema.js';
import { ProjectCheckpointStore } from '../project/ProjectCheckpoint.js';
import { ArtworkModel } from './ArtworkModel.js';
import { ArtworkRenderer } from './ArtworkRenderer.js';
import { HistoryManager } from './HistoryManager.js';
import { ViewportModel } from './ViewportModel.js';
import { loadArtworkFile, renderPdfWithLayers } from './fileLoader.js';
import {
  getSnapOffset,
  buildSnapTargets,
  getResizeSnapFactor,
} from './snap.js';
import {
  requestSaveDestination,
  saveOrDownloadFile,
  writeSaveDestination,
} from '../utils/fileSaver.js';
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings } from '../render/RenderSettings.js';
import { sanitizeBoardAppearance } from '../render/BoardAppearance.js';
import {
  getArtworkRasterSignature,
  rasterizeArtwork,
  resolveArtworkDpi,
  resolvePdfRenderOptions,
} from './artworkRasterizer.js';
import { sanitizeArtworkFinish } from '../render/FinishConfig.js';
import { DEFAULT_PAGE_BOX, PAGE_BOXES } from './pdfArtworkLoader.js';
import { getOverprintMode, isOverprintEnabled, setOverprintEnabled as setOverprintSetting } from './overprintSettings.js';
import { getMuPdfClient } from '../pdf-renderer/mupdfClient.js';
import { getPdfSeparations } from './pdfArtworkLoader.js';
import { clonePrepressSettings, DEFAULT_PREPRESS_SETTINGS, sanitizePrepressSettings } from '../prepress/prepressState.js';
import { runPrepressPreflight, createPreflightReportBlob } from '../prepress/prepressPreflight.js';
import { buildProductionDieline } from '../prepress/productionDieline.js';
import { getPrepressPresets, savePrepressPreset } from '../prepress/PrepressPresetStore.js';

const SNAP_SCREEN_PX = 6;
const SNAP_RELEASE_SCREEN_PX = 9;

function downloadBlob(documentRef, windowRef, blob, fileName) {
  const url = windowRef.URL.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  documentRef.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  windowRef.setTimeout(() => windowRef.URL.revokeObjectURL(url), 1000);
}

function deepClone(value) {
  return structuredClone(value);
}

function rotateVector(vector, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: vector.x * cosine - vector.y * sine,
    y: vector.x * sine + vector.y * cosine,
  };
}

function getResizeSideDirection(side, rotation) {
  const direction = side === 'e'
    ? { x: 1, y: 0 }
    : side === 'w'
      ? { x: -1, y: 0 }
      : side === 's'
        ? { x: 0, y: 1 }
        : { x: 0, y: -1 };
  return rotateVector(direction, rotation);
}

function getVisibleEdgeWorldPoint(model, side) {
  const rect = model.visibleLocalRect;
  const localX = side === 'e'
    ? rect.x + rect.width
    : side === 'w'
      ? rect.x
      : rect.x + rect.width / 2;
  const localY = side === 's'
    ? rect.y + rect.height
    : side === 'n'
      ? rect.y
      : rect.y + rect.height / 2;
  const rotated = rotateVector({
    x: localX - model.unrotatedWidthMm / 2,
    y: localY - model.unrotatedHeightMm / 2,
  }, model.rotation);
  return {
    x: model.centerXmm + rotated.x,
    y: model.centerYmm + rotated.y,
  };
}

function getVisibleCornerWorldPoint(model, corner) {
  const rect = model.visibleLocalRect;
  const localX = corner.includes('e') ? rect.x + rect.width : rect.x;
  const localY = corner.includes('s') ? rect.y + rect.height : rect.y;
  const rotated = rotateVector({
    x: localX - model.unrotatedWidthMm / 2,
    y: localY - model.unrotatedHeightMm / 2,
  }, model.rotation);
  return {
    x: model.centerXmm + rotated.x,
    y: model.centerYmm + rotated.y,
  };
}

function getCropLocalWorldPoint(model, localX, localY) {
  const rotated = rotateVector({
    x: localX - model.unrotatedWidthMm / 2,
    y: localY - model.unrotatedHeightMm / 2,
  }, model.rotation);
  return {
    x: model.centerXmm + rotated.x,
    y: model.centerYmm + rotated.y,
  };
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function createDragHandleSvg(documentRef) {
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('fill', 'currentColor');
  svg.innerHTML = '<circle cx="4" cy="4" r="1.4"/><circle cx="12" cy="4" r="1.4"/><circle cx="4" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="4" cy="8" r="1.4"/><circle cx="12" cy="8" r="1.4"/>';
  return svg;
}

const LAYER_PALETTE = ['#4a9eff', '#ff6b6b', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#20c997', '#f06595', '#74c0fc', '#ff8787'];

function createTargetCircleSvg(documentRef, filled) {
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  if (filled) svg.innerHTML = '<circle cx="8" cy="8" r="6" fill="currentColor"/>';
  else svg.innerHTML = '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  return svg;
}

function assignLayerColor(existingColors) {
  const used = new Set(existingColors || []);
  for (const color of LAYER_PALETTE) {
    if (!used.has(color)) return color;
  }
  return LAYER_PALETTE[0];
}

function finishState(entry) {
  return sanitizeArtworkFinish(entry);
}

function range(start, end) {
  const result = [];
  const step = start <= end ? 1 : -1;
  for (let index = start; index !== end + step; index += step) result.push(index);
  return result;
}

export function createArtworkApp({
  boxModel,
  boxApp,
  documentRef = document,
  windowRef = window,
  onBack,
  onPreview,
  onBackToEditor,
  onProjectLoaded,
  getWorkflowStep = () => 'artwork',
  getRenderState = () => DEFAULT_RENDER_SETTINGS,
  getRenderBoardAppearance = () => null,
  getRenderAssets = () => [],
  getPreview3dState = () => null,
  getCartonSource = () => ({ mode: 'quick', box: boxModel.toJSON() }),
  getWorkflowSelection = () => 'quick',
  getTechnicalAssets = () => null,
  canPersistProject = () => true,
  restoreCartonDocument = async () => null,
  onRenderStateChanged = () => {},
  onArtworkQualityChanged = () => {},
  onStateChanged = () => {},
  operationProgress = null,
}) {
  let artwork = new ArtworkModel();
  const viewport = new ViewportModel();
  const layers = {
    artwork: true,
    dieline: true,
    names: true,
    highlights: true,
  };
  const layerLocks = {
    artwork: false,
    dieline: true,
    names: true,
    highlights: true,
  };
  const artworks = [];
  let activeArtworkIndex = -1;
  let prepress = clonePrepressSettings(DEFAULT_PREPRESS_SETTINGS);
  const prepressOverlays = { trim: false, bleed: false, safe: false, dieline: false, marks: false };
  let lastPreflight = null;
  let prepressPresets = [];
  let originalBlob = null;
  let previewBlob = null;
  const svg = documentRef.getElementById('artworkWorkspace');
  const canvasWrap = documentRef.getElementById('artworkCanvasWrap');
  const dropState = documentRef.getElementById('dropState');
  const input = documentRef.getElementById('artworkFileInput');
  const projectInput = documentRef.getElementById('projectFileInput');
  const toast = documentRef.getElementById('toast');
  const processing = documentRef.getElementById('processingOverlay');
  const processingText = documentRef.getElementById('processingText');
  const announcer = documentRef.getElementById('announcer');
  const errorBanner = documentRef.getElementById('errorBanner');
  const errorMessage = documentRef.getElementById('errorMessage');
  const errorRetryButton = documentRef.getElementById('errorRetryButton');
  const errorDismissButton = documentRef.getElementById('errorDismissButton');

  async function runForegroundOperation(options) {
    if (operationProgress?.run) return operationProgress.run(options);
    const controller = new AbortController();
    try {
      const value = await options.work({
        id: options.id,
        signal: controller.signal,
        report: () => {},
        cancel: () => controller.abort(),
      });
      return controller.signal.aborted
        ? { status: 'cancelled' }
        : { status: 'succeeded', value };
    } catch (error) {
      return controller.signal.aborted || error?.name === 'AbortError'
        ? { status: 'cancelled', error }
        : { status: 'failed', error };
    }
  }
  const pageDialog = documentRef.getElementById('pageDialog');
  const pageNumber = documentRef.getElementById('pdfPageNumber');
  const pageCount = documentRef.getElementById('pdfPageCount');
  const passwordDialog = documentRef.getElementById('passwordDialog');
  const passwordInput = documentRef.getElementById('pdfPasswordInput');
  const separationsDialog = documentRef.getElementById('separationsDialog');
  const separationsList = documentRef.getElementById('separationsList');
  const sublayersContainer = documentRef.getElementById('artworkSublayers');
  const contextMenu = documentRef.getElementById('layerContextMenu');

  const controls = {
    fileName: documentRef.getElementById('artworkFileName'),
    x: documentRef.getElementById('artworkX'),
    y: documentRef.getElementById('artworkY'),
    width: documentRef.getElementById('artworkWidth'),
    height: documentRef.getElementById('artworkHeight'),
    opacity: documentRef.getElementById('artworkOpacity'),
    opacityValue: documentRef.getElementById('artworkOpacityValue'),
    bgOpacity: documentRef.getElementById('artworkBgOpacity'),
    bgOpacityValue: documentRef.getElementById('artworkBgOpacityValue'),
    dpi: documentRef.getElementById('effectiveDpi'),
    previewQuality: documentRef.getElementById('artworkPreviewQuality'),
    renderQuality: documentRef.getElementById('artworkRenderQuality'),
    qualitySummary: documentRef.getElementById('artworkQualitySummary'),
    finishSection: documentRef.getElementById('artworkFinishSection'),
    finishRole: documentRef.getElementById('artworkFinishRole'),
    finishType: documentRef.getElementById('artworkFinishType'),
    finishMaskChannel: documentRef.getElementById('artworkFinishMaskChannel'),
    finishInvert: documentRef.getElementById('artworkFinishInvert'),
    finishIntensity: documentRef.getElementById('artworkFinishIntensity'),
    finishIntensityValue: documentRef.getElementById('artworkFinishIntensityValue'),
    finishColor: documentRef.getElementById('artworkFinishColor'),
    finishRoughness: documentRef.getElementById('artworkFinishRoughness'),
    finishRoughnessValue: documentRef.getElementById('artworkFinishRoughnessValue'),
    finishRelief: documentRef.getElementById('artworkFinishRelief'),
    finishReliefValue: documentRef.getElementById('artworkFinishReliefValue'),
    choose: documentRef.getElementById('chooseArtworkButton'),
    replace: documentRef.getElementById('replaceArtworkButton'),
    remove: documentRef.getElementById('removeArtworkButton'),
    fit: documentRef.getElementById('fitArtworkButton'),
    fill: documentRef.getElementById('fillArtworkButton'),
    center: documentRef.getElementById('centerArtworkButton'),
    rotateLeft: documentRef.getElementById('rotateLeftButton'),
    rotateRight: documentRef.getElementById('rotateRightButton'),
    flipHorizontal: documentRef.getElementById('flipHorizontalButton'),
    flipVertical: documentRef.getElementById('flipVerticalButton'),
    reset: documentRef.getElementById('resetArtworkButton'),
    undo: documentRef.getElementById('undoButton'),
    redo: documentRef.getElementById('redoButton'),
    preview: documentRef.getElementById('previewButton'),
    referencePointGrid: documentRef.getElementById('referencePointGrid'),
    pdfLayersSection: documentRef.getElementById('pdfLayersSection'),
    pdfLayersList: documentRef.getElementById('pdfLayersList'),
    pageBoxSelect: documentRef.getElementById('pageBoxSelect'),
    cropSection: documentRef.getElementById('cropSection'),
    opacitySection: documentRef.getElementById('opacitySection'),
    cropFrameBtn: documentRef.getElementById('cropFrameButton'),
    cropDrawBtn: documentRef.getElementById('cropDrawButton'),
    clearCrop: documentRef.getElementById('clearCropButton'),
    cropStatus: documentRef.getElementById('cropStatus'),
    scaleX: documentRef.getElementById('artworkScaleX'),
    scaleY: documentRef.getElementById('artworkScaleY'),
    constrainBtn: documentRef.getElementById('constrainProportionsBtn'),
    boxWidth: documentRef.getElementById('artworkBoxWidth'),
    boxHeight: documentRef.getElementById('artworkBoxHeight'),
    boxDepth: documentRef.getElementById('artworkBoxDepth'),
    boxConstrainBtn: documentRef.getElementById('boxConstrainProportionsBtn'),
    boxDimensionsSection: documentRef.getElementById('boxDimensionsSection'),
    prepressMode: documentRef.getElementById('prepressMode'),
    prepressPreset: documentRef.getElementById('prepressPreset'),
    prepressProfile: documentRef.getElementById('prepressProfile'),
    prepressBleed: documentRef.getElementById('prepressBleed'),
    prepressSafe: documentRef.getElementById('prepressSafe'),
    prepressSlug: documentRef.getElementById('prepressSlug'),
    prepressDpi: documentRef.getElementById('prepressDpi'),
    prepressCutOffset: documentRef.getElementById('prepressCutOffset'),
    prepressCreaseOffset: documentRef.getElementById('prepressCreaseOffset'),
    prepressGlueDelta: documentRef.getElementById('prepressGlueDelta'),
    prepressTuckDelta: documentRef.getElementById('prepressTuckDelta'),
    prepressCropMarks: documentRef.getElementById('prepressCropMarks'),
    prepressRegistrationMarks: documentRef.getElementById('prepressRegistrationMarks'),
    prepressSlugMark: documentRef.getElementById('prepressSlugMark'),
    prepressReset: documentRef.getElementById('prepressReset'),
    prepressSavePreset: documentRef.getElementById('prepressSavePreset'),
    prepressRun: documentRef.getElementById('prepressRun'),
    prepressExport: documentRef.getElementById('prepressExport'),
    prepressReport: documentRef.getElementById('prepressReport'),
    prepressStatus: documentRef.getElementById('prepressStatus'),
  };

  const layerControls = {
    artwork: documentRef.getElementById('layerArtwork'),
    dieline: documentRef.getElementById('layerDieline'),
    names: documentRef.getElementById('layerNames'),
    highlights: documentRef.getElementById('layerHighlights'),
  };
  const layerLockControls = {
    artwork: documentRef.getElementById('lockArtwork'),
    dieline: documentRef.getElementById('lockDieline'),
    names: documentRef.getElementById('lockNames'),
    highlights: documentRef.getElementById('lockHighlights'),
  };

  let selected = false;
  let gesture = null;
  let spacePressed = false;
  let saveTimer = null;
  let toastTimer = null;
  let wheelBefore = null;
  let wheelTimer = null;
  let processingGeneration = 0;
  let processingController = null;
  let pdfRenderGeneration = 0;
  let pdfRenderController = null;
  let previewResourceGeneration = 0;
  let previewResourceController = null;
  const previewResourceSignatures = new Map();
  let projectCreatedAt = new Date().toISOString();
  let errorRetry = null;
  let currentError = null;
  let currentErrorFallback = 'unexpectedError';
  let saveQueue = Promise.resolve();
  let disposed = false;
  let sublayerDrag = null;
  let renamingSublayerIndex = -1;
  let cancelRename = false;
  let pendingReplace = false;
  let cropMode = null;
  let cropPreview = null;
  let cropGesture = null;
  let cropDrawStart = null;
  let cropBeforeState = null;
  let constrainProportions = true;
  let boxConstrainProportions = true;
  let artworkGroupCollapsed = false;
  let selectedArtworkIndices = new Set();
  const thumbnailUrlCache = new Map();
  const projectCheckpoint = new ProjectCheckpointStore();

  function showToast(message) {
    windowRef.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = windowRef.setTimeout(() => toast.classList.remove('visible'), 2400);
  }

  function announce(message) {
    announcer.textContent = message;
  }

  function clearError() {
    errorRetry = null;
    currentError = null;
    currentErrorFallback = 'unexpectedError';
    errorBanner.hidden = true;
    errorMessage.textContent = '';
    errorRetryButton.hidden = true;
  }

  function renderCurrentError() {
    if (!currentError) return;
    errorMessage.textContent = getUserErrorMessage(currentError, currentErrorFallback);
  }

  function showError(error, fallbackKey = 'unexpectedError', { retry = null } = {}) {
    errorRetry = retry;
    currentError = error;
    currentErrorFallback = fallbackKey;
    renderCurrentError();
    errorRetryButton.hidden = typeof retry !== 'function';
    errorBanner.hidden = false;
    recordDiagnostic('user-error', {
      code: error instanceof AppError ? error.code : fallbackKey,
    });
  }

  errorDismissButton.addEventListener('click', clearError);
  errorRetryButton.addEventListener('click', () => {
    const retry = errorRetry;
    clearError();
    retry?.();
  });

  function captureEditorState() {
    return {
      artworks: artworks.map((entry) => ({
        artwork: entry.model.toJSON(),
        visible: entry.visible,
        locked: entry.locked,
        color: entry.color,
        ...finishState(entry),
        originalBlob: entry.originalBlob,
        previewBlob: entry.previewBlob,
      })),
      activeArtworkIndex,
      layers: { ...layers },
      layerLocks: { ...layerLocks },
      collapseArtworkGroup: artworkGroupCollapsed,
    };
  }

  function applyEditorState(state) {
    resetCropInteraction({ updateUi: false });
    artworks.length = 0;
    for (const entry of state.artworks || []) {
      artworks.push({
        model: new ArtworkModel(entry.artwork),
        visible: entry.visible !== false,
        locked: Boolean(entry.locked),
        color: entry.color || assignLayerColor(artworks.map((e) => e.color)),
        ...finishState(entry),
        originalBlob: entry.originalBlob || null,
        previewBlob: entry.previewBlob || null,
        displayBlob: null,
      });
    }
    Object.assign(layers, state.layers);
    Object.assign(layerLocks, state.layerLocks);
    artworkGroupCollapsed = Boolean(state.collapseArtworkGroup);
    updateTwistyDom();
    // History restores replace every ArtworkModel instance. Keep the renderer's
    // entry list in lockstep with those new models before the active selection
    // and the next render are updated; otherwise the selection frame can use
    // the restored model while the artwork image/clip still comes from the
    // pre-undo renderer entry.
    renderer.setArtworks(artworks);
    selectArtworkRow(
      Number.isInteger(state.activeArtworkIndex) && state.activeArtworkIndex >= 0
        ? Math.min(state.activeArtworkIndex, artworks.length - 1)
        : -1,
    );
    render();
    scheduleSave();
  }

  const history = new HistoryManager({ apply: applyEditorState, limit: 100 });

  function updateTwistyDom() {
    const twisty = documentRef.getElementById('artworkTwisty');
    if (!twisty) return;
    twisty.setAttribute('aria-expanded', String(!artworkGroupCollapsed));
    twisty.setAttribute('aria-label', t(artworkGroupCollapsed ? 'expandArtworkGroup' : 'collapseArtworkGroup'));
  }

  function syncThumbnailUrls() {
    const limit = artworks.length;
    const kept = new Set();
    for (let index = 0; index < limit; index += 1) {
      const blob = artworks[index].previewBlob;
      if (!blob) continue;
      const blobKey = blob.size;
      const cached = thumbnailUrlCache.get(index);
      if (cached && cached.blobKey === blobKey) {
        kept.add(index);
        continue;
      }
      if (cached?.url) URL.revokeObjectURL(cached.url);
      const url = URL.createObjectURL(blob);
      thumbnailUrlCache.set(index, { blobKey, url });
      kept.add(index);
    }
    for (const [key, cached] of thumbnailUrlCache) {
      if (!kept.has(key)) {
        if (cached.url) URL.revokeObjectURL(cached.url);
        thumbnailUrlCache.delete(key);
      }
    }
  }

  function syncArtworkVisibility() {
    renderer.syncArtworkVisibility(artworks);
  }

  function createLayerLockSvg() {
    return createSvgElement('svg', {
      class: 'layer-lock-icon',
      viewBox: '0 0 24 24',
      width: 12,
      height: 12,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
    }, '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>');
  }

  const renderer = new ArtworkRenderer({
    svg,
    model: boxModel,
    artwork,
    viewport,
    layers,
    onPointerStart: startArtworkGesture,
  });

  function artworkEntryName(entry) {
    return entry?.model?.source?.fileName || 'artwork';
  }

  function getActiveEntry() {
    return artworks[activeArtworkIndex] || null;
  }

  function setActiveArtwork(index) {
    if (index < 0 || index >= artworks.length) return;
    activeArtworkIndex = index;
    const entry = artworks[index];
    artwork = entry.model;
    originalBlob = entry.originalBlob;
    previewBlob = entry.previewBlob;
    renderer.artwork = artwork;
  }

  function activateArtwork(index, { fit = false } = {}) {
    if (index < 0 || index >= artworks.length) {
      activeArtworkIndex = -1;
      artwork = new ArtworkModel();
      originalBlob = null;
      previewBlob = null;
      renderer.artwork = artwork;
    } else {
      setActiveArtwork(index);
    }
    renderer.setArtworks(artworks);
    renderPdfLayers();
    render();
    refreshPreviewResources();
    if (fit) windowRef.requestAnimationFrame(() => renderer.fitToScreen());
    scheduleSave();
  }

  function ensureVideoElement(entry) {
    const isVideo = Boolean(
      entry?.model?.source?.isVideo
      || entry?.model?.source?.mimeType?.startsWith('video/')
      || entry?.originalBlob?.type?.startsWith('video/')
      || entry?.model?.source?.fileName?.match(/\.(mp4|webm|ogv)$/i)
    );
    if (isVideo && !entry.videoElement && entry.originalBlob && typeof document !== 'undefined') {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(entry.originalBlob);
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.preload = 'auto';
      video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0.001;pointer-events:none;';
      if (document.body) document.body.appendChild(video);
      entry.videoElement = video;
    }
    return entry?.videoElement || null;
  }

  function getArtworks() {
    return artworks.map((entry) => ({
      model: entry.model,
      originalBlob: entry.originalBlob,
      previewBlob: entry.previewBlob,
      displayBlob: entry.displayBlob || null,
      videoElement: ensureVideoElement(entry),
      visible: entry.visible,
      ...finishState(entry),
    }));
  }

  function getPreviewResourceDpi() {
    const bounds = boxModel.getBounds();
    const width = Math.max(1, svg?.clientWidth || 1);
    const height = Math.max(1, svg?.clientHeight || 1);
    return Math.max(
      150,
      Math.min(600, Math.max(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height)) * 25.4 * 1.5),
    );
  }

  async function refreshPreviewResources({ force = false } = {}) {
    if (disposed || !artworks.length) return false;
    const targetDpi = getPreviewResourceDpi();
    const candidates = artworks.filter((entry) => entry.model.hasArtwork && entry.originalBlob);
    const pending = candidates.filter((entry) => {
      const plateOptions = getEntryPdfRenderOptions(entry);
      const signature = `${getArtworkRasterSignature(entry, 'preview', { plateOptions })}|${targetDpi.toFixed(2)}`;
      return force || previewResourceSignatures.get(entry.model.source.id) !== signature;
    });
    if (!pending.length) return false;
    previewResourceController?.abort();
    const controller = new AbortController();
    previewResourceController = controller;
    const generation = ++previewResourceGeneration;
    try {
      for (const entry of pending) {
        const plateOptions = getEntryPdfRenderOptions(entry);
        const entryTargetDpi = resolveArtworkDpi(entry.model.quality?.preview, {
          purpose: 'preview',
          requiredDpi: targetDpi,
        });
        const rendered = await rasterizeArtwork({
          entry,
          purpose: 'preview',
          targetDpi: entryTargetDpi,
          requiredDpi: targetDpi,
          signal: controller.signal,
          documentRef,
          plateOptions,
        });
        if (generation !== previewResourceGeneration || controller.signal.aborted || disposed) return false;
        entry.displayBlob = rendered.blob;
        previewResourceSignatures.set(
          entry.model.source.id,
          `${getArtworkRasterSignature(entry, 'preview', { plateOptions })}|${targetDpi.toFixed(2)}`,
        );
      }
      renderer.setArtworks(artworks);
      render();
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('Could not prepare high-quality artwork preview', error);
      }
      return false;
    } finally {
      if (generation === previewResourceGeneration) previewResourceController = null;
    }
  }

  function getArtworksJson() {
    return JSON.stringify({
      artworks: artworks.map((entry) => ({
        artwork: entry.model.toJSON(),
        visible: entry.visible,
        ...finishState(entry),
      })),
      activeArtworkIndex,
    });
  }

  function persistedWorkflowStep(value = getWorkflowStep()) {
    if (value === 'preview') return 'preview';
    if (value === 'render') return 'render';
    if (value === 'artwork') return 'artwork';
    return 'box';
  }

  function createSnapshot(workflowStep = persistedWorkflowStep()) {
    const topmost = artworks[0];
    const cartonSource = getCartonSource() || { mode: 'quick', box: boxModel.toJSON() };
    return {
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      meta: {
        id: 'current',
        name: artworkEntryName(topmost) || 'Untitled carton',
        createdAt: projectCreatedAt,
        updatedAt: new Date().toISOString(),
        locale: documentRef.documentElement.lang || 'en',
      },
      workflowStep,
      workflowSelection: getWorkflowSelection() === 'technical' ? 'technical' : 'quick',
      cartonSource: structuredClone(cartonSource),
      artworks: artworks.map((entry) => ({
        artwork: entry.model.toJSON(),
        visible: entry.visible,
        ...finishState(entry),
      })),
      activeArtworkIndex,
      render: sanitizeRenderSettings(getRenderState()),
      renderAppearance: sanitizeBoardAppearance(getRenderBoardAppearance()),
      prepress: clonePrepressSettings(prepress),
      view: {
        ...viewport.toJSON(),
        layers: { ...layers },
        layerLocks: { ...layerLocks },
        collapseArtworkGroup: artworkGroupCollapsed,
      },
      history: history.toJSON(),
    };
  }

  function createCheckpointPayload() {
    return {
      snapshot: createSnapshot(),
      artworkBlobs: artworks.map((entry) => ({
        originalBlob: entry.originalBlob,
        previewBlob: entry.previewBlob,
      })),
      renderAssets: getRenderAssets() || [],
      technicalAssets: getTechnicalAssets() || null,
    };
  }

  async function verifyCheckpointPayload(payload) {
    await validateProjectBundle({
      snapshot: payload.snapshot,
      artworkBlobs: payload.artworkBlobs,
      renderAssets: payload.renderAssets,
      technicalAssets: payload.technicalAssets,
    });
  }

  async function createProjectCheckpoint(options = {}) {
    const payload = createCheckpointPayload();
    return projectCheckpoint.createProjectCheckpoint(payload, {
      verify: verifyCheckpointPayload,
      write: options.writeCheckpoint || options.faultInjector || (async () => {}),
    });
  }

  async function restoreProjectCheckpoint() {
    const payload = await projectCheckpoint.restoreProjectCheckpoint({ verify: verifyCheckpointPayload });
    if (!payload) return false;
    await restoreProject(payload);
    return true;
  }

  function discardProjectCheckpoint() {
    projectCheckpoint.discardProjectCheckpoint();
  }

  function enqueueSave(workflowStep = persistedWorkflowStep()) {
    if (!canPersistProject()) return Promise.resolve(false);
    const hasCompleteArtwork = artworks.length > 0 && artworks.every(
      (entry) => entry.model.hasArtwork && entry.originalBlob && entry.previewBlob,
    );
    const payload = {
      snapshot: createSnapshot(persistedWorkflowStep(workflowStep)),
      artworkBlobs: hasCompleteArtwork
        ? artworks.map((entry) => ({
          originalBlob: entry.originalBlob,
          previewBlob: entry.previewBlob,
        }))
        : [],
      renderAssets: getRenderAssets() || [],
      technicalAssets: getTechnicalAssets() || null,
    };
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        if (disposed) return false;
        await saveCurrentProject(payload);
        return true;
      })
      .catch((error) => {
        console.error(error);
        showError(error, 'autosaveFailed');
        throw error;
      });
    return saveQueue;
  }

  function scheduleSave() {
    windowRef.clearTimeout(saveTimer);
    saveTimer = windowRef.setTimeout(() => {
      enqueueSave().catch(() => {});
    }, 500);
    onStateChanged();
  }

  function persistWorkflowStep(workflowStep = persistedWorkflowStep()) {
    windowRef.clearTimeout(saveTimer);
    return enqueueSave(workflowStep).catch(() => false);
  }

  async function flushPendingSave() {
    windowRef.clearTimeout(saveTimer);
    try {
      return await enqueueSave();
    } catch {
      return false;
    }
  }

  function renderControls() {
    const enabled = artwork.hasArtwork;
    const transformEnabled = enabled && !layerLocks.artwork && !(artworks[activeArtworkIndex]?.locked);
    controls.fileName.textContent = artwork.source?.fileName || t('noFile');
    const reference = enabled ? artwork.getReferencePosition() : null;
    controls.x.value = enabled ? round(reference.x) : '';
    controls.y.value = enabled ? round(reference.y) : '';
    controls.width.value = enabled ? round(artwork.displayedWidthMm) : '';
    controls.height.value = enabled ? round(artwork.displayedHeightMm) : '';
    if (enabled) {
      controls.scaleX.value = round(artwork.scaleX * 100);
      controls.scaleY.value = round(artwork.scaleY * 100);
      controls.scaleX.disabled = !transformEnabled;
      controls.scaleY.disabled = !transformEnabled;
    } else {
      controls.scaleX.value = '';
      controls.scaleY.value = '';
    }
    controls.constrainBtn.setAttribute('aria-pressed', String(constrainProportions));
    controls.constrainBtn.textContent = constrainProportions ? '🔗' : '⛓️‍💥';
    controls.boxWidth.value = round(boxModel.dimensions.width);
    controls.boxHeight.value = round(boxModel.dimensions.height);
    controls.boxDepth.value = round(boxModel.dimensions.depth);
    controls.boxConstrainBtn.setAttribute('aria-pressed', String(boxConstrainProportions));
    controls.boxConstrainBtn.textContent = boxConstrainProportions ? '🔗' : '⛓️‍💥';
    controls.opacity.value = enabled ? Math.round(artwork.opacity * 100) : 100;
    controls.opacityValue.value = `${controls.opacity.value}%`;
    controls.bgOpacity.value = enabled ? Math.round(artwork.bgOpacity * 100) : 28;
    controls.bgOpacityValue.value = `${controls.bgOpacity.value}%`;

    for (const slider of [controls.opacity, controls.bgOpacity]) {
      if (slider) {
        const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
        slider.style.setProperty('--slider-progress', `${pct}%`);
      }
    }

    const dpi = artwork.getEffectiveDpi();
    controls.dpi.textContent = !enabled ? '—' : dpi == null ? 'Vector' : `${Math.round(dpi)} DPI`;
    controls.dpi.classList.toggle('low-dpi', dpi != null && dpi < 300);
    if (controls.previewQuality) controls.previewQuality.value = enabled ? String(artwork.quality?.preview || 'auto') : 'auto';
    if (controls.renderQuality) controls.renderQuality.value = enabled ? String(artwork.quality?.render || 'auto') : 'auto';
    if (controls.previewQuality) controls.previewQuality.disabled = !enabled || !artwork.source?.vector;
    if (controls.renderQuality) controls.renderQuality.disabled = !enabled || !artwork.source?.vector;
    if (controls.qualitySummary) {
      controls.qualitySummary.textContent = !enabled
        ? t('qualityNoArtwork')
        : artwork.source?.vector
          ? t('qualityVectorSummary')
          : t('qualityNativeSummary', { dpi: Math.round(dpi || 0) });
    }
    const activeFinish = finishState(getActiveEntry());
    const hasFinish = enabled && activeFinish.outputRole !== 'print';
    if (controls.finishSection) controls.finishSection.hidden = !enabled;
    if (controls.finishRole) {
      controls.finishRole.value = enabled ? activeFinish.outputRole : 'print';
      controls.finishRole.disabled = !enabled || !transformEnabled;
    }
    if (controls.finishType) controls.finishType.value = activeFinish.finish?.type || 'spot-gloss';
    if (controls.finishMaskChannel) controls.finishMaskChannel.value = activeFinish.finish?.maskChannel || 'auto';
    if (controls.finishInvert) controls.finishInvert.checked = activeFinish.finish?.invert === true;
    if (controls.finishIntensity) {
      controls.finishIntensity.value = String(Math.round((activeFinish.finish?.intensity || 1) * 100));
      controls.finishIntensity.disabled = !hasFinish || !transformEnabled;
    }
    if (controls.finishIntensityValue) controls.finishIntensityValue.value = `${Math.round((activeFinish.finish?.intensity || 1) * 100)}%`;
    if (controls.finishColor) {
      controls.finishColor.value = activeFinish.finish?.foilColor || '#d4af37';
      controls.finishColor.disabled = !hasFinish || activeFinish.finish?.type !== 'foil' || !transformEnabled;
    }
    if (controls.finishRoughness) {
      controls.finishRoughness.value = String(Math.round((activeFinish.finish?.foilRoughness || 0.22) * 100));
      controls.finishRoughness.disabled = !hasFinish || !['spot-gloss', 'foil'].includes(activeFinish.finish?.type) || !transformEnabled;
    }
    if (controls.finishRoughnessValue) controls.finishRoughnessValue.value = `${Math.round((activeFinish.finish?.foilRoughness || 0.22) * 100)}%`;
    if (controls.finishRelief) {
      controls.finishRelief.value = String(Math.round((activeFinish.finish?.reliefStrength || 0.35) * 100));
      controls.finishRelief.disabled = !hasFinish || !['emboss', 'deboss'].includes(activeFinish.finish?.type) || !transformEnabled;
    }
    if (controls.finishReliefValue) controls.finishReliefValue.value = `${Math.round((activeFinish.finish?.reliefStrength || 0.35) * 100)}%`;
    for (const control of [controls.finishType, controls.finishMaskChannel, controls.finishInvert]) {
      if (control) control.disabled = !hasFinish || !transformEnabled;
    }

    for (const control of [
      controls.x, controls.y, controls.width, controls.height, controls.opacity,
      controls.remove, controls.fit, controls.fill, controls.center,
      controls.rotateLeft, controls.rotateRight, controls.flipHorizontal, controls.flipVertical, controls.reset,
    ]) {
      control.disabled = !transformEnabled;
    }
    for (const button of controls.referencePointGrid.querySelectorAll('.reference-point-button')) {
      button.disabled = !transformEnabled;
      button.setAttribute('aria-pressed', String(button.dataset.point === artwork.referencePoint));
    }
    controls.bgOpacity.disabled = !transformEnabled;
    controls.replace.disabled = !enabled;
    if (controls.preview) controls.preview.disabled = artworks.length === 0;
    controls.undo.disabled = history.undoStack.length === 0;
    controls.redo.disabled = history.redoStack.length === 0;
    controls.cropSection.hidden = !enabled;
    controls.opacitySection.hidden = !enabled;
    controls.clearCrop.disabled = !artwork.crop && !cropMode;
    updateCropButtons();
    dropState.hidden = artworks.length > 0;
    const countElement = documentRef.getElementById('artworkLayerCount');
    if (countElement) {
      countElement.hidden = artworks.length <= 1;
      countElement.textContent = artworks.length ? `(${artworks.length})` : '';
    }
    renderer.selected = selected && enabled;
    const isArtworkSelected = selected && enabled;
    documentRef.querySelectorAll('.adobe-layer-row[data-layer-id="artwork"]').forEach((row) => {
      row.classList.toggle('active', isArtworkSelected);
    });
  }

  function renderPrepressControls() {
    const technicalPrepressBlocked = boxModel?.mode === 'technical';
    const map = [
      ['prepressMode', prepress.mode], ['prepressProfile', prepress.profileId],
      ['prepressBleed', prepress.bleedMm], ['prepressSafe', prepress.safeMm],
      ['prepressSlug', prepress.slugMm], ['prepressDpi', prepress.requiredDpi],
      ['prepressCutOffset', prepress.allowances.cutOffsetMm],
      ['prepressCreaseOffset', prepress.allowances.creaseOffsetMm],
      ['prepressGlueDelta', prepress.allowances.glueTabDeltaMm],
      ['prepressTuckDelta', prepress.allowances.tuckClearanceDeltaMm],
      ['prepressCropMarks', prepress.marks.crop], ['prepressRegistrationMarks', prepress.marks.registration],
      ['prepressSlugMark', prepress.marks.slug],
    ];
    for (const [id, value] of map) {
      const control = controls[id];
      if (!control) continue;
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
      control.disabled = technicalPrepressBlocked;
    }
    if (controls.prepressPreset) {
      const selected = controls.prepressPreset.value;
      const option = (label, value) => { const next = documentRef.createElement('option'); next.textContent = label; next.value = value; return next; };
      controls.prepressPreset.replaceChildren(option('—', ''));
      for (const preset of prepressPresets) controls.prepressPreset.appendChild(option(preset.name, preset.id));
      controls.prepressPreset.value = prepressPresets.some((preset) => preset.id === selected) ? selected : '';
      controls.prepressPreset.disabled = technicalPrepressBlocked;
    }
    for (const id of ['prepressRun', 'prepressReport', 'prepressExport', 'prepressReset', 'prepressSavePreset']) {
      if (controls[id]) controls[id].disabled = technicalPrepressBlocked;
    }
    if (controls.prepressStatus) {
      if (technicalPrepressBlocked) {
        controls.prepressStatus.textContent = 'Production-assist export is unavailable for technical curved dielines. Exact flat SVG, PDF and raster export remain available.';
        controls.prepressStatus.classList.add('is-error');
        return;
      }
      const production = buildProductionDieline(boxModel, prepress);
      controls.prepressStatus.textContent = production.diagnostics.valid
        ? `${prepress.mode === 'production-assist' ? 'Production assist' : 'Technical proof'} · ${production.diagnostics.elementCount} elements · ${production.diagnostics.bleedBounds.width.toFixed(1)} × ${production.diagnostics.bleedBounds.height.toFixed(1)} mm`
        : 'Prepress contour needs review';
      controls.prepressStatus.classList.toggle('is-error', !production.diagnostics.valid);
    }
  }

  function renderSublayers() {
    syncThumbnailUrls();
    sublayersContainer.hidden = artworks.length === 0 || artworkGroupCollapsed;
    sublayersContainer.replaceChildren();
    for (let index = 0; index < artworks.length; index += 1) {
      const entry = artworks[index];
      const row = documentRef.createElement('div');
      row.className = 'adobe-layer-row artwork-sublayer';
      if (index === activeArtworkIndex) row.classList.add('active');
      if (selectedArtworkIndices.has(index)) row.classList.add('selected');
      if (entry.locked) row.classList.add('locked');
      row.dataset.artworkIndex = String(index);
      row.draggable = true;

      const eye = documentRef.createElement('label');
      eye.className = 'layer-toggle-cell eye-cell';
      eye.title = 'Toggle Visibility';
      const checkbox = documentRef.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'sr-only';
      checkbox.checked = entry.visible;
      checkbox.addEventListener('change', () => toggleArtworkVisibility(index, checkbox.checked));
      eye.appendChild(checkbox);
      const eyeSvg = createLayerEyeSvg();
      eyeSvg.classList.add('layer-eye-icon');
      eye.appendChild(eyeSvg);
      row.appendChild(eye);

      const lockLabel = documentRef.createElement('label');
      lockLabel.className = 'layer-toggle-cell lock-cell';
      lockLabel.title = t('lockArtworkLayer');
      const lockCb = documentRef.createElement('input');
      lockCb.type = 'checkbox';
      lockCb.className = 'layer-toggle-input';
      lockCb.setAttribute('aria-label', t('lockArtworkLabel'));
      lockCb.checked = entry.locked;
      lockCb.addEventListener('change', () => toggleArtworkLock(index, lockCb.checked));
      lockLabel.appendChild(lockCb);
      lockLabel.appendChild(createLayerLockSvg());
      row.appendChild(lockLabel);

      const colorSquare = documentRef.createElement('span');
      colorSquare.className = 'layer-color-square';
      colorSquare.style.backgroundColor = entry.color || LAYER_PALETTE[0];
      row.appendChild(colorSquare);

      const thumbCached = thumbnailUrlCache.get(index);
      if (thumbCached?.url) {
        const thumbImg = documentRef.createElement('img');
        thumbImg.className = 'artwork-sublayer-thumb';
        thumbImg.src = thumbCached.url;
        thumbImg.alt = entry.model.source?.fileName || '';
        row.appendChild(thumbImg);
      } else {
        const thumbnail = documentRef.createElement('span');
        thumbnail.className = 'layer-thumbnail artwork-sublayer-thumb placeholder';
        thumbnail.appendChild(createLayerThumbSvg());
        row.appendChild(thumbnail);
      }

      const name = documentRef.createElement('span');
      name.className = 'layer-title';
      name.textContent = entry.model.source?.fileName || 'artwork';
      name.title = entry.model.source?.fileName || 'artwork';
      name.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        startRenameSublayer(index, name);
      });
      row.appendChild(name);
      if (entry.outputRole && entry.outputRole !== 'print') {
        const finishBadge = documentRef.createElement('span');
        finishBadge.className = 'artwork-finish-badge';
        finishBadge.textContent = entry.finish?.type || 'finish';
        finishBadge.title = t('artworkFinishMask');
        row.appendChild(finishBadge);
      }

      const target = documentRef.createElement('span');
      target.className = 'layer-target-circle';
      if (index === activeArtworkIndex) target.classList.add('active');
      target.title = t('selectArtworkLayer');
      target.appendChild(createTargetCircleSvg(documentRef, index === activeArtworkIndex));
      target.addEventListener('click', (event) => {
        event.stopPropagation();
        handleLayerClick(event, index);
      });
      row.appendChild(target);

      row.addEventListener('click', (event) => {
        if (event.target.closest('.layer-toggle-cell')) return;
        if (event.target.closest('.layer-target-circle')) return;
        handleLayerClick(event, index);
      });

      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showContextMenu(event, index);
      });

      row.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('.layer-toggle-cell')) return;
        if (event.target.closest('.layer-target-circle')) return;
        selectedArtworkIndices = new Set([index]);
        sublayerDrag = {
          index,
          pointerId: event.pointerId,
          moved: false,
          started: false,
          row: event.currentTarget,
          startX: event.clientX,
          startY: event.clientY,
          before: captureEditorState(),
        };
      });

      sublayersContainer.appendChild(row);
    }
  }

  function showContextMenu(event, index) {
    const entry = artworks[index];
    if (!entry) return;
    contextMenu.dataset.artworkIndex = String(index);
    const lockItem = contextMenu.querySelector('[data-action="lock"]');
    const lockSpan = lockItem.querySelector('span');
    lockSpan.textContent = t(entry.locked ? 'unlockLayer' : 'lockLayer');
    contextMenu.hidden = false;
    const x = Math.min(event.clientX, windowRef.innerWidth - contextMenu.offsetWidth - 8);
    const y = Math.min(event.clientY, windowRef.innerHeight - contextMenu.offsetHeight - 8);
    contextMenu.style.left = `${Math.max(4, x)}px`;
    contextMenu.style.top = `${Math.max(4, y)}px`;
  }

  function hideContextMenu() {
    contextMenu.hidden = true;
  }

  contextMenu.addEventListener('click', (event) => {
    const button = event.target.closest('.context-menu-item');
    if (!button) return;
    hideContextMenu();
    const action = button.dataset.action;
    const index = Number(contextMenu.dataset.artworkIndex);
    const entry = artworks[index];
    if (!entry) return;
    if (action === 'rename') {
      const nameEl = sublayersContainer.children[index]?.querySelector('.layer-title');
      if (nameEl) startRenameSublayer(index, nameEl);
    } else if (action === 'duplicate') {
      duplicateArtwork(index);
    } else if (action === 'lock') {
      toggleArtworkLock(index, !entry.locked);
    } else if (action === 'delete') {
      showDeleteConfirmation();
    }
  });

  documentRef.addEventListener('click', (event) => {
    if (!contextMenu.hidden && !contextMenu.contains(event.target)) hideContextMenu();
  });

  windowRef.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !contextMenu.hidden) {
      hideContextMenu();
      event.stopPropagation();
    }
  });

  function duplicateArtwork(index) {
    const entry = artworks[index];
    if (!entry) return;
    const before = captureEditorState();
    const model = new ArtworkModel(entry.model.toJSON());
    const color = assignLayerColor(artworks.map((e) => e.color));
    artworks.splice(index, 0, {
      model,
      originalBlob: entry.originalBlob ? new Blob([entry.originalBlob], { type: entry.originalBlob.type }) : null,
      previewBlob: entry.previewBlob ? new Blob([entry.previewBlob], { type: 'image/png' }) : null,
      displayBlob: null,
      visible: entry.visible,
      locked: false,
      color,
      ...finishState(entry),
    });
    if (activeArtworkIndex >= index) activeArtworkIndex += 1;
    renderer.setArtworks(artworks);
    commitChange('Duplicate artwork', before);
  }

  function showDeleteConfirmation() {
    const selected = selectedArtworkIndices.size
      ? [...selectedArtworkIndices]
      : (activeArtworkIndex >= 0 ? [activeArtworkIndex] : []);
    const toRemove = selected
      .filter((i) => i >= 0 && i < artworks.length);
    if (!toRemove.length) return;
    const confirmMsg = toRemove.length > 1
      ? t('removeSelectedConfirm', { count: toRemove.length })
      : t('removeConfirm');
    if (!windowRef.confirm(confirmMsg)) return;
    removeSelectedArtworks(toRemove);
  }

  function removeSelectedArtworks(toRemove) {
    const before = captureEditorState();
    pdfRenderController?.abort();
    pdfRenderController = null;
    previewResourceController?.abort();
    previewResourceController = null;
    previewResourceGeneration += 1;
    previewResourceSignatures.clear();
    pdfRenderGeneration += 1;
    toRemove.sort((a, b) => b - a);
    for (const index of toRemove) {
      artworks.splice(index, 1);
    }
    selectedArtworkIndices.clear();
    if (artworks.length === 0) {
      activeArtworkIndex = -1;
      artwork = new ArtworkModel();
      originalBlob = null;
      previewBlob = null;
      renderer.artwork = artwork;
    } else {
      activeArtworkIndex = Math.min(activeArtworkIndex, artworks.length - 1);
      setActiveArtwork(activeArtworkIndex);
    }
    renderer.setArtworks(artworks);
    selected = false;
    renderPdfLayers();
    render();
    commitChange('Remove artwork', before);
  }

  function handleLayerClick(event, index) {
    if (event.ctrlKey || event.metaKey) {
      if (selectedArtworkIndices.has(index)) {
        selectedArtworkIndices.delete(index);
      } else {
        selectedArtworkIndices.add(index);
      }
      [...sublayersContainer.children].forEach((row, ri) => {
        row.classList.toggle('selected', selectedArtworkIndices.has(ri));
      });
      renderControls();
      renderer.render();
      return;
    }
    if (event.shiftKey && activeArtworkIndex >= 0 && activeArtworkIndex !== index) {
      selectedArtworkIndices = new Set(range(activeArtworkIndex, index));
      [...sublayersContainer.children].forEach((row, ri) => {
        row.classList.toggle('selected', selectedArtworkIndices.has(ri));
      });
      renderControls();
      renderer.render();
      return;
    }
    selectArtworkRow(index);
  }

  function selectArtworkRow(index) {
    if (artworks[index]?.locked) {
      selectedArtworkIndices = new Set([index]);
      [...sublayersContainer.children].forEach((row, ri) => {
        row.classList.toggle('selected', selectedArtworkIndices.has(ri));
        row.classList.toggle('active', ri === activeArtworkIndex);
      });
      return;
    }
    setActiveArtwork(index);
    selected = true;
    selectedArtworkIndices = new Set([index]);
    renderer.selectionColor = artworks[index]?.color || null;
    [...sublayersContainer.children].forEach((row, rowIndex) => {
      row.classList.toggle('active', rowIndex === index);
      row.classList.toggle('selected', rowIndex === index);
    });
    documentRef.querySelectorAll('.adobe-layer-row[data-layer-id="artwork"]').forEach((row) => {
      row.classList.toggle('active', artworks[index]?.hasArtwork);
    });
    renderPdfLayers();
    renderControls();
    renderer.render();
    const activeRow = sublayersContainer.children[index];
    if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    scheduleSave();
  }

  function toggleArtworkVisibility(index, visible) {
    const entry = artworks[index];
    if (!entry || entry.visible === visible) return;
    const before = captureEditorState();
    entry.visible = visible;
    commitChange('Toggle artwork visibility', before);
  }

  function toggleArtworkLock(index, locked) {
    const entry = artworks[index];
    if (!entry || entry.locked === locked) return;
    const before = captureEditorState();
    entry.locked = locked;
    if (locked && activeArtworkIndex === index && selectedArtworkIndices.size <= 1) {
      selectedArtworkIndices.clear();
      selected = false;
    }
    commitChange('Toggle artwork lock', before);
  }

  sublayersContainer.addEventListener('pointermove', moveSublayerDrag);
  sublayersContainer.addEventListener('pointerup', endSublayerDrag);
  sublayersContainer.addEventListener('pointercancel', endSublayerDrag);

  function moveSublayerDrag(event) {
    if (!sublayerDrag || event.pointerId !== sublayerDrag.pointerId) return;
    if (!sublayerDrag.started) {
      const dx = event.clientX - sublayerDrag.startX;
      const dy = event.clientY - sublayerDrag.startY;
      if (Math.abs(dx) + Math.abs(dy) < 5) return;
      sublayerDrag.started = true;
      sublayerDrag.row.setPointerCapture(event.pointerId);
      sublayerDrag.row.classList.add('dragging');
      selected = false;
      render();
    }
    const container = sublayersContainer;
    const rows = [...container.children];
    if (rows.length < 2) return;
    const current = sublayerDrag.index;
    let targetIndex = current;
    for (let index = 0; index < rows.length; index += 1) {
      const rectangle = rows[index].getBoundingClientRect();
      if (event.clientY >= rectangle.top && event.clientY < rectangle.top + rectangle.height / 2) {
        targetIndex = index;
        break;
      }
      if (event.clientY >= rectangle.top + rectangle.height / 2 && event.clientY < rectangle.bottom) {
        targetIndex = index;
        break;
      }
      if (index === rows.length - 1 && event.clientY >= rectangle.bottom) {
        targetIndex = rows.length - 1;
      }
    }
    if (targetIndex !== current) {
      const [moved] = artworks.splice(current, 1);
      artworks.splice(targetIndex, 0, moved);
      if (activeArtworkIndex === current) activeArtworkIndex = targetIndex;
      else if (activeArtworkIndex > current && activeArtworkIndex <= targetIndex) activeArtworkIndex -= 1;
      else if (activeArtworkIndex >= targetIndex && activeArtworkIndex < current) activeArtworkIndex += 1;
      selectedArtworkIndices = new Set([targetIndex]);
      sublayerDrag.index = targetIndex;
      sublayerDrag.moved = true;
      renderer.setArtworks(artworks);
      renderSublayers();
      render();
    }
  }

  function endSublayerDrag(event) {
    if (!sublayerDrag || event.pointerId !== sublayerDrag.pointerId) return;
    const drag = sublayerDrag;
    sublayerDrag = null;
    if (!drag.started) return;
    renderSublayers();
    render();
    if (drag.moved) {
      commitChange('Reorder artwork', drag.before);
    }
  }

  function startRenameSublayer(index, nameElement) {
    if (renamingSublayerIndex >= 0) return;
    renamingSublayerIndex = index;
    cancelRename = false;
    const entry = artworks[index];
    const inputElement = documentRef.createElement('input');
    inputElement.className = 'layer-rename-input';
    inputElement.value = entry.model.source?.fileName || '';
    inputElement.setAttribute('aria-label', t('renameArtworkLayer'));
    inputElement.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        inputElement.blur();
      } else if (event.key === 'Escape') {
        cancelRename = true;
        inputElement.blur();
      }
    });
    inputElement.addEventListener('blur', () => {
      if (renamingSublayerIndex !== index) return;
      renamingSublayerIndex = -1;
      const newName = inputElement.value.trim();
      const current = artworks[index];
      if (!cancelRename && current && newName && newName !== current.model.source?.fileName) {
        const before = captureEditorState();
        current.model.source.fileName = newName;
        commitChange('Rename artwork', before);
      } else {
        renderSublayers();
        render();
      }
      cancelRename = false;
    });
    nameElement.replaceChildren(inputElement);
    inputElement.focus();
    inputElement.select();
  }

  function render() {
    renderControls();
    renderPrepressControls();
    renderSublayers();
    syncArtworkVisibility();
    // Keep the crop controls synchronized after history restores a snapshot.
    // Undo/redo replaces the ArtworkModel before rendering, so relying on the
    // transient crop interaction cleanup alone can leave a stale "Crop applied"
    // status or an enabled Clear button when the restored model has no crop.
    updateCropButtons();
    updateCropStatus();
    controls.clearCrop.disabled = !artwork.crop && !cropMode;
    renderer.render();
    renderPrepressOverlay();
  }

  function createSvgElement(name, attributes, innerHtml) {
    const element = documentRef.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    if (innerHtml) element.innerHTML = innerHtml;
    return element;
  }

  function renderPrepressOverlay() {
    if (!svg) return;
    svg.querySelector('#prepressOverlay')?.remove();
    if (!Object.values(prepressOverlays).some(Boolean)) return;
    let production;
    try { production = buildProductionDieline(boxModel, prepress); } catch { return; }
    const group = createSvgElement('g', { id: 'prepressOverlay', 'pointer-events': 'none' });
    const addPaths = (id, polygons, attributes) => {
      if (!prepressOverlays[id] || !polygons?.length) return;
      const layer = createSvgElement('g', attributes);
      for (const polygon of polygons) {
        if (!polygon || polygon.length < 3) continue;
        const d = polygon.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x} ${y}`).join('') + 'Z';
        layer.appendChild(createSvgElement('path', { d }));
      }
      group.appendChild(layer);
    };
    addPaths('trim', production.trimPolygons, { fill: 'none', stroke: '#d00000', 'stroke-width': 0.5 });
    addPaths('bleed', production.bleedPolygons, { fill: 'none', stroke: '#f2a900', 'stroke-width': 0.45, 'stroke-dasharray': '2,1' });
    addPaths('safe', production.safePolygons, { fill: 'none', stroke: '#00a878', 'stroke-width': 0.45, 'stroke-dasharray': '1,1' });
    if (prepressOverlays.dieline) {
      const layer = createSvgElement('g', { fill: 'none', stroke: '#185adb', 'stroke-width': 0.4, 'stroke-dasharray': '2,1' });
      for (const segment of production.fold) layer.appendChild(createSvgElement('line', { x1: segment.start.x, y1: segment.start.y, x2: segment.end.x, y2: segment.end.y }));
      layer.setAttribute('stroke', '#185adb');
      group.appendChild(layer);
      const cuts = createSvgElement('g', { fill: 'none', stroke: '#d00000', 'stroke-width': 0.45 });
      for (const segment of production.cut) cuts.appendChild(createSvgElement('line', { x1: segment.start.x, y1: segment.start.y, x2: segment.end.x, y2: segment.end.y }));
      group.appendChild(cuts);
    }
    if (prepressOverlays.marks) {
      const marks = createSvgElement('g', { fill: 'none', stroke: '#111', 'stroke-width': 0.35 });
      const b = production.mediaBounds; const size = Math.max(2, prepress.slugMm * 0.45); const gap = Math.max(1, prepress.slugMm * 0.12);
      for (const [x1, y1, x2, y2] of [[b.minX, b.minY, b.minX - size, b.minY], [b.maxX, b.minY, b.maxX + size, b.minY], [b.minX, b.maxY, b.minX - size, b.maxY], [b.maxX, b.maxY, b.maxX + size, b.maxY], [b.minX, b.minY, b.minX, b.minY - size], [b.maxX, b.minY, b.maxX, b.minY - size], [b.minX, b.maxY, b.minX, b.maxY + size], [b.maxX, b.maxY, b.maxX, b.maxY + size]]) {
        marks.appendChild(createSvgElement('line', { x1, y1, x2, y2 }));
      }
      marks.setAttribute('transform', `translate(${gap} ${gap})`);
      group.appendChild(marks);
    }
    svg.appendChild(group);
  }

  function createLayerEyeSvg() {
    return createSvgElement('svg', {
      class: 'layer-eye-icon',
      viewBox: '0 0 24 24',
      width: 14,
      height: 14,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
    }, '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>');
  }

  function createLayerThumbSvg() {
    return createSvgElement('svg', {
      viewBox: '0 0 16 16',
      width: 12,
      height: 12,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.2,
    }, '<path d="M8 1l6 3-6 3-6-3 6-3z"/><path d="M2 8l6 3 6-3"/><path d="M2 11l6 3 6-3"/>');
  }

  function renderPdfLayers() {
    const isPdf = artwork.hasArtwork
      && (artwork.source?.vector || artwork.source?.mimeType === 'application/pdf');
    const layers = artwork.source?.pdfLayers || [];
    const hasLayers = isPdf && layers.length > 0;
    controls.pdfLayersSection.hidden = !isPdf;
    renderPageBoxControl(isPdf);
    controls.pdfLayersList.replaceChildren();
    if (!hasLayers) return;
    for (const layer of layers) {
      const row = documentRef.createElement('div');
      row.className = 'adobe-layer-row pdf-layer-row';
      row.dataset.layerId = layer.id;

      const eye = documentRef.createElement('label');
      eye.className = 'layer-toggle-cell eye-cell';
      eye.title = 'Toggle Visibility';
      const checkbox = documentRef.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'sr-only';
      checkbox.checked = artwork.pdfLayerVisibility?.[layer.id] !== false;
      checkbox.addEventListener('change', () => togglePdfLayer(layer.id, checkbox.checked));
      eye.appendChild(checkbox);
      eye.appendChild(createLayerEyeSvg());
      row.appendChild(eye);

      const thumbnail = documentRef.createElement('span');
      thumbnail.className = 'layer-thumbnail';
      thumbnail.appendChild(createLayerThumbSvg());
      row.appendChild(thumbnail);

      const name = documentRef.createElement('span');
      name.className = 'layer-title';
      name.textContent = layer.group ? `${layer.group} / ${layer.name}` : layer.name;
      name.title = layer.name;
      row.appendChild(name);

      controls.pdfLayersList.appendChild(row);
    }
  }

  function renderPageBoxControl(visible) {
    const select = controls.pageBoxSelect;
    if (!select) return;
    if (!visible) {
      select.hidden = true;
      return;
    }
    select.hidden = false;
    const current = artwork.source?.pageBox || DEFAULT_PAGE_BOX;
    select.value = PAGE_BOXES.includes(current) ? current : DEFAULT_PAGE_BOX;
  }

  async function togglePdfLayer(id, visible) {
    const layers = artwork.source?.pdfLayers;
    const entry = getActiveEntry();
    if (!layers || !artwork.hasArtwork || !entry?.originalBlob) return;
    const next = {};
    for (const layer of layers) {
      next[layer.id] = layer.id === id ? visible : artwork.pdfLayerVisibility?.[layer.id] !== false;
    }
    artwork.pdfLayerVisibility = next;
    renderPdfLayers();
    scheduleSave();

    invalidatePreviewResources(entry);
    pdfRenderController?.abort();
    const controller = new AbortController();
    pdfRenderController = controller;
    const generation = ++pdfRenderGeneration;
    try {
      const rendered = await renderPdfWithLayers(entry.originalBlob, {
        pageIndex: artwork.source.pageIndex || 0,
        visibility: next,
        signal: controller.signal,
        overprint: false,
        cacheKey: artwork.source.sha256 || '',
        pageBox: artwork.source.pageBox || DEFAULT_PAGE_BOX,
        passwordKey: artwork.source.sha256 || '',
        session: artwork.source.id || null,
        ...getEntryPdfRenderOptions(entry),
      });
      if (generation !== pdfRenderGeneration || disposed) return;
      entry.previewBlob = rendered.previewBlob;
      previewBlob = entry.previewBlob;
      renderer.setArtworks(artworks);
      render();
      refreshPreviewResources({ force: true });
    } catch (error) {
      if (error?.name === 'AbortError' || generation !== pdfRenderGeneration) return;
      console.error(error);
      showError(error, 'artworkLoadFailed');
    } finally {
      if (generation === pdfRenderGeneration) pdfRenderController = null;
    }
  }

  function commitChange(label, before) {
    history.commit(label, before, captureEditorState());
    recordDiagnostic('editor-change', { command: label });
    render();
    scheduleSave();
  }

  function command(label, callback, { fitViewport = false } = {}) {
    if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked) return;
    const before = captureEditorState();
    try {
      clearError();
      callback();
      commitChange(label, before);
      if (fitViewport) renderer.fitToScreen();
    } catch (error) {
      render();
      showError(error, 'invalidValue');
    }
  }

  async function setOverprintEnabled(next) {
    const enabled = Boolean(next);
    if (isOverprintEnabled() === enabled) return false;
    setOverprintSetting(enabled);

    const pdfEntries = artworks.filter((entry) => (
      entry?.model?.hasArtwork
      && entry.originalBlob
      && (entry.model.source?.vector || entry.model.source?.mimeType === 'application/pdf')
    ));
    if (!pdfEntries.length) {
      renderer.setArtworks(artworks);
      render();
      return true;
    }

    invalidatePreviewResources(pdfEntries);
    pdfRenderController?.abort();
    const controller = new AbortController();
    pdfRenderController = controller;
    const generation = ++pdfRenderGeneration;
    try {
      for (const entry of pdfEntries) {
        const rendered = await renderPdfWithLayers(entry.originalBlob, {
          pageIndex: entry.model.source.pageIndex || 0,
          visibility: entry.model.pdfLayerVisibility,
          signal: controller.signal,
          overprint: false,
          cacheKey: entry.model.source.sha256 || '',
          pageBox: entry.model.source.pageBox || DEFAULT_PAGE_BOX,
          passwordKey: entry.model.source.sha256 || '',
          session: entry.model.source.id || null,
          ...getEntryPdfRenderOptions(entry),
        });
        if (generation !== pdfRenderGeneration || disposed || controller.signal.aborted) return true;
        entry.previewBlob = rendered.previewBlob;
        entry.displayBlob = null;
      }
      previewBlob = artworks.find((entry) => entry.previewBlob)?.previewBlob || previewBlob;
      renderer.setArtworks(artworks);
      render();
      await refreshPreviewResources({ force: true });
      if (pdfEntries.some((entry) => {
        const plateOptions = getEntryPdfRenderOptions(entry);
        return previewResourceSignatures.get(entry.model.source.id)
          !== `${getArtworkRasterSignature(entry, 'preview', { plateOptions })}|${getPreviewResourceDpi().toFixed(2)}`;
      })) {
        await refreshPreviewResources({ force: true });
      }
      Promise.resolve(onArtworkQualityChanged({ kind: 'overprint' })).catch(() => {});
      return true;
    } catch (error) {
      if (error?.name === 'AbortError' || generation !== pdfRenderGeneration) return true;
      // The overprint setting has already been applied; a failing re-render
      // must not flip the toggle back off. The preview stays at whatever
      // quality the renderer managed and retries naturally on the next
      // refresh.
      console.error(error);
      return true;
    } finally {
      if (generation === pdfRenderGeneration) pdfRenderController = null;
    }
  }

  async function choosePdfPage(count) {
    pageNumber.value = '1';
    pageNumber.max = String(count);
    pageCount.textContent = t('pdfPageCount', { count });
    pageDialog.showModal();
    return new Promise((resolve, reject) => {
      pageDialog.addEventListener('close', () => {
        if (pageDialog.returnValue !== 'confirm') {
          reject(new AppError('pdfPageCancelled'));
          return;
        }
        resolve(Number(pageNumber.value) - 1);
      }, { once: true });
    });
  }

  async function promptPdfPassword() {
    passwordInput.value = '';
    passwordDialog.showModal();
    return new Promise((resolve, reject) => {
      passwordDialog.addEventListener('close', () => {
        if (passwordDialog.returnValue !== 'confirm') {
          reject(new AppError('pdfPasswordCancelled'));
          return;
        }
        resolve(passwordInput.value);
      }, { once: true });
    });
  }

  const pdfSeparationsCache = new Map();

  function setupDialogDragging(dialog, handle) {
    if (!dialog || !handle) return;
    let drag = null;

    const clampPosition = () => {
      if (!dialog.open || !dialog.style.left || !dialog.style.top) return;
      const rect = dialog.getBoundingClientRect();
      const margin = 8;
      const maxLeft = Math.max(margin, windowRef.innerWidth - rect.width - margin);
      const maxTop = Math.max(margin, windowRef.innerHeight - rect.height - margin);
      const left = Math.min(maxLeft, Math.max(margin, Number.parseFloat(dialog.style.left)));
      const top = Math.min(maxTop, Math.max(margin, Number.parseFloat(dialog.style.top)));
      if (Number.isFinite(left)) dialog.style.left = `${left}px`;
      if (Number.isFinite(top)) dialog.style.top = `${top}px`;
    };

    const stopDragging = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag = null;
      dialog.classList.remove('is-dragging');
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !dialog.open) return;
      const rect = dialog.getBoundingClientRect();
      dialog.style.right = 'auto';
      dialog.style.bottom = 'auto';
      dialog.style.left = `${rect.left}px`;
      dialog.style.top = `${rect.top}px`;
      dialog.style.margin = '0';
      dialog.style.transform = 'none';
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      dialog.classList.add('is-dragging');
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const rect = dialog.getBoundingClientRect();
      const margin = 8;
      const maxLeft = Math.max(margin, windowRef.innerWidth - rect.width - margin);
      const maxTop = Math.max(margin, windowRef.innerHeight - rect.height - margin);
      const left = Math.min(maxLeft, Math.max(margin, event.clientX - drag.offsetX));
      const top = Math.min(maxTop, Math.max(margin, event.clientY - drag.offsetY));
      dialog.style.left = `${left}px`;
      dialog.style.top = `${top}px`;
    });

    handle.addEventListener('pointerup', stopDragging);
    handle.addEventListener('pointercancel', stopDragging);
    windowRef.addEventListener('resize', clampPosition);
  }

  setupDialogDragging(
    separationsDialog,
    separationsDialog?.querySelector('[data-dialog-drag-handle]'),
  );

  function getEntryPdfRenderOptions(entry) {
    const model = entry?.model || entry;
    const cached = pdfSeparationsCache.get(model?.source?.id);
    return resolvePdfRenderOptions(model, { spotCount: cached?.names?.length });
  }

  function invalidatePreviewResources(entries = artworks) {
    previewResourceController?.abort();
    previewResourceController = null;
    previewResourceGeneration += 1;
    const targets = Array.isArray(entries) ? entries : [entries];
    for (const entry of targets) {
      if (!entry) continue;
      entry.displayBlob = null;
      if (entry.model?.source?.id) previewResourceSignatures.delete(entry.model.source.id);
    }
  }

  function getSeparationVisibility() {
    const visibility = artwork.pdfSeparationVisibility;
    return {
      process: Array.isArray(visibility?.process)
        ? [0, 1, 2, 3].map((index) => visibility.process[index] !== false)
        : [true, true, true, true],
      spots: visibility?.spots && typeof visibility.spots === 'object'
        ? { ...visibility.spots }
        : {},
    };
  }

  function renderSeparationsDialog(data) {
    separationsList.replaceChildren();
    const processNames = ['Cyan', 'Magenta', 'Yellow', 'Black'];
    const coverage = data.coverage || [];
    const visibility = getSeparationVisibility();
    const makeRow = (name, index, toggleable, visible, onChange) => {
      const row = documentRef.createElement('div');
      row.className = 'separation-row';
      const checkbox = documentRef.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = visible !== false;
      checkbox.className = 'separation-toggle';
      checkbox.setAttribute('aria-label', name);
      checkbox.addEventListener('change', () => onChange(checkbox.checked));
      const nameEl = documentRef.createElement('span');
      nameEl.className = 'separation-name';
      nameEl.textContent = name;
      const coverageEl = documentRef.createElement('span');
      coverageEl.className = 'separation-coverage';
      const coverageValue = index < 4 ? data.process?.[index]?.coverage : data.spots?.[index - 4]?.coverage;
      const displayCoverage = coverageValue ?? coverage[index];
      coverageEl.textContent = displayCoverage != null ? `${displayCoverage}%` : '—';
      row.append(checkbox, nameEl, coverageEl);
      return row;
    };
    for (let i = 0; i < 4; i += 1) {
      separationsList.appendChild(makeRow(
        processNames[i],
        i,
        true,
        visibility.process[i],
        (visible) => toggleProcessSeparation(i, visible),
      ));
    }
    for (let i = 0; i < (data.names || []).length; i += 1) {
      separationsList.appendChild(makeRow(
        data.names[i],
        4 + i,
        true,
        visibility.spots[String(i)],
        (visible) => toggleSeparation(i, visible),
      ));
    }
  }

  async function openSeparations() {
    const entry = getActiveEntry();
    if (!entry?.model?.hasArtwork || !entry.originalBlob || !artwork.source?.vector) return;
    if (!separationsDialog || !separationsList) return;
    const sourceId = artwork.source.id;
    let data = pdfSeparationsCache.get(sourceId);
    if (!data) {
      try {
        data = await getPdfSeparations(entry.originalBlob, {
          pageIndex: artwork.source.pageIndex || 0,
          signal: pdfRenderController?.signal,
          overprintMode: 2,
        });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        console.error(error);
        showError(error, 'artworkLoadFailed');
        return;
      }
      pdfSeparationsCache.set(sourceId, data);
    }
    renderSeparationsDialog(data);
    separationsDialog.showModal();
  }

  async function toggleSeparation(index, visible) {
    const entry = getActiveEntry();
    if (!entry?.originalBlob) return;
    const state = getSeparationVisibility();
    const cached = pdfSeparationsCache.get(artwork.source.id);
    for (let spotIndex = 0; spotIndex < (cached?.names?.length || 0); spotIndex += 1) {
      if (!Object.hasOwn(state.spots, String(spotIndex))) state.spots[String(spotIndex)] = true;
    }
    state.spots[String(index)] = visible;
    artwork.pdfSeparationVisibility = state;
    scheduleSave();
    if (cached) renderSeparationsDialog(cached);

    invalidatePreviewResources(entry);
    pdfRenderController?.abort();
    const controller = new AbortController();
    pdfRenderController = controller;
    const generation = ++pdfRenderGeneration;
    try {
      const rendered = await renderPdfWithLayers(entry.originalBlob, {
        pageIndex: artwork.source.pageIndex || 0,
        visibility: artwork.pdfLayerVisibility,
        signal: controller.signal,
        overprint: false,
        cacheKey: artwork.source.sha256 || '',
        pageBox: artwork.source.pageBox || DEFAULT_PAGE_BOX,
        passwordKey: artwork.source.sha256 || '',
        session: artwork.source.id || null,
        ...getEntryPdfRenderOptions(entry),
      });
      if (generation !== pdfRenderGeneration || disposed) return;
      entry.previewBlob = rendered.previewBlob;
      entry.displayBlob = null;
      previewBlob = entry.previewBlob;
      renderer.setArtworks(artworks);
      render();
      await refreshPreviewResources({ force: true });
    } catch (error) {
      if (error?.name === 'AbortError' || generation !== pdfRenderGeneration) return;
      console.error(error);
      showError(error, 'artworkLoadFailed');
    } finally {
      if (generation === pdfRenderGeneration) pdfRenderController = null;
    }
  }

  async function toggleProcessSeparation(index, visible) {
    const entry = getActiveEntry();
    if (!entry?.originalBlob) return;
    const state = getSeparationVisibility();
    state.process[index] = visible;
    artwork.pdfSeparationVisibility = state;
    const cached = pdfSeparationsCache.get(artwork.source.id);
    if (cached) {
      for (let spotIndex = 0; spotIndex < (cached.names?.length || 0); spotIndex += 1) {
        if (!Object.hasOwn(state.spots, String(spotIndex))) state.spots[String(spotIndex)] = true;
      }
      artwork.pdfSeparationVisibility = state;
    }
    scheduleSave();
    if (cached) renderSeparationsDialog(cached);

    invalidatePreviewResources(entry);
    pdfRenderController?.abort();
    const controller = new AbortController();
    pdfRenderController = controller;
    const generation = ++pdfRenderGeneration;
    try {
      const rendered = await renderPdfWithLayers(entry.originalBlob, {
        pageIndex: artwork.source.pageIndex || 0,
        visibility: artwork.pdfLayerVisibility,
        signal: controller.signal,
        overprint: false,
        cacheKey: artwork.source.sha256 || '',
        pageBox: artwork.source.pageBox || DEFAULT_PAGE_BOX,
        passwordKey: artwork.source.sha256 || '',
        session: artwork.source.id || null,
        ...getEntryPdfRenderOptions(entry),
      });
      if (generation !== pdfRenderGeneration || disposed) return;
      entry.previewBlob = rendered.previewBlob;
      entry.displayBlob = null;
      previewBlob = entry.previewBlob;
      renderer.setArtworks(artworks);
      render();
      await refreshPreviewResources({ force: true });
    } catch (error) {
      if (error?.name === 'AbortError' || generation !== pdfRenderGeneration) return;
      console.error(error);
      showError(error, 'artworkLoadFailed');
    } finally {
      if (generation === pdfRenderGeneration) pdfRenderController = null;
    }
  }

  async function processFile(file, { replace = false } = {}) {
    if (!file) return;
    const generation = ++processingGeneration;
    processingController?.abort();
    processingController = new AbortController();
    pdfRenderController?.abort();
    pdfRenderController = null;
    pdfRenderGeneration += 1;
    clearError();
    processing.hidden = false;
    canvasWrap.setAttribute('aria-busy', 'true');
    processingText.textContent = t('processing');
    announce(t('processingStarted'));
    const before = captureEditorState();

    try {
      const loaded = await loadArtworkFile(file, {
        choosePage: choosePdfPage,
        signal: processingController.signal,
        promptPassword: promptPdfPassword,
        overprintMode: getOverprintMode(),
      });
      if (generation !== processingGeneration) return;
      const model = new ArtworkModel();
      model.load(loaded.source, boxModel.getBounds());
      if (replace && activeArtworkIndex >= 0) {
        const entry = artworks[activeArtworkIndex];
        entry.model = model;
        entry.originalBlob = loaded.originalBlob;
        entry.previewBlob = loaded.previewBlob;
        entry.displayBlob = null;
        entry.locked = false;
      } else {
        const existingColors = artworks.map((e) => e.color);
        artworks.unshift({
          model,
          originalBlob: loaded.originalBlob,
          previewBlob: loaded.previewBlob,
          displayBlob: null,
          visible: true,
          locked: false,
          color: assignLayerColor(existingColors),
          outputRole: 'print',
          finish: null,
        });
        activeArtworkIndex = 0;
      }
      setActiveArtwork(activeArtworkIndex);
      // A newly loaded artwork is the active selection. Keep the selection
      // model in sync so Edit -> Remove Artwork and Delete act on it too.
      selectedArtworkIndices = new Set([activeArtworkIndex]);
      renderer.setArtworks(artworks);
      history.clear();
      selected = true;
      renderPdfLayers();
      render();
      windowRef.requestAnimationFrame(() => renderer.fitToScreen());
      await refreshPreviewResources({ force: true });
      commitChange(replace ? 'Replace artwork' : 'Add artwork', before);
      announce(t('processingComplete'));
      windowRef.dispatchEvent(new CustomEvent('artwork-loaded', {
        detail: artwork.toJSON(),
      }));
      recordDiagnostic('artwork-loaded', {
        mimeType: loaded.source.mimeType,
        vector: loaded.source.vector,
        pageCount: loaded.source.pageCount,
      });
    } catch (error) {
      if (
        generation === processingGeneration
        && error.name !== 'AbortError'
        && error.code !== 'pdfPageCancelled'
      ) {
        console.error(error);
        recordDiagnostic('artwork-load-failed', {
          reason: error instanceof AppError ? error.code : 'unknown',
        });
        showError(error, 'artworkLoadFailed', {
          retry: () => input.click(),
        });
      } else if (generation === processingGeneration) {
        announce(t('processingCancelled'));
      }
    } finally {
      if (generation === processingGeneration) {
        processing.hidden = true;
        canvasWrap.setAttribute('aria-busy', 'false');
        processingController = null;
      }
      input.value = '';
    }
  }

  function startArtworkGesture(event, detail) {
    if (cropMode) return;
    if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const imageEl = event.target.closest('.artwork-image');
    const clickedIndex = imageEl ? Number(imageEl.dataset.artworkIndex) : -1;
    if (clickedIndex >= 0 && clickedIndex !== activeArtworkIndex && !artworks[clickedIndex]?.locked) {
      selectArtworkRow(clickedIndex);
    }

    selected = true;
    const point = renderer.clientToModel(event.clientX, event.clientY);
    const anchorPos = artwork.getReferencePosition();
    const visibleCenter = artwork.visibleCenter;
    const startDistFromAnchor = Math.hypot(point.x - anchorPos.x, point.y - anchorPos.y);
    const startDistFromCenter = Math.hypot(point.x - visibleCenter.x, point.y - visibleCenter.y);
    const fixedSideBySide = { n: 's', e: 'w', s: 'n', w: 'e' };
    const fixedCornerByCorner = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };
    const resizeAnchorWorld = detail.side
      ? getVisibleEdgeWorldPoint(artwork, fixedSideBySide[detail.side])
      : detail.corner
        ? getVisibleCornerWorldPoint(artwork, fixedCornerByCorner[detail.corner])
        : null;
    const resizeStartPoint = detail.side
      ? getVisibleEdgeWorldPoint(artwork, detail.side)
      : detail.corner
        ? getVisibleCornerWorldPoint(artwork, detail.corner)
        : null;

    gesture = {
      ...detail,
      pointerId: event.pointerId,
      before: captureEditorState(),
      startPoint: point,
      startCenter: visibleCenter,
      startScaleX: artwork.scaleX,
      startScaleY: artwork.scaleY,
      startDisplayedWidth: artwork.displayedWidthMm,
      startDisplayedHeight: artwork.displayedHeightMm,
      startVisibleWidth: artwork.visibleUnrotatedWidthMm,
      startVisibleHeight: artwork.visibleUnrotatedHeightMm,
      rotation: artwork.rotation,
      anchorPos,
      startDistFromAnchor: Math.max(0.001, startDistFromAnchor),
      startDistFromCenter: Math.max(0.001, startDistFromCenter),
      resizeAnchorWorld,
      resizeStartPoint,
      resizeFixedSide: detail.side ? fixedSideBySide[detail.side] : null,
      resizeFixedCorner: detail.corner ? fixedCornerByCorner[detail.corner] : null,
      activeSnapTargets: {},
    };
    svg.setPointerCapture(event.pointerId);
    render();
  }

  function updateResizeGesture(event, point) {
    const targets = buildSnapTargets(boxModel);
    const threshold = SNAP_SCREEN_PX / viewport.zoom;
    const releaseThreshold = SNAP_RELEASE_SCREEN_PX / viewport.zoom;
    const bypassSnap = event.ctrlKey || event.metaKey;
    const activeTargets = bypassSnap ? {} : (gesture.activeSnapTargets || {});
    const nextActiveTargets = {};
    const guides = [];
    const keepTarget = (key, target) => {
      if (!target) return;
      nextActiveTargets[key] = target;
      guides.push(target);
    };

    if (gesture.corner && !constrainProportions) {
      const anchor = event.altKey ? gesture.startCenter : gesture.resizeAnchorWorld;
      const xDirection = rotateVector({ x: gesture.sx, y: 0 }, artwork.rotation);
      const yDirection = rotateVector({ x: 0, y: gesture.sy }, artwork.rotation);
      const xProjection = (point.x - anchor.x) * xDirection.x + (point.y - anchor.y) * xDirection.y;
      const yProjection = (point.x - anchor.x) * yDirection.x + (point.y - anchor.y) * yDirection.y;
      const xBase = event.altKey ? gesture.startVisibleWidth / 2 : gesture.startVisibleWidth;
      const yBase = event.altKey ? gesture.startVisibleHeight / 2 : gesture.startVisibleHeight;
      const xFactor = Math.min(
        20 / gesture.startScaleX,
        Math.max(0.01 / gesture.startScaleX, Math.abs(xProjection) / Math.max(0.001, xBase)),
      );
      const yFactor = Math.min(
        20 / gesture.startScaleY,
        Math.max(0.01 / gesture.startScaleY, Math.abs(yProjection) / Math.max(0.001, yBase)),
      );

      let nextXFactor = xFactor;
      let nextYFactor = yFactor;
      if (!bypassSnap) {
        const factors = [
          {
            key: 'corner-x',
            factor: xFactor,
            vector: { x: xDirection.x * xBase, y: xDirection.y * xBase },
            minFactor: 0.01 / gesture.startScaleX,
            maxFactor: 20 / gesture.startScaleX,
          },
          {
            key: 'corner-y',
            factor: yFactor,
            vector: { x: yDirection.x * yBase, y: yDirection.y * yBase },
            minFactor: 0.01 / gesture.startScaleY,
            maxFactor: 20 / gesture.startScaleY,
          },
        ];
        for (const item of factors) {
          const axis = Math.abs(item.vector.x) >= Math.abs(item.vector.y) ? 'x' : 'y';
          const resolved = getResizeSnapFactor({
            candidateFactor: item.factor,
            anchor,
            vector: item.vector,
            axis,
            targets,
            threshold,
            releaseThreshold,
            minFactor: item.minFactor,
            maxFactor: item.maxFactor,
            activeTarget: activeTargets[item.key],
            point,
          });
          if (item.key === 'corner-x') nextXFactor = resolved.factor;
          else nextYFactor = resolved.factor;
          keepTarget(item.key, resolved.target);
        }
      }

      artwork.setScaleX(gesture.startScaleX * nextXFactor);
      artwork.setScaleY(gesture.startScaleY * nextYFactor);
      if (event.altKey) {
        artwork.setVisibleCenter(gesture.startCenter.x, gesture.startCenter.y);
      } else {
        const nextAnchor = getVisibleCornerWorldPoint(artwork, gesture.resizeFixedCorner);
        artwork.moveBy(
          anchor.x - nextAnchor.x,
          anchor.y - nextAnchor.y,
        );
      }
      gesture.activeSnapTargets = nextActiveTargets;
      renderer.setSnapGuides(guides);
      return;
    }

    if (gesture.side) {
      const axis = gesture.axis;
      const direction = getResizeSideDirection(gesture.side, artwork.rotation);
      const anchor = event.altKey ? gesture.startCenter : gesture.resizeAnchorWorld;
      const startDimension = axis === 'x' ? gesture.startVisibleWidth : gesture.startVisibleHeight;
      const startScale = axis === 'x' ? gesture.startScaleX : gesture.startScaleY;
      const projection = (point.x - anchor.x) * direction.x + (point.y - anchor.y) * direction.y;
      const baseDimension = event.altKey ? startDimension / 2 : startDimension;
      const rawFactor = Math.abs(projection) / Math.max(0.001, baseDimension);
      const minimumFactor = constrainProportions
        ? Math.max(0.01 / gesture.startScaleX, 0.01 / gesture.startScaleY)
        : 0.01 / startScale;
      const maximumFactor = constrainProportions
        ? Math.min(20 / gesture.startScaleX, 20 / gesture.startScaleY)
        : 20 / startScale;
      const nextFactor = Math.min(maximumFactor, Math.max(minimumFactor, rawFactor));
      let resolvedFactor = nextFactor;
      if (!bypassSnap) {
        const vector = {
          x: direction.x * baseDimension,
          y: direction.y * baseDimension,
        };
        const snapAxis = Math.abs(vector.x) >= Math.abs(vector.y) ? 'x' : 'y';
        const resolved = getResizeSnapFactor({
          candidateFactor: nextFactor,
          anchor,
          vector,
          axis: snapAxis,
          targets,
          threshold,
          releaseThreshold,
          minFactor: minimumFactor,
          maxFactor: maximumFactor,
          activeTarget: activeTargets.side,
          point,
        });
        resolvedFactor = resolved.factor;
        keepTarget('side', resolved.target);
      }
      const nextScale = startScale * resolvedFactor;

      if (axis === 'x') {
        artwork.setScaleX(nextScale);
        if (constrainProportions) artwork.setScaleY(gesture.startScaleY * resolvedFactor);
      } else {
        artwork.setScaleY(nextScale);
        if (constrainProportions) artwork.setScaleX(gesture.startScaleX * resolvedFactor);
      }

      if (event.altKey) {
        artwork.setVisibleCenter(gesture.startCenter.x, gesture.startCenter.y);
      } else {
        const nextAnchor = getVisibleEdgeWorldPoint(artwork, gesture.resizeFixedSide);
        artwork.moveBy(
          anchor.x - nextAnchor.x,
          anchor.y - nextAnchor.y,
        );
      }
      gesture.activeSnapTargets = nextActiveTargets;
      renderer.setSnapGuides(guides);
      return;
    }

    const isAlt = event.altKey;
    const anchor = isAlt ? gesture.startCenter : gesture.anchorPos;
    const currentDist = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    const factor = currentDist / (isAlt ? gesture.startDistFromCenter : gesture.startDistFromAnchor);
    const minimumFactor = Math.max(0.01 / gesture.startScaleX, 0.01 / gesture.startScaleY);
    const maximumFactor = Math.min(20 / gesture.startScaleX, 20 / gesture.startScaleY);
    const nextFactor = Math.min(maximumFactor, Math.max(minimumFactor, factor));

    let snappedFactor = nextFactor;
    if (!bypassSnap) {
      const vector = {
        x: gesture.resizeStartPoint.x - anchor.x,
        y: gesture.resizeStartPoint.y - anchor.y,
      };
      let best = null;
      for (const axis of ['x', 'y']) {
        if (Math.abs(vector[axis]) < 1e-9) continue;
        const resolved = getResizeSnapFactor({
          candidateFactor: nextFactor,
          anchor,
          vector,
          axis,
          targets,
          threshold,
          releaseThreshold,
          minFactor: minimumFactor,
          maxFactor: maximumFactor,
          activeTarget: activeTargets.corner,
          point,
        });
        if (!best || Math.abs(resolved.factor - nextFactor) < Math.abs(best.factor - nextFactor)) {
          best = resolved;
        }
      }
      if (best) {
        snappedFactor = best.factor;
        keepTarget('corner', best.target);
      }
    }
    artwork.setScaleX(gesture.startScaleX * snappedFactor);
    artwork.setScaleY(gesture.startScaleY * snappedFactor);
    if (isAlt) {
      artwork.setVisibleCenter(gesture.startCenter.x, gesture.startCenter.y);
    }
    gesture.activeSnapTargets = nextActiveTargets;
    renderer.setSnapGuides(guides);
  }

  svg.addEventListener('pointermove', (event) => {
    if (cropGesture) { moveCropGesture(event); return; }
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = renderer.clientToModel(event.clientX, event.clientY);
    if (gesture.type === 'move') {
      const candidate = {
        x: gesture.startCenter.x + point.x - gesture.startPoint.x,
        y: gesture.startCenter.y + point.y - gesture.startPoint.y,
      };
      let snapped = candidate;
      if (!event.altKey) {
        const offset = getSnapOffset(
          candidate,
          {
            x: artwork.displayedWidthMm / 2,
            y: artwork.displayedHeightMm / 2,
          },
          buildSnapTargets(boxModel),
          SNAP_SCREEN_PX / viewport.zoom,
        );
        snapped = {
          x: candidate.x + offset.dx,
          y: candidate.y + offset.dy,
        };
      }
      artwork.setVisibleCenter(snapped.x, snapped.y);
    } else if (gesture.type === 'resize') {
      updateResizeGesture(event, point);
    } else if (gesture.type === 'pan') {
      viewport.panBy(event.clientX - gesture.lastClientX, event.clientY - gesture.lastClientY);
      gesture.lastClientX = event.clientX;
      gesture.lastClientY = event.clientY;
    }
    render();
  });

  function releasePointerCapture(pointerId) {
    try {
      if (pointerId != null && svg.hasPointerCapture?.(pointerId)) {
        svg.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
  }

  function finishGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const pointerId = gesture.pointerId;
    if (gesture.type === 'move' || gesture.type === 'resize') {
      commitChange(gesture.type === 'move' ? 'Move artwork' : 'Resize artwork', gesture.before);
    } else if (gesture.type === 'pan') {
      scheduleSave();
    }
    gesture = null;
    renderer.setSnapGuides([]);
    svg.classList.remove('canvas-panning');
    releasePointerCapture(pointerId);
  }
  function finishCropGesture(event) {
    if (!cropGesture || event.pointerId !== cropGesture.pointerId) return;
    const pointerId = cropGesture.pointerId;
    if (cropDrawStart) {
      if (cropPreview && cropPreview.width >= 1 && cropPreview.height >= 1) {
        renderer.drawRect = null;
        renderer.cropFrame = cropPreview;
        updateCropStatus();
      } else {
        cropPreview = null;
        renderer.drawRect = null;
        renderer.cropFrame = null;
        updateCropStatus();
      }
      cropDrawStart = null;
    }
    cropGesture = null;
    renderer.setSnapGuides([]);
    releasePointerCapture(pointerId);
    render();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function startDrawCrop(event) {
    event.preventDefault();
    event.stopPropagation();
    const point = renderer.clientToModel(event.clientX, event.clientY);
    const unrotated = rotateVector(
      { x: point.x - artwork.centerXmm, y: point.y - artwork.centerYmm },
      -artwork.rotation,
    );
    const localX = clamp(unrotated.x + artwork.unrotatedWidthMm / 2, 0, artwork.unrotatedWidthMm);
    const localY = clamp(unrotated.y + artwork.unrotatedHeightMm / 2, 0, artwork.unrotatedHeightMm);
    cropDrawStart = { localX, localY };
    cropPreview = { x: localX, y: localY, width: 0, height: 0 };
    cropGesture = { pointerId: event.pointerId, type: 'draw' };
    renderer.drawRect = cropPreview;
    renderer.cropFrame = null;
    updateCropStatus();
    svg.setPointerCapture(event.pointerId);
    selected = false;
  }

  function startCropGesture(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = renderer.clientToModel(event.clientX, event.clientY);
    const unrotated = rotateVector(
      { x: point.x - artwork.centerXmm, y: point.y - artwork.centerYmm },
      -artwork.rotation,
    );
    const localX = clamp(unrotated.x + artwork.unrotatedWidthMm / 2, 0, artwork.unrotatedWidthMm);
    const localY = clamp(unrotated.y + artwork.unrotatedHeightMm / 2, 0, artwork.unrotatedHeightMm);
    cropGesture = {
      pointerId: event.pointerId,
      type: 'move',
      startX: event.clientX,
      startY: event.clientY,
      startCrop: { ...cropPreview },
      initialLocalX: localX,
      initialLocalY: localY,
      activeSnapTargets: {},
    };
    const cornerEl = event.target.closest('[data-crop-corner]');
    if (cornerEl) {
      cropGesture.type = 'resize';
      cropGesture.corner = Number(cornerEl.dataset.cropCorner);
      switch (cropGesture.corner) {
        case 0: cropGesture.anchorX = cropPreview.x + cropPreview.width; cropGesture.anchorY = cropPreview.y + cropPreview.height; break;
        case 1: cropGesture.anchorX = cropPreview.x; cropGesture.anchorY = cropPreview.y + cropPreview.height; break;
        case 2: cropGesture.anchorX = cropPreview.x; cropGesture.anchorY = cropPreview.y; break;
        case 3: cropGesture.anchorX = cropPreview.x + cropPreview.width; cropGesture.anchorY = cropPreview.y; break;
      }
    } else {
      const edgeEl = event.target.closest('.crop-side-handle');
      if (edgeEl) {
        cropGesture.type = 'resize';
        cropGesture.edge = edgeEl.dataset.cropEdge;
        switch (cropGesture.edge) {
          case 'n': cropGesture.anchorY = cropPreview.y + cropPreview.height; break;
          case 'e': cropGesture.anchorX = cropPreview.x; break;
          case 's': cropGesture.anchorY = cropPreview.y; break;
          case 'w': cropGesture.anchorX = cropPreview.x + cropPreview.width; break;
        }
      }
    }
    svg.setPointerCapture(event.pointerId);
    selected = false;
  }

  function moveCropGesture(event) {
    if (!cropGesture || event.pointerId !== cropGesture.pointerId || !cropPreview) return;
    const point = renderer.clientToModel(event.clientX, event.clientY);
    const unrotated = rotateVector(
      { x: point.x - artwork.centerXmm, y: point.y - artwork.centerYmm },
      -artwork.rotation,
    );
    const localX = clamp(unrotated.x + artwork.unrotatedWidthMm / 2, 0, artwork.unrotatedWidthMm);
    const localY = clamp(unrotated.y + artwork.unrotatedHeightMm / 2, 0, artwork.unrotatedHeightMm);
    const maxW = artwork.unrotatedWidthMm;
    const maxH = artwork.unrotatedHeightMm;
    if (cropGesture.type === 'draw' && cropDrawStart) {
      const minX = Math.min(cropDrawStart.localX, localX);
      const minY = Math.min(cropDrawStart.localY, localY);
      const maxX = Math.max(cropDrawStart.localX, localX);
      const maxY = Math.max(cropDrawStart.localY, localY);
      cropPreview.x = minX;
      cropPreview.y = minY;
      cropPreview.width = Math.max(1, maxX - minX);
      cropPreview.height = Math.max(1, maxY - minY);
      renderer.drawRect = cropPreview;
      renderer.render();
      return;
    }
    if (cropGesture.type === 'move') {
      const dx = localX - cropGesture.initialLocalX;
      const dy = localY - cropGesture.initialLocalY;
      let newX = cropGesture.startCrop.x + dx;
      let newY = cropGesture.startCrop.y + dy;
      newX = Math.max(0, Math.min(maxW - cropPreview.width, newX));
      newY = Math.max(0, Math.min(maxH - cropPreview.height, newY));
      cropPreview.x = newX;
      cropPreview.y = newY;
    } else if (cropGesture.edge) {
      const minDim = 1;
      switch (cropGesture.edge) {
        case 'n': {
          const newY = clamp(localY, 0, cropGesture.anchorY - minDim);
          cropPreview.y = newY;
          cropPreview.height = cropGesture.anchorY - newY;
          break;
        }
        case 'e': {
          const newRight = clamp(localX, cropGesture.anchorX + minDim, maxW);
          cropPreview.x = cropGesture.anchorX;
          cropPreview.width = newRight - cropGesture.anchorX;
          break;
        }
        case 's': {
          const newBottom = clamp(localY, cropGesture.anchorY + minDim, maxH);
          cropPreview.y = cropGesture.anchorY;
          cropPreview.height = newBottom - cropGesture.anchorY;
          break;
        }
        case 'w': {
          const newX = clamp(localX, 0, cropGesture.anchorX - minDim);
          cropPreview.x = newX;
          cropPreview.width = cropGesture.anchorX - newX;
          break;
        }
        default:
          break;
      }
    } else {
      const { anchorX, anchorY } = cropGesture;
      const minDim = 1;
      const minX = Math.min(anchorX, localX);
      const minY = Math.min(anchorY, localY);
      const maxDimX = Math.max(anchorX, localX);
      const maxDimY = Math.max(anchorY, localY);
      const newX = Math.max(0, minX);
      const newY = Math.max(0, minY);
      const newW = Math.max(minDim, Math.min(maxW - newX, maxDimX - newX));
      const newH = Math.max(minDim, Math.min(maxH - newY, maxDimY - newY));
      cropPreview.x = newX;
      cropPreview.y = newY;
      cropPreview.width = newW;
      cropPreview.height = newH;
    }

    if (cropGesture.type === 'resize') {
      const bypassSnap = event.ctrlKey || event.metaKey;
      const targets = buildSnapTargets(boxModel);
      const threshold = SNAP_SCREEN_PX / viewport.zoom;
      const releaseThreshold = SNAP_RELEASE_SCREEN_PX / viewport.zoom;
      const activeTargets = bypassSnap ? {} : (cropGesture.activeSnapTargets || {});
      const nextActiveTargets = {};
      const guides = [];
      const keepTarget = (key, target) => {
        if (!target) return;
        nextActiveTargets[key] = target;
        guides.push(target);
      };
      const startCrop = cropGesture.startCrop;
      const anchorLocal = {
        x: cropGesture.anchorX ?? (startCrop.x + startCrop.width / 2),
        y: cropGesture.anchorY ?? (startCrop.y + startCrop.height / 2),
      };
      const applyLocalAxisSnap = (key, localAxis, sign, startDimension, currentCoordinate, maxCoordinate) => {
        if (!Number.isFinite(anchorLocal[localAxis]) || startDimension <= 0) return currentCoordinate;
        const candidateFactor = Math.abs(currentCoordinate - anchorLocal[localAxis]) / startDimension;
        const vectorLocal = localAxis === 'x'
          ? { x: sign * startDimension, y: 0 }
          : { x: 0, y: sign * startDimension };
        const vector = rotateVector(vectorLocal, artwork.rotation);
        const axis = Math.abs(vector.x) >= Math.abs(vector.y) ? 'x' : 'y';
        const minFactor = 1 / startDimension;
        const maxFactor = Math.max(minFactor, Math.abs(maxCoordinate - anchorLocal[localAxis]) / startDimension);
        const resolved = getResizeSnapFactor({
          candidateFactor,
          anchor: getCropLocalWorldPoint(artwork, anchorLocal.x, anchorLocal.y),
          vector,
          axis,
          targets,
          threshold,
          releaseThreshold,
          minFactor,
          maxFactor,
          activeTarget: activeTargets[key],
          point,
        });
        keepTarget(key, resolved.target);
        return anchorLocal[localAxis] + sign * startDimension * resolved.factor;
      };

      if (cropGesture.corner != null) {
        const cornerSigns = [
          { x: -1, y: -1 },
          { x: 1, y: -1 },
          { x: 1, y: 1 },
          { x: -1, y: 1 },
        ][cropGesture.corner];
        const currentX = cornerSigns.x > 0 ? cropPreview.x + cropPreview.width : cropPreview.x;
        const currentY = cornerSigns.y > 0 ? cropPreview.y + cropPreview.height : cropPreview.y;
        let snappedX = currentX;
        let snappedY = currentY;
        if (!bypassSnap) {
          snappedX = applyLocalAxisSnap(
            'crop-x',
            'x',
            cornerSigns.x,
            startCrop.width,
            currentX,
            cornerSigns.x > 0 ? maxW : 0,
          );
          snappedY = applyLocalAxisSnap(
            'crop-y',
            'y',
            cornerSigns.y,
            startCrop.height,
            currentY,
            cornerSigns.y > 0 ? maxH : 0,
          );
        }
        if (cornerSigns.x > 0) cropPreview.width = Math.max(1, snappedX - cropPreview.x);
        else {
          cropPreview.x = snappedX;
          cropPreview.width = Math.max(1, cropGesture.anchorX - snappedX);
        }
        if (cornerSigns.y > 0) cropPreview.height = Math.max(1, snappedY - cropPreview.y);
        else {
          cropPreview.y = snappedY;
          cropPreview.height = Math.max(1, cropGesture.anchorY - snappedY);
        }
      } else if (cropGesture.edge) {
        const edge = cropGesture.edge;
        const localAxis = edge === 'e' || edge === 'w' ? 'x' : 'y';
        const sign = edge === 'e' || edge === 's' ? 1 : -1;
        const startDimension = localAxis === 'x' ? startCrop.width : startCrop.height;
        const currentCoordinate = localAxis === 'x'
          ? (sign > 0 ? cropPreview.x + cropPreview.width : cropPreview.x)
          : (sign > 0 ? cropPreview.y + cropPreview.height : cropPreview.y);
        const maxCoordinate = localAxis === 'x'
          ? (sign > 0 ? maxW : 0)
          : (sign > 0 ? maxH : 0);
        const snapped = bypassSnap
          ? currentCoordinate
          : applyLocalAxisSnap('crop-edge', localAxis, sign, startDimension, currentCoordinate, maxCoordinate);
        if (localAxis === 'x') {
          if (sign > 0) cropPreview.width = Math.max(1, snapped - cropPreview.x);
          else {
            cropPreview.x = snapped;
            cropPreview.width = Math.max(1, cropGesture.anchorX - snapped);
          }
        } else if (sign > 0) cropPreview.height = Math.max(1, snapped - cropPreview.y);
        else {
          cropPreview.y = snapped;
          cropPreview.height = Math.max(1, cropGesture.anchorY - snapped);
        }
      }
      cropGesture.activeSnapTargets = nextActiveTargets;
      renderer.setSnapGuides(guides);
    } else {
      renderer.setSnapGuides([]);
    }
    renderer.cropFrame = cropPreview;
    renderer.render();
  }

  svg.addEventListener('pointerup', (event) => {
    if (cropGesture) { finishCropGesture(event); return; }
    finishGesture(event);
  });
  svg.addEventListener('pointercancel', (event) => {
    if (cropGesture) { finishCropGesture(event); return; }
    finishGesture(event);
  });
  // Pointer capture normally routes these events back to the SVG, but a
  // browser can cancel capture when the pointer leaves the document or the
  // target is rebuilt during a render. Keep a document-level fallback so a
  // crop gesture can never remain stuck in its transient drawing state.
  documentRef.addEventListener('pointerup', (event) => {
    if (cropGesture) finishCropGesture(event);
    else if (gesture) finishGesture(event);
  });
  documentRef.addEventListener('pointercancel', (event) => {
    if (cropGesture) finishCropGesture(event);
    else if (gesture) finishGesture(event);
  });
  svg.addEventListener('pointerdown', (event) => {
    if (event.button === 2) {
      if (event.target !== svg || gesture || cropGesture) return;
      event.preventDefault();
      gesture = {
        type: 'pan',
        pointerId: event.pointerId,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
      svg.classList.add('canvas-panning');
      svg.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (cropMode === 'draw' && event.target.closest('.artwork-image')) {
      startDrawCrop(event);
      return;
    }
    if (cropMode && (event.target.closest('.crop-handle') || event.target.closest('.crop-frame'))) {
      startCropGesture(event);
      return;
    }
    if (event.target.closest('.artwork-image, .resize-handle')) return;
    if (event.button === 1 || (event.button === 0 && spacePressed)) {
      event.preventDefault();
      gesture = {
        type: 'pan',
        pointerId: event.pointerId,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
      svg.setPointerCapture(event.pointerId);
    } else if (event.button === 0) {
      selected = false;
      render();
    }
  });

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rectangle = svg.getBoundingClientRect();
    if (event.ctrlKey && artwork.hasArtwork && !getActiveEntry()?.locked) {
      if (!wheelBefore) wheelBefore = captureEditorState();
      artwork.setScaleX(artwork.scaleX * Math.exp(-event.deltaY * 0.001));
      artwork.setScaleY(artwork.scaleY * Math.exp(-event.deltaY * 0.001));
      render();
      windowRef.clearTimeout(wheelTimer);
      wheelTimer = windowRef.setTimeout(() => {
        commitChange('Scale artwork', wheelBefore);
        wheelBefore = null;
      }, 220);
    } else {
      viewport.zoomAt(
        event.clientX - rectangle.left,
        event.clientY - rectangle.top,
        Math.exp(-event.deltaY * 0.001),
      );
      renderer.render();
      scheduleSave();
    }
  }, { passive: false });

  function bindNumberControl(control, label, apply) {
    control.addEventListener('change', () => command(label, () => apply(Number(control.value))));
  }
  function bindSliderControl(control, label, apply) {
    let before = null;
    const updateProgress = () => {
      const pct = ((control.value - control.min) / (control.max - control.min)) * 100;
      control.style.setProperty('--slider-progress', `${pct}%`);
    };
    control.addEventListener('input', () => {
      if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked) return;
      if (!before) before = captureEditorState();
      updateProgress();
      apply(Number(control.value));
      render();
    });
    control.addEventListener('change', () => {
      if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked) return;
      updateProgress();
      apply(Number(control.value));
      render();
      if (before) {
        commitChange(label, before);
      } else {
        command(label, () => {});
      }
      before = null;
    });
  }
  bindNumberControl(controls.x, 'Set artwork X', (value) => artwork.setReferencePosition(value, artwork.getReferencePosition().y));
  bindNumberControl(controls.y, 'Set artwork Y', (value) => artwork.setReferencePosition(artwork.getReferencePosition().x, value));
  bindNumberControl(controls.width, 'Set artwork width', (value) => {
    if (constrainProportions) {
      const factor = value / artwork.displayedWidthMm;
      artwork.setScaleX(artwork.scaleX * factor);
      artwork.setScaleY(artwork.scaleY * factor);
    } else {
      artwork.setDisplayedWidth(value);
    }
  });

  svg.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  bindNumberControl(controls.height, 'Set artwork height', (value) => {
    if (constrainProportions) {
      const factor = value / artwork.displayedHeightMm;
      artwork.setScaleX(artwork.scaleX * factor);
      artwork.setScaleY(artwork.scaleY * factor);
    } else {
      artwork.setDisplayedHeight(value);
    }
  });
  bindNumberControl(controls.scaleX, 'Set artwork scale X', (value) => {
    artwork.setScaleX(value / 100);
    if (constrainProportions) artwork.setScaleY(artwork.scaleX);
  });
  bindNumberControl(controls.scaleY, 'Set artwork scale Y', (value) => {
    artwork.setScaleY(value / 100);
    if (constrainProportions) artwork.setScaleX(artwork.scaleY);
  });
  bindSliderControl(controls.opacity, 'Set artwork opacity', (value) => artwork.setOpacity(value / 100));
  bindSliderControl(controls.bgOpacity, 'Set background opacity', (value) => artwork.setBgOpacity(value / 100));

  async function setArtworkQuality(kind, value, index = activeArtworkIndex) {
    const entry = artworks[index];
    if (!entry?.model?.hasArtwork || !['preview', 'render'].includes(kind)) return false;
    const before = captureEditorState();
    if (kind === 'preview') entry.model.setPreviewQuality(value);
    else entry.model.setRenderQuality(value);
    commitChange(`Set artwork ${kind} quality`, before);
    if (kind === 'preview') {
      await refreshPreviewResources({ force: true });
    }
    await onArtworkQualityChanged({ kind, index, value: entry.model.quality[kind] });
    return true;
  }

  function updateArtworkFinish(index, patch = {}) {
    const entry = artworks[index];
    if (!entry?.model?.hasArtwork || entry.locked) return false;
    const before = captureEditorState();
    const next = finishState(entry);
    next.outputRole = patch.outputRole || next.outputRole;
    next.finish = { ...next.finish, ...patch };
    if (next.outputRole === 'print') next.finish = null;
    const sanitized = sanitizeArtworkFinish(next);
    entry.outputRole = sanitized.outputRole;
    entry.finish = sanitized.finish;
    commitChange('Update artwork finish', before);
    Promise.resolve(onArtworkQualityChanged({
      kind: 'finish',
      index,
      outputRole: entry.outputRole,
      finish: entry.finish,
    })).catch(() => {});
    return true;
  }

  controls.previewQuality?.addEventListener('change', (event) => {
    setArtworkQuality('preview', event.target.value);
  });
  controls.renderQuality?.addEventListener('change', (event) => {
    setArtworkQuality('render', event.target.value);
  });

  function updateFinishConfig(label, updater) {
    const entry = getActiveEntry();
    if (!entry?.model?.hasArtwork || layerLocks.artwork || entry.locked) return;
    const before = captureEditorState();
    const next = finishState(entry);
    updater(next);
    entry.outputRole = next.outputRole;
    entry.finish = next.outputRole === 'print' ? null : next.finish;
    commitChange(label, before);
    Promise.resolve(onArtworkQualityChanged({
      kind: 'finish',
      index: activeArtworkIndex,
      outputRole: entry.outputRole,
      finish: entry.finish,
    })).catch(() => {});
  }

  controls.finishRole?.addEventListener('change', (event) => {
    updateFinishConfig('Set artwork output role', (next) => {
      next.outputRole = event.target.value;
      if (next.outputRole !== 'print' && !next.finish) next.finish = sanitizeArtworkFinish({}).finish;
    });
  });
  controls.finishType?.addEventListener('change', (event) => {
    updateFinishConfig('Set artwork finish type', (next) => {
      next.finish = { ...next.finish, type: event.target.value };
    });
  });
  controls.finishMaskChannel?.addEventListener('change', (event) => {
    updateFinishConfig('Set artwork finish mask channel', (next) => {
      next.finish = { ...next.finish, maskChannel: event.target.value };
    });
  });
  controls.finishInvert?.addEventListener('change', (event) => {
    updateFinishConfig('Invert artwork finish mask', (next) => {
      next.finish = { ...next.finish, invert: event.target.checked };
    });
  });
  function bindFinishSlider(control, label, key, scale = 100) {
    control?.addEventListener('change', (event) => {
      const value = Number(event.target.value) / scale;
      updateFinishConfig(label, (next) => {
        next.finish = { ...next.finish, [key]: value };
      });
    });
  }
  bindFinishSlider(controls.finishIntensity, 'Set finish intensity', 'intensity');
  bindFinishSlider(controls.finishRoughness, 'Set finish roughness', 'foilRoughness');
  bindFinishSlider(controls.finishRelief, 'Set relief strength', 'reliefStrength');
  controls.finishColor?.addEventListener('change', (event) => {
    updateFinishConfig('Set foil color', (next) => {
      next.finish = { ...next.finish, foilColor: event.target.value };
    });
  });

  let lastNonZeroArtworkOpacity = 1.0;
  const opacityLabel = controls.opacity?.closest('.opacity-row');
  if (opacityLabel) {
    const bTag = opacityLabel.querySelector('b');
    if (bTag) {
      bTag.style.cursor = 'pointer';
      bTag.addEventListener('click', () => {
        if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked) return;
        if (artwork.opacity > 0) {
          lastNonZeroArtworkOpacity = artwork.opacity;
          artwork.setOpacity(0);
        } else {
          artwork.setOpacity(lastNonZeroArtworkOpacity || 1.0);
        }
        render();
        scheduleSave();
      });
    }
  }

  let lastNonZeroBleed = 0.28;
  const bgOpacityLabel = controls.bgOpacity?.closest('.opacity-row');
  if (bgOpacityLabel) {
    const bTag = bgOpacityLabel.querySelector('b');
    if (bTag) {
      bTag.style.cursor = 'pointer';
      bTag.addEventListener('click', () => {
        if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked) return;
        if (artwork.bgOpacity > 0) {
          lastNonZeroBleed = artwork.bgOpacity;
          artwork.setBgOpacity(0);
        } else {
          artwork.setBgOpacity(lastNonZeroBleed || 0.28);
        }
        render();
        scheduleSave();
      });
    }
  }

  controls.referencePointGrid.addEventListener('click', (event) => {
    const button = event.target.closest('.reference-point-button');
    if (!button || button.disabled) return;
    if (artwork.referencePoint === button.dataset.point) return;
    artwork.setReferencePoint(button.dataset.point);
    render();
    scheduleSave();
  });

  controls.fit.addEventListener('click', () => command('Fit artwork', () => artwork.fitDieline(boxModel.getBounds())));
  controls.fill.addEventListener('click', () => command('Fill artwork', () => artwork.fillDieline(boxModel.getBounds())));
  controls.center.addEventListener('click', () => command('Center artwork', () => artwork.centerOnDieline(boxModel.getBounds())));
  controls.rotateLeft.addEventListener('click', () => command('Rotate artwork', () => artwork.rotateQuarterTurns(-1), { fitViewport: true }));
  controls.rotateRight.addEventListener('click', () => command('Rotate artwork', () => artwork.rotateQuarterTurns(1), { fitViewport: true }));
  controls.flipHorizontal.addEventListener('click', () => command('Flip artwork horizontally', () => artwork.flipHorizontal()));
  controls.flipVertical.addEventListener('click', () => command('Flip artwork vertically', () => artwork.flipVertical()));
  controls.reset.addEventListener('click', () => command('Reset artwork', () => {
    artwork.resetTransform();
    artwork.centerOnDieline(boxModel.getBounds());
    artwork.modified = false;
  }));

  for (const [key, control] of Object.entries(layerControls)) {
    control.addEventListener('change', () => {
      const before = captureEditorState();
      layers[key] = control.checked;
      commitChange(`Toggle ${key}`, before);
    });
  }
  for (const [key, control] of Object.entries(layerLockControls)) {
    control.addEventListener('change', () => {
      const before = captureEditorState();
      layerLocks[key] = control.checked;
      commitChange(`Lock ${key}`, before);
    });
  }

  controls.undo.addEventListener('click', () => {
    if (history.undo()) {
      render();
      scheduleSave();
    }
  });
  controls.redo.addEventListener('click', () => {
    if (history.redo()) {
      render();
      scheduleSave();
    }
  });

  function isValidCrop(value) {
    return Boolean(
      value
      && Number.isFinite(Number(value.x))
      && Number.isFinite(Number(value.y))
      && Number.isFinite(Number(value.width))
      && Number.isFinite(Number(value.height))
      && Number(value.width) >= 1
      && Number(value.height) >= 1,
    );
  }

  function resetCropInteraction({ updateUi = true } = {}) {
    const pointerId = cropGesture?.pointerId;
    cropMode = null;
    cropPreview = null;
    cropGesture = null;
    cropDrawStart = null;
    cropBeforeState = null;
    renderer.cropFrame = null;
    renderer.drawRect = null;
    renderer.setSnapGuides([]);
    svg.style.cursor = '';
    releasePointerCapture(pointerId);
    if (updateUi) {
      updateCropButtons();
      updateCropStatus();
      controls.clearCrop.disabled = !artwork.crop;
    }
  }

  function updateCropButtons() {
    const isFrame = cropMode === 'frame';
    const isDraw = cropMode === 'draw';
    controls.cropFrameBtn.classList.toggle('active', isFrame);
    controls.cropDrawBtn.classList.toggle('active', isDraw);
    controls.cropFrameBtn.setAttribute('aria-pressed', String(isFrame));
    controls.cropDrawBtn.setAttribute('aria-pressed', String(isDraw));
    const frameLabel = isFrame ? t('applyCropTitle') : t('cropFrameTitle');
    const drawLabel = isDraw ? t('applyCropTitle') : t('cropDrawTitle');
    controls.cropFrameBtn.querySelector('span').textContent = isFrame ? t('applyCrop') : t('cropFrame');
    controls.cropDrawBtn.querySelector('span').textContent = isDraw ? t('applyCrop') : t('cropDraw');
    controls.cropFrameBtn.title = frameLabel;
    controls.cropFrameBtn.setAttribute('aria-label', frameLabel);
    controls.cropDrawBtn.title = drawLabel;
    controls.cropDrawBtn.setAttribute('aria-label', drawLabel);
  }

  function updateCropStatus(idleKey = null) {
    let key = idleKey;
    if (!key) {
      if (cropMode === 'frame') key = 'cropFramePrompt';
      else if (cropMode === 'draw') key = cropDrawStart ? 'cropDrawDrawing' : 'cropDrawPrompt';
      else key = artwork.crop ? 'cropApplied' : 'cropIdle';
    }
    controls.cropStatus.textContent = t(key);
  }

  function enterCropFrame() {
    cropMode = 'frame';
    cropBeforeState = captureEditorState();
    cropGesture = null;
    cropDrawStart = null;
    const existingCrop = artwork.crop;
    cropPreview = existingCrop
      ? { ...existingCrop }
      : { x: 0, y: 0, width: artwork.unrotatedWidthMm, height: artwork.unrotatedHeightMm };
    renderer.cropFrame = cropPreview;
    renderer.drawRect = null;
    selected = false;
    updateCropButtons();
    updateCropStatus();
    controls.clearCrop.disabled = false;
    render();
  }

  function enterCropDraw() {
    cropMode = 'draw';
    cropBeforeState = captureEditorState();
    cropGesture = null;
    cropDrawStart = null;
    cropPreview = null;
    renderer.cropFrame = null;
    renderer.drawRect = null;
    selected = false;
    updateCropButtons();
    updateCropStatus();
    controls.clearCrop.disabled = false;
    svg.style.cursor = 'crosshair';
    render();
  }

  function exitCropMode(commit) {
    if (!cropMode) return false;
    if (!commit || !isValidCrop(cropPreview)) {
      resetCropInteraction();
      render();
      return false;
    }

    const before = cropBeforeState || captureEditorState();
    const nextCrop = {
      x: Number(cropPreview.x),
      y: Number(cropPreview.y),
      width: Number(cropPreview.width),
      height: Number(cropPreview.height),
    };
    const previousArtwork = before.artworks?.[activeArtworkIndex]?.artwork || null;
    artwork.applyCrop(nextCrop);
    const changed = JSON.stringify(previousArtwork) !== JSON.stringify(artwork.toJSON());
    selected = true;
    resetCropInteraction();
    if (changed) {
      commitChange('Crop artwork', before);
    } else {
      render();
    }
    return changed;
  }

  function clearCrop() {
    if (!artwork.crop && !cropMode) return;
    const before = captureEditorState();
    const hadCrop = Boolean(artwork.crop);
    artwork.clearCrop();
    selected = true;
    resetCropInteraction();
    if (hadCrop) {
      commitChange('Clear crop', before);
    } else {
      render();
    }
  }

  controls.cropFrameBtn.addEventListener('click', () => {
    if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked) return;
    if (cropMode === 'frame') { exitCropMode(true); return; }
    if (cropMode === 'draw') exitCropMode(true);
    enterCropFrame();
  });
  controls.cropDrawBtn.addEventListener('click', () => {
    if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked) return;
    if (cropMode === 'draw') { exitCropMode(true); return; }
    if (cropMode === 'frame') exitCropMode(true);
    enterCropDraw();
  });
  controls.clearCrop.addEventListener('click', clearCrop);
  controls.constrainBtn.addEventListener('click', () => {
    constrainProportions = !constrainProportions;
    controls.constrainBtn.setAttribute('aria-pressed', String(constrainProportions));
    controls.constrainBtn.textContent = constrainProportions ? '🔗' : '⛓️‍💥';
    renderControls();
  });

  function readBoxDimensions() {
    return {
      width: Number(controls.boxWidth.value),
      height: Number(controls.boxHeight.value),
      depth: Number(controls.boxDepth.value),
    };
  }

  function applyBoxDimensionChange(nextDims) {
    try {
      boxModel.updateDimensions(nextDims);
      renderer.render();
      scheduleSave();
    } catch (err) {
      showToast(err.message);
      renderControls();
      render();
    }
  }

  controls.boxConstrainBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    boxConstrainProportions = !boxConstrainProportions;
    controls.boxConstrainBtn.setAttribute('aria-pressed', String(boxConstrainProportions));
    controls.boxConstrainBtn.textContent = boxConstrainProportions ? '🔗' : '⛓️‍💥';
  });

  function handleBoxDimChange(changedKey) {
    const current = readBoxDimensions();
    if (!Number.isFinite(current.width) || !Number.isFinite(current.height) || !Number.isFinite(current.depth)) return;

    if (boxConstrainProportions) {
      const modelDims = boxModel.dimensions;
      if (changedKey === 'width' && modelDims.width > 0) {
        const ratio = current.width / modelDims.width;
        current.height = modelDims.height * ratio;
        current.depth = modelDims.depth * ratio;
      } else if (changedKey === 'height' && modelDims.height > 0) {
        const ratio = current.height / modelDims.height;
        current.width = modelDims.width * ratio;
        current.depth = modelDims.depth * ratio;
      } else if (changedKey === 'depth' && modelDims.depth > 0) {
        const ratio = current.depth / modelDims.depth;
        current.width = modelDims.width * ratio;
        current.height = modelDims.height * ratio;
      }
    }

    command('Set box dimensions', () => applyBoxDimensionChange(current));
  }

  controls.boxWidth.addEventListener('change', () => handleBoxDimChange('width'));
  controls.boxHeight.addEventListener('change', () => handleBoxDimChange('height'));
  controls.boxDepth.addEventListener('change', () => handleBoxDimChange('depth'));

  function readPrepressControl(control, fallback) {
    if (!control) return fallback;
    return control.type === 'checkbox' ? control.checked : control.value;
  }

  const prepressFieldMap = [
    ['mode', 'prepressMode'], ['profileId', 'prepressProfile'], ['bleedMm', 'prepressBleed'],
    ['safeMm', 'prepressSafe'], ['slugMm', 'prepressSlug'], ['requiredDpi', 'prepressDpi'],
  ];
  for (const [key, id] of prepressFieldMap) controls[id]?.addEventListener('change', () => setPrepressSettings({ [key]: readPrepressControl(controls[id], prepress[key]) }));
  const allowanceMap = [
    ['cutOffsetMm', 'prepressCutOffset'], ['creaseOffsetMm', 'prepressCreaseOffset'],
    ['glueTabDeltaMm', 'prepressGlueDelta'], ['tuckClearanceDeltaMm', 'prepressTuckDelta'],
  ];
  for (const [key, id] of allowanceMap) controls[id]?.addEventListener('change', () => setPrepressSettings({ allowances: { [key]: readPrepressControl(controls[id], prepress.allowances[key]) } }));
  const markMap = [['crop', 'prepressCropMarks'], ['registration', 'prepressRegistrationMarks'], ['slug', 'prepressSlugMark']];
  for (const [key, id] of markMap) controls[id]?.addEventListener('change', () => setPrepressSettings({ marks: { [key]: readPrepressControl(controls[id], prepress.marks[key]) } }));
  controls.prepressReset?.addEventListener('click', () => setPrepressSettings(DEFAULT_PREPRESS_SETTINGS));
  controls.prepressPreset?.addEventListener('change', () => {
    const preset = prepressPresets.find((entry) => entry.id === controls.prepressPreset.value);
    if (preset) setPrepressSettings(preset.settings);
  });
  controls.prepressSavePreset?.addEventListener('click', async () => {
    const name = windowRef.prompt?.('Prepress preset name', 'Production assist') || '';
    if (!name.trim()) return;
    try {
      await savePrepressPreset({ name, settings: prepress });
      prepressPresets = await getPrepressPresets();
      renderPrepressControls();
    } catch (error) {
      showError(error, 'unexpectedError');
    }
  });
  controls.prepressRun?.addEventListener('click', () => runCurrentPreflight());
  controls.prepressReport?.addEventListener('click', () => exportPreflightReport().catch((error) => showError(error, 'unexpectedError')));
  controls.prepressExport?.addEventListener('click', () => exportDeliverable('prepress-pdf'));

  controls.pageBoxSelect?.addEventListener('change', (event) => {
    const entry = getActiveEntry();
    if (!entry?.model?.hasArtwork || !entry.originalBlob) return;
    const next = PAGE_BOXES.includes(event.target.value) ? event.target.value : DEFAULT_PAGE_BOX;
    if (artwork.source.pageBox === next) return;
    artwork.source.pageBox = next;
    scheduleSave();
    invalidatePreviewResources(entry);
    pdfRenderController?.abort();
    const controller = new AbortController();
    pdfRenderController = controller;
    const generation = ++pdfRenderGeneration;
    renderPdfLayers();
    (async () => {
      try {
        const rendered = await renderPdfWithLayers(entry.originalBlob, {
          pageIndex: artwork.source.pageIndex || 0,
          visibility: artwork.pdfLayerVisibility,
          signal: controller.signal,
          overprint: false,
          cacheKey: artwork.source.sha256 || '',
          pageBox: next,
          passwordKey: artwork.source.sha256 || '',
          session: artwork.source.id || null,
          ...getEntryPdfRenderOptions(entry),
        });
        if (generation !== pdfRenderGeneration || disposed) return;
        entry.previewBlob = rendered.previewBlob;
        entry.displayBlob = null;
        previewBlob = entry.previewBlob;
        renderer.setArtworks(artworks);
        render();
        refreshPreviewResources({ force: true });
        Promise.resolve(onArtworkQualityChanged({ kind: 'pageBox' })).catch(() => {});
      } catch (error) {
        if (error?.name === 'AbortError' || generation !== pdfRenderGeneration) return;
        console.error(error);
        showError(error, 'artworkLoadFailed');
      } finally {
        if (generation === pdfRenderGeneration) pdfRenderController = null;
      }
    })();
  });

  function setupBoxScrubber(iconElement, key, axis) {
    if (!iconElement) return;

    let startPos = 0;
    let startVal = 0;
    let isDragging = false;

    iconElement.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      isDragging = true;
      try { iconElement.setPointerCapture(event.pointerId); } catch { /* ok */ }
      iconElement.classList.add('scrubbing');

      const current = readBoxDimensions();
      startVal = Number.isFinite(current[key]) ? current[key] : boxModel.dimensions[key];

      if (axis === 'horizontal') startPos = event.clientX;
      else if (axis === 'vertical') startPos = event.clientY;
      else if (axis === 'diagonal') startPos = event.clientX - event.clientY;
    });

    iconElement.addEventListener('pointermove', (event) => {
      if (!isDragging) return;

      let delta = 0;
      if (axis === 'horizontal') {
        delta = event.clientX - startPos;
      } else if (axis === 'vertical') {
        delta = startPos - event.clientY;
      } else if (axis === 'diagonal') {
        delta = (event.clientX - event.clientY - startPos) / Math.SQRT2;
      }

      let step = 0.1;
      let decimals = 1;
      if (event.ctrlKey || event.metaKey) { step = 1; decimals = 0; }
      else if (event.altKey) { step = 0.01; decimals = 2; }

      const rawNewValue = startVal + delta * step;
      const factor = Math.pow(10, decimals);
      const newValue = Math.max(0.1, Math.min(100000, Math.round(rawNewValue * factor) / factor));

      const input = controls[key === 'width' ? 'boxWidth' : key === 'height' ? 'boxHeight' : 'boxDepth'];
      if (input && Number(input.value) !== newValue) {
        input.value = round(newValue);
        try {
          const dims = readBoxDimensions();
          boxModel.updateDimensions(dims);
          renderer.render();
        } catch { /* silent preview can fail; restore on pointerup */ }
      }
    });

    const stopDragging = (event) => {
      if (!isDragging) return;
      isDragging = false;
      try { iconElement.releasePointerCapture(event.pointerId); } catch { /* ok */ }
      iconElement.classList.remove('scrubbing');
      command('Set box dimensions', () => {
        const dims = readBoxDimensions();
        applyBoxDimensionChange(dims);
      });
    };

    iconElement.addEventListener('pointerup', stopDragging);
    iconElement.addEventListener('pointercancel', stopDragging);
  }

  const boxScrubbers = {
    width: documentRef.querySelector('#boxDimensionsSection .dim-scrubber[data-dim="width"]'),
    height: documentRef.querySelector('#boxDimensionsSection .dim-scrubber[data-dim="height"]'),
    depth: documentRef.querySelector('#boxDimensionsSection .dim-scrubber[data-dim="depth"]'),
  };
  setupBoxScrubber(boxScrubbers.width, 'width', 'horizontal');
  setupBoxScrubber(boxScrubbers.height, 'height', 'vertical');
  setupBoxScrubber(boxScrubbers.depth, 'depth', 'diagonal');

  controls.choose.addEventListener('click', () => input.click());
  controls.replace.addEventListener('click', () => {
    if (!windowRef.confirm(t('replaceConfirm'))) return;
    pendingReplace = true;
    input.click();
  });
  controls.remove.addEventListener('click', () => {
    if (layerLocks.artwork) return;
    showDeleteConfirmation();
  });
  input.addEventListener('change', () => {
    processFile(input.files?.[0], { replace: pendingReplace });
    pendingReplace = false;
  });

  function dragStatus(event) {
    event.preventDefault();
    const files = [...(event.dataTransfer?.items || [])].filter((item) => item.kind === 'file');
    dropState.classList.toggle('drag-valid', files.length === 1);
    dropState.classList.toggle('drag-invalid', files.length !== 1);
  }
  canvasWrap.addEventListener('dragenter', dragStatus);
  canvasWrap.addEventListener('dragover', dragStatus);
  canvasWrap.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && canvasWrap.contains(event.relatedTarget)) return;
    dropState.classList.remove('drag-valid', 'drag-invalid');
  });
  canvasWrap.addEventListener('drop', (event) => {
    event.preventDefault();
    dropState.classList.remove('drag-valid', 'drag-invalid');
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length !== 1) {
      showError(new AppError('dropOneFile'), 'artworkLoadFailed', {
        retry: () => input.click(),
      });
      return;
    }
    processFile(files[0]);
  });

  documentRef.getElementById('cancelProcessingButton').addEventListener('click', () => {
    processingController?.abort();
    processingGeneration += 1;
    processing.hidden = true;
    canvasWrap.setAttribute('aria-busy', 'false');
    processingController = null;
    announce(t('processingCancelled'));
    showToast(t('artworkProcessingCancelled'));
  });

  documentRef.getElementById('artworkTwisty').addEventListener('click', () => {
    artworkGroupCollapsed = !artworkGroupCollapsed;
    updateTwistyDom();
    renderSublayers();
    scheduleSave();
  });

  documentRef.getElementById('backToBoxButton')?.addEventListener('click', onBack);
  controls.preview?.addEventListener('click', () => {
    onPreview(getExportWarnings(boxModel, artwork, t));
  });
  documentRef.getElementById('export3dHtmlButton')?.addEventListener('click', () => {
    exportDeliverable('html');
  });
  documentRef.getElementById('publish3dHtmlButton')?.addEventListener('click', () => {
    publishHtmlExport();
  });
  documentRef.getElementById('backToArtworkButton')?.addEventListener('click', () => {
    selected = true;
    render();
    onBackToEditor();
  });
  documentRef.querySelectorAll('.adobe-layer-row:not(.artwork-sublayer)').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.layer-toggle-cell')) return;

      const layerId = row.dataset.layerId;
      documentRef.querySelectorAll('.adobe-layer-row').forEach((r) => r.classList.remove('active'));
      row.classList.add('active');

      if (layerId === 'artwork') {
        if (artwork.hasArtwork) {
          selected = true;
          render();
        }
      } else {
        selected = false;
        render();
      }
    });
  });

  async function saveProjectArchive() {
    if (!canPersistProject()) {
      showToast(t('technicalPluginNotReady'));
      return { status: 'failed' };
    }
    if (operationProgress?.isBusy?.()) {
      showToast(t('operationInProgress'));
      return { status: 'busy' };
    }
    if (artworks.length === 0) {
      showToast(t('loadBeforeSave'));
      return { status: 'failed' };
    }
    clearError();
    const destinationPromise = requestSaveDestination({
      suggestedName: 'carton-project.carton',
      types: [
        {
          description: 'CartonBuilder Project (*.carton)',
          accept: { 'application/x-carton-project': ['.carton', '.json'] },
        },
      ],
      windowRef,
    });
    const outcome = await runForegroundOperation({
      id: 'project-save',
      labelKey: 'projectSaving',
      cancellable: true,
      lockMode: 'actions',
      work: async ({ signal, report, cancel }) => {
        const destination = await destinationPromise;
        if (!destination) {
          cancel();
          return null;
        }
        const blob = await createProjectArchive({
          snapshot: createSnapshot(),
          artworkBlobs: artworks.map((entry) => ({
            originalBlob: entry.originalBlob,
            previewBlob: entry.previewBlob,
          })),
          renderAssets: getRenderAssets() || [],
          technicalAssets: getTechnicalAssets() || null,
          signal,
          onProgress: ({ fraction, stageKey, stageParams }) => report({ fraction, stageKey, stageParams }),
        });
        await writeSaveDestination({
          destination,
          blob,
          suggestedName: 'carton-project.carton',
          windowRef,
          documentRef,
          signal,
          onProgress: (written, total) => report({
            fraction: 0.98 + (total ? (written / total) * 0.02 : 0),
            stageKey: 'exportWritingFile',
          }),
        });
        return true;
      },
    });

    if (outcome.status === 'succeeded') showToast(t('projectSaved'));
    else if (outcome.status === 'cancelled') showToast(t('operationCancelled'));
    else {
      console.error(outcome.error);
      showError(outcome.error, 'projectSaveFailed');
    }
    return outcome;
  }

  projectInput.addEventListener('change', async () => {
    if (operationProgress?.isBusy?.()) {
      projectInput.value = '';
      showToast(t('operationInProgress'));
      return;
    }
    try {
      clearError();
      const outcome = await runForegroundOperation({
        id: 'project-open',
        labelKey: 'projectOpening',
        cancellable: true,
        lockMode: 'workspace',
        work: async ({ signal, report }) => {
          const project = await readProjectArchive(projectInput.files?.[0], {
            signal,
            onProgress: ({ fraction, stageKey, stageParams }) => report({ fraction, stageKey, stageParams }),
          });
          await restoreProject(project);
          await onProjectLoaded(project.snapshot, project);
          return project;
        },
      });
      if (outcome.status === 'succeeded') showToast(t('projectOpened'));
      else if (outcome.status === 'cancelled') showToast(t('operationCancelled'));
      else {
        console.error(outcome.error);
        showError(outcome.error, 'projectOpenFailed');
      }
    } catch (error) {
      console.error(error);
      showError(error, 'projectOpenFailed');
    } finally {
      projectInput.value = '';
    }
  });

  function setPrepressSettings(next) {
    prepress = sanitizePrepressSettings({ ...prepress, ...(next || {}), allowances: { ...prepress.allowances, ...(next?.allowances || {}) }, marks: { ...prepress.marks, ...(next?.marks || {}) }, technicalLines: { ...prepress.technicalLines, ...(next?.technicalLines || {}) } });
    lastPreflight = null;
    render();
    scheduleSave();
    return clonePrepressSettings(prepress);
  }

  function preflightBlobSignature(blob) {
    if (!blob) return null;
    return {
      size: Number(blob.size) || 0,
      type: blob.type || '',
      lastModified: Number(blob.lastModified) || 0,
    };
  }

  function getPreflightSignature() {
    return JSON.stringify({
      box: boxModel.toJSON(),
      settings: prepress,
      artworks: artworks.map((entry) => ({
        model: entry.model?.toJSON?.() || entry.model || null,
        visible: entry.visible !== false,
        outputRole: entry.outputRole || 'print',
        finish: finishState(entry),
        originalBlob: preflightBlobSignature(entry.originalBlob),
        previewBlob: preflightBlobSignature(entry.previewBlob),
      })),
    });
  }

  function setPrepressOverlay(name, visible) {
    if (!Object.hasOwn(prepressOverlays, name)) return false;
    prepressOverlays[name] = Boolean(visible);
    renderPrepressOverlay();
    return prepressOverlays[name];
  }

  function getPrepressSettings() {
    return clonePrepressSettings(prepress);
  }

  function runCurrentPreflight() {
    const report = runPrepressPreflight({ boxModel, artworks: getArtworks(), settings: prepress });
    lastPreflight = { signature: getPreflightSignature(), report };
    if (controls.prepressStatus) {
      controls.prepressStatus.textContent = report.valid
        ? `Preflight passed with ${report.warnings.length} warnings and ${report.manualReview.length} manual checks.`
        : `Preflight blocked: ${report.blocking.length} blocking issue(s).`;
      controls.prepressStatus.classList.toggle('is-error', !report.valid);
    }
    return report;
  }

  function getCurrentPreflight({ fresh = false } = {}) {
    const signature = getPreflightSignature();
    if (!fresh && lastPreflight?.signature === signature) return lastPreflight.report;
    return runCurrentPreflight();
  }

  async function exportPreflightReport() {
    const report = getCurrentPreflight({ fresh: true });
    await saveOrDownloadFile({
      blob: createPreflightReportBlob(report),
      suggestedName: 'carton-preflight-report.json',
      types: [{ description: 'Preflight JSON (*.json)', accept: { 'application/json': ['.json'] } }],
      windowRef,
      documentRef,
    });
    return true;
  }

  async function exportDeliverable(type) {
    if (operationProgress?.isBusy?.()) {
      showToast(t('operationInProgress'));
      return false;
    }
    const initialSuggestedName = type === 'svg'
      ? getExportFilename(boxModel.dimensions)
      : type === 'prepress-svg'
        ? getPrepressExportFilename(boxModel.dimensions)
        : type === 'png'
          ? 'carton-artwork-preview.png'
          : type === 'jpg'
            ? 'carton-artwork-preview.jpg'
            : type === 'pdf'
              ? 'carton-artwork.pdf'
              : type === 'prepress-pdf'
                ? 'carton-prepress-production-assist.pdf'
                : type === 'html'
                  ? 'carton-3d.html'
                  : null;
    if (!initialSuggestedName) return false;
    const initialTypes = type === 'svg' || type === 'prepress-svg'
      ? [{ description: 'Scalable Vector Graphics (*.svg)', accept: { 'image/svg+xml': ['.svg'] } }]
      : type === 'png'
        ? [{ description: 'PNG Image (*.png)', accept: { 'image/png': ['.png'] } }]
        : type === 'jpg'
          ? [{ description: 'JPEG Image (*.jpg)', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }]
          : type === 'html'
            ? [{ description: 'Interactive 3D HTML (*.html)', accept: { 'text/html': ['.html'] } }]
            : [{ description: 'PDF Document (*.pdf)', accept: { 'application/pdf': ['.pdf'] } }];
    const destinationPromise = requestSaveDestination({
      suggestedName: initialSuggestedName,
      types: initialTypes,
      windowRef,
    });
    const outcome = await runForegroundOperation({
      id: `artwork-export-${type}`,
      labelKey: 'projectExporting',
      cancellable: true,
      lockMode: 'actions',
      work: async ({ signal, report, cancel }) => {
        try {
          clearError();
          report({ stageKey: 'operationPreparing' });
          let blob;
          let suggestedName;
          let types;
          let fallback = 'unexpectedError';
          const exportArtworks = getArtworks().filter((entry) => entry.visible && entry.outputRole !== 'finish');

          if (type === 'svg') {
            blob = new Blob([createExportSvg(boxModel)], { type: 'image/svg+xml;charset=utf-8' });
            suggestedName = getExportFilename(boxModel.dimensions);
            types = [{
              description: 'Scalable Vector Graphics (*.svg)',
              accept: { 'image/svg+xml': ['.svg'] },
            }];
          } else if (type === 'prepress-svg') {
            blob = new Blob([await createPrepressSvg({
              boxModel,
              artworks: exportArtworks,
              settings: prepress,
            })], { type: 'image/svg+xml;charset=utf-8' });
            suggestedName = getPrepressExportFilename(boxModel.dimensions);
            types = [{ description: 'Prepress SVG (*.svg)', accept: { 'image/svg+xml': ['.svg'] } }];
          } else if (type === 'png' || type === 'jpg') {
            const mimeType = type === 'png' ? 'image/png' : 'image/jpeg';
            const { createPreviewBlob } = await import('../export/artworkExport.js');
            const selectedDpi = exportArtworks
              .map((entry) => Number(entry.model.quality?.render))
              .filter((value) => Number.isFinite(value) && value > 0);
            const hasAutoQuality = exportArtworks.some(
              (entry) => !Number.isFinite(Number(entry.model.quality?.render)),
            );
            const exportDpi = Math.max(
              selectedDpi.length ? Math.max(...selectedDpi) : 150,
              hasAutoQuality ? 300 : 0,
            );
            blob = await createPreviewBlob({
              boxModel,
              artworks: exportArtworks,
              type: mimeType,
              dpi: exportDpi,
            });
            suggestedName = type === 'png' ? 'carton-artwork-preview.png' : 'carton-artwork-preview.jpg';
            types = type === 'png'
              ? [{ description: 'PNG Image (*.png)', accept: { 'image/png': ['.png'] } }]
              : [{ description: 'JPEG Image (*.jpg)', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }];
            fallback = type === 'png' ? 'exportPngFailed' : 'exportJpgFailed';
          } else if (type === 'pdf') {
            const { createPdfExport } = await import('../export/artworkExport.js');
            blob = await createPdfExport({ boxModel, artworks: exportArtworks });
            suggestedName = 'carton-artwork.pdf';
            types = [{
              description: 'PDF Document (*.pdf)',
              accept: { 'application/pdf': ['.pdf'] },
            }];
            fallback = 'exportPdfFailed';
          } else if (type === 'prepress-pdf') {
            const report = getCurrentPreflight({ fresh: true });
            if (!report.valid) throw new AppError('prepressBlocked');
            const { createPrepressPdfExport } = await import('../export/artworkExport.js');
            blob = await createPrepressPdfExport({ boxModel, artworks: exportArtworks, settings: prepress, preflight: report });
            suggestedName = 'carton-prepress-production-assist.pdf';
            types = [{ description: 'Prepress PDF (not PDF/X) (*.pdf)', accept: { 'application/pdf': ['.pdf'] } }];
            fallback = 'exportPdfFailed';
          } else if (type === 'html') {
            const { createInteractive3dHtml } = await import('../export/interactive3dExport.js');
            const renderState = sanitizeRenderSettings(getRenderState());
            const previewState = getPreview3dState?.() || null;
            blob = await createInteractive3dHtml({
              boxModel,
              artworks: exportArtworks,
              htmlQuality: renderState.quality.html,
              renderState,
              boardAppearance: sanitizeBoardAppearance(getRenderBoardAppearance()),
              previewState,
              locale: documentRef.documentElement.lang || 'en',
              documentRef,
            });
            suggestedName = 'carton-3d.html';
            types = [{
              description: 'Interactive 3D HTML (*.html)',
              accept: { 'text/html': ['.html'] },
            }];
            fallback = 'exportPdfFailed';
          } else {
            return false;
          }

          const destination = await destinationPromise;
          if (!destination) {
            cancel();
            return false;
          }
          await writeSaveDestination({
            destination,
            blob,
            suggestedName,
            windowRef,
            documentRef,
            signal,
            onProgress: (written, total) => report({
              fraction: 0.98 + (total ? (written / total) * 0.02 : 0),
              stageKey: 'exportWritingFile',
            }),
          });
          return true;
        } catch (error) {
          throw Object.assign(error, { fallbackKey: fallback });
        }
      },
    });
    if (outcome.status === 'succeeded') return true;
    if (outcome.status === 'cancelled') {
      showToast(t('operationCancelled'));
      return false;
    }
    console.error(outcome.error);
    showError(outcome.error, outcome.error?.fallbackKey || 'unexpectedError');
    return false;
  }

  function readPublishSettings() {
    const defaults = { owner: 'shafranek-js', repo: 'CartonBuilder', token: '' };
    try {
      const raw = windowRef.localStorage?.getItem('carton.publish.settings');
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch {
      return defaults;
    }
  }

  function savePublishSettings(settings) {
    try {
      windowRef.localStorage?.setItem('carton.publish.settings', JSON.stringify(settings));
    } catch { /* ignore */ }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = documentRef.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      documentRef.body.appendChild(textarea);
      textarea.select();
      try { documentRef.execCommand('copy'); } catch { /* ignore */ }
      textarea.remove();
    }
  }

  async function publishHtmlExport() {
    if (operationProgress?.isBusy?.()) {
      showToast(t('operationInProgress'));
      return false;
    }
    const outcome = await runForegroundOperation({
      id: 'publish-html',
      labelKey: 'exportPublishing',
      cancellable: true,
      lockMode: 'actions',
      work: async ({ signal, report, cancel }) => {
        clearError();
        const exportArtworks = getArtworks().filter((entry) => entry.visible && entry.outputRole !== 'finish');
        const { createInteractive3dHtml } = await import('../export/interactive3dExport.js');
        report({ stageKey: 'operationProcessing', fraction: 0.1 });
        const renderState = sanitizeRenderSettings(getRenderState());
        const previewState = getPreview3dState?.() || null;
        const blob = await createInteractive3dHtml({
          boxModel,
          artworks: exportArtworks,
          htmlQuality: renderState.quality.html,
          renderState,
          boardAppearance: sanitizeBoardAppearance(getRenderBoardAppearance()),
          previewState,
          locale: documentRef.documentElement.lang || 'en',
          documentRef,
        });

        let settings = readPublishSettings();
        if (!settings.token) {
          const token = windowRef.prompt?.(t('publishTokenPrompt'));
          if (!token) {
            cancel();
            return false;
          }
          settings = { ...settings, token };
          savePublishSettings(settings);
        }
        if (!settings.owner || !settings.repo) {
          const owner = windowRef.prompt?.(t('publishOwnerPrompt'), settings.owner || '');
          const repo = windowRef.prompt?.(t('publishRepoPrompt'), settings.repo || '');
          if (!owner || !repo) {
            cancel();
            return false;
          }
          settings = { ...settings, owner, repo };
          savePublishSettings(settings);
        }

        const { publishInteractiveHtml } = await import('../export/publishExport.js');
        const filename = `carton-${Date.now()}.html`;
        report({ stageKey: 'exportPublishing', fraction: 0.65 });
        const { pageUrl } = await publishInteractiveHtml({
          blob,
          filename,
          token: settings.token,
          owner: settings.owner,
          repo: settings.repo,
          signal,
        });

        await copyToClipboard(pageUrl);
        showToast(`${t('publishSuccess')}: ${pageUrl}`);
        report({ stageKey: 'projectReady', fraction: 1 });
        return true;
      },
    });
    if (outcome.status === 'cancelled') {
      showToast(t('operationCancelled'));
      return false;
    }
    if (outcome.status !== 'succeeded' || outcome.value === false) {
      console.error(outcome.error);
      showToast(t('publishFailed'));
      return false;
    }
    return true;
  }

  function clearArtworkForCartonChange() {
    processingController?.abort();
    processingController = null;
    pdfRenderController?.abort();
    pdfRenderController = null;
    previewResourceController?.abort();
    previewResourceController = null;
    previewResourceGeneration += 1;
    previewResourceSignatures.clear();
    pdfRenderGeneration += 1;
    for (const [, cached] of thumbnailUrlCache) {
      if (cached.url) URL.revokeObjectURL(cached.url);
    }
    thumbnailUrlCache.clear();
    artworks.length = 0;
    activeArtworkIndex = -1;
    selectedArtworkIndices.clear();
    artwork = new ArtworkModel();
    originalBlob = null;
    previewBlob = null;
    lastPreflight = null;
    for (const key of Object.keys(prepressOverlays)) prepressOverlays[key] = false;
    history.clear();
    renderer.artwork = artwork;
    renderer.setArtworks(artworks);
    selected = false;
    renderPdfLayers();
    render();
    onStateChanged();
  }

  async function restoreProject({ snapshot, artworkBlobs = [], technicalAssets = null }) {
    const quickBox = snapshot.cartonSource?.mode === 'quick'
      ? snapshot.cartonSource.box
      : snapshot.box;
    if (snapshot.cartonSource?.mode === 'technical') {
      await restoreCartonDocument({ snapshot, technicalAssets });
    } else {
      if (!quickBox) throw new AppError('projectIncomplete');
      boxApp.loadState(quickBox);
    }
    prepress = sanitizePrepressSettings(snapshot.prepress);
    lastPreflight = null;
    projectCreatedAt = snapshot.meta?.createdAt || new Date().toISOString();
    artworks.length = 0;
    for (let index = 0; index < (snapshot.artworks || []).length; index += 1) {
      const entry = snapshot.artworks[index];
      const blobs = artworkBlobs[index] || {};
      artworks.push({
        model: new ArtworkModel(entry.artwork),
        visible: entry.visible !== false,
        locked: Boolean(entry.locked),
        color: entry.color || assignLayerColor(artworks.map((e) => e.color)),
        ...finishState(entry),
        originalBlob: blobs.originalBlob || null,
        previewBlob: blobs.previewBlob || null,
        displayBlob: null,
      });
    }
    Object.assign(layers, snapshot.view?.layers || {});
    Object.assign(layerLocks, snapshot.view?.layerLocks || {});
    Object.assign(viewport, {
      zoom: snapshot.view?.zoom || 1,
      panX: snapshot.view?.panX || 0,
      panY: snapshot.view?.panY || 0,
    });
    history.restore(snapshot.history);
    artworkGroupCollapsed = Boolean(snapshot.view?.collapseArtworkGroup);
    updateTwistyDom();
    setActiveArtwork(Math.min(snapshot.activeArtworkIndex || 0, artworks.length - 1));
    renderer.setArtworks(artworks);
    selected = Boolean(artwork.hasArtwork);
    selectedArtworkIndices = new Set([activeArtworkIndex]);
    for (const [key, control] of Object.entries(layerControls)) control.checked = layers[key];
    for (const [key, control] of Object.entries(layerLockControls)) control.checked = layerLocks[key];
    renderPdfLayers();
    render();
    refreshPreviewResources({ force: true });
    scheduleSave();
  }

  windowRef.addEventListener('keydown', (event) => {
    if (event.key === ' ') spacePressed = true;
    if (artworks.length === 0 || documentRef.getElementById('artworkStep').hidden) return;
    const active = documentRef.activeElement;
    if (active?.matches('input, textarea, select')) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
      render();
      scheduleSave();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      history.redo();
      render();
      scheduleSave();
      return;
    }
    if (event.key === '0') {
      event.preventDefault();
      renderer.fitToScreen();
      return;
    }
    if (event.key === 'Escape') {
      if (cropMode) { exitCropMode(false); return; }
      selected = false;
      render();
      return;
    }
    if (event.key === 'Enter' && cropMode) {
      event.preventDefault();
      exitCropMode(true);
      return;
    }
    if (event.key === 'Delete' && !layerLocks.artwork) {
      controls.remove.click();
      return;
    }
    if (event.altKey && event.key === '[') {
      event.preventDefault();
      const next = activeArtworkIndex > 0 ? activeArtworkIndex - 1 : artworks.length - 1;
      if (next >= 0 && !artworks[next]?.locked) selectArtworkRow(next);
      return;
    }
    if (event.altKey && event.key === ']') {
      event.preventDefault();
      const next = activeArtworkIndex < artworks.length - 1 ? activeArtworkIndex + 1 : 0;
      if (next >= 0 && !artworks[next]?.locked) selectArtworkRow(next);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      if (activeArtworkIndex >= 0) duplicateArtwork(activeArtworkIndex);
      return;
    }
    const deltas = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (selected && !layerLocks.artwork && deltas[event.key]) {
      event.preventDefault();
      const step = event.ctrlKey || event.metaKey ? 10 : event.shiftKey ? 1 : 0.1;
      const [x, y] = deltas[event.key];
      command('Nudge artwork', () => artwork.moveBy(x * step, y * step));
    }
  });
  windowRef.addEventListener('keyup', (event) => {
    if (event.key === ' ') spacePressed = false;
  });
  windowRef.addEventListener('resize', () => {
    renderer.render();
    if (!artworkStep.hidden) refreshPreviewResources();
  });
  documentRef.addEventListener('carton-locale-changed', () => {
    render();
    renderCurrentError();
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    windowRef.clearTimeout(saveTimer);
    windowRef.clearTimeout(toastTimer);
    windowRef.clearTimeout(wheelTimer);
    processingController?.abort();
    processingController = null;
    pdfRenderController?.abort();
    pdfRenderController = null;
    previewResourceController?.abort();
    previewResourceController = null;
    previewResourceGeneration += 1;
    previewResourceSignatures.clear();
    for (const [, cached] of thumbnailUrlCache) {
      if (cached.url) URL.revokeObjectURL(cached.url);
    }
    thumbnailUrlCache.clear();
    renderer.dispose();
  }

  windowRef.addEventListener('beforeunload', dispose);

  async function restoreAutosave() {
    try {
      const stored = await loadCurrentProject();
      if (!stored) return false;
      const validated = await validateProjectBundle(stored);
      await restoreProject(validated);
      await onProjectLoaded(validated.snapshot, validated);
      return true;
    } catch (error) {
      console.warn('Could not restore autosaved project', error);
      showError(
        new AppError('autosaveRestoreFailed', {}, { cause: error }),
        'autosaveRestoreFailed',
      );
      return false;
    }
  }

  async function restoreProjectFromUrl(url) {
    try {
      processing.hidden = false;
      processing.setAttribute('aria-busy', 'true');
      processingText.textContent = t('processing');
      const response = await windowRef.fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Could not load example project: ${response.status}`);
      const project = await readProjectArchive(await response.blob());
      await restoreProject(project);
      await onProjectLoaded(project.snapshot, project);
      return true;
    } catch (error) {
      console.warn('Could not restore the first-run example project', error);
      return false;
    } finally {
      processing.hidden = true;
      processing.removeAttribute('aria-busy');
    }
  }

  render();
  getPrepressPresets().then((presets) => { prepressPresets = presets; renderPrepressControls(); }).catch(() => {});

  return {
    get artwork() { return artwork; },
    renderer,
    history,
    layers,
    layerLocks,
    render,
    fitToScreen: () => {
      renderer.fitToScreen();
      return refreshPreviewResources();
    },
    createSnapshot,
    createProjectCheckpoint,
    restoreProjectCheckpoint,
    discardProjectCheckpoint,
    hasProjectCheckpoint: () => projectCheckpoint.hasProjectCheckpoint(),
    saveProjectArchive,
    persistWorkflowStep,
    scheduleSave,
    notifyRenderStateChanged: () => onRenderStateChanged(),
    flushPendingSave,
    dispose,
    clearArtworkForCartonChange,
    restoreAutosave,
    restoreProjectFromUrl,
    get originalBlob() { return originalBlob; },
    get previewBlob() { return previewBlob; },
    getArtworks,
    getArtworksJson,
    getPrepressSettings,
    setPrepressSettings,
    setPrepressOverlay,
    getPrepressOverlayState: () => ({ ...prepressOverlays }),
    runPrepressPreflight: () => getCurrentPreflight(),
    exportPreflightReport,
    removeSelectedArtwork() {
      if (layerLocks.artwork) return false;
      showDeleteConfirmation();
      return true;
    },
    setArtworkQuality,
    updateArtworkFinish,
    refreshPreviewResources,
    setOverprintEnabled,
    isOverprintAvailable: () => getMuPdfClient().getRendererVersion() === 'mupdf-custom',
    openSeparations,
    hasModifiedArtwork: () => artwork.hasArtwork && artwork.modified,
    exportDeliverable,
    resetPlacementForNewDimensions() {
      const entry = getActiveEntry();
      if (!entry) return;
      artwork.fitDieline(boxModel.getBounds(), { setInitial: true });
      history.clear();
      renderer.fitToScreen();
      scheduleSave();
    },
  };
}
