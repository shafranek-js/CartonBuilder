import { t } from '../i18n.js';
import { resolveArtworkDpi } from '../artwork/artworkRasterizer.js';
import { BoxScene } from './BoxScene.js';
import { composeArtworkTexture } from './textureComposer.js';
import {
  getCenteredPreviewViewportRect,
  getPreviewExportViewportInfo,
} from './previewExportViewport.js';
import { readSceneSettings, sanitizeSceneSettings, writeSceneSettings, SCENE_FIELDS } from './sceneSettings.js';
import {
  deleteScenePreset,
  getUserScenePresets,
  saveScenePreset,
} from './ScenePresetStore.js';

const DEFAULT_STATE = Object.freeze({
  active: false,
  foldProgress: 1,
  selectedPanelId: null,
  cameraProjection: 'perspective',
  cameraPreset: 'isometric',
  cameraFov: 35,
  scenePreset: 'studio',
  environment: 'studio',
  environmentIntensity: 0.65,
  lightAzimuth: 63,
  lightElevation: 48,
  lightIntensity: 2.6,
  hemisphereIntensity: 1.7,
  shadowEnabled: true,
  shadowMapSize: 1024,
  shadowBlur: 1.5,
  shadowIntensity: 0.25,
  backgroundColor: null,
});

const PRESET_BACKGROUNDS = Object.freeze({
  technical: '#f2f3f3',
  studio: '#e8eaeb',
  photorealistic: '#d9dcde',
});

const ENVIRONMENT_OPTIONS = Object.freeze(['none', 'studio', 'neutral', 'warm', 'cool', 'bright', 'night']);

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

function getPreviewTextureDpi(boxModel, artworks, canvas) {
  const bounds = boxModel.getBounds();
  const width = Math.max(1, canvas?.clientWidth || canvas?.width || 1);
  const height = Math.max(1, canvas?.clientHeight || canvas?.height || 1);
  const requiredDpi = Math.max(
    150,
    Math.min(600, Math.max(width / bounds.width, height / bounds.height) * 25.4 * 1.25),
  );
  return Math.max(
    150,
    ...(artworks || []).map((entry) => resolveArtworkDpi(entry?.model?.quality?.preview, {
      purpose: 'preview',
      requiredDpi,
    })),
  );
}

