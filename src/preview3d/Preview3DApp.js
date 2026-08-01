import { t } from '../i18n.js';
import { BoxScene } from './BoxScene.js';
import { composeArtworkTexture } from './textureComposer.js';

const DEFAULT_STATE = Object.freeze({
  active: false,
  foldProgress: 1,
  selectedPanelId: null,
  cameraProjection: 'perspective',
  cameraPreset: 'isometric',
  scenePreset: 'studio',
});

const PANEL_KEYS = Object.freeze({
  front: 'frontPanel3d',
  back: 'backPanel3d',
  left: 'leftPanel3d',
  right: 'rightPanel3d',
  top: 'topPanel3d',
  bottom: 'basePanel3d',
});

const ANIMATION_DURATION = 400;

function cloneState(state) {
  return { ...state };
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - ((-2 * value + 2) ** 3) / 2;
}

function roundDimension(value) {
  return Number(value.toFixed(2)).toString();
}

export function createPreview3DApp({
  boxModel,
  artwork,
  getPreviewBlob,
  documentRef = document,
  windowRef = window,
  onModeChange = () => {},
}) {
  const elements = {
    panel3d: documentRef.getElementById('preview3dPanel'),
    canvas: documentRef.getElementById('preview3dCanvas'),
    foldSlider: documentRef.getElementById('foldProgress'),
    foldValue: documentRef.getElementById('foldProgressValue'),
    open: documentRef.getElementById('open3dButton'),
    fold: documentRef.getElementById('fold3dButton'),
    reset: documentRef.getElementById('reset3dViewButton'),
    camera: documentRef.getElementById('cameraProjection'),
    preset: documentRef.getElementById('scenePreset'),
    inspector: documentRef.getElementById('preview3dInspector'),
    inspectorName: documentRef.getElementById('preview3dPanelName'),
    inspectorDimensions: documentRef.getElementById('preview3dPanelDimensions'),
    summary: documentRef.getElementById('preview3dSummary'),
    busy: documentRef.getElementById('preview3dBusy'),
    recovery: documentRef.getElementById('preview3dRecovery'),
    recoveryMessage: documentRef.getElementById('preview3dRecoveryMessage'),
    retry: documentRef.getElementById('retry3dButton'),
  };

  let state = cloneState(DEFAULT_STATE);
  let scene = null;
  let disposed = false;
  let structureSignature = '';
  let artworkSignature = '';
  let currentPreviewBlob = null;
  let syncController = null;
  let syncGeneration = 0;
  let animationFrame = null;
  let lastRecoveryKey = '';
  const listeners = [];

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }

  function panelName(panelId) {
    return panelId ? t(PANEL_KEYS[panelId] || panelId) : t('noPanelSelected3d');
  }

  function updateInspector() {
    const panel = state.selectedPanelId
      ? boxModel.getPanel(state.selectedPanelId)
      : null;
    elements.inspector.hidden = !panel;
    elements.inspectorName.textContent = panelName(panel?.id);
    elements.inspectorDimensions.textContent = panel
      ? t('panelDimensions3d', {
        width: roundDimension(panel.width),
        height: roundDimension(panel.height),
      })
      : '';
  }

  function updateSummary({ announce = false } = {}) {
    const message = t('preview3dSummary', {
      fold: Math.round(state.foldProgress * 100),
      panel: panelName(state.selectedPanelId),
      camera: t(state.cameraProjection === 'orthographic'
        ? 'orthographicCamera3d'
        : 'perspectiveCamera3d'),
      preset: t(`${state.scenePreset}Preset3d`),
    });
    elements.summary.textContent = message;
    if (announce) {
      elements.summary.removeAttribute('aria-hidden');
    }
  }

  function updateModeDom() {
    onModeChange(state.active);
  }

  function updateControls() {
    elements.foldSlider.value = String(state.foldProgress);
    elements.foldValue.value = `${Math.round(state.foldProgress * 100)}%`;
    elements.camera.value = state.cameraProjection;
    elements.preset.value = state.scenePreset;
    updateInspector();
    updateSummary();
  }

  function setBusy(value) {
    elements.panel3d.setAttribute('aria-busy', String(value));
    elements.busy.hidden = !value;
  }
  function hideRecovery() {
    elements.recovery.hidden = true;
    lastRecoveryKey = '';
  }

  function showRecovery(key = 'webglUnavailable3d') {
    lastRecoveryKey = key;
    elements.recoveryMessage.textContent = t(key);
    elements.recovery.hidden = false;
    setBusy(false);
    elements.summary.textContent = t(key);
  }

  function getSignatures() {
    return {
      structure: JSON.stringify(boxModel.toJSON()),
      artwork: JSON.stringify(artwork.toJSON()),
      previewBlob: getPreviewBlob(),
    };
  }

  function cancelSync() {
    syncGeneration += 1;
    syncController?.abort();
    syncController = null;
  }

  async function syncScene({ force = false } = {}) {
    if (disposed || !state.active) return false;
    const signatures = getSignatures();
    const structureChanged = force || !scene || signatures.structure !== structureSignature;
    const artworkChanged = force
      || !scene
      || signatures.artwork !== artworkSignature
      || signatures.previewBlob !== currentPreviewBlob;
    if (!structureChanged && !artworkChanged) {
      scene.render();
      return true;
    }

    cancelSync();
    const generation = syncGeneration;
    const controller = new AbortController();
    syncController = controller;
    setBusy(true);
    hideRecovery();

    try {
      const composed = await composeArtworkTexture({
        boxModel,
        artwork,
        previewBlob: signatures.previewBlob,
        documentRef,
        signal: controller.signal,
      });
      if (disposed || generation !== syncGeneration || controller.signal.aborted) return false;

      if (structureChanged) {
        scene?.dispose();
        scene = new BoxScene({
          canvas: elements.canvas,
          container: elements.panel3d,
          boxModel,
          textureCanvas: composed.canvas,
          foldProgress: state.foldProgress,
          cameraProjection: state.cameraProjection,
          scenePreset: state.scenePreset,
          selectedPanelId: state.selectedPanelId,
          windowRef,
          onSelection: (panelId) => {
            state.selectedPanelId = panelId;
            updateControls();
          },
          onContextLost: () => showRecovery('webglContextLost3d'),
          onContextRestored: () => {
            elements.summary.textContent = t('webglContextRestored3d');
            syncScene({ force: true });
          },
        });
      } else {
        scene.replaceTexture(composed.canvas);
      }
      structureSignature = signatures.structure;
      artworkSignature = signatures.artwork;
      currentPreviewBlob = signatures.previewBlob;
      hideRecovery();
      setBusy(false);
      updateControls();
      scene.render();
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      console.error('Could not initialize 3D preview', error);
      showRecovery('webglUnavailable3d');
      return false;
    } finally {
      if (generation === syncGeneration) {
        syncController = null;
        setBusy(false);
      }
    }
  }

  function cancelAnimation() {
    if (animationFrame != null) windowRef.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function applyFoldProgress(value, { announce = false } = {}) {
    state.foldProgress = Math.min(1, Math.max(0, Number(value) || 0));
    scene?.applyFold(state.foldProgress);
    elements.foldSlider.value = String(state.foldProgress);
    elements.foldValue.value = `${Math.round(state.foldProgress * 100)}%`;
    updateSummary({ announce });
  }

  function setFoldProgress(value) {
    cancelAnimation();
    applyFoldProgress(value, { announce: true });
  }

  function animateFold(target) {
    cancelAnimation();
    const destination = Math.min(1, Math.max(0, Number(target) || 0));
    const reducedMotion = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || Math.abs(destination - state.foldProgress) < 1e-6) {
      applyFoldProgress(destination, { announce: true });
      scene?.resetView();
      return;
    }
    const startValue = state.foldProgress;
    const startTime = windowRef.performance.now();
    const tick = (now) => {
      const elapsed = Math.min(1, (now - startTime) / ANIMATION_DURATION);
      applyFoldProgress(
        startValue + (destination - startValue) * easeInOutCubic(elapsed),
      );
      if (elapsed < 1) {
        animationFrame = windowRef.requestAnimationFrame(tick);
      } else {
        animationFrame = null;
        applyFoldProgress(destination, { announce: true });
        scene?.resetView();
      }
    };
    animationFrame = windowRef.requestAnimationFrame(tick);
  }

  async function activate() {
    if (disposed) return false;
    state.active = true;
    updateModeDom();
    updateControls();
    return syncScene();
  }

  function deactivate() {
    if (disposed) return;
    cancelAnimation();
    cancelSync();
    setBusy(false);
    state.active = false;
    updateModeDom();
  }

  function suspend() {
    cancelAnimation();
    cancelSync();
    setBusy(false);
  }

  function setCameraProjection(value) {
    if (!['perspective', 'orthographic'].includes(value)) return;
    state.cameraProjection = value;
    elements.camera.value = value;
    scene?.setCameraProjection(value);
    updateSummary({ announce: true });
  }

  function setScenePreset(value) {
    if (!['technical', 'studio', 'photorealistic'].includes(value)) return;
    state.scenePreset = value;
    elements.preset.value = value;
    scene?.setScenePreset(value);
    updateSummary({ announce: true });
  }

  function selectPanel(panelId) {
    const next = boxModel.getPanel(panelId)?.id || null;
    state.selectedPanelId = next;
    scene?.setSelectedPanel(next, { notify: false });
    updateControls();
  }

  function resetView() {
    scene?.resetView();
    elements.summary.textContent = t('viewReset3d');
  }

  function resetForProject() {
    cancelAnimation();
    cancelSync();
    scene?.dispose();
    scene = null;
    state = cloneState(DEFAULT_STATE);
    structureSignature = '';
    artworkSignature = '';
    currentPreviewBlob = null;
    hideRecovery();
    setBusy(false);
    updateModeDom();
    updateControls();
  }

  listen(elements.open, 'click', () => animateFold(0));
  listen(elements.fold, 'click', () => animateFold(1));
  listen(elements.reset, 'click', resetView);
  listen(elements.foldSlider, 'input', (event) => setFoldProgress(event.target.value));
  listen(elements.foldSlider, 'change', () => scene?.resetView());
  listen(elements.camera, 'change', (event) => setCameraProjection(event.target.value));
  listen(elements.preset, 'change', (event) => setScenePreset(event.target.value));
  listen(elements.retry, 'click', () => syncScene({ force: true }));
  listen(elements.canvas, 'keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    selectPanel(null);
  });
  listen(documentRef, 'carton-locale-changed', () => {
    updateControls();
    if (lastRecoveryKey) showRecovery(lastRecoveryKey);
  });

  updateModeDom();
  updateControls();

  return {    activate,
    deactivate,
    suspend,
    setFoldProgress,
    setCameraProjection,
    setScenePreset,
    selectPanel,
    resetView,
    render() {
      if (state.active) syncScene();
      else scene?.render();
    },
    getState: () => cloneState(state),
    getResourceInfo: () => scene?.getResourceInfo() || {
      panels: 0,
      geometries: 0,
      textures: 0,
      calls: 0,
    },
    resetForProject,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimation();
      cancelSync();
      for (const remove of listeners.splice(0)) remove();
      scene?.dispose();
      scene = null;
    },
  };
}
