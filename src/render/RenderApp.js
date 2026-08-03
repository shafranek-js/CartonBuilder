import { t } from '../i18n.js';
import { ARTWORK_RENDER_QUALITY_OPTIONS } from '../artwork/ArtworkModel.js';
import { resolveArtworkDpi } from '../artwork/artworkRasterizer.js';
import { saveOrDownloadFile } from '../utils/fileSaver.js';
import { composeArtworkTexture } from '../preview3d/textureComposer.js';
import { buildRenderSceneModel, getRenderArtworkSignature } from './RenderSceneModel.js';
import {
  DEFAULT_RENDER_SETTINGS,
  getRenderOutputDimensions,
  sanitizeRenderSettings,
} from './RenderSettings.js';
import { applyRenderPreset } from './renderPresets.js';
import { renderStill } from './StillRenderService.js';
import { isPathTracingEnabled, PathTracingRenderService } from './PathTracingRenderService.js';
import {
  cloneBoardAppearance,
  sanitizeBoardAppearance,
} from './BoardAppearance.js';
import {
  readRenderSettings,
  writeRenderSettings,
} from './renderSettingsStorage.js';
import {
  deleteRenderPreset,
  getActiveRenderPresetId,
  getRenderPresets,
  saveRenderPreset,
  setActiveRenderPresetId,
} from './RenderPresetStore.js';

let rendererModulePromise = null;

async function loadRendererModule() {
  rendererModulePromise ||= import('./WebGLCartonRenderer.js');
  return rendererModulePromise;
}

function clone(value) {
  return structuredClone(value);
}

function getStorage(windowRef) {
  try {
    return windowRef?.localStorage || null;
  } catch {
    return null;
  }
}

function setRangeProgress(element, value) {
  if (!element) return;
  const min = Number(element.min) || 0;
  const max = Number(element.max) || 1;
  element.style.setProperty('--slider-progress', `${((Number(value) - min) / (max - min)) * 100}%`);
}

function formatOutputName(dimensions, presetId, longEdge, extension) {
  const number = (value) => Number(value.toFixed(2)).toString();
  return `carton-render-${number(dimensions.width)}x${number(dimensions.height)}x${number(dimensions.depth)}mm-${presetId}-${longEdge}.${extension}`;
}

function createSaveTypes(format) {
  return format === 'png'
    ? [{ description: 'PNG Image (*.png)', accept: { 'image/png': ['.png'] } }]
    : [{ description: 'JPEG Image (*.jpg)', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }];
}

function getRenderTextureDpi(boxModel, dimensions) {
  const bounds = boxModel.getBounds();
  return Math.max(
    150,
    Math.max(dimensions.width / bounds.width, dimensions.height / bounds.height) * 25.4 * 1.25,
  );
}

function getInteractiveArtworkTextureDpi(artworks, requiredDpi) {
  return (artworks || []).reduce((dpi, entry) => Math.max(
    dpi,
    resolveArtworkDpi(entry?.model?.quality?.render, {
      purpose: 'render-screen',
      requiredDpi,
    }),
  ), requiredDpi);
}

const RENDER_ASPECT_LABELS = Object.freeze({
  square: '1:1',
  landscape: '4:3',
  wide: '16:9',
  portrait: '3:4',
});

