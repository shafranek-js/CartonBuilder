import { createExportSvg, getExportFilename } from '../export/svgExport.js';
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
import { validateProjectBundle } from '../project/projectSchema.js';
import { ArtworkModel, getReferenceFraction } from './ArtworkModel.js';
import { ArtworkRenderer } from './ArtworkRenderer.js';
import { HistoryManager } from './HistoryManager.js';
import { ViewportModel } from './ViewportModel.js';
import { loadArtworkFile, renderPdfWithLayers } from './fileLoader.js';
import { getSnapOffset, buildSnapTargets, getResizeSnapScale, getDisplayedReferenceFraction } from './snap.js';
import { saveOrDownloadFile } from '../utils/fileSaver.js';

const SNAP_SCREEN_PX = 6;

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
  const pageDialog = documentRef.getElementById('pageDialog');
  const pageNumber = documentRef.getElementById('pdfPageNumber');
  const pageCount = documentRef.getElementById('pdfPageCount');
  const sublayersContainer = documentRef.getElementById('artworkSublayers');
  const contextMenu = documentRef.getElementById('layerContextMenu');

  const controls = {
    fileName: documentRef.getElementById('artworkFileName'),
    x: documentRef.getElementById('artworkX'),
    y: documentRef.getElementById('artworkY'),
    width: documentRef.getElementById('artworkWidth'),
    height: documentRef.getElementById('artworkHeight'),
    scale: documentRef.getElementById('artworkScale'),
    opacity: documentRef.getElementById('artworkOpacity'),
    opacityValue: documentRef.getElementById('artworkOpacityValue'),
    bgOpacity: documentRef.getElementById('artworkBgOpacity'),
    bgOpacityValue: documentRef.getElementById('artworkBgOpacityValue'),
    dpi: documentRef.getElementById('effectiveDpi'),
    choose: documentRef.getElementById('chooseArtworkButton'),
    replace: documentRef.getElementById('replaceArtworkButton'),
    remove: documentRef.getElementById('removeArtworkButton'),
    fit: documentRef.getElementById('fitArtworkButton'),
    fill: documentRef.getElementById('fillArtworkButton'),
    center: documentRef.getElementById('centerArtworkButton'),
    rotateLeft: documentRef.getElementById('rotateLeftButton'),
    rotateRight: documentRef.getElementById('rotateRightButton'),
    reset: documentRef.getElementById('resetArtworkButton'),
    undo: documentRef.getElementById('undoButton'),
    redo: documentRef.getElementById('redoButton'),
    preview: documentRef.getElementById('previewButton'),
    referencePointGrid: documentRef.getElementById('referencePointGrid'),
    pdfLayersSection: documentRef.getElementById('pdfLayersSection'),
    pdfLayersList: documentRef.getElementById('pdfLayersList'),
    cropSection: documentRef.getElementById('cropSection'),
    cropFrameBtn: documentRef.getElementById('cropFrameButton'),
    cropDrawBtn: documentRef.getElementById('cropDrawButton'),
    clearCrop: documentRef.getElementById('clearCropButton'),
    cropStatus: documentRef.getElementById('cropStatus'),
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
  let artworkGroupCollapsed = false;
  let selectedArtworkIndices = new Set();
  const thumbnailUrlCache = new Map();

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
    artworks.length = 0;
    for (const entry of state.artworks || []) {
      artworks.push({
        model: new ArtworkModel(entry.artwork),
        visible: entry.visible !== false,
        locked: Boolean(entry.locked),
        color: entry.color || assignLayerColor(artworks.map((e) => e.color)),
        originalBlob: entry.originalBlob || null,
        previewBlob: entry.previewBlob || null,
      });
    }
    Object.assign(layers, state.layers);
    Object.assign(layerLocks, state.layerLocks);
    artworkGroupCollapsed = Boolean(state.collapseArtworkGroup);
    updateTwistyDom();
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
    if (fit) windowRef.requestAnimationFrame(() => renderer.fitToScreen());
    scheduleSave();
  }

  function getArtworks() {
    return artworks.map((entry) => ({
      model: entry.model,
      originalBlob: entry.originalBlob,
      previewBlob: entry.previewBlob,
      visible: entry.visible,
    }));
  }

  function getArtworksJson() {
    return JSON.stringify({
      artworks: artworks.map((entry) => ({
        artwork: entry.model.toJSON(),
        visible: entry.visible,
      })),
      activeArtworkIndex,
    });
  }

  function persistedWorkflowStep(value = getWorkflowStep()) {
    if (value === 'preview') return 'preview';
    if (value === 'artwork') return 'artwork';
    return 'box';
  }

  function createSnapshot(workflowStep = persistedWorkflowStep()) {
    const topmost = artworks[0];
    return {
      schemaVersion: 2,
      meta: {
        id: 'current',
        name: artworkEntryName(topmost) || 'Untitled carton',
        createdAt: projectCreatedAt,
        updatedAt: new Date().toISOString(),
        locale: documentRef.documentElement.lang || 'en',
      },
      workflowStep,
      box: boxModel.toJSON(),
      artworks: artworks.map((entry) => ({
        artwork: entry.model.toJSON(),
        visible: entry.visible,
      })),
      activeArtworkIndex,
      view: {
        ...viewport.toJSON(),
        layers: { ...layers },
        layerLocks: { ...layerLocks },
        collapseArtworkGroup: artworkGroupCollapsed,
      },
      history: history.toJSON(),
    };
  }

  function enqueueSave(workflowStep = persistedWorkflowStep()) {
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
    controls.scale.value = enabled ? round(artwork.scale * 100) : '';
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

    for (const control of [
      controls.x, controls.y, controls.width, controls.height, controls.scale, controls.opacity,
      controls.remove, controls.fit, controls.fill, controls.center,
      controls.rotateLeft, controls.rotateRight, controls.reset,
    ]) {
      control.disabled = !transformEnabled;
    }
    for (const button of controls.referencePointGrid.querySelectorAll('.reference-point-button')) {
      button.disabled = !transformEnabled;
      button.setAttribute('aria-pressed', String(button.dataset.point === artwork.referencePoint));
    }
    controls.bgOpacity.disabled = !transformEnabled;
    controls.replace.disabled = !enabled;
    controls.preview.disabled = artworks.length === 0;
    controls.undo.disabled = history.undoStack.length === 0;
    controls.redo.disabled = history.redoStack.length === 0;
    controls.cropSection.hidden = !enabled;
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
      lockCb.className = 'sr-only';
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
      visible: entry.visible,
      locked: false,
      color,
    });
    if (activeArtworkIndex >= index) activeArtworkIndex += 1;
    renderer.setArtworks(artworks);
    commitChange('Duplicate artwork', before);
  }

  function showDeleteConfirmation() {
    const toRemove = [...selectedArtworkIndices]
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
    renderSublayers();
    syncArtworkVisibility();
    renderer.render();
  }

  function createSvgElement(name, attributes, innerHtml) {
    const element = documentRef.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    if (innerHtml) element.innerHTML = innerHtml;
    return element;
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
    const layers = artwork.source?.pdfLayers || [];
    const hasLayers = artwork.hasArtwork && layers.length > 0;
    controls.pdfLayersSection.hidden = !hasLayers;
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

    pdfRenderController?.abort();
    const controller = new AbortController();
    pdfRenderController = controller;
    const generation = ++pdfRenderGeneration;
    try {
      const rendered = await renderPdfWithLayers(entry.originalBlob, {
        pageIndex: artwork.source.pageIndex || 0,
        visibility: next,
        signal: controller.signal,
      });
      if (generation !== pdfRenderGeneration || disposed) return;
      entry.previewBlob = rendered.previewBlob;
      previewBlob = entry.previewBlob;
      renderer.setArtworks(artworks);
      render();
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
      });
      if (generation !== processingGeneration) return;
      const model = new ArtworkModel();
      model.load(loaded.source, boxModel.getBounds());
      if (replace && activeArtworkIndex >= 0) {
        const entry = artworks[activeArtworkIndex];
        entry.model = model;
        entry.originalBlob = loaded.originalBlob;
        entry.previewBlob = loaded.previewBlob;
        entry.locked = false;
      } else {
        const existingColors = artworks.map((e) => e.color);
        artworks.unshift({
          model,
          originalBlob: loaded.originalBlob,
          previewBlob: loaded.previewBlob,
          visible: true,
          locked: false,
          color: assignLayerColor(existingColors),
        });
        activeArtworkIndex = 0;
      }
      setActiveArtwork(activeArtworkIndex);
      renderer.setArtworks(artworks);
      history.clear();
      selected = true;
      renderPdfLayers();
      render();
      windowRef.requestAnimationFrame(() => renderer.fitToScreen());
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
    if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selected = true;
    const point = renderer.clientToModel(event.clientX, event.clientY);
    const anchorPos = artwork.getReferencePosition();
    const startDistFromAnchor = Math.hypot(point.x - anchorPos.x, point.y - anchorPos.y);
    const startDistFromCenter = Math.hypot(point.x - artwork.centerXmm, point.y - artwork.centerYmm);

    gesture = {
      ...detail,
      pointerId: event.pointerId,
      before: captureEditorState(),
      startPoint: point,
      startCenter: { x: artwork.centerXmm, y: artwork.centerYmm },
      startScale: artwork.scale,
      rotation: artwork.rotation,
      anchorPos,
      startDistFromAnchor: Math.max(0.001, startDistFromAnchor),
      startDistFromCenter: Math.max(0.001, startDistFromCenter),
    };
    svg.setPointerCapture(event.pointerId);
    render();
  }

  function updateResizeGesture(event, point) {
    const isAlt = event.altKey;
    const anchor = isAlt ? gesture.startCenter : artwork.getReferencePosition();
    const currentDist = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    const factor = currentDist / (isAlt ? gesture.startDistFromCenter : gesture.startDistFromAnchor);
    const nextScale = Math.max(0.01, gesture.startScale * factor);

    const fraction = isAlt
      ? { x: 0, y: 0 }
      : getDisplayedReferenceFraction(
        artwork.rotation,
        getReferenceFraction(artwork.referencePoint),
      );
    const snappedScale = getResizeSnapScale({
      candidateScale: nextScale,
      anchor,
      baseW: artwork.initialWidthMm,
      baseH: artwork.initialHeightMm,
      fraction,
      targets: buildSnapTargets(boxModel),
      threshold: SNAP_SCREEN_PX / viewport.zoom,
    });
    artwork.setScale(snappedScale);
    if (isAlt) {
      artwork.centerXmm = gesture.startCenter.x;
      artwork.centerYmm = gesture.startCenter.y;
    }
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
      artwork.setCenter(snapped.x, snapped.y);
    } else if (gesture.type === 'resize') {
      updateResizeGesture(event, point);
    } else if (gesture.type === 'pan') {
      viewport.panBy(event.clientX - gesture.lastClientX, event.clientY - gesture.lastClientY);
      gesture.lastClientX = event.clientX;
      gesture.lastClientY = event.clientY;
    }
    render();
  });

  function finishGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.type === 'move' || gesture.type === 'resize') {
      commitChange(gesture.type === 'move' ? 'Move artwork' : 'Resize artwork', gesture.before);
    }
    gesture = null;
  }
  function finishCropGesture() {
    if (!cropGesture) return;
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
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function startDrawCrop(event) {
    event.preventDefault();
    event.stopPropagation();
    const point = renderer.clientToModel(event.clientX, event.clientY);
    const unrotated = rotateVector(
      point.x - artwork.centerXmm,
      point.y - artwork.centerYmm,
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
      point.x - artwork.centerXmm,
      point.y - artwork.centerYmm,
      -artwork.rotation,
    );
    const localX = unrotated.x + artwork.unrotatedWidthMm / 2;
    const localY = unrotated.y + artwork.unrotatedHeightMm / 2;
    cropGesture = {
      pointerId: event.pointerId,
      type: 'move',
      startX: event.clientX,
      startY: event.clientY,
      startCrop: { ...cropPreview },
      initialLocalX: localX,
      initialLocalY: localY,
    };
    const cornerEl = event.target.closest('.crop-handle');
    if (cornerEl) {
      cropGesture.type = 'resize';
      cropGesture.corner = Number(cornerEl.dataset.cropCorner);
      switch (cropGesture.corner) {
        case 0: cropGesture.anchorX = cropPreview.x + cropPreview.width; cropGesture.anchorY = cropPreview.y + cropPreview.height; break;
        case 1: cropGesture.anchorX = cropPreview.x; cropGesture.anchorY = cropPreview.y + cropPreview.height; break;
        case 2: cropGesture.anchorX = cropPreview.x; cropGesture.anchorY = cropPreview.y; break;
        case 3: cropGesture.anchorX = cropPreview.x + cropPreview.width; cropGesture.anchorY = cropPreview.y; break;
      }
    }
    svg.setPointerCapture(event.pointerId);
    selected = false;
  }

  function moveCropGesture(event) {
    if (!cropGesture || event.pointerId !== cropGesture.pointerId || !cropPreview) return;
    const point = renderer.clientToModel(event.clientX, event.clientY);
    const unrotated = rotateVector(
      point.x - artwork.centerXmm,
      point.y - artwork.centerYmm,
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
    renderer.cropFrame = cropPreview;
    renderer.render();
  }

  svg.addEventListener('pointerup', (event) => {
    if (cropGesture) { finishCropGesture(); return; }
    finishGesture(event);
  });
  svg.addEventListener('pointercancel', (event) => {
    if (cropGesture) { finishCropGesture(); return; }
    finishGesture(event);
  });
  svg.addEventListener('pointerdown', (event) => {
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
      artwork.setScale(artwork.scale * Math.exp(-event.deltaY * 0.001));
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
  bindNumberControl(controls.width, 'Set artwork width', (value) => artwork.setDisplayedWidth(value));
  bindNumberControl(controls.height, 'Set artwork height', (value) => artwork.setDisplayedHeight(value));
  bindNumberControl(controls.scale, 'Set artwork scale', (value) => artwork.setScale(value / 100));
  bindSliderControl(controls.opacity, 'Set artwork opacity', (value) => artwork.setOpacity(value / 100));
  bindSliderControl(controls.bgOpacity, 'Set background opacity', (value) => artwork.setBgOpacity(value / 100));

  let lastNonZeroArtworkOpacity = 1.0;
  const opacityLabel = controls.opacity?.closest('label');
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
  const bgOpacityLabel = controls.bgOpacity?.closest('label');
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

  controls.cropFrameBtn.addEventListener('click', () => {
    if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked) return;
    if (cropMode === 'frame') { exitCropMode(false); return; }
    if (cropMode === 'draw') { exitCropMode(false); }
    enterCropFrame();
  });
  controls.cropDrawBtn.addEventListener('click', () => {
    if (!artwork.hasArtwork || layerLocks.artwork || getActiveEntry()?.locked) return;
    if (cropMode === 'draw') { exitCropMode(false); return; }
    if (cropMode === 'frame') { exitCropMode(false); }
    enterCropDraw();
  });
  controls.clearCrop.addEventListener('click', clearCrop);

  function updateCropButtons() {
    const isFrame = cropMode === 'frame';
    const isDraw = cropMode === 'draw';
    controls.cropFrameBtn.classList.toggle('active', isFrame);
    controls.cropDrawBtn.classList.toggle('active', isDraw);
    if (isFrame || isDraw) {
      controls.cropFrameBtn.querySelector('span').textContent = t('applyCrop');
      controls.cropDrawBtn.querySelector('span').textContent = t('applyCrop');
    } else {
      controls.cropFrameBtn.querySelector('span').textContent = t('cropFrame');
      controls.cropDrawBtn.querySelector('span').textContent = t('cropDraw');
    }
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
    if (commit && cropPreview) {
      artwork.crop = { ...cropPreview };
      artwork.modified = true;
    }
    cropMode = null;
    cropPreview = null;
    cropGesture = null;
    cropDrawStart = null;
    renderer.cropFrame = null;
    renderer.drawRect = null;
    svg.style.cursor = '';
    updateCropButtons();
    updateCropStatus();
    controls.clearCrop.disabled = !artwork.crop;
    render();
    if (commit) scheduleSave();
  }

  function clearCrop() {
    artwork.crop = null;
    cropMode = null;
    cropPreview = null;
    cropGesture = null;
    cropDrawStart = null;
    renderer.cropFrame = null;
    renderer.drawRect = null;
    svg.style.cursor = '';
    updateCropButtons();
    updateCropStatus();
    controls.clearCrop.disabled = true;
    render();
    scheduleSave();
  }

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

  documentRef.getElementById('backToBoxButton').addEventListener('click', onBack);
  controls.preview.addEventListener('click', () => {
    onPreview(getExportWarnings(boxModel, artwork, t));
  });
  documentRef.getElementById('export3dHtmlButton')?.addEventListener('click', () => {
    exportDeliverable('html');
  });
  documentRef.getElementById('backToArtworkButton').addEventListener('click', () => {
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
    if (artworks.length === 0) {
      showToast(t('loadBeforeSave'));
      return;
    }
    try {
      clearError();
      const blob = await createProjectArchive({
        snapshot: createSnapshot(),
        artworkBlobs: artworks.map((entry) => ({
          originalBlob: entry.originalBlob,
          previewBlob: entry.previewBlob,
        })),
      });
      await saveOrDownloadFile({
        blob,
        suggestedName: 'carton-project.carton',
        types: [
          {
            description: 'CartonBuilder Project (*.carton)',
            accept: { 'application/x-carton-project': ['.carton', '.json'] },
          },
        ],
        windowRef,
        documentRef,
      });
    } catch (error) {
      console.error(error);
      showError(error, 'projectSaveFailed');
    }
  }

  projectInput.addEventListener('change', async () => {
    try {
      clearError();
      const project = await readProjectArchive(projectInput.files?.[0]);
      restoreProject(project);
      onProjectLoaded(project.snapshot);
      showToast(t('projectOpened'));
    } catch (error) {
      console.error(error);
      showError(error, 'projectOpenFailed');
    } finally {
      projectInput.value = '';
    }
  });

  async function exportDeliverable(type) {
    try {
      clearError();
      let blob;
      let suggestedName;
      let types;
      let fallback = 'unexpectedError';
      const exportArtworks = getArtworks().filter((entry) => entry.visible);

      if (type === 'svg') {
        blob = new Blob([createExportSvg(boxModel)], { type: 'image/svg+xml;charset=utf-8' });
        suggestedName = getExportFilename(boxModel.dimensions);
        types = [{
          description: 'Scalable Vector Graphics (*.svg)',
          accept: { 'image/svg+xml': ['.svg'] },
        }];
      } else if (type === 'png' || type === 'jpg') {
        const mimeType = type === 'png' ? 'image/png' : 'image/jpeg';
        const { createPreviewBlob } = await import('../export/artworkExport.js');
        blob = await createPreviewBlob({
          boxModel,
          artworks: exportArtworks,
          type: mimeType,
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
      } else if (type === 'html') {
        const { createInteractive3dHtml } = await import('../export/interactive3dExport.js');
        blob = await createInteractive3dHtml({ boxModel, artworks: exportArtworks, documentRef });
        suggestedName = 'carton-3d.html';
        types = [{
          description: 'Interactive 3D HTML (*.html)',
          accept: { 'text/html': ['.html'] },
        }];
        fallback = 'exportPdfFailed';
      } else {
        return false;
      }

      await saveOrDownloadFile({ blob, suggestedName, types, windowRef, documentRef });
      return true;
    } catch (error) {
      console.error(error);
      showError(error, fallback);
      return false;
    }
  }

  function restoreProject({ snapshot, artworkBlobs = [] }) {
    boxApp.loadState(snapshot.box);
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
        originalBlob: blobs.originalBlob || null,
        previewBlob: blobs.previewBlob || null,
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
  windowRef.addEventListener('resize', () => renderer.render());
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
      restoreProject(validated);
      onProjectLoaded(validated.snapshot);
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

  render();

  return {
    get artwork() { return artwork; },
    renderer,
    history,
    layers,
    layerLocks,
    render,
    fitToScreen: () => renderer.fitToScreen(),
    createSnapshot,
    saveProjectArchive,
    persistWorkflowStep,
    scheduleSave,
    flushPendingSave,
    dispose,
    restoreAutosave,
    get originalBlob() { return originalBlob; },
    get previewBlob() { return previewBlob; },
    getArtworks,
    getArtworksJson,
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
