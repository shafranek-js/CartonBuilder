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
import { ArtworkModel } from './ArtworkModel.js';
import { ArtworkRenderer } from './ArtworkRenderer.js';
import { HistoryManager } from './HistoryManager.js';
import { ViewportModel } from './ViewportModel.js';
import { loadArtworkFile } from './fileLoader.js';

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
  const artwork = new ArtworkModel();
  const viewport = new ViewportModel();
  const layers = {
    artwork: true,
    dieline: true,
    names: true,
    highlights: true,
    showFull: false,
  };
  const layerLocks = {
    artwork: false,
    dieline: true,
    names: true,
    highlights: true,
  };
  const svg = documentRef.getElementById('artworkWorkspace');
  const previewSvg = documentRef.getElementById('previewWorkspace');
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
  };

  const layerControls = {
    artwork: documentRef.getElementById('layerArtwork'),
    dieline: documentRef.getElementById('layerDieline'),
    names: documentRef.getElementById('layerNames'),
    highlights: documentRef.getElementById('layerHighlights'),
    showFull: documentRef.getElementById('showFullArtwork'),
  };
  const layerLockControls = {
    artwork: documentRef.getElementById('lockArtwork'),
    dieline: documentRef.getElementById('lockDieline'),
    names: documentRef.getElementById('lockNames'),
    highlights: documentRef.getElementById('lockHighlights'),
  };

  let originalBlob = null;
  let previewBlob = null;
  let selected = false;
  let gesture = null;
  let spacePressed = false;
  let saveTimer = null;
  let toastTimer = null;
  let wheelBefore = null;
  let wheelTimer = null;
  let processingGeneration = 0;
  let processingController = null;
  let projectCreatedAt = new Date().toISOString();
  let errorRetry = null;
  let currentError = null;
  let currentErrorFallback = 'unexpectedError';
  let saveQueue = Promise.resolve();
  let disposed = false;

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
      artwork: artwork.toJSON(),
      layers: { ...layers },
      layerLocks: { ...layerLocks },
    };
  }

  function applyEditorState(state) {
    artwork.restore(state.artwork);
    Object.assign(layers, state.layers);
    Object.assign(layerLocks, state.layerLocks);
    render();
    scheduleSave();
  }

  const history = new HistoryManager({ apply: applyEditorState, limit: 100 });

  const renderer = new ArtworkRenderer({
    svg,
    previewSvg,
    model: boxModel,
    artwork,
    viewport,
    layers,
    onPointerStart: startArtworkGesture,
  });

  function persistedWorkflowStep(value = getWorkflowStep()) {
    if (value === 'preview') return 'preview';
    if (value === 'artwork') return 'artwork';
    return 'box';
  }

  function createSnapshot(workflowStep = persistedWorkflowStep()) {
    return {
      schemaVersion: 1,
      meta: {
        id: 'current',
        name: artwork.source?.fileName || 'Untitled carton',
        createdAt: projectCreatedAt,
        updatedAt: new Date().toISOString(),
        locale: documentRef.documentElement.lang || 'en',
      },
      workflowStep,
      box: boxModel.toJSON(),
      artwork: artwork.hasArtwork ? artwork.toJSON() : null,
      view: {
        ...viewport.toJSON(),
        layers: { ...layers },
        layerLocks: { ...layerLocks },
      },
      history: history.toJSON(),
    };
  }

  function enqueueSave(workflowStep = persistedWorkflowStep()) {
    const hasCompleteArtwork = artwork.hasArtwork && originalBlob && previewBlob;
    const payload = {
      snapshot: createSnapshot(persistedWorkflowStep(workflowStep)),
      originalBlob: hasCompleteArtwork ? originalBlob : null,
      previewBlob: hasCompleteArtwork ? previewBlob : null,
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
    const transformEnabled = enabled && !layerLocks.artwork;
    controls.fileName.textContent = artwork.source?.fileName || t('noFile');
    controls.x.value = enabled ? round(artwork.centerXmm) : '';
    controls.y.value = enabled ? round(artwork.centerYmm) : '';
    controls.width.value = enabled ? round(artwork.displayedWidthMm) : '';
    controls.height.value = enabled ? round(artwork.displayedHeightMm) : '';
    controls.scale.value = enabled ? round(artwork.scale * 100) : '';
    controls.opacity.value = enabled ? Math.round(artwork.opacity * 100) : 100;
    controls.opacityValue.value = `${controls.opacity.value}%`;
    controls.bgOpacity.value = enabled ? Math.round(artwork.bgOpacity * 100) : 28;
    controls.bgOpacityValue.value = `${controls.bgOpacity.value}%`;
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
    controls.bgOpacity.disabled = !transformEnabled || layers.showFull;
    controls.replace.disabled = !enabled;
    controls.preview.disabled = !enabled;
    controls.undo.disabled = history.undoStack.length === 0;
    controls.redo.disabled = history.redoStack.length === 0;
    dropState.hidden = enabled;
    renderer.selected = selected && enabled;
  }

  function render() {
    renderControls();
    renderer.render();
  }

  function commitChange(label, before) {
    history.commit(label, before, captureEditorState());
    recordDiagnostic('editor-change', { command: label });
    render();
    scheduleSave();
  }

  function command(label, callback, { fitViewport = false } = {}) {
    if (!artwork.hasArtwork || layerLocks.artwork) return;
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

  async function processFile(file, replacing = false) {
    if (!file) return;
    if (artwork.hasArtwork && !replacing) return;
    const generation = ++processingGeneration;
    processingController?.abort();
    processingController = new AbortController();
    clearError();
    processing.hidden = false;
    canvasWrap.setAttribute('aria-busy', 'true');
    processingText.textContent = t('processing');
    announce(t('processingStarted'));

    try {
      const loaded = await loadArtworkFile(file, {
        choosePage: choosePdfPage,
        signal: processingController.signal,
      });
      if (generation !== processingGeneration) return;
      originalBlob = loaded.originalBlob;
      previewBlob = loaded.previewBlob;
      artwork.load(loaded.source, boxModel.getBounds());
      history.clear();
      selected = true;
      renderer.setPreviewBlob(previewBlob);
      render();
      windowRef.requestAnimationFrame(() => renderer.fitToScreen());
      scheduleSave();
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
    if (!artwork.hasArtwork || layerLocks.artwork || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selected = true;
    const point = renderer.clientToModel(event.clientX, event.clientY);
    gesture = {
      ...detail,
      pointerId: event.pointerId,
      before: captureEditorState(),
      startPoint: point,
      startCenter: { x: artwork.centerXmm, y: artwork.centerYmm },
      startScale: artwork.scale,
      startWidth: artwork.unrotatedWidthMm,
      startHeight: artwork.unrotatedHeightMm,
      rotation: artwork.rotation,
    };
    svg.setPointerCapture(event.pointerId);
    render();
  }

  function updateResizeGesture(event, point) {
    const { sx, sy } = gesture;
    if (event.altKey) {
      const relative = rotateVector({
        x: point.x - gesture.startCenter.x,
        y: point.y - gesture.startCenter.y,
      }, -gesture.rotation);
      const scaleX = Math.abs(relative.x) / (artwork.initialWidthMm / 2);
      const scaleY = Math.abs(relative.y) / (artwork.initialHeightMm / 2);
      artwork.setScale(Math.max(scaleX, scaleY));
      artwork.centerXmm = gesture.startCenter.x;
      artwork.centerYmm = gesture.startCenter.y;
      return;
    }

    const oppositeOffset = rotateVector({
      x: -sx * gesture.startWidth / 2,
      y: -sy * gesture.startHeight / 2,
    }, gesture.rotation);
    const opposite = {
      x: gesture.startCenter.x + oppositeOffset.x,
      y: gesture.startCenter.y + oppositeOffset.y,
    };
    const local = rotateVector({ x: point.x - opposite.x, y: point.y - opposite.y }, -gesture.rotation);
    artwork.setScale(Math.max(
      Math.abs(local.x) / artwork.initialWidthMm,
      Math.abs(local.y) / artwork.initialHeightMm,
    ));
    const centerOffset = rotateVector({
      x: sx * artwork.unrotatedWidthMm / 2,
      y: sy * artwork.unrotatedHeightMm / 2,
    }, gesture.rotation);
    artwork.centerXmm = opposite.x + centerOffset.x;
    artwork.centerYmm = opposite.y + centerOffset.y;
  }

  svg.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = renderer.clientToModel(event.clientX, event.clientY);
    if (gesture.type === 'move') {
      artwork.setCenter(
        gesture.startCenter.x + point.x - gesture.startPoint.x,
        gesture.startCenter.y + point.y - gesture.startPoint.y,
      );
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
  svg.addEventListener('pointerup', finishGesture);
  svg.addEventListener('pointercancel', finishGesture);
  svg.addEventListener('pointerdown', (event) => {
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
    if (event.ctrlKey && artwork.hasArtwork) {
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
    control.addEventListener('input', () => {
      if (!artwork.hasArtwork || layerLocks.artwork) return;
      if (!before) before = captureEditorState();
      apply(Number(control.value));
      render();
    });
    control.addEventListener('change', () => {
      if (!artwork.hasArtwork || layerLocks.artwork) return;
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
  bindNumberControl(controls.x, 'Set artwork X', (value) => artwork.setCenter(value, artwork.centerYmm));
  bindNumberControl(controls.y, 'Set artwork Y', (value) => artwork.setCenter(artwork.centerXmm, value));
  bindNumberControl(controls.width, 'Set artwork width', (value) => artwork.setDisplayedWidth(value));
  bindNumberControl(controls.height, 'Set artwork height', (value) => artwork.setDisplayedHeight(value));
  bindNumberControl(controls.scale, 'Set artwork scale', (value) => artwork.setScale(value / 100));
  bindSliderControl(controls.opacity, 'Set artwork opacity', (value) => artwork.setOpacity(value / 100));
  bindSliderControl(controls.bgOpacity, 'Set background opacity', (value) => artwork.setBgOpacity(value / 100));

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

  controls.choose.addEventListener('click', () => input.click());
  controls.replace.addEventListener('click', () => {
    if (windowRef.confirm(t('replaceConfirm'))) input.click();
  });
  controls.remove.addEventListener('click', () => {
    if (layerLocks.artwork) return;
    if (!windowRef.confirm(t('removeConfirm'))) return;
    artwork.clear();
    history.clear();
    originalBlob = null;
    previewBlob = null;
    renderer.setPreviewBlob(null);
    selected = false;
    render();
    scheduleSave();
  });
  input.addEventListener('change', () => processFile(input.files?.[0], artwork.hasArtwork));

  function dragStatus(event) {
    event.preventDefault();
    if (artwork.hasArtwork) return;
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
    if (artwork.hasArtwork) return;
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length !== 1) {
      showError(new AppError('dropOneFile'), 'artworkLoadFailed', {
        retry: () => input.click(),
      });
      return;
    }
    processFile(files[0], false);
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

  documentRef.getElementById('backToBoxButton').addEventListener('click', onBack);
  controls.preview.addEventListener('click', () => {
    renderer.renderPreview(documentRef.getElementById('previewDieline').checked);
    onPreview(getExportWarnings(boxModel, artwork, t));
  });
  documentRef.getElementById('backToArtworkButton').addEventListener('click', () => {
    selected = true;
    render();
    onBackToEditor();
  });
  documentRef.getElementById('previewDieline').addEventListener('change', (event) => {
    renderer.renderPreview(event.target.checked);
  });

  documentRef.getElementById('saveProjectButton').addEventListener('click', async () => {
    if (!artwork.hasArtwork) {
      showToast(t('loadBeforeSave'));
      return;
    }
    try {
      clearError();
      const blob = await createProjectArchive({
        snapshot: createSnapshot(),
        originalBlob,
        previewBlob,
      });
      downloadBlob(documentRef, windowRef, blob, 'carton-project.carton');
    } catch (error) {
      console.error(error);
      showError(error, 'projectSaveFailed');
    }
  });
  documentRef.getElementById('loadProjectButton')?.addEventListener('click', () => projectInput.click());
  documentRef.getElementById('loadProjectButtonStep1')?.addEventListener('click', () => projectInput.click());
  documentRef.getElementById('diagnosticsButton').addEventListener('click', () => {
    downloadBlob(
      documentRef,
      windowRef,
      createDiagnosticsBlob({
        boxModel,
        artwork,
        workflowStep: documentRef.getElementById('previewStep').hidden ? 'artwork' : 'preview',
        windowRef,
      }),
      'carton-builder-diagnostics.json',
    );
  });
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

  documentRef.getElementById('exportSvgButton').addEventListener('click', () => {
    try {
      clearError();
      downloadBlob(
        documentRef,
        windowRef,
        new Blob([createExportSvg(boxModel)], { type: 'image/svg+xml;charset=utf-8' }),
        getExportFilename(boxModel.dimensions),
      );
    } catch (error) {
      console.error(error);
      showError(error, 'unexpectedError');
    }
  });
  documentRef.getElementById('exportPngButton').addEventListener('click', async () => {
    try {
      clearError();
      const { createPreviewBlob } = await import('../export/artworkExport.js');
      const blob = await createPreviewBlob({
        boxModel,
        artwork,
        originalBlob,
        previewBlob,
        type: 'image/png',
      });
      downloadBlob(documentRef, windowRef, blob, 'carton-artwork-preview.png');
    } catch (error) {
      console.error(error);
      showError(error, 'exportPngFailed');
    }
  });
  documentRef.getElementById('exportJpgButton').addEventListener('click', async () => {
    try {
      clearError();
      const { createPreviewBlob } = await import('../export/artworkExport.js');
      const blob = await createPreviewBlob({
        boxModel,
        artwork,
        originalBlob,
        previewBlob,
        type: 'image/jpeg',
      });
      downloadBlob(documentRef, windowRef, blob, 'carton-artwork-preview.jpg');
    } catch (error) {
      console.error(error);
      showError(error, 'exportJpgFailed');
    }
  });
  documentRef.getElementById('exportPdfButton').addEventListener('click', async () => {
    try {
      clearError();
      const { createPdfExport } = await import('../export/artworkExport.js');
      const blob = await createPdfExport({ boxModel, artwork, originalBlob, previewBlob });
      downloadBlob(documentRef, windowRef, blob, 'carton-artwork.pdf');
    } catch (error) {
      console.error(error);
      showError(error, 'exportPdfFailed');
    }
  });

  function restoreProject({ snapshot, originalBlob: sourceBlob, previewBlob: storedPreview }) {
    boxApp.loadState(snapshot.box);
    projectCreatedAt = snapshot.meta?.createdAt || new Date().toISOString();
    if (snapshot.artwork) {
      artwork.restore(snapshot.artwork);
    } else {
      artwork.clear();
    }
    Object.assign(layers, snapshot.view?.layers || {});
    Object.assign(layerLocks, snapshot.view?.layerLocks || {});
    Object.assign(viewport, {
      zoom: snapshot.view?.zoom || 1,
      panX: snapshot.view?.panX || 0,
      panY: snapshot.view?.panY || 0,
    });
    history.restore(snapshot.history);
    originalBlob = sourceBlob || null;
    previewBlob = storedPreview || null;
    renderer.setPreviewBlob(previewBlob);
    selected = Boolean(artwork.hasArtwork);
    for (const [key, control] of Object.entries(layerControls)) control.checked = layers[key];
    for (const [key, control] of Object.entries(layerLockControls)) control.checked = layerLocks[key];
    render();
    scheduleSave();
  }

  windowRef.addEventListener('keydown', (event) => {
    if (event.key === ' ') spacePressed = true;
    if (!artwork.hasArtwork || documentRef.getElementById('artworkStep').hidden) return;
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
      selected = false;
      render();
      return;
    }
    if (event.key === 'Delete' && !layerLocks.artwork) {
      controls.remove.click();
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
    artwork,
    renderer,
    history,
    layers,
    layerLocks,
    render,
    fitToScreen: () => renderer.fitToScreen(),
    renderPreview: () => renderer.renderPreview(documentRef.getElementById('previewDieline').checked),
    createSnapshot,
    persistWorkflowStep,
    scheduleSave,
    flushPendingSave,
    dispose,
    restoreAutosave,
    get originalBlob() { return originalBlob; },
    get previewBlob() { return previewBlob; },
    hasModifiedArtwork: () => artwork.hasArtwork && artwork.modified,
    resetPlacementForNewDimensions() {
      if (!artwork.hasArtwork) return;
      artwork.fitDieline(boxModel.getBounds(), { setInitial: true });
      history.clear();
      renderer.fitToScreen();
      scheduleSave();
    },
  };
}