export function createRenderApp({
  boxModel,
  getArtworks,
  documentRef = document,
  windowRef = window,
  initialState = DEFAULT_RENDER_SETTINGS,
  initialBoardAppearance = null,
  restorePersistedSettings = true,
  onStateChange = () => {},
  setArtworkQuality = () => false,
  onBackToPreview = () => {},
}) {
  const elements = {
    panel: documentRef.getElementById('renderPanel'),
    canvas: documentRef.getElementById('renderCanvas'),
    busy: documentRef.getElementById('renderBusy'),
    recovery: documentRef.getElementById('renderRecovery'),
    recoveryMessage: documentRef.getElementById('renderRecoveryMessage'),
    retry: documentRef.getElementById('retryRenderButton'),
    status: documentRef.getElementById('renderStatus'),
    png: documentRef.getElementById('renderPngButton'),
    jpg: documentRef.getElementById('renderJpgButton'),
    back: documentRef.getElementById('backToPreviewButton'),
    cameraPreset: documentRef.getElementById('renderCameraPreset'),
    projection: documentRef.getElementById('renderProjection'),
    fov: documentRef.getElementById('renderFov'),
    fovValue: documentRef.getElementById('renderFovValue'),
    aspect: documentRef.getElementById('renderAspect'),
    longEdge: documentRef.getElementById('renderLongEdge'),
    material: documentRef.getElementById('renderMaterialProfile'),
    azimuth: documentRef.getElementById('renderLightAzimuth'),
    azimuthValue: documentRef.getElementById('renderLightAzimuthValue'),
    elevation: documentRef.getElementById('renderLightElevation'),
    elevationValue: documentRef.getElementById('renderLightElevationValue'),
    intensity: documentRef.getElementById('renderLightIntensity'),
    intensityValue: documentRef.getElementById('renderLightIntensityValue'),
    environment: documentRef.getElementById('renderEnvironment'),
    environmentIntensity: documentRef.getElementById('renderEnvironmentIntensity'),
    environmentIntensityValue: documentRef.getElementById('renderEnvironmentIntensityValue'),
    exposure: documentRef.getElementById('renderExposure'),
    exposureValue: documentRef.getElementById('renderExposureValue'),
    backgroundMode: documentRef.getElementById('renderBackgroundMode'),
    backgroundColor: documentRef.getElementById('renderBackgroundColor'),
    shadowEnabled: documentRef.getElementById('renderShadowEnabled'),
    shadowIntensity: documentRef.getElementById('renderShadowIntensity'),
    shadowIntensityValue: documentRef.getElementById('renderShadowIntensityValue'),
    shadowBlur: documentRef.getElementById('renderShadowBlur'),
    shadowBlurValue: documentRef.getElementById('renderShadowBlurValue'),
    transparentShadow: documentRef.getElementById('renderTransparentShadow'),
    boardThickness: documentRef.getElementById('renderBoardThickness'),
    boardThicknessValue: documentRef.getElementById('renderBoardThicknessValue'),
    boardBevel: documentRef.getElementById('renderBoardBevel'),
    boardBevelValue: documentRef.getElementById('renderBoardBevelValue'),
    boardInteriorColor: documentRef.getElementById('renderBoardInteriorColor'),
    boardEdgeColor: documentRef.getElementById('renderBoardEdgeColor'),
    effectsGtao: documentRef.getElementById('renderEffectsGtao'),
    effectsGtaoIntensity: documentRef.getElementById('renderGtaoIntensity'),
    effectsGtaoIntensityValue: documentRef.getElementById('renderGtaoIntensityValue'),
    effectsGtaoRadius: documentRef.getElementById('renderGtaoRadius'),
    effectsGtaoRadiusValue: documentRef.getElementById('renderGtaoRadiusValue'),
    effectsGtaoResolution: documentRef.getElementById('renderGtaoResolution'),
    effectsDof: documentRef.getElementById('renderEffectsDof'),
    effectsDofFocusMode: documentRef.getElementById('renderDofFocusMode'),
    effectsDofFocusDistance: documentRef.getElementById('renderDofFocusDistance'),
    effectsDofFocusDistanceValue: documentRef.getElementById('renderDofFocusDistanceValue'),
    effectsDofAperture: documentRef.getElementById('renderDofAperture'),
    effectsDofApertureValue: documentRef.getElementById('renderDofApertureValue'),
    effectsDofMaxBlur: documentRef.getElementById('renderDofMaxBlur'),
    effectsDofMaxBlurValue: documentRef.getElementById('renderDofMaxBlurValue'),
    namedPreset: documentRef.getElementById('renderNamedPreset'),
    saveNamedPreset: documentRef.getElementById('saveRenderPresetButton'),
    deleteNamedPreset: documentRef.getElementById('deleteRenderPresetButton'),
    experimentalPathTracing: documentRef.getElementById('experimentalPathTracingButton'),
    diagnosticsOutput: documentRef.getElementById('renderDiagnosticsOutput'),
    artworkQualityList: documentRef.getElementById('renderArtworkQualityList'),
    viewportOverlay: documentRef.getElementById('renderViewportOverlay'),
    viewportFrame: documentRef.getElementById('renderViewportFrame'),
    viewportLabel: documentRef.getElementById('renderViewportLabel'),
    viewportSummary: documentRef.getElementById('renderViewportSummary'),
    presetButtons: [...documentRef.querySelectorAll('[data-render-preset]')],
  };

  const storage = getStorage(windowRef);
  const storedSettings = restorePersistedSettings
    ? readRenderSettings(storage)
    : null;
  let state = sanitizeRenderSettings(storedSettings?.renderSettings || initialState);
  let boardAppearance = sanitizeBoardAppearance(
    storedSettings?.boardAppearance || initialBoardAppearance,
  );
  let namedPresets = [];
  let activeNamedPresetId = '';
  let pathTracingService = null;
  let renderer = null;
  let active = false;
  let disposed = false;
  let syncController = null;
  let exportController = null;
  let syncGeneration = 0;
  let structureSignature = '';
  let artworkSignature = '';

  function getState() {
    const camera = renderer?.getCameraState();
    const next = camera
      ? { ...state, camera: { ...state.camera, ...camera } }
      : state;
    return clone(sanitizeRenderSettings(next));
  }

  function notifyStateChange() {
    state = sanitizeRenderSettings(getState());
    persistSettings();
    onStateChange(getState());
  }

  function persistSettings() {
    writeRenderSettings({
      renderSettings: getState(),
      boardAppearance,
    }, storage);
  }

  function setBusy(value) {
    elements.panel?.setAttribute('aria-busy', String(value));
    if (elements.busy) elements.busy.hidden = !value;
    if (elements.png) elements.png.disabled = value;
    if (elements.jpg) elements.jpg.disabled = value;
  }

  function showRecovery(messageKey = 'renderUnavailable') {
    if (elements.recoveryMessage) elements.recoveryMessage.textContent = t(messageKey);
    if (elements.recovery) elements.recovery.hidden = false;
    setBusy(false);
  }

  function hideRecovery() {
    if (elements.recovery) elements.recovery.hidden = true;
  }

  function updatePresetButtons() {
    for (const button of elements.presetButtons) {
      button.classList.toggle('active', button.dataset.renderPreset === state.presetId);
    }
  }

  function updateNamedPresetOptions() {
    if (!elements.namedPreset) return;
    const selected = activeNamedPresetId;
    elements.namedPreset.replaceChildren();
    const placeholder = documentRef.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('renderNamedPresetPlaceholder');
    elements.namedPreset.append(placeholder);
    for (const preset of namedPresets) {
      const option = documentRef.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      elements.namedPreset.append(option);
    }
    elements.namedPreset.value = namedPresets.some((preset) => preset.id === selected) ? selected : '';
  }

  function updateArtworkQualityList() {
    if (!elements.artworkQualityList) return;
    const entries = getArtworks?.() || [];
    elements.artworkQualityList.replaceChildren();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const model = entry?.model;
      if (!model?.hasArtwork || entry.visible === false) continue;
      const row = documentRef.createElement('label');
      row.className = 'render-artwork-quality-row';
      const name = documentRef.createElement('span');
      name.className = 'render-artwork-quality-name';
      name.textContent = model.source?.fileName || t('artwork');
      name.title = name.textContent;
      const select = documentRef.createElement('select');
      select.dataset.renderArtworkIndex = String(index);
      select.setAttribute('aria-label', `${t('renderQuality')} ${name.textContent}`);
      for (const value of ARTWORK_RENDER_QUALITY_OPTIONS) {
        const option = documentRef.createElement('option');
        option.value = String(value);
        option.textContent = value === 'auto' ? t('qualityAuto') : `${value} DPI`;
        select.appendChild(option);
      }
      select.value = String(model.quality?.render || 'auto');
      if (!model.source?.vector) {
        select.disabled = true;
        select.title = t('qualityNativePixels');
      }
      select.addEventListener('change', async () => {
        const value = select.value;
        select.disabled = true;
        try {
          await setArtworkQuality('render', value, index);
        } finally {
          // Rebuild after the async texture replacement has settled so the
          // control reflects the model that is now displayed in the canvas.
          updateArtworkQualityList();
        }
      });
      row.append(name, select);
      elements.artworkQualityList.appendChild(row);
    }
  }

  function updateViewportOverlay() {
    const dimensions = getRenderOutputDimensions(state);
    const aspect = dimensions.width / dimensions.height;
    const aspectLabel = RENDER_ASPECT_LABELS[state.aspect] || `${dimensions.width}:${dimensions.height}`;
    const summary = t('renderViewportSummary', {
      width: dimensions.width,
      height: dimensions.height,
      aspect: aspectLabel,
    });
    if (elements.viewportSummary) elements.viewportSummary.textContent = summary;
    if (elements.viewportLabel) elements.viewportLabel.textContent = summary;
    if (!elements.viewportOverlay || !elements.viewportFrame) return;

    const availableWidth = Math.max(1, elements.viewportOverlay.clientWidth);
    const availableHeight = Math.max(1, elements.viewportOverlay.clientHeight);
    let frameWidth = availableWidth;
    let frameHeight = frameWidth / aspect;
    if (frameHeight > availableHeight) {
      frameHeight = availableHeight;
      frameWidth = frameHeight * aspect;
    }
    elements.viewportFrame.style.width = `${Math.max(1, Math.floor(frameWidth))}px`;
    elements.viewportFrame.style.height = `${Math.max(1, Math.floor(frameHeight))}px`;
    elements.viewportFrame.style.left = `${Math.max(0, Math.floor((availableWidth - frameWidth) / 2))}px`;
    elements.viewportFrame.style.top = `${Math.max(0, Math.floor((availableHeight - frameHeight) / 2))}px`;
  }

  function updateControls() {
    elements.cameraPreset.value = state.camera.preset;
    elements.projection.value = state.camera.projection;
    elements.fov.value = String(state.camera.fov);
    elements.fovValue.value = `${Math.round(state.camera.fov)}°`;
    setRangeProgress(elements.fov, state.camera.fov);
    elements.aspect.value = state.aspect;
    elements.longEdge.value = String(state.longEdge);
    elements.material.value = state.material.profile;
    elements.azimuth.value = String(state.lighting.azimuth);
    elements.azimuthValue.value = `${Math.round(state.lighting.azimuth)}°`;
    setRangeProgress(elements.azimuth, state.lighting.azimuth);
    elements.elevation.value = String(state.lighting.elevation);
    elements.elevationValue.value = `${Math.round(state.lighting.elevation)}°`;
    setRangeProgress(elements.elevation, state.lighting.elevation);
    elements.intensity.value = String(state.lighting.intensity);
    elements.intensityValue.value = state.lighting.intensity.toFixed(1);
    setRangeProgress(elements.intensity, state.lighting.intensity);
    elements.environment.value = state.lighting.environment;
    elements.environmentIntensity.value = String(state.lighting.environmentIntensity);
    elements.environmentIntensityValue.value = state.lighting.environmentIntensity.toFixed(2);
    setRangeProgress(elements.environmentIntensity, state.lighting.environmentIntensity);
    elements.exposure.value = String(state.lighting.exposure);
    elements.exposureValue.value = state.lighting.exposure.toFixed(2);
    setRangeProgress(elements.exposure, state.lighting.exposure);
    elements.backgroundMode.value = state.background.mode;
    elements.backgroundColor.value = state.background.color;
    elements.shadowEnabled.checked = state.shadows.enabled;
    elements.shadowIntensity.value = String(state.shadows.intensity);
    elements.shadowIntensityValue.value = state.shadows.intensity.toFixed(2);
    setRangeProgress(elements.shadowIntensity, state.shadows.intensity);
    elements.shadowBlur.value = String(state.shadows.blur);
    elements.shadowBlurValue.value = state.shadows.blur.toFixed(1);
    setRangeProgress(elements.shadowBlur, state.shadows.blur);
    elements.transparentShadow.checked = state.shadows.includeInTransparentExport;
    if (elements.boardThickness) {
      elements.boardThickness.value = String(boardAppearance.thicknessMm);
      if (elements.boardThicknessValue) elements.boardThicknessValue.value = `${boardAppearance.thicknessMm.toFixed(2)} mm`;
      setRangeProgress(elements.boardThickness, boardAppearance.thicknessMm);
    }
    if (elements.boardBevel) {
      elements.boardBevel.value = String(boardAppearance.bevelRadiusMm);
      if (elements.boardBevelValue) elements.boardBevelValue.value = `${boardAppearance.bevelRadiusMm.toFixed(2)} mm`;
      setRangeProgress(elements.boardBevel, boardAppearance.bevelRadiusMm);
    }
    if (elements.boardInteriorColor) elements.boardInteriorColor.value = boardAppearance.interiorColor;
    if (elements.boardEdgeColor) elements.boardEdgeColor.value = boardAppearance.edgeColor;
    const effects = state.effects;
    if (elements.effectsGtao) elements.effectsGtao.checked = effects.gtao.enabled;
    if (elements.effectsGtaoIntensity) {
      elements.effectsGtaoIntensity.value = String(effects.gtao.intensity);
      if (elements.effectsGtaoIntensityValue) elements.effectsGtaoIntensityValue.value = effects.gtao.intensity.toFixed(2);
      setRangeProgress(elements.effectsGtaoIntensity, effects.gtao.intensity);
    }
    if (elements.effectsGtaoRadius) {
      elements.effectsGtaoRadius.value = String(effects.gtao.radius);
      if (elements.effectsGtaoRadiusValue) elements.effectsGtaoRadiusValue.value = effects.gtao.radius.toFixed(2);
      setRangeProgress(elements.effectsGtaoRadius, effects.gtao.radius);
    }
    if (elements.effectsGtaoResolution) elements.effectsGtaoResolution.value = effects.gtao.resolution;
    if (elements.effectsDof) elements.effectsDof.checked = effects.dof.enabled;
    if (elements.effectsDofFocusMode) elements.effectsDofFocusMode.value = effects.dof.focusMode;
    if (elements.effectsDofFocusDistance) {
      elements.effectsDofFocusDistance.value = String(effects.dof.focusDistance);
      if (elements.effectsDofFocusDistanceValue) elements.effectsDofFocusDistanceValue.value = effects.dof.focusDistance.toFixed(2);
      setRangeProgress(elements.effectsDofFocusDistance, effects.dof.focusDistance);
    }
    if (elements.effectsDofAperture) {
      elements.effectsDofAperture.value = String(effects.dof.aperture);
      if (elements.effectsDofApertureValue) elements.effectsDofApertureValue.value = effects.dof.aperture.toFixed(3);
      setRangeProgress(elements.effectsDofAperture, effects.dof.aperture);
    }
    if (elements.effectsDofMaxBlur) {
      elements.effectsDofMaxBlur.value = String(effects.dof.maxBlur);
      if (elements.effectsDofMaxBlurValue) elements.effectsDofMaxBlurValue.value = effects.dof.maxBlur.toFixed(3);
      setRangeProgress(elements.effectsDofMaxBlur, effects.dof.maxBlur);
    }
    if (elements.namedPreset) elements.namedPreset.value = activeNamedPresetId;
    updateNamedPresetOptions();
    updatePresetButtons();
    updateArtworkQualityList();
    updateViewportOverlay();
    updateDiagnostics();
  }

  function updateDiagnostics() {
    if (!elements.diagnosticsOutput) return;
    const diagnostics = renderer?.getDiagnostics?.();
    if (!diagnostics) {
      elements.diagnosticsOutput.textContent = t('renderDiagnosticsWaiting');
      return;
    }
    const lines = [
      `backend: ${diagnostics.backend || 'WebGL2'}`,
      `drawing buffer: ${diagnostics.drawingBufferWidth || 0}×${diagnostics.drawingBufferHeight || 0}`,
      `quality: ${diagnostics.qualityState || diagnostics.quality?.state || 'interactive'}`,
      `render scale: ${Number(diagnostics.renderScale ?? diagnostics.quality?.renderScale ?? 1).toFixed(2)}`,
      `passes: ${(diagnostics.passes || []).join(' → ') || 'none'}`,
      `shadow map: ${diagnostics.shadowMapSize || 0}`,
      `draw calls: ${diagnostics.calls || 0}`,
      `geometries/textures: ${diagnostics.geometries || 0}/${diagnostics.textures || 0}`,
    ];
    elements.diagnosticsOutput.textContent = lines.join('\n');
  }

  function updateState(next, { notify = true, render = true } = {}) {
    exportController?.abort();
    state = sanitizeRenderSettings(next);
    updateControls();
    renderer?.updateSettings(state, { render });
    if (notify) notifyStateChange();
  }

  function change(mutator) {
    const next = clone(state);
    mutator(next);
    updateState(next);
  }

  function currentSignatures() {
    const sceneModel = buildRenderSceneModel({
      boxModel,
      artworks: getArtworks(),
      renderSettings: state,
      boardAppearance,
    });
    return {
      structure: JSON.stringify(boxModel.toJSON()),
      artwork: getRenderArtworkSignature(sceneModel),
      sceneModel,
    };
  }

  async function syncScene({ force = false, purpose = 'render-screen', targetDpi = null } = {}) {
    if (!active || disposed) return false;
    const signatures = currentSignatures();
    const structureChanged = force || !renderer || signatures.structure !== structureSignature;
    const artworkChanged = force || !renderer || signatures.artwork !== artworkSignature;
    if (!structureChanged && !artworkChanged) {
      renderer.updateSettings(state);
      renderer.render();
      updateDiagnostics();
      return true;
    }

    syncGeneration += 1;
    const generation = syncGeneration;
    syncController?.abort();
    syncController = new AbortController();
    setBusy(true);
    hideRecovery();

    try {
      const requiredTextureDpi = getRenderTextureDpi(boxModel, {
        width: Math.max(1, elements.canvas?.clientWidth || 1),
        height: Math.max(1, elements.canvas?.clientHeight || 1),
      });
      const textureDpi = targetDpi || getInteractiveArtworkTextureDpi(
        signatures.sceneModel.artworks,
        requiredTextureDpi,
      );
      const composed = await composeArtworkTexture({
        boxModel,
        artworks: signatures.sceneModel.artworks,
        documentRef,
        purpose,
        targetDpi: textureDpi,
        getEntryTargetDpi: (entry) => resolveArtworkDpi(entry?.model?.quality?.render, {
          purpose,
          requiredDpi: textureDpi,
        }),
        signal: syncController.signal,
      });
      if (generation !== syncGeneration || syncController.signal.aborted) return false;

      if (structureChanged) {
        const { WebGLCartonRenderer } = await loadRendererModule();
        if (generation !== syncGeneration || syncController.signal.aborted) return false;
        renderer?.dispose();
        renderer = new WebGLCartonRenderer({
          canvas: elements.canvas,
          container: elements.panel,
          boxModel,
          sceneModel: signatures.sceneModel,
          textureCanvas: composed.canvas,
          renderSettings: state,
          boardAppearance,
          windowRef,
          onContextLost: () => showRecovery('renderContextLost'),
          onContextRestored: () => syncScene({ force: true }),
          onCameraChange: (camera) => {
            if (!active || disposed) return;
            renderer?.markInteraction?.();
            state = sanitizeRenderSettings({ ...state, camera: { ...state.camera, ...camera, preset: 'custom' } });
            updateControls();
            notifyStateChange();
          },
        });
        // A replacement renderer owns a fresh 1x1 post-processing composer.
        // Size it immediately; activate()'s resize frame may have run long ago
        // when artwork quality is changed from an already-open Render step.
        renderer.resize();
      } else {
        renderer.replaceArtwork(composed.canvas);
        renderer.setBoardAppearance?.(boardAppearance);
      }
      structureSignature = signatures.structure;
      artworkSignature = signatures.artwork;
      renderer.updateSettings(state);
      setBusy(false);
      updateControls();
      elements.status.textContent = t('renderReady');
      updateDiagnostics();
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false;
      console.error('Could not initialize Render', error);
      showRecovery('renderUnavailable');
      elements.status.textContent = t('renderUnavailable');
      return false;
    } finally {
      if (generation === syncGeneration) {
        syncController = null;
        setBusy(false);
      }
    }
  }

  async function activate() {
    if (disposed) return false;
    active = true;
    loadNamedPresets();
    updateControls();
    await syncScene();
    windowRef.requestAnimationFrame(() => renderer?.resize());
    windowRef.requestAnimationFrame(updateViewportOverlay);
    return Boolean(renderer);
  }

  function deactivate() {
    active = false;
    syncGeneration += 1;
    syncController?.abort();
    syncController = null;
  }

  function restoreState(next, nextBoardAppearance = undefined) {
    exportController?.abort();
    state = sanitizeRenderSettings(next);
    if (nextBoardAppearance !== undefined) {
      boardAppearance = sanitizeBoardAppearance(nextBoardAppearance);
      renderer?.setBoardAppearance?.(boardAppearance);
    }
    persistSettings();
    updateControls();
    if (active) syncScene({ force: true });
  }

  function setHtmlExportQuality(value) {
    const next = clone(state);
    next.quality.html = value;
    updateState(next);
    return state.quality.html;
  }

  async function loadNamedPresets() {
    try {
      namedPresets = await getRenderPresets();
      activeNamedPresetId = getActiveRenderPresetId();
      const activePreset = namedPresets.find((preset) => preset.id === activeNamedPresetId);
      if (activePreset) {
        boardAppearance = sanitizeBoardAppearance(activePreset.boardAppearance);
        renderer?.setBoardAppearance?.(boardAppearance);
        persistSettings();
      } else if (activeNamedPresetId) {
        activeNamedPresetId = '';
        setActiveRenderPresetId('');
      }
      updateControls();
    } catch {
      namedPresets = [];
    }
  }

  function updateBoardAppearance(mutator, { notify = true } = {}) {
    const next = cloneBoardAppearance(boardAppearance);
    mutator(next);
    boardAppearance = sanitizeBoardAppearance(next);
    renderer?.setBoardAppearance?.(boardAppearance);
    renderer?.markInteraction?.();
    renderer?.render?.();
    updateControls();
    if (notify) {
      persistSettings();
      onStateChange(getState());
    }
  }

  async function saveNamedPreset() {
    const name = windowRef.prompt?.(t('renderPresetNamePrompt'), 'My Render Preset')
      || elements.namedPreset?.dataset?.customName
      || 'My Render Preset';
    if (!name || !String(name).trim()) return false;
    const preset = await saveRenderPreset({
      name: String(name).trim(),
      renderSettings: getState(),
      boardAppearance,
    });
    namedPresets = [preset, ...namedPresets.filter((entry) => entry.id !== preset.id)];
    activeNamedPresetId = preset.id;
    updateControls();
    return true;
  }

  async function applyNamedPreset() {
    const preset = namedPresets.find((entry) => entry.id === elements.namedPreset?.value);
    if (!preset) return false;
    activeNamedPresetId = preset.id;
    setActiveRenderPresetId(activeNamedPresetId);
    boardAppearance = sanitizeBoardAppearance(preset.boardAppearance);
    updateState(preset.renderSettings);
    renderer?.setBoardAppearance?.(boardAppearance);
    persistSettings();
    onStateChange(getState());
    updateControls();
    return true;
  }

  async function removeNamedPreset() {
    const id = elements.namedPreset?.value || activeNamedPresetId;
    if (!id) return false;
    await deleteRenderPreset(id);
    namedPresets = namedPresets.filter((entry) => entry.id !== id);
    activeNamedPresetId = '';
    updateControls();
    return true;
  }

  function resetForProject() {
    exportController?.abort();
    structureSignature = '';
    artworkSignature = '';
    syncGeneration += 1;
    syncController?.abort();
    renderer?.dispose();
    renderer = null;
  }

  async function exportImage(format) {
    if (!renderer && !(await activate())) return false;
    exportController?.abort();
    const controller = new AbortController();
    exportController = controller;
    const exportState = getState();
    setBusy(true);
    elements.status.textContent = t('renderExporting');
    try {
      const outputDimensions = getRenderOutputDimensions(exportState);
      const synced = await syncScene({
        force: true,
        purpose: 'render-export',
        targetDpi: getRenderTextureDpi(boxModel, outputDimensions),
      });
      if (!synced || !renderer) throw new Error('Render texture could not be prepared.');
      const blob = await renderStill({
        renderer,
        settings: exportState,
        format,
        documentRef,
        signal: controller.signal,
      });
      const dimensions = boxModel.dimensions;
      const extension = format === 'png' ? 'png' : 'jpg';
      await saveOrDownloadFile({
        blob,
        suggestedName: formatOutputName(dimensions, exportState.presetId, exportState.longEdge, extension),
        types: createSaveTypes(format),
        windowRef,
        documentRef,
      });
      elements.status.textContent = t('renderExported', outputDimensions);
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('Could not export Render image', error);
        elements.status.textContent = t('renderExportFailed');
      }
      return false;
    } finally {
      if (!disposed && exportController === controller) setBusy(false);
      if (exportController === controller) exportController = null;
    }
  }

  async function runExperimentalPathTracing() {
    if (!isPathTracingEnabled()) return false;
    pathTracingService?.cancel();
    pathTracingService = new PathTracingRenderService({ renderer, sceneModel: currentSignatures().sceneModel, windowRef });
    setBusy(true);
    elements.status.textContent = t('renderPathTracingStarting');
    try {
      await pathTracingService.render({
        signal: exportController?.signal,
        onProgress: (progress) => {
          elements.status.textContent = `${t('renderPathTracingStarting')} ${Math.round(progress * 100)}%`;
        },
      });
      elements.status.textContent = t('renderPathTracingUnavailable');
      return false;
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('Experimental path tracing unavailable', error);
        elements.status.textContent = t('renderPathTracingUnavailable');
      }
      return false;
    } finally {
      setBusy(false);
      pathTracingService?.dispose();
      pathTracingService = null;
    }
  }

  for (const button of elements.presetButtons) {
    button.addEventListener('click', () => updateState(applyRenderPreset(state, button.dataset.renderPreset)));
  }
  elements.cameraPreset.addEventListener('change', (event) => change((next) => { next.camera.preset = event.target.value; }));
  elements.projection.addEventListener('change', (event) => change((next) => { next.camera.projection = event.target.value; }));
  elements.fov.addEventListener('input', (event) => change((next) => { next.camera.fov = Number(event.target.value); }));
  elements.aspect.addEventListener('change', (event) => change((next) => { next.aspect = event.target.value; }));
  elements.longEdge.addEventListener('change', (event) => change((next) => { next.longEdge = Number(event.target.value); }));
  elements.material.addEventListener('change', (event) => change((next) => { next.material.profile = event.target.value; }));
  elements.azimuth.addEventListener('input', (event) => change((next) => { next.lighting.azimuth = Number(event.target.value); }));
  elements.elevation.addEventListener('input', (event) => change((next) => { next.lighting.elevation = Number(event.target.value); }));
  elements.intensity.addEventListener('input', (event) => change((next) => { next.lighting.intensity = Number(event.target.value); }));
  elements.environment.addEventListener('change', (event) => change((next) => { next.lighting.environment = event.target.value; }));
  elements.environmentIntensity.addEventListener('input', (event) => change((next) => { next.lighting.environmentIntensity = Number(event.target.value); }));
  elements.exposure.addEventListener('input', (event) => change((next) => { next.lighting.exposure = Number(event.target.value); }));
  elements.backgroundMode.addEventListener('change', (event) => change((next) => { next.background.mode = event.target.value; }));
  elements.backgroundColor.addEventListener('input', (event) => change((next) => { next.background.color = event.target.value; }));
  elements.shadowEnabled.addEventListener('change', (event) => change((next) => { next.shadows.enabled = event.target.checked; }));
  elements.shadowIntensity.addEventListener('input', (event) => change((next) => { next.shadows.intensity = Number(event.target.value); }));
  elements.shadowBlur.addEventListener('input', (event) => change((next) => { next.shadows.blur = Number(event.target.value); }));
  elements.transparentShadow.addEventListener('change', (event) => change((next) => { next.shadows.includeInTransparentExport = event.target.checked; }));
  elements.boardThickness?.addEventListener('input', (event) => updateBoardAppearance((next) => { next.thicknessMm = Number(event.target.value); }));
  elements.boardBevel?.addEventListener('input', (event) => updateBoardAppearance((next) => { next.bevelRadiusMm = Number(event.target.value); }));
  elements.boardInteriorColor?.addEventListener('input', (event) => updateBoardAppearance((next) => { next.interiorColor = event.target.value; }));
  elements.boardEdgeColor?.addEventListener('input', (event) => updateBoardAppearance((next) => { next.edgeColor = event.target.value; }));
  elements.effectsGtao?.addEventListener('change', (event) => change((next) => { next.effects.gtao.enabled = event.target.checked; }));
  elements.effectsGtaoIntensity?.addEventListener('input', (event) => change((next) => { next.effects.gtao.intensity = Number(event.target.value); }));
  elements.effectsGtaoRadius?.addEventListener('input', (event) => change((next) => { next.effects.gtao.radius = Number(event.target.value); }));
  elements.effectsGtaoResolution?.addEventListener('change', (event) => change((next) => { next.effects.gtao.resolution = event.target.value; }));
  elements.effectsDof?.addEventListener('change', (event) => change((next) => { next.effects.dof.enabled = event.target.checked; }));
  elements.effectsDofFocusMode?.addEventListener('change', (event) => change((next) => { next.effects.dof.focusMode = event.target.value; }));
  elements.effectsDofFocusDistance?.addEventListener('input', (event) => change((next) => { next.effects.dof.focusDistance = Number(event.target.value); }));
  elements.effectsDofAperture?.addEventListener('input', (event) => change((next) => { next.effects.dof.aperture = Number(event.target.value); }));
  elements.effectsDofMaxBlur?.addEventListener('input', (event) => change((next) => { next.effects.dof.maxBlur = Number(event.target.value); }));
  elements.namedPreset?.addEventListener('change', applyNamedPreset);
  elements.saveNamedPreset?.addEventListener('click', saveNamedPreset);
  elements.deleteNamedPreset?.addEventListener('click', removeNamedPreset);
  if (elements.experimentalPathTracing) {
    elements.experimentalPathTracing.hidden = !isPathTracingEnabled();
    elements.experimentalPathTracing.addEventListener('click', runExperimentalPathTracing);
  }
  elements.png.addEventListener('click', () => exportImage('png'));
  elements.jpg.addEventListener('click', () => exportImage('jpg'));
  elements.back.addEventListener('click', onBackToPreview);
  elements.retry.addEventListener('click', () => syncScene({ force: true }));
  const handleWindowResize = () => {
    renderer?.resize();
    updateViewportOverlay();
  };
  const handleLocaleChanged = () => updateControls();
  windowRef.addEventListener('resize', handleWindowResize);
  documentRef.addEventListener('carton-locale-changed', handleLocaleChanged);

  updateControls();

  return {
    activate,
    deactivate,
    restoreState,
    setHtmlExportQuality,
    resetForProject,
    exportImage,
    getState,
    getBoardAppearance() {
      return cloneBoardAppearance(boardAppearance);
    },
    refreshArtwork() {
      if (!active) return Promise.resolve(false);
      return syncScene({ force: true });
    },
    render() {
      renderer?.render();
    },
    getDiagnostics() {
      return renderer?.getDiagnostics() || { panels: 0, geometries: 0, textures: 0, calls: 0 };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      syncController?.abort();
      exportController?.abort();
      pathTracingService?.dispose();
      renderer?.dispose();
      renderer = null;
      windowRef.removeEventListener('resize', handleWindowResize);
      documentRef.removeEventListener('carton-locale-changed', handleLocaleChanged);
    },
  };
}