export function createPreview3DApp({
  boxModel,
  artwork,
  getArtworks,
  getArtworksJson,
  getRenderState = () => null,
  setHtmlExportQuality = () => false,
  documentRef = document,
  windowRef = window,
  onModeChange = () => {},
}) {
  const elements = {
    panel3d: documentRef.getElementById('preview3dPanel'),
    canvas: documentRef.getElementById('preview3dCanvas'),
    exportViewportOverlay: documentRef.getElementById('previewExportViewportOverlay'),
    exportViewportFrame: documentRef.getElementById('previewExportViewportFrame'),
    exportViewportLabel: documentRef.getElementById('previewExportViewportLabel'),
    exportHtmlQuality: documentRef.getElementById('previewExportHtmlQuality'),
    exportPresentationSummary: documentRef.getElementById('previewExportPresentationSummary'),
    exportFlatSummary: documentRef.getElementById('previewExportFlatSummary'),
    exportHtmlSummary: documentRef.getElementById('previewExportHtmlSummary'),
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
    lightAzimuth: documentRef.getElementById('lightAzimuth'),
    lightAzimuthValue: documentRef.getElementById('lightAzimuthValue'),
    lightElevation: documentRef.getElementById('lightElevation'),
    lightElevationValue: documentRef.getElementById('lightElevationValue'),
    lightIntensity: documentRef.getElementById('lightIntensity'),
    lightIntensityValue: documentRef.getElementById('lightIntensityValue'),
    shadowBlur: documentRef.getElementById('shadowBlur'),
    shadowBlurValue: documentRef.getElementById('shadowBlurValue'),
    shadowIntensity: documentRef.getElementById('shadowIntensity'),
    shadowIntensityValue: documentRef.getElementById('shadowIntensityValue'),
    cameraPreset: documentRef.getElementById('cameraPreset'),
    cameraFov: documentRef.getElementById('cameraFov'),
    cameraFovValue: documentRef.getElementById('cameraFovValue'),
    environment: documentRef.getElementById('environment'),
    environmentIntensity: documentRef.getElementById('environmentIntensity'),
    environmentIntensityValue: documentRef.getElementById('environmentIntensityValue'),
    hemisphereIntensity: documentRef.getElementById('hemisphereIntensity'),
    hemisphereIntensityValue: documentRef.getElementById('hemisphereIntensityValue'),
    shadowEnabled: documentRef.getElementById('shadowEnabled'),
    shadowMapSize: documentRef.getElementById('shadowMapSize'),
    backgroundColor: documentRef.getElementById('backgroundColor'),
    scenePresetSelect: documentRef.getElementById('scenePresetSelect'),
    applyScenePresetBtn: documentRef.getElementById('applyScenePresetBtn'),
    saveScenePresetBtn: documentRef.getElementById('saveScenePresetBtn'),
    deleteScenePresetBtn: documentRef.getElementById('deleteScenePresetBtn'),
    scenePresetStatus: documentRef.getElementById('scenePresetStatus'),
  };

  let state = cloneState(readSceneSettings(DEFAULT_STATE, windowRef.localStorage));
  let scene = null;
  let disposed = false;
  let structureSignature = '';
  let artworkSignature = '';
  let syncController = null;
  let syncGeneration = 0;
  let animationFrame = null;
  let lastRecoveryKey = '';
  let persistTimer = null;
  const listeners = [];

  function schedulePersist() {
    windowRef.clearTimeout(persistTimer);
    persistTimer = windowRef.setTimeout(() => {
      writeSceneSettings(state, windowRef.localStorage);
    }, 250);
  }

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

  function updateExportViewport() {
    const info = getPreviewExportViewportInfo({
      boxModel,
      artworks: getArtworks?.() || [],
      renderSettings: getRenderState?.(),
    });
    const presentationSummary = t('previewExportPresentationSummary', {
      width: info.render.width,
      height: info.render.height,
      aspect: info.render.aspectLabel,
      longEdge: info.render.longEdge,
    });
    const flatSummary = t('previewExportFlatSummary', {
      width: info.flat.width,
      height: info.flat.height,
      dpi: info.flat.dpi,
      widthMm: info.flat.widthMm,
      heightMm: info.flat.heightMm,
    });
    if (elements.exportPresentationSummary) {
      elements.exportPresentationSummary.textContent = presentationSummary;
    }
    if (elements.exportFlatSummary) elements.exportFlatSummary.textContent = flatSummary;
    const htmlQualityLabel = info.html.quality === 'auto'
      ? t('qualityAuto')
      : `${info.html.quality} DPI`;
    if (elements.exportHtmlQuality) elements.exportHtmlQuality.value = String(info.html.quality);
    if (elements.exportHtmlSummary) {
      elements.exportHtmlSummary.textContent = t('previewExportHtmlSummary', {
        quality: htmlQualityLabel,
      });
    }
    if (elements.exportViewportLabel) {
      elements.exportViewportLabel.textContent = t('previewExportViewportLabel', {
        width: info.render.width,
        height: info.render.height,
      });
    }
    if (!elements.exportViewportOverlay || !elements.exportViewportFrame) return;

    const rect = getCenteredPreviewViewportRect(
      elements.exportViewportOverlay.clientWidth,
      elements.exportViewportOverlay.clientHeight,
      info.render.aspect,
    );
    elements.exportViewportFrame.style.width = `${rect.width}px`;
    elements.exportViewportFrame.style.height = `${rect.height}px`;
    elements.exportViewportFrame.style.left = `${rect.left}px`;
    elements.exportViewportFrame.style.top = `${rect.top}px`;
  }

  function updateModeDom() {
    onModeChange(state.active);
  }

  function setRangeProgress(element, value) {
    const min = Number(element.min) || 0;
    const max = Number(element.max) || 1;
    element.style.setProperty('--slider-progress', `${((Number(value) - min) / (max - min)) * 100}%`);
  }

  function updateControls() {
    elements.foldSlider.value = String(state.foldProgress);
    setRangeProgress(elements.foldSlider, state.foldProgress);
    elements.foldValue.value = `${Math.round(state.foldProgress * 100)}%`;
    elements.camera.value = state.cameraProjection;
    elements.preset.value = state.scenePreset;
    elements.lightAzimuth.value = String(state.lightAzimuth);
    setRangeProgress(elements.lightAzimuth, state.lightAzimuth);
    elements.lightAzimuthValue.value = `${Math.round(state.lightAzimuth)}°`;
    elements.lightElevation.value = String(state.lightElevation);
    setRangeProgress(elements.lightElevation, state.lightElevation);
    elements.lightElevationValue.value = `${Math.round(state.lightElevation)}°`;
    elements.lightIntensity.value = String(state.lightIntensity);
    setRangeProgress(elements.lightIntensity, state.lightIntensity);
    elements.lightIntensityValue.value = state.lightIntensity.toFixed(1);
    elements.shadowBlur.value = String(state.shadowBlur);
    setRangeProgress(elements.shadowBlur, state.shadowBlur);
    elements.shadowBlurValue.value = state.shadowBlur.toFixed(1);
    elements.shadowIntensity.value = String(state.shadowIntensity);
    setRangeProgress(elements.shadowIntensity, state.shadowIntensity);
    elements.shadowIntensityValue.value = state.shadowIntensity.toFixed(2);
    elements.cameraPreset.value = state.cameraPreset;
    elements.cameraFov.value = String(state.cameraFov);
    setRangeProgress(elements.cameraFov, state.cameraFov);
    elements.cameraFovValue.value = `${Math.round(state.cameraFov)}°`;
    elements.environment.value = state.environment;
    elements.environmentIntensity.value = String(state.environmentIntensity);
    setRangeProgress(elements.environmentIntensity, state.environmentIntensity);
    elements.environmentIntensityValue.value = state.environmentIntensity.toFixed(2);
    elements.hemisphereIntensity.value = String(state.hemisphereIntensity);
    setRangeProgress(elements.hemisphereIntensity, state.hemisphereIntensity);
    elements.hemisphereIntensityValue.value = state.hemisphereIntensity.toFixed(1);
    elements.shadowEnabled.checked = state.shadowEnabled;
    elements.shadowMapSize.value = String(state.shadowMapSize);
    elements.backgroundColor.value = state.backgroundColor
      || PRESET_BACKGROUNDS[state.scenePreset]
      || '#e8eaeb';
    updateInspector();
    updateSummary();
    updateExportViewport();
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
      artwork: getArtworksJson ? getArtworksJson() : JSON.stringify(artwork.toJSON()),
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
      || signatures.artwork !== artworkSignature;
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
      const artworks = getArtworks ? getArtworks() : [];
      const targetDpi = getPreviewTextureDpi(boxModel, artworks, elements.canvas);
      const composed = await composeArtworkTexture({
        boxModel,
        artworks,
        documentRef,
        purpose: 'preview',
        targetDpi,
        getEntryTargetDpi: (entry) => resolveArtworkDpi(entry?.model?.quality?.preview, {
          purpose: 'preview',
          requiredDpi: targetDpi,
        }),
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
          lightAzimuth: state.lightAzimuth,
          lightElevation: state.lightElevation,
          shadowBlur: state.shadowBlur,
          shadowIntensity: state.shadowIntensity,
          shadowEnabled: state.shadowEnabled,
          shadowMapSize: state.shadowMapSize,
          hemisphereIntensity: state.hemisphereIntensity,
          environmentPreset: state.environment,
          environmentIntensity: state.environmentIntensity,
          cameraPreset: state.cameraPreset,
          cameraFov: state.cameraFov,
          backgroundColor: state.backgroundColor || undefined,
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
    elements.foldSlider.style.setProperty('--slider-progress', `${state.foldProgress * 100}%`);
    elements.foldValue.value = `${Math.round(state.foldProgress * 100)}%`;
    if (announce) schedulePersist();
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
    artworkSignature = '';
    updateModeDom();
    updateControls();
    const result = await syncScene();
    windowRef.requestAnimationFrame?.(updateExportViewport);
    return result;
  }

  function deactivate() {
    if (disposed) return;
    cancelAnimation();
    cancelSync();
    setBusy(false);
    state.active = false;
    updateModeDom();
  }

  function refreshArtwork() {
    if (state.active) return syncScene({ force: true });
    return Promise.resolve(false);
  }

  function suspend() {
    cancelAnimation();
    cancelSync();
    setBusy(false);
    // A step transition can occur in the same task as a range-input event.
    // Reconcile the DOM value before pausing so Preview never loses the last
    // technical fold position when Render is opened immediately afterwards.
    const sliderValue = Number(elements.foldSlider?.value);
    if (Number.isFinite(sliderValue) && Math.abs(sliderValue - state.foldProgress) > 1e-6) {
      applyFoldProgress(sliderValue);
    }
  }

  function setCameraProjection(value) {
    if (!['perspective', 'orthographic'].includes(value)) return;
    state.cameraProjection = value;
    elements.camera.value = value;
    scene?.setCameraProjection(value);
    schedulePersist();
    updateSummary({ announce: true });
  }

  function setScenePreset(value) {
    if (!['technical', 'studio', 'photorealistic'].includes(value)) return;
    state.scenePreset = value;
    elements.preset.value = value;
    scene?.setScenePreset(value);
    if (state.backgroundColor) scene?.setBackgroundColor(state.backgroundColor);
    schedulePersist();
    updateControls();
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

  function applySceneSettings(settings) {
    state = cloneState(sanitizeSceneSettings(settings, DEFAULT_STATE));
    scene?.setScenePreset(state.scenePreset);
    scene?.setCameraProjection(state.cameraProjection);
    scene?.setCameraPreset(state.cameraPreset);
    scene?.setFov(state.cameraFov);
    scene?.setEnvironment(state.environment);
    scene?.setEnvironmentIntensity(state.environmentIntensity);
    scene?.setLightDirection(state.lightAzimuth, state.lightElevation);
    scene?.setLightIntensity(state.lightIntensity);
    scene?.setHemisphereIntensity(state.hemisphereIntensity);
    scene?.setShadowsEnabled(state.shadowEnabled);
    scene?.setShadowMapSize(state.shadowMapSize);
    scene?.setShadowBlur(state.shadowBlur);
    scene?.setShadowIntensity(state.shadowIntensity);
    if (state.backgroundColor) scene?.setBackgroundColor(state.backgroundColor);
    scene?.applyFold(state.foldProgress);
    schedulePersist();
    updateControls();
  }

  let scenePresets = [];

  async function refreshScenePresets(selectId = null) {
    scenePresets = await getUserScenePresets();
    elements.scenePresetSelect.replaceChildren();
    const placeholder = documentRef.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '—';
    elements.scenePresetSelect.appendChild(placeholder);
    for (const preset of scenePresets) {
      const option = documentRef.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      elements.scenePresetSelect.appendChild(option);
    }
    if (selectId) elements.scenePresetSelect.value = selectId;
    const hasSelection = Boolean(elements.scenePresetSelect.value);
    elements.applyScenePresetBtn.disabled = !hasSelection;
    elements.deleteScenePresetBtn.disabled = !hasSelection;
  }

  function selectedScenePreset() {
    return scenePresets.find((preset) => preset.id === elements.scenePresetSelect.value) || null;
  }

  async function handleSaveScenePreset() {
    const name = windowRef.prompt(t('scenePresetNamePrompt'), '');
    if (name === null) return;
    const settings = {};
    for (const key of SCENE_FIELDS) settings[key] = state[key];
    const saved = await saveScenePreset({ name, settings });
    await refreshScenePresets(saved.id);
    elements.scenePresetStatus.textContent = t('scenePresetSaved');
  }

  async function handleApplyScenePreset() {
    const preset = selectedScenePreset();
    if (!preset) return;
    applySceneSettings(preset.settings);
    elements.scenePresetStatus.textContent = t('scenePresetApplied');
  }

  async function handleDeleteScenePreset() {
    const preset = selectedScenePreset();
    if (!preset) return;
    if (!windowRef.confirm(`Delete scene preset "${preset.name}"?`)) return;
    await deleteScenePreset(preset.id);
    await refreshScenePresets();
    elements.scenePresetStatus.textContent = t('scenePresetDeleted');
  }

  function resetForProject() {
    cancelAnimation();
    cancelSync();
    scene?.dispose();
    scene = null;
    state = cloneState(readSceneSettings(DEFAULT_STATE, windowRef.localStorage));
    structureSignature = '';
    artworkSignature = '';
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
  listen(elements.exportHtmlQuality, 'change', (event) => {
    setHtmlExportQuality(event.target.value);
    updateExportViewport();
  });
  listen(windowRef, 'resize', updateExportViewport);

  function updateLightDirection() {
    scene?.setLightDirection(state.lightAzimuth, state.lightElevation);
    schedulePersist();
    updateControls();
  }
  listen(elements.lightAzimuth, 'input', (event) => {
    state.lightAzimuth = Number(event.target.value);
    updateLightDirection();
  });
  listen(elements.lightElevation, 'input', (event) => {
    state.lightElevation = Number(event.target.value);
    updateLightDirection();
  });
  listen(elements.lightIntensity, 'input', (event) => {
    state.lightIntensity = Number(event.target.value);
    scene?.setLightIntensity(state.lightIntensity);
    schedulePersist();
    updateControls();
  });
  listen(elements.shadowBlur, 'input', (event) => {
    state.shadowBlur = Number(event.target.value);
    scene?.setShadowBlur(state.shadowBlur);
    schedulePersist();
    updateControls();
  });
  listen(elements.shadowIntensity, 'input', (event) => {
    state.shadowIntensity = Number(event.target.value);
    scene?.setShadowIntensity(state.shadowIntensity);
    schedulePersist();
    updateControls();
  });
  listen(elements.cameraPreset, 'change', (event) => {
    state.cameraPreset = event.target.value;
    scene?.setCameraPreset(state.cameraPreset);
    schedulePersist();
    updateControls();
  });
  listen(elements.cameraFov, 'input', (event) => {
    state.cameraFov = Number(event.target.value);
    scene?.setFov(state.cameraFov);
    schedulePersist();
    updateControls();
  });
  listen(elements.environment, 'change', (event) => {
    state.environment = event.target.value;
    scene?.setEnvironment(state.environment);
    schedulePersist();
    updateControls();
  });
  listen(elements.environmentIntensity, 'input', (event) => {
    state.environmentIntensity = Number(event.target.value);
    scene?.setEnvironmentIntensity(state.environmentIntensity);
    schedulePersist();
    updateControls();
  });
  listen(elements.hemisphereIntensity, 'input', (event) => {
    state.hemisphereIntensity = Number(event.target.value);
    scene?.setHemisphereIntensity(state.hemisphereIntensity);
    schedulePersist();
    updateControls();
  });
  listen(elements.shadowEnabled, 'change', (event) => {
    state.shadowEnabled = event.target.checked;
    scene?.setShadowsEnabled(state.shadowEnabled);
    schedulePersist();
    updateControls();
  });
  listen(elements.shadowMapSize, 'change', (event) => {
    state.shadowMapSize = Number(event.target.value);
    scene?.setShadowMapSize(state.shadowMapSize);
    schedulePersist();
    updateControls();
  });
  listen(elements.backgroundColor, 'input', (event) => {
    state.backgroundColor = event.target.value;
    scene?.setBackgroundColor(state.backgroundColor);
    schedulePersist();
    updateControls();
  });

  listen(documentRef, 'carton-locale-changed', () => {
    updateControls();
    if (lastRecoveryKey) showRecovery(lastRecoveryKey);
  });

  listen(elements.scenePresetSelect, 'change', () => {
    const hasSelection = Boolean(elements.scenePresetSelect.value);
    elements.applyScenePresetBtn.disabled = !hasSelection;
    elements.deleteScenePresetBtn.disabled = !hasSelection;
  });
  listen(elements.saveScenePresetBtn, 'click', handleSaveScenePreset);
  listen(elements.applyScenePresetBtn, 'click', handleApplyScenePreset);
  listen(elements.deleteScenePresetBtn, 'click', handleDeleteScenePreset);

  updateModeDom();
  updateControls();
  refreshScenePresets();

  return {    activate,
    deactivate,
    refreshArtwork,
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
    getExportViewportInfo: () => getPreviewExportViewportInfo({
      boxModel,
      artworks: getArtworks?.() || [],
      renderSettings: getRenderState?.(),
    }),
    resetForProject,
    dispose() {
      if (disposed) return;
      disposed = true;
      windowRef.clearTimeout(persistTimer);
      cancelAnimation();
      cancelSync();
      for (const remove of listeners.splice(0)) remove();
      scene?.dispose();
      scene = null;
    },
  };
}
