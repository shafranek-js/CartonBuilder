import { getUserErrorMessage, t } from '../i18n.js';
import { enhanceSlider } from '../ui/SliderStepper.js';
import { ARTWORK_RENDER_QUALITY_OPTIONS } from '../artwork/ArtworkModel.js';
import { resolveArtworkDpi } from '../artwork/artworkRasterizer.js';
import { requestSaveDestination, writeSaveDestination } from '../utils/fileSaver.js';
import { composeArtworkTexture } from '../preview3d/textureComposer.js';
import { buildRenderSceneModel, getRenderArtworkSignature } from './RenderSceneModel.js';
import {
  DEFAULT_RENDER_SETTINGS,
  getRenderOutputDimensions,
  sanitizeRenderSettings,
} from './RenderSettings.js';
import { applyRenderPreset } from './renderPresets.js';
import { renderStill } from './StillRenderService.js';
import { getRenderHealth, runRenderExportPreflight } from './renderPreflight.js';
import {
  getTurntableDimensions,
  isTurntableWithinPixelBudget,
  sanitizeTurntableOptions,
} from './turntableOptions.js';
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
  undoDeleteRenderPreset,
} from './RenderPresetStore.js';
import { getRenderAsset, saveRenderAsset } from './RenderAssetStore.js';
import { normalizeRenderAsset, validateRenderBackground } from './renderAssets.js';
import {
  getEnvironmentMapPreset,
  loadBuiltInEnvironmentAsset,
  validateRenderEnvironment,
} from './environmentAssets.js';
import { generateNeutralRenderThumbnail } from './PresetThumbnailService.js';
import {
  cameraPositionFromHeading,
  normalizeCameraPresetState,
  normalizeDegrees,
} from './cameraState.js';
import {
  deleteRenderViewPreset,
  duplicateRenderViewPreset,
  getActiveRenderViewPresetId,
  getRenderViewPresets,
  renameRenderViewPreset,
  saveRenderViewPreset,
  setActiveRenderViewPresetId,
  undoDeleteRenderViewPreset,
} from './RenderViewPresetStore.js';

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
  if (format === 'png') return [{ description: 'PNG Image (*.png)', accept: { 'image/png': ['.png'] } }];
  if (format === 'jpg') return [{ description: 'JPEG Image (*.jpg)', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }];
  if (format === 'glb') return [{ description: 'Binary glTF (*.glb)', accept: { 'model/gltf-binary': ['.glb'] } }];
  return [{ description: 'ZIP archive (*.zip)', accept: { 'application/zip': ['.zip'] } }];
}

function formatMegabytes(bytes) {
  return `${(Math.max(0, Number(bytes) || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

function renderPreflightIssueText(entry) {
  const details = entry.details || {};
  switch (entry.code) {
    case 'context-lost': return t('renderPreflightContextLost');
    case 'renderer-unavailable': return t('renderPreflightRendererUnavailable');
    case 'renderer-will-initialize': return t('renderPreflightWillInitialize');
    case 'gpu-limit': return t('renderPreflightGpuLimit', { width: details.width, height: details.height, maxDimension: details.maxDimension });
    case 'turntable-budget': return t('renderPreflightTurntableBudget', { frames: details.frames, width: details.width, height: details.height });
    case 'jpeg-background': return t('renderPreflightJpegBackground');
    case 'basic-glb-finishes': return t('renderPreflightBasicGlbFinishes');
    case 'hdri-glb': return t('renderPreflightHdriGlb');
    case 'invalid-geometry': return t('renderPreflightInvalidGeometry', { templateId: details.templateId, element: details.invalidElement || 'unknown' });
    case 'memory-budget': return t('renderPreflightMemory', { estimated: formatMegabytes(details.estimatedBytes), budget: formatMegabytes(details.memoryBudgetBytes) });
    default: return entry.code;
  }
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
  initialRenderAssets = [],
  restorePersistedSettings = true,
  onStateChange = () => {},
  setArtworkQuality = () => false,
  updateArtworkFinish = () => false,
  operationProgress = null,
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
    lens: documentRef.getElementById('renderCameraLens'),
    lensValue: documentRef.getElementById('renderCameraLensValue'),
    heading: documentRef.getElementById('renderCameraHeading'),
    cameraElevation: documentRef.getElementById('renderCameraElevation'),
    panX: documentRef.getElementById('renderCameraPanX'),
    panY: documentRef.getElementById('renderCameraPanY'),
    cameraDistance: documentRef.getElementById('renderCameraDistance'),
    frameHeight: documentRef.getElementById('renderCameraFrameHeight'),
    verticalCorrection: documentRef.getElementById('renderKeepVerticalsParallel'),
    fitCamera: documentRef.getElementById('renderFitCameraButton'),
    mirrorCamera: documentRef.getElementById('renderMirrorCameraButton'),
    resetCamera: documentRef.getElementById('renderResetCameraButton'),
    viewPreset: documentRef.getElementById('renderViewPreset'),
    viewPresetList: documentRef.getElementById('renderViewPresetList'),
    saveViewPreset: documentRef.getElementById('saveRenderViewPresetButton'),
    deleteViewPreset: documentRef.getElementById('deleteRenderViewPresetButton'),
    undoViewPreset: documentRef.getElementById('undoRenderViewPresetButton'),
    duplicateViewPreset: documentRef.getElementById('duplicateRenderViewPresetButton'),
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
    environmentMapPreset: documentRef.getElementById('renderEnvironmentMapPreset'),
    environmentMapFile: documentRef.getElementById('renderEnvironmentMapFile'),
    environmentMapFileName: documentRef.getElementById('renderEnvironmentMapFileName'),
    environmentMapUsage: documentRef.getElementById('renderEnvironmentMapUsage'),
    environmentMapRotation: documentRef.getElementById('renderEnvironmentMapRotation'),
    environmentMapRotationValue: documentRef.getElementById('renderEnvironmentMapRotationValue'),
    environmentMapBackgroundIntensity: documentRef.getElementById('renderEnvironmentMapBackgroundIntensity'),
    environmentMapBackgroundIntensityValue: documentRef.getElementById('renderEnvironmentMapBackgroundIntensityValue'),
    environmentMapBackgroundBlur: documentRef.getElementById('renderEnvironmentMapBackgroundBlur'),
    environmentMapBackgroundBlurValue: documentRef.getElementById('renderEnvironmentMapBackgroundBlurValue'),
    environmentMapResolution: documentRef.getElementById('renderEnvironmentResolution'),
    clearEnvironmentMap: documentRef.getElementById('renderClearEnvironmentMapButton'),
    exposure: documentRef.getElementById('renderExposure'),
    exposureValue: documentRef.getElementById('renderExposureValue'),
    backgroundMode: documentRef.getElementById('renderBackgroundMode'),
    backgroundColor: documentRef.getElementById('renderBackgroundColor'),
    backgroundFile: documentRef.getElementById('renderBackgroundFile'),
    backgroundFileName: documentRef.getElementById('renderBackgroundFileName'),
    clearBackground: documentRef.getElementById('renderClearBackgroundButton'),
    backgroundFit: documentRef.getElementById('renderBackgroundFit'),
    backgroundPositionX: documentRef.getElementById('renderBackgroundPositionX'),
    backgroundPositionXValue: documentRef.getElementById('renderBackgroundPositionXValue'),
    backgroundPositionY: documentRef.getElementById('renderBackgroundPositionY'),
    backgroundPositionYValue: documentRef.getElementById('renderBackgroundPositionYValue'),
    backgroundZoom: documentRef.getElementById('renderBackgroundZoom'),
    backgroundZoomValue: documentRef.getElementById('renderBackgroundZoomValue'),
    backgroundBrightness: documentRef.getElementById('renderBackgroundBrightness'),
    backgroundBrightnessValue: documentRef.getElementById('renderBackgroundBrightnessValue'),
    backgroundOverlayOpacity: documentRef.getElementById('renderBackgroundOverlayOpacity'),
    backgroundOverlayOpacityValue: documentRef.getElementById('renderBackgroundOverlayOpacityValue'),
    backgroundOverlayColor: documentRef.getElementById('renderBackgroundOverlayColor'),
    backgroundBlur: documentRef.getElementById('renderBackgroundBlur'),
    backgroundBlurValue: documentRef.getElementById('renderBackgroundBlurValue'),
    shadowEnabled: documentRef.getElementById('renderShadowEnabled'),
    shadowIntensity: documentRef.getElementById('renderShadowIntensity'),
    shadowIntensityValue: documentRef.getElementById('renderShadowIntensityValue'),
    shadowBlur: documentRef.getElementById('renderShadowBlur'),
    shadowBlurValue: documentRef.getElementById('renderShadowBlurValue'),
    transparentShadow: documentRef.getElementById('renderTransparentShadow'),
    shadowMapSize: documentRef.getElementById('renderShadowMapSize'),
    floorReflectionEnabled: documentRef.getElementById('renderFloorReflectionEnabled'),
    floorReflectionStrength: documentRef.getElementById('renderFloorReflectionStrength'),
    floorReflectionStrengthValue: documentRef.getElementById('renderFloorReflectionStrengthValue'),
    floorReflectionBlur: documentRef.getElementById('renderFloorReflectionBlur'),
    floorReflectionBlurValue: documentRef.getElementById('renderFloorReflectionBlurValue'),
    floorReflectionFade: documentRef.getElementById('renderFloorReflectionFade'),
    floorReflectionFadeValue: documentRef.getElementById('renderFloorReflectionFadeValue'),
    transparentReflection: documentRef.getElementById('renderTransparentReflection'),
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
    aaInteractive: documentRef.getElementById('renderAaInteractive'),
    aaSettled: documentRef.getElementById('renderAaSettled'),
    aaExport: documentRef.getElementById('renderAaExport'),
    aaTaaSamples: documentRef.getElementById('renderAaTaaSamples'),
    aaTaaSamplesValue: documentRef.getElementById('renderAaTaaSamplesValue'),
    qualityInteractive: documentRef.getElementById('renderQualityInteractive'),
    qualityExport: documentRef.getElementById('renderQualityExport'),
    qualityHtml: documentRef.getElementById('renderQualityHtml'),
    namedPreset: documentRef.getElementById('renderNamedPreset'),
    namedPresetList: documentRef.getElementById('renderNamedPresetList'),
    saveNamedPreset: documentRef.getElementById('saveRenderPresetButton'),
    updateNamedPreset: documentRef.getElementById('updateRenderPresetButton'),
    duplicateNamedPreset: documentRef.getElementById('duplicateRenderPresetButton'),
    deleteNamedPreset: documentRef.getElementById('deleteRenderPresetButton'),
    undoNamedPreset: documentRef.getElementById('undoRenderPresetButton'),
    experimentalPathTracing: documentRef.getElementById('experimentalPathTracingButton'),
    diagnosticsOutput: documentRef.getElementById('renderDiagnosticsOutput'),
    artworkQualityList: documentRef.getElementById('renderArtworkQualityList'),
    finishSummary: documentRef.getElementById('renderFinishSummary'),
    viewportOverlay: documentRef.getElementById('renderViewportOverlay'),
    viewportFrame: documentRef.getElementById('renderViewportFrame'),
    viewportLabel: documentRef.getElementById('renderViewportLabel'),
    viewportSummary: documentRef.getElementById('renderViewportSummary'),
    exportPreflight: documentRef.getElementById('renderExportPreflight'),
    exportConfirm: documentRef.getElementById('renderExportConfirm'),
    presetButtons: [...documentRef.querySelectorAll('[data-render-preset]')],
  exportDialog: documentRef.getElementById('renderExportDialog'),
    exportForm: documentRef.getElementById('renderExportForm'),
    exportKind: documentRef.getElementById('renderExportKind'),
    exportFormat: documentRef.getElementById('renderExportFormat'),
    exportSizing: documentRef.getElementById('renderExportSizing'),
    exportWidth: documentRef.getElementById('renderExportWidth'),
    exportHeight: documentRef.getElementById('renderExportHeight'),
    exportUnit: documentRef.getElementById('renderExportUnit'),
    exportPrintWidth: documentRef.getElementById('renderExportPrintWidth'),
    exportPrintHeight: documentRef.getElementById('renderExportPrintHeight'),
    exportPpi: documentRef.getElementById('renderExportPpi'),
    exportJpegQuality: documentRef.getElementById('renderJpegQuality'),
    exportJpegQualityValue: documentRef.getElementById('renderJpegQualityValue'),
    exportSequenceFrames: documentRef.getElementById('renderExportSequenceFrames'),
    exportSequenceLongEdge: documentRef.getElementById('renderExportSequenceLongEdge'),
    exportSequenceFormat: documentRef.getElementById('renderExportSequenceFormat'),
    exportGlbTextureSize: documentRef.getElementById('renderExportGlbTextureSize'),
    exportGlbMaterialMode: documentRef.getElementById('renderExportGlbMaterialMode'),
    exportGlbIncludeCamera: documentRef.getElementById('renderExportGlbIncludeCamera'),
    exportGlbWarning: documentRef.getElementById('renderExportGlbWarning'),
    exportLockAspect: documentRef.getElementById('renderExportLockAspect'),
    exportImageOptions: documentRef.getElementById('renderExportImageOptions'),
    exportSequenceOptions: documentRef.getElementById('renderExportSequenceOptions'),
    exportGlbOptions: documentRef.getElementById('renderExportGlbOptions'),
    exportSummary: documentRef.getElementById('renderExportSummary'),
    presetNameDialog: documentRef.getElementById('renderPresetNameDialog'),
    presetNameForm: documentRef.getElementById('renderPresetNameForm'),
    presetNameInput: documentRef.getElementById('renderPresetNameInput'),
  };

  const storage = getStorage(windowRef);

  function requestPresetName(defaultName = 'My Preset') {
    if (!elements.presetNameDialog?.showModal) return Promise.resolve(defaultName);
    elements.presetNameInput.value = defaultName;
    elements.presetNameInput.focus();
    elements.presetNameDialog.showModal();
    return new Promise((resolve) => {
      elements.presetNameDialog.addEventListener('close', () => {
        resolve(elements.presetNameDialog.returnValue === 'confirm'
          ? elements.presetNameInput.value.trim().slice(0, 64)
          : '');
      }, { once: true });
    });
  }
  const storedSettings = restorePersistedSettings
    ? readRenderSettings(storage)
    : null;
  let state = sanitizeRenderSettings(storedSettings?.renderSettings || initialState);
  function canonicalBoardAppearance(value = null) {
    const next = sanitizeBoardAppearance(value);
    next.thicknessMm = boxModel.board?.caliperMm ?? next.thicknessMm;
    return next;
  }

  let boardAppearance = canonicalBoardAppearance(
    storedSettings?.boardAppearance || initialBoardAppearance,
  );
  let namedPresets = [];
  let activeNamedPresetId = '';
  let viewPresets = [];
  let activeViewPresetId = getActiveRenderViewPresetId();
  let viewUndoTimer = null;
  let renderUndoTimer = null;
  let exportDialogDraftKind = null;
  let backgroundAsset = null;
  let environmentAsset = null;
  let environmentAssetLoadGeneration = 0;
  let availableRenderAssets = Array.isArray(initialRenderAssets)
    ? initialRenderAssets.map(normalizeRenderAsset).filter(Boolean)
    : [];
  let pathTracingService = null;
  let renderer = null;
  let active = false;
  let disposed = false;
  let syncController = null;
  let exportController = null;
  let syncGeneration = 0;
  let structureSignature = '';
  let artworkSignature = '';
  let lastPreflight = null;
  let renderContextState = 'initializing';
  let renderContextRecoveryCount = 0;

  function restoreRenderAssets(assets = []) {
    const entries = Array.isArray(assets) ? assets.map(normalizeRenderAsset).filter(Boolean) : [];
    availableRenderAssets = entries.length ? entries : availableRenderAssets;
    const assetId = state.background?.image?.assetId;
    backgroundAsset = availableRenderAssets.find((asset) => asset.kind !== 'environment' && asset.assetId === assetId) || null;
    const environmentAssetId = state.lighting?.environmentMap?.assetId;
    environmentAsset = availableRenderAssets.find((asset) => asset.kind === 'environment' && asset.assetId === environmentAssetId) || null;
    return Boolean(backgroundAsset || environmentAsset);
  }

  restoreRenderAssets(initialRenderAssets);

  function getRenderAssets() {
    return [
      backgroundAsset,
      environmentAsset?.source === 'builtin' ? null : environmentAsset,
    ].filter(Boolean);
  }

  async function ensureBackgroundAsset() {
    const assetId = state.background?.image?.assetId;
    if (!assetId || backgroundAsset?.assetId === assetId) return backgroundAsset;
    backgroundAsset = availableRenderAssets.find((asset) => asset.kind !== 'environment' && asset.assetId === assetId) || null;
    if (backgroundAsset) return backgroundAsset;
    try {
      const candidate = await getRenderAsset(assetId);
      backgroundAsset = candidate?.kind === 'environment' ? null : candidate;
    } catch {
      backgroundAsset = null;
    }
    if (backgroundAsset) availableRenderAssets = [
      ...availableRenderAssets.filter((asset) => asset.assetId !== backgroundAsset.assetId),
      backgroundAsset,
    ];
    return backgroundAsset;
  }

  async function ensureEnvironmentAsset({ surfaceError = false } = {}) {
    const environmentMap = state.lighting?.environmentMap || {};
    if (environmentMap.source === 'builtin') {
      const preset = getEnvironmentMapPreset(environmentMap.presetId);
      if (!preset?.assetUrl) {
        if (environmentAsset?.source === 'builtin') environmentAsset = null;
        return null;
      }
      if (environmentAsset?.source === 'builtin' && environmentAsset.presetId === preset.id) return environmentAsset;
      const generation = ++environmentAssetLoadGeneration;
      try {
        const fetchFn = typeof windowRef.fetch === 'function'
          ? windowRef.fetch.bind(windowRef)
          : globalThis.fetch;
        const asset = await loadBuiltInEnvironmentAsset(preset.id, fetchFn);
        if (generation !== environmentAssetLoadGeneration || state.lighting?.environmentMap?.presetId !== preset.id) return null;
        environmentAsset = asset;
        return environmentAsset;
      } catch (error) {
        environmentAsset = null;
        if (surfaceError) throw error;
        return null;
      }
    }

    const assetId = environmentMap.assetId;
    if (!assetId || environmentAsset?.assetId === assetId) return environmentAsset;
    environmentAsset = availableRenderAssets.find((asset) => asset.kind === 'environment' && asset.assetId === assetId) || null;
    if (environmentAsset) return environmentAsset;
    try {
      const candidate = await getRenderAsset(assetId);
      environmentAsset = candidate?.kind === 'environment' ? candidate : null;
    } catch {
      environmentAsset = null;
    }
    if (environmentAsset) availableRenderAssets = [
      ...availableRenderAssets.filter((asset) => asset.assetId !== environmentAsset.assetId),
      environmentAsset,
    ];
    return environmentAsset;
  }

  async function setEnvironmentMapFile(file) {
    const asset = await validateRenderEnvironment(file);
    environmentAssetLoadGeneration += 1;
    try { await saveRenderAsset(asset); } catch { /* in-memory fallback remains usable */ }
    environmentAsset = asset;
    availableRenderAssets = [
      ...availableRenderAssets.filter((entry) => entry.assetId !== asset.assetId),
      asset,
    ];
    const next = clone(state);
    next.lighting.environmentMap = {
      ...next.lighting.environmentMap,
      source: 'custom',
      assetId: asset.assetId,
    };
    updateState(next);
    return clone(asset);
  }

  function clearEnvironmentMap() {
    environmentAssetLoadGeneration += 1;
    environmentAsset = null;
    const next = clone(state);
    next.lighting.environmentMap = {
      ...next.lighting.environmentMap,
      source: 'builtin',
      presetId: 'neutral-softbox',
      assetId: '',
    };
    updateState(next);
  }

  async function setBackgroundImage(file) {
    const asset = await validateRenderBackground(file);
    try {
      await saveRenderAsset(asset);
    } catch {
      // Keep the in-memory asset usable when IndexedDB is unavailable.
    }
    backgroundAsset = asset;
    availableRenderAssets = [
      ...availableRenderAssets.filter((entry) => entry.assetId !== asset.assetId),
      asset,
    ];
    const next = clone(state);
    next.background.mode = 'image';
    next.background.image = {
      ...next.background.image,
      assetId: asset.assetId,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
    };
    updateState(next);
    return clone(asset);
  }

  function clearBackgroundImage() {
    backgroundAsset = null;
    const next = clone(state);
    next.background.mode = 'solid';
    next.background.image = { ...DEFAULT_RENDER_SETTINGS.background.image };
    updateState(next);
  }

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

  async function runForegroundExport({ id, labelKey, work }) {
    if (!operationProgress) {
      const controller = new AbortController();
      return work({ signal: controller.signal, report: () => {}, cancel: () => controller.abort() });
    }
    const outcome = await operationProgress.run({
      id,
      labelKey,
      cancellable: true,
      lockMode: 'actions',
      work,
    });
    if (outcome.status === 'cancelled') elements.status.textContent = t('operationCancelled');
    return outcome.status === 'succeeded' && outcome.value !== false;
  }

  function setExportAvailability(enabled) {
    const available = Boolean(enabled);
    if (elements.png) elements.png.disabled = !available;
    if (elements.jpg) elements.jpg.disabled = !available;
    if (elements.exportConfirm && !available) elements.exportConfirm.disabled = true;
  }

  function showRecovery(messageKey = 'renderUnavailable') {
    if (elements.recoveryMessage) elements.recoveryMessage.textContent = t(messageKey);
    if (elements.recovery) elements.recovery.hidden = false;
    setBusy(false);
    setExportAvailability(false);
  }

  function hideRecovery() {
    if (elements.recovery) elements.recovery.hidden = true;
  }

  function hasVisibleRenderArtwork() {
    return (getArtworks?.() || []).some((entry) => (
      entry?.visible !== false && entry?.model?.hasArtwork
    ));
  }

  function refreshArtworkVisibility() {
    if (disposed || hasVisibleRenderArtwork()) return true;
    return handleMissingArtwork();
  }

  function clearRenderSurface() {
    const canvas = elements.canvas;
    if (!canvas) return;
    // Resizing a WebGL canvas clears its color buffer without attempting to
    // acquire a second context (which would fail after context loss).
    const width = canvas.width || 1;
    const height = canvas.height || 1;
    canvas.width = width;
    canvas.height = height;
  }

  function handleMissingArtwork() {
    syncGeneration += 1;
    syncController?.abort();
    syncController = null;
    exportController?.abort();
    pathTracingService?.cancel?.();
    pathTracingService?.dispose?.();
    pathTracingService = null;
    renderer?.dispose?.();
    renderer = null;
    structureSignature = '';
    artworkSignature = '';
    renderContextState = 'initializing';
    clearRenderSurface();
    showRecovery('renderArtworkRequired');
    elements.status.textContent = t('renderArtworkRequired');
    updateDiagnostics();
    return false;
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
    if (elements.namedPresetList) {
      elements.namedPresetList.replaceChildren();
      for (const preset of namedPresets) {
        const card = documentRef.createElement('button');
        card.type = 'button';
        card.className = 'render-preset-card';
        card.classList.toggle('active', preset.id === selected);
        card.dataset.namedPreset = preset.id;
        const thumb = documentRef.createElement('span');
        thumb.className = 'render-preset-thumbnail';
        thumb.setAttribute('aria-hidden', 'true');
        const label = documentRef.createElement('span');
        label.className = 'render-preset-card-label';
        label.textContent = preset.name;
        card.append(thumb, label);
        card.addEventListener('click', () => {
          if (elements.namedPreset) elements.namedPreset.value = preset.id;
          applyNamedPreset();
        });
        elements.namedPresetList.append(card);
      }
    }
  }

  async function loadPresetThumbnails() {
    for (const button of elements.presetButtons) {
      const presetId = button.dataset.renderPreset;
      const thumbnail = button.querySelector('[data-preset-thumbnail]') || button.querySelector('.render-preset-thumbnail');
      if (!thumbnail) continue;
      try {
        const dataUrl = await generateNeutralRenderThumbnail({ presetId, documentRef, windowRef });
        if (dataUrl) {
          thumbnail.style.backgroundImage = `url(${dataUrl})`;
          thumbnail.classList.add('has-real-thumbnail');
        }
      } catch (error) {
        console.warn('Could not generate preset thumbnail', presetId, error);
      }
    }
  }

  function updateArtworkQualityList() {
    if (!elements.artworkQualityList) return;
    const entries = getArtworks?.() || [];
    elements.artworkQualityList.replaceChildren();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const model = entry?.model;
      if (!model?.hasArtwork || entry.visible === false) continue;

      const card = documentRef.createElement('div');
      card.className = 'render-artwork-quality-card';

      const headerRow = documentRef.createElement('div');
      headerRow.className = 'render-artwork-quality-header';

      const icon = documentRef.createElement('span');
      icon.className = 'render-artwork-quality-icon';
      icon.textContent = '📄';

      const name = documentRef.createElement('span');
      name.className = 'render-artwork-quality-name';
      name.textContent = model.source?.fileName || t('artwork');
      name.title = name.textContent;

      headerRow.append(icon, name);

      const fieldRow = documentRef.createElement('label');
      fieldRow.className = 'field render-artwork-quality-field';

      const labelSpan = documentRef.createElement('span');
      labelSpan.textContent = t('renderQuality');

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
          updateArtworkQualityList();
        }
      });

      fieldRow.append(labelSpan, select);
      card.append(headerRow, fieldRow);
      elements.artworkQualityList.appendChild(card);
    }
  }

  function updateFinishSummary() {
    if (!elements.finishSummary) return;
    const entries = getArtworks?.() || [];
    elements.finishSummary.replaceChildren();
    const finishes = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry?.visible !== false && entry?.outputRole !== 'print' && entry?.finish);
    if (!finishes.length) {
      const empty = documentRef.createElement('p');
      empty.className = 'quality-help';
      empty.textContent = t('renderFinishesEmpty');
      elements.finishSummary.appendChild(empty);
      return;
    }
    for (const { entry, index } of finishes) {
      const finish = entry.finish;
      const row = documentRef.createElement('div');
      row.className = 'render-finish-row';
      const title = documentRef.createElement('span');
      title.className = 'render-finish-name';
      title.textContent = entry.model.source?.fileName || t('artwork');
      const type = documentRef.createElement('select');
      type.setAttribute('aria-label', `${t('artworkFinishType')} ${title.textContent}`);
      for (const [value, labelKey] of [
        ['spot-gloss', 'artworkFinishSpotGloss'],
        ['foil', 'artworkFinishFoil'],
        ['emboss', 'artworkFinishEmboss'],
        ['deboss', 'artworkFinishDeboss'],
      ]) {
        const option = documentRef.createElement('option');
        option.value = value;
        option.textContent = t(labelKey);
        type.appendChild(option);
      }
      type.value = finish.type;
      type.addEventListener('change', () => {
        Promise.resolve(updateArtworkFinish(index, { type: type.value })).catch(() => {});
      });
      const intensity = documentRef.createElement('input');
      intensity.type = 'range';
      intensity.min = '0';
      intensity.max = '100';
      intensity.value = String(Math.round((finish.intensity || 1) * 100));
      intensity.setAttribute('aria-label', `${t('artworkFinishIntensity')} ${title.textContent}`);
      intensity.addEventListener('change', () => {
        Promise.resolve(updateArtworkFinish(index, { intensity: Number(intensity.value) / 100 })).catch(() => {});
      });
      enhanceSlider(intensity);
      row.append(title, type, intensity);
      if (finish.type === 'foil') {
        const color = documentRef.createElement('input');
        color.type = 'color';
        color.value = finish.foilColor || '#d4af37';
        color.setAttribute('aria-label', `${t('artworkFinishFoilColor')} ${title.textContent}`);
        color.addEventListener('change', () => {
          Promise.resolve(updateArtworkFinish(index, { foilColor: color.value })).catch(() => {});
        });
        row.appendChild(color);
      }
      elements.finishSummary.appendChild(row);
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

  function updateViewPresetOptions() {
    const selected = activeViewPresetId || state.activeViewPresetId || '';
    if (elements.viewPreset) {
      elements.viewPreset.replaceChildren();
      const placeholder = documentRef.createElement('option');
      placeholder.value = '';
      placeholder.textContent = t('renderViewPresetPlaceholder');
      elements.viewPreset.append(placeholder);
      for (const preset of viewPresets) {
        const option = documentRef.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        elements.viewPreset.append(option);
      }
      elements.viewPreset.value = viewPresets.some((entry) => entry.id === selected) ? selected : '';
    }
    if (!elements.viewPresetList) return;
    elements.viewPresetList.replaceChildren();
    for (const preset of viewPresets) {
      const card = documentRef.createElement('button');
      card.type = 'button';
      card.className = 'render-preset-card render-view-preset-card';
      card.dataset.viewPreset = preset.id;
      card.classList.toggle('active', preset.id === selected);
      const thumb = documentRef.createElement('span');
      thumb.className = 'render-preset-thumbnail render-view-preset-thumbnail';
      thumb.setAttribute('aria-hidden', 'true');
      const label = documentRef.createElement('span');
      label.className = 'render-preset-card-label';
      label.textContent = preset.name;
      card.append(thumb, label);
      card.addEventListener('click', () => applyViewPreset(preset.id));
      elements.viewPresetList.append(card);
    }
  }

  function markRenderPresetModified() {
    if (!activeNamedPresetId) return;
    const active = namedPresets.find((entry) => entry.id === activeNamedPresetId);
    if (!active) return;
    elements.namedPreset?.setAttribute('data-modified', 'true');
  }

  function getBoxCenterRadius() {
    const dimensions = boxModel.dimensions || {};
    const width = Number(dimensions.width || 1);
    const height = Number(dimensions.height || 1);
    const depth = Number(dimensions.depth || 1);
    const center = [0, height / 2, 0];
    const radius = Math.max(0.001, Math.hypot(width / 2, height / 2, depth / 2));
    return { center, radius };
  }

  function getNormalizedViewCamera(camera = renderer?.getCameraState?.() || state.camera) {
    const { radius } = getBoxCenterRadius();
    return normalizeCameraPresetState({
      ...camera,
      distanceFactor: Number(camera.cameraDistance || 0) / radius,
      frameHeightFactor: Number(camera.orthographicHeight || camera.frameHeight || 0) / radius,
    }, { radius });
  }

  function applyViewCamera(camera) {
    const { center, radius } = getBoxCenterRadius();
    const normalized = normalizeCameraPresetState(camera, { radius });
    const position = cameraPositionFromHeading({
      heading: normalized.heading,
      elevation: normalized.elevation,
      distance: Math.max(radius, normalized.distanceFactor * radius),
      target: center,
    });
    const next = clone(state);
    next.camera = {
      ...next.camera,
      preset: 'custom',
      projection: normalized.projection,
      fov: normalized.fov,
      position,
      target: center,
      orthographicHeight: Math.max(0.01, normalized.frameHeightFactor * radius),
      verticalCorrection: normalized.verticalCorrection,
      keepVerticalsParallel: normalized.verticalCorrection,
      heading: normalized.heading,
      elevation: normalized.elevation,
      cameraDistance: normalized.distanceFactor * radius,
    };
    next.activeViewPresetId = activeViewPresetId;
    next.viewPresetBaseId = activeViewPresetId;
    updateState(next);
  }

  function applyViewPreset(id) {
    const preset = viewPresets.find((entry) => entry.id === id);
    if (!preset) return false;
    activeViewPresetId = preset.id;
    setActiveRenderViewPresetId(activeViewPresetId);
    applyViewCamera(preset.camera);
    return true;
  }

  async function saveCurrentViewPreset() {
    const name = await requestPresetName('My View');
    if (!String(name).trim()) return false;
    const preset = await saveRenderViewPreset({ name, camera: getNormalizedViewCamera() });
    viewPresets = [preset, ...viewPresets.filter((entry) => entry.id !== preset.id)];
    activeViewPresetId = preset.id;
    const next = clone(state);
    next.activeViewPresetId = preset.id;
    next.viewPresetBaseId = preset.id;
    state = sanitizeRenderSettings(next);
    updateControls();
    notifyStateChange();
    return true;
  }

  async function removeCurrentViewPreset() {
    const id = elements.viewPreset?.value || activeViewPresetId;
    if (!id) return false;
    await deleteRenderViewPreset(id);
    viewPresets = viewPresets.filter((entry) => entry.id !== id);
    activeViewPresetId = '';
    const next = clone(state);
    next.activeViewPresetId = '';
    state = sanitizeRenderSettings(next);
    if (elements.undoViewPreset) elements.undoViewPreset.hidden = false;
    windowRef.clearTimeout(viewUndoTimer);
    viewUndoTimer = windowRef.setTimeout(() => {
      if (elements.undoViewPreset) elements.undoViewPreset.hidden = true;
    }, 10_000);
    updateControls();
    return true;
  }

  async function undoCurrentViewPresetDelete() {
    const restored = await undoDeleteRenderViewPreset();
    if (!restored) return false;
    viewPresets = [restored, ...viewPresets.filter((entry) => entry.id !== restored.id)];
    activeViewPresetId = restored.id;
    if (elements.undoViewPreset) elements.undoViewPreset.hidden = true;
    updateControls();
    return true;
  }

  function getExportDialogKind() {
    if (elements.exportDialog?.open && elements.exportKind?.value) {
      return elements.exportKind.value;
    }
    return exportDialogDraftKind ?? state.output.kind;
  }

  function updateExportPreflight() {
    if (!elements.exportPreflight) return null;
    const output = state.output;
    const kind = getExportDialogKind();
    const hasFinishes = (getArtworks?.() || []).some((entry) => (
      entry?.visible !== false && entry?.outputRole !== 'print' && entry?.finish
    ));
    lastPreflight = runRenderExportPreflight({
      kind,
      format: kind === 'sequence' ? output.sequence.format : output.format,
      settings: state,
      diagnostics: renderer?.getDiagnostics?.() || {},
      rendererAvailable: Boolean(renderer),
      hasFinishes,
    });
    const statusLabel = lastPreflight.status === 'blocked'
      ? t('renderPreflightBlocked')
      : lastPreflight.status === 'warning'
        ? t('renderPreflightWarning')
        : t('renderPreflightReady');
    const details = `${lastPreflight.dimensions.width} × ${lastPreflight.dimensions.height} px · ${formatMegabytes(lastPreflight.estimatedBytes)}`;
    const issueLines = lastPreflight.issues
      .filter((entry) => entry.severity !== 'info')
      .map((entry) => `${entry.severity === 'error' ? '⛔' : '⚠'} ${renderPreflightIssueText(entry)}`);
    elements.exportPreflight.className = `render-export-preflight is-${lastPreflight.status}`;
    elements.exportPreflight.replaceChildren();
    const status = documentRef.createElement('strong');
    status.textContent = `${statusLabel} · ${details}`;
    elements.exportPreflight.append(status);
    if (issueLines.length) {
      const list = documentRef.createElement('span');
      list.textContent = issueLines.join(' ');
      elements.exportPreflight.append(list);
    }
    if (elements.exportConfirm) elements.exportConfirm.disabled = lastPreflight.status === 'blocked';
    if (elements.exportGlbWarning) elements.exportGlbWarning.hidden = !lastPreflight.issues.some((entry) => entry.code === 'basic-glb-finishes');
    return lastPreflight;
  }

  function updateExportDialog() {
    const output = state.output;
    if (!elements.exportFormat) return;
    const dialogOpen = Boolean(elements.exportDialog?.open);
    const kind = getExportDialogKind();
    const format = dialogOpen ? elements.exportFormat.value : output.format;
    const sizingMode = dialogOpen ? elements.exportSizing.value : output.sizingMode;
    if (!dialogOpen) {
      if (elements.exportKind) elements.exportKind.value = kind;
      elements.exportFormat.value = output.format;
      elements.exportSizing.value = output.sizingMode;
      elements.exportWidth.value = String(output.widthPx);
      elements.exportHeight.value = String(output.heightPx);
      elements.exportUnit.value = output.printUnit;
      elements.exportPrintWidth.value = String(output.printWidth);
      elements.exportPrintHeight.value = String(output.printHeight);
      elements.exportPpi.value = String(output.ppi);
      elements.exportJpegQuality.value = String(output.jpegQuality);
      elements.exportJpegQualityValue.value = `${Math.round(output.jpegQuality * 100)}%`;
      if (elements.exportSequenceFrames) elements.exportSequenceFrames.value = String(output.sequence.frames);
      if (elements.exportSequenceLongEdge) elements.exportSequenceLongEdge.value = String(output.sequence.longEdge);
      if (elements.exportSequenceFormat) elements.exportSequenceFormat.value = output.sequence.format;
      if (elements.exportGlbTextureSize) elements.exportGlbTextureSize.value = String(output.glb.textureSize);
      if (elements.exportGlbMaterialMode) elements.exportGlbMaterialMode.value = output.glb.materialMode;
      if (elements.exportGlbIncludeCamera) elements.exportGlbIncludeCamera.checked = output.glb.includeCamera;
      if (elements.exportLockAspect) elements.exportLockAspect.checked = output.lockAspect;
    }
    if (elements.exportImageOptions) elements.exportImageOptions.hidden = kind !== 'image';
    if (elements.exportSequenceOptions) elements.exportSequenceOptions.hidden = kind !== 'sequence';
    if (elements.exportGlbOptions) elements.exportGlbOptions.hidden = kind !== 'glb';
    const printVisible = sizingMode === 'print';
    const pixelsVisible = sizingMode === 'pixels';
    const jpegQualityField = elements.exportJpegQuality?.closest('#renderJpegQualityField');
    if (jpegQualityField) jpegQualityField.hidden = kind !== 'image' || format !== 'jpg';
    const printGroup = elements.exportPrintWidth?.closest('.render-export-print');
    const pixelsGroup = elements.exportWidth?.closest('.render-export-pixels');
    if (printGroup) printGroup.hidden = kind !== 'image' || !printVisible;
    if (pixelsGroup) pixelsGroup.hidden = kind !== 'image' || !pixelsVisible;
    if (elements.exportSummary) {
      if (kind === 'sequence') {
        const dimensions = getTurntableDimensions(state, output.sequence.longEdge);
        const allowed = isTurntableWithinPixelBudget({ ...output.sequence, ...dimensions });
        elements.exportSummary.textContent = t('renderTurntableSummary', {
          frames: output.sequence.frames,
          width: dimensions.width,
          height: dimensions.height,
          status: allowed ? '' : ` · ${t('renderTurntableTooLarge')}`,
        });
      } else if (kind === 'glb') {
        elements.exportSummary.textContent = t('renderGlbSummary', {
          textureSize: output.glb.textureSize === 'auto' ? t('renderExportAuto') : `${output.glb.textureSize}px`,
          materialMode: output.glb.materialMode === 'full-pbr' ? t('renderGlbFullPbr') : t('renderGlbCompatibility'),
        });
      } else {
        const dimensions = getRenderOutputDimensions(state);
        elements.exportSummary.textContent = t('renderExportSummary', dimensions);
      }
    }
    updateExportPreflight();
  }

  function openExportDialog(format = state.output.format, kind = 'image') {
    if (!hasVisibleRenderArtwork()) return handleMissingArtwork();
    if (!elements.exportDialog?.showModal) return exportImage(format);
    exportDialogDraftKind = kind;
    state.output.kind = kind;
    elements.exportFormat.value = format;
    updateExportDialog();
    elements.exportFormat.value = format;
    elements.exportDialog.showModal();
    return true;
  }

  function updateControls() {
    elements.cameraPreset.value = state.camera.preset;
    elements.projection.value = state.camera.projection;
    elements.fov.value = String(state.camera.fov);
    elements.fovValue.value = `${Math.round(state.camera.fov)}°`;
    if (elements.lens) elements.lens.value = state.camera.lens || 'custom';
    if (elements.lensValue) elements.lensValue.textContent = `${Number(state.camera.focalLength || 35).toFixed(1)} mm · ${Math.round(state.camera.fov)}°`;
    if (elements.heading) elements.heading.value = String(Math.round(state.camera.heading || 0));
    if (elements.cameraElevation) elements.cameraElevation.value = String(Math.round(state.camera.elevation || 0));
    if (elements.panX) elements.panX.value = String(Number(state.camera.horizontalPan || 0).toFixed(1));
    if (elements.panY) elements.panY.value = String(Number(state.camera.verticalPan || 0).toFixed(1));
    if (elements.cameraDistance) elements.cameraDistance.value = String(Number(state.camera.cameraDistance || 0).toFixed(1));
    if (elements.frameHeight) elements.frameHeight.value = String(Number(state.camera.frameHeight || state.camera.orthographicHeight || 0).toFixed(1));
    if (elements.verticalCorrection) {
      elements.verticalCorrection.checked = state.camera.verticalCorrection === true;
      elements.verticalCorrection.disabled = state.camera.projection === 'orthographic';
    }
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
    const environmentMap = state.lighting.environmentMap;
    if (elements.environmentMapPreset) elements.environmentMapPreset.value = environmentMap.source === 'builtin' ? environmentMap.presetId : environmentMap.source;
    if (elements.environmentMapUsage) elements.environmentMapUsage.value = environmentMap.usage;
    if (elements.environmentMapRotation) {
      elements.environmentMapRotation.value = String(environmentMap.rotation);
      if (elements.environmentMapRotationValue) elements.environmentMapRotationValue.value = `${Math.round(environmentMap.rotation)}°`;
      setRangeProgress(elements.environmentMapRotation, environmentMap.rotation);
    }
    if (elements.environmentMapBackgroundIntensity) {
      elements.environmentMapBackgroundIntensity.value = String(environmentMap.backgroundIntensity);
      if (elements.environmentMapBackgroundIntensityValue) elements.environmentMapBackgroundIntensityValue.value = environmentMap.backgroundIntensity.toFixed(2);
      setRangeProgress(elements.environmentMapBackgroundIntensity, environmentMap.backgroundIntensity);
    }
    if (elements.environmentMapBackgroundBlur) {
      elements.environmentMapBackgroundBlur.value = String(environmentMap.backgroundBlur);
      if (elements.environmentMapBackgroundBlurValue) elements.environmentMapBackgroundBlurValue.value = environmentMap.backgroundBlur.toFixed(2);
      setRangeProgress(elements.environmentMapBackgroundBlur, environmentMap.backgroundBlur);
    }
    if (elements.environmentMapResolution) elements.environmentMapResolution.value = String(environmentMap.resolutionCap);
    if (elements.environmentMapFileName) {
      const environmentDiagnostics = renderer?.getDiagnostics?.()?.environmentMap;
      if (!environmentAsset) {
        elements.environmentMapFileName.textContent = t('renderEnvironmentNoFile');
      } else if (environmentDiagnostics?.fallbackReason) {
        const requested = `${Number(environmentDiagnostics.requestedResolution || environmentMap.resolutionCap) / 1024}K`;
        elements.environmentMapFileName.textContent = `${environmentAsset.fileName} · ${requested} → Neutral Softbox · fallback: ${environmentDiagnostics.fallbackReason}`;
      } else if (environmentDiagnostics?.effectiveResolution) {
        const requested = `${Number(environmentDiagnostics.requestedResolution || environmentMap.resolutionCap) / 1024}K`;
        const effective = `${Number(environmentDiagnostics.effectiveResolution) / 1024}K`;
        const status = environmentDiagnostics.fallbackReason
          ? ` · fallback: ${environmentDiagnostics.fallbackReason}`
          : ` · ${environmentDiagnostics.cacheHit ? 'cache hit' : 'prepared'}`;
        elements.environmentMapFileName.textContent = `${environmentAsset.fileName} · ${requested} → ${effective}${status}`;
      } else {
        elements.environmentMapFileName.textContent = environmentAsset.fileName;
      }
    }
    elements.exposure.value = String(state.lighting.exposure);
    elements.exposureValue.value = state.lighting.exposure.toFixed(2);
    setRangeProgress(elements.exposure, state.lighting.exposure);
    elements.backgroundMode.value = state.background.mode;
    elements.backgroundColor.value = state.background.color;
    if (elements.backgroundFileName) {
      elements.backgroundFileName.textContent = state.background.image.fileName || t('renderBackgroundNoImage');
    }
    if (elements.backgroundFit) elements.backgroundFit.value = state.background.image.fit;
    if (elements.backgroundPositionX) {
      elements.backgroundPositionX.value = String(state.background.image.positionX);
      elements.backgroundPositionXValue.value = `${Math.round(state.background.image.positionX * 100)}%`;
      setRangeProgress(elements.backgroundPositionX, state.background.image.positionX);
    }
    if (elements.backgroundPositionY) {
      elements.backgroundPositionY.value = String(state.background.image.positionY);
      elements.backgroundPositionYValue.value = `${Math.round(state.background.image.positionY * 100)}%`;
      setRangeProgress(elements.backgroundPositionY, state.background.image.positionY);
    }
    if (elements.backgroundZoom) {
      elements.backgroundZoom.value = String(state.background.image.zoom);
      elements.backgroundZoomValue.value = `${state.background.image.zoom.toFixed(2)}×`;
      setRangeProgress(elements.backgroundZoom, state.background.image.zoom);
    }
    if (elements.backgroundBrightness) {
      elements.backgroundBrightness.value = String(state.background.image.brightness);
      elements.backgroundBrightnessValue.value = state.background.image.brightness.toFixed(2);
      setRangeProgress(elements.backgroundBrightness, state.background.image.brightness);
    }
    if (elements.backgroundOverlayOpacity) {
      elements.backgroundOverlayOpacity.value = String(state.background.image.overlayOpacity);
      elements.backgroundOverlayOpacityValue.value = `${Math.round(state.background.image.overlayOpacity * 100)}%`;
      setRangeProgress(elements.backgroundOverlayOpacity, state.background.image.overlayOpacity);
    }
    if (elements.backgroundOverlayColor) elements.backgroundOverlayColor.value = state.background.image.overlayColor;
    if (elements.backgroundBlur) {
      elements.backgroundBlur.value = String(state.background.image.blur);
      if (elements.backgroundBlurValue) elements.backgroundBlurValue.value = `${state.background.image.blur.toFixed(1)} px`;
      setRangeProgress(elements.backgroundBlur, state.background.image.blur);
    }
    elements.shadowEnabled.checked = state.shadows.enabled;
    elements.shadowIntensity.value = String(state.shadows.intensity);
    elements.shadowIntensityValue.value = state.shadows.intensity.toFixed(2);
    setRangeProgress(elements.shadowIntensity, state.shadows.intensity);
    elements.shadowBlur.value = String(state.shadows.blur);
    elements.shadowBlurValue.value = state.shadows.blur.toFixed(1);
    setRangeProgress(elements.shadowBlur, state.shadows.blur);
    elements.transparentShadow.checked = state.shadows.includeInTransparentExport;
    if (elements.shadowMapSize) elements.shadowMapSize.value = String(state.shadows.mapSize);
    if (elements.floorReflectionEnabled) elements.floorReflectionEnabled.checked = state.floor.reflection.enabled;
    if (elements.floorReflectionStrength) {
      elements.floorReflectionStrength.value = String(state.floor.reflection.strength);
      elements.floorReflectionStrengthValue.value = state.floor.reflection.strength.toFixed(2);
      setRangeProgress(elements.floorReflectionStrength, state.floor.reflection.strength);
    }
    if (elements.floorReflectionBlur) {
      elements.floorReflectionBlur.value = String(state.floor.reflection.blur);
      elements.floorReflectionBlurValue.value = state.floor.reflection.blur.toFixed(2);
      setRangeProgress(elements.floorReflectionBlur, state.floor.reflection.blur);
    }
    if (elements.floorReflectionFade) {
      elements.floorReflectionFade.value = String(state.floor.reflection.fadeDistance);
      elements.floorReflectionFadeValue.value = state.floor.reflection.fadeDistance.toFixed(2);
      setRangeProgress(elements.floorReflectionFade, state.floor.reflection.fadeDistance);
    }
    if (elements.transparentReflection) elements.transparentReflection.checked = state.floor.reflection.includeInTransparentExport;
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
    if (elements.aaInteractive) elements.aaInteractive.value = effects.antialiasing.interactive;
    if (elements.aaSettled) elements.aaSettled.value = effects.antialiasing.settled;
    if (elements.aaExport) elements.aaExport.value = effects.antialiasing.export;
    if (elements.aaTaaSamples) {
      elements.aaTaaSamples.value = String(effects.antialiasing.taaSamples);
      if (elements.aaTaaSamplesValue) elements.aaTaaSamplesValue.value = String(effects.antialiasing.taaSamples);
      setRangeProgress(elements.aaTaaSamples, effects.antialiasing.taaSamples);
    }
    const quality = state.quality;
    if (elements.qualityInteractive) elements.qualityInteractive.value = quality.interactive;
    if (elements.qualityExport) elements.qualityExport.value = quality.export;
    if (elements.qualityHtml) elements.qualityHtml.value = quality.html;
    if (elements.namedPreset) elements.namedPreset.value = activeNamedPresetId;
    updateNamedPresetOptions();
    updateViewPresetOptions();
    updatePresetButtons();
    updateArtworkQualityList();
    updateFinishSummary();
    updateViewportOverlay();
    updateExportDialog();
    updateDiagnostics();
    if (state.activeViewPresetId && !viewPresets.some((entry) => entry.id === state.activeViewPresetId)) {
      // A project may reference a global preset that is unavailable on this device.
      // Keep the exact camera vectors and expose the state as Custom.
      if (elements.viewPreset) elements.viewPreset.value = '';
    }
  }

  function updateDiagnostics() {
    if (!elements.diagnosticsOutput) return;
    const diagnostics = renderer?.getDiagnostics?.() || { contextState: active ? 'unavailable' : 'initializing' };
    const health = diagnostics.health || getRenderHealth(diagnostics);
    const quality = diagnostics.quality || {};
    const lines = [
      `backend: ${diagnostics.backend || 'WebGL2'}`,
      `health: ${health.status}`,
      `context: ${diagnostics.contextState || 'initializing'} · recoveries: ${diagnostics.contextRecoveryCount || 0}`,
      `drawing buffer: ${diagnostics.drawingBufferWidth || 0}×${diagnostics.drawingBufferHeight || 0}`,
      `quality: ${diagnostics.qualityState || quality.state || 'interactive'}`,
      `render scale: ${Number(diagnostics.renderScale ?? quality.renderScale ?? 1).toFixed(2)}`,
      `frame time: ${Number(quality.frameTime || 0).toFixed(1)} ms · p95: ${Number(quality.frameTimeP95 || 0).toFixed(1)} ms · target: ${Number(quality.targetFrameMs || 0).toFixed(1)} ms`,
      `passes: ${(diagnostics.passes || []).join(' → ') || 'none'}`,
      `shadow map: ${diagnostics.shadowMapSize || 0}`,
      `draw calls: ${diagnostics.calls || 0}`,
      `geometries/textures: ${diagnostics.geometries || 0}/${diagnostics.textures || 0}`,
    ];
    if (diagnostics.environmentMap) {
      const environment = diagnostics.environmentMap;
      const requested = environment.requestedResolution ? `${environment.requestedResolution} px` : 'n/a';
      const effective = environment.effectiveResolution ? `${environment.effectiveResolution}×${environment.height || 0}` : 'Neutral Softbox';
      const status = environment.fallbackReason
        ? `fallback: ${environment.fallbackReason}`
        : environment.cacheHit ? 'cache hit' : 'cache miss';
      lines.push(`environment: ${environment.assetId || environment.source || 'procedural'} · requested ${requested} · effective ${effective} · ${status} · cache ${environment.cacheEntries || 0}/2`);
    }
    if (diagnostics.lastExport) {
      lines.push(`last export: ${diagnostics.lastExport.width}×${diagnostics.lastExport.height} px · ${diagnostics.lastExport.durationMs} ms`);
    }
    elements.diagnosticsOutput.textContent = lines.join('\n');
  }

  function updateState(next, { notify = true, render = true } = {}) {
    exportController?.abort();
    const previousState = state;
    state = sanitizeRenderSettings(next);
    if (activeNamedPresetId && JSON.stringify(previousState) !== JSON.stringify(state)) {
      markRenderPresetModified();
    }
    updateControls();
    // Apply the serializable environment-map state before attaching a loaded
    // asset. This keeps a cap change from being overwritten by an in-flight
    // load that started with the previous map/cap pair.
    renderer?.updateSettings(state, { render });
    renderer?.setBackgroundAsset?.(backgroundAsset);
    const environmentSelection = state.lighting?.environmentMap || {};
    const previousEnvironmentSelection = previousState.lighting?.environmentMap || {};
    const builtinCapOnlyChange = environmentSelection.source === 'builtin'
      && previousEnvironmentSelection.source === 'builtin'
      && environmentSelection.presetId === previousEnvironmentSelection.presetId
      && environmentSelection.resolutionCap !== previousEnvironmentSelection.resolutionCap
      && Object.entries(environmentSelection)
        .filter(([key]) => key !== 'resolutionCap')
        .every(([key, value]) => value === previousEnvironmentSelection[key]);
    const environmentAssetMatchesState = !environmentAsset
      || (environmentSelection.source === 'builtin'
        && environmentAsset.source === 'builtin'
        && environmentAsset.presetId === environmentSelection.presetId)
      || (environmentSelection.source === 'custom' && environmentAsset.assetId === environmentSelection.assetId);
    // BoxScene.setEnvironmentMap already starts the bounded runtime rebuild
    // for a built-in cap-only change. Avoid immediately starting a second
    // generation through setEnvironmentAsset; that duplicate PMREM work can
    // exceed hosted SwiftShader's readiness budget and race diagnostics.
    if (environmentAssetMatchesState && !builtinCapOnlyChange) {
      renderer?.setEnvironmentAsset?.(environmentAsset);
    }
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
    if (!hasVisibleRenderArtwork()) return handleMissingArtwork();
    await ensureBackgroundAsset();
    await ensureEnvironmentAsset();
    if (!hasVisibleRenderArtwork()) return handleMissingArtwork();
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
        includeFinishMaps: true,
        materialProfile: state.material.profile,
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
          materialMaps: composed.materialMaps,
          renderSettings: state,
          boardAppearance,
          backgroundAsset,
          environmentAsset,
          windowRef,
          onContextLost: () => {
            renderContextState = 'lost';
            showRecovery('renderContextLost');
          },
          onContextRestored: () => {
            renderContextState = 'restored';
            renderContextRecoveryCount += 1;
            syncScene({ force: true });
          },
          onCameraChange: (camera) => {
            if (!active || disposed) return;
            renderer?.markInteraction?.();
            const previousViewId = state.activeViewPresetId || activeViewPresetId;
            state = sanitizeRenderSettings({
              ...state,
              camera: { ...state.camera, ...camera, preset: 'custom' },
              activeViewPresetId: '',
              viewPresetBaseId: previousViewId || state.viewPresetBaseId || '',
            });
            activeViewPresetId = '';
            markRenderPresetModified();
            updateControls();
            notifyStateChange();
          },
        });
        // A replacement renderer owns a fresh 1x1 post-processing composer.
        // Size it immediately; activate()'s resize frame may have run long ago
        // when artwork quality is changed from an already-open Render step.
        renderer.resize();
      } else {
        renderer.replaceArtwork(composed.canvas, composed.materialMaps, signatures.sceneModel);
        renderer.setBoardAppearance?.(boardAppearance);
        renderer.setBackgroundAsset?.(backgroundAsset);
      }
      structureSignature = signatures.structure;
      artworkSignature = signatures.artwork;
      renderer.updateSettings(state);
      renderContextState = 'ready';
      setBusy(false);
      setExportAvailability(true);
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
    const artworkDeadline = Date.now() + 750;
    while (!hasVisibleRenderArtwork() && active && !disposed && Date.now() < artworkDeadline) {
      await nextFrame();
    }
    if (!hasVisibleRenderArtwork()) {
      handleMissingArtwork();
      return false;
    }
    loadNamedPresets();
    loadViewPresets();
    updateControls();
    await syncScene();
    if (!hasVisibleRenderArtwork()) {
      handleMissingArtwork();
      return false;
    }
    windowRef.setTimeout(() => loadPresetThumbnails(), 0);
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

  function nextFrame() {
    return new Promise((resolve) => {
      if (typeof windowRef.requestAnimationFrame === 'function') windowRef.requestAnimationFrame(() => resolve());
      else windowRef.setTimeout(resolve, 16);
    });
  }

  async function whenStable({ timeoutMs = 5000 } = {}) {
    const deadline = Date.now() + Math.max(250, Number(timeoutMs) || 5000);
    while (Date.now() < deadline) {
      // Activation is scheduled from the workflow stepper. On a slow browser
      // the busy flag can settle in the same frame that a previous renderer is
      // disposed, leaving a brief renderer-less gap with no active sync. Make
      // the readiness probe heal that gap instead of returning a false
      // negative to diagnostics/visual gates.
      if (!renderer && !syncController && active && renderContextState !== 'lost' && hasVisibleRenderArtwork()) {
        await syncScene({ force: true });
        continue;
      }
      if (!syncController && renderer) break;
      await new Promise((resolve) => windowRef.setTimeout(resolve, 16));
    }
    if (!renderer || Date.now() >= deadline) return false;
    await nextFrame();
    await nextFrame();
    renderer.renderSettled?.();
    updateDiagnostics();
    return true;
  }

  function runExportPreflight(options = {}) {
    const output = state.output;
    const hasFinishes = (getArtworks?.() || []).some((entry) => (
      entry?.visible !== false && entry?.outputRole !== 'print' && entry?.finish
    ));
    return runRenderExportPreflight({
      kind: options.kind || output.kind,
      format: options.format || (output.kind === 'sequence' ? output.sequence.format : output.format),
      settings: options.settings || state,
      diagnostics: options.diagnostics || renderer?.getDiagnostics?.() || {},
      rendererAvailable: options.rendererAvailable ?? Boolean(renderer),
      hasFinishes: options.hasFinishes ?? hasFinishes,
    });
  }

  function restoreState(next, nextBoardAppearance = undefined) {
    exportController?.abort();
    state = sanitizeRenderSettings(next);
    restoreRenderAssets(availableRenderAssets);
    if (nextBoardAppearance !== undefined) {
      boardAppearance = canonicalBoardAppearance(nextBoardAppearance);
      renderer?.setBoardAppearance?.(boardAppearance);
    }
    renderer?.setBackgroundAsset?.(backgroundAsset);
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

  function applySettings({ renderSettings, boardAppearance } = {}) {
    activeNamedPresetId = '';
    setActiveRenderPresetId('');
    activeViewPresetId = '';
    setActiveRenderViewPresetId('');
    const next = clone(sanitizeRenderSettings(renderSettings || state));
    next.activeViewPresetId = '';
    next.viewPresetBaseId = state.viewPresetBaseId || '';
    restoreState(next, boardAppearance);
    return true;
  }

  async function loadNamedPresets() {
    try {
      namedPresets = await getRenderPresets();
      activeNamedPresetId = getActiveRenderPresetId();
      const activePreset = namedPresets.find((preset) => preset.id === activeNamedPresetId);
      if (activePreset) {
        boardAppearance = canonicalBoardAppearance(activePreset.boardAppearance);
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

  async function loadViewPresets() {
    try {
      viewPresets = await getRenderViewPresets();
      const persistedId = state.activeViewPresetId || activeViewPresetId;
      activeViewPresetId = viewPresets.some((entry) => entry.id === persistedId) ? persistedId : '';
      if (activeViewPresetId !== state.activeViewPresetId) {
        state = sanitizeRenderSettings({
          ...state,
          activeViewPresetId,
          viewPresetBaseId: activeViewPresetId ? state.viewPresetBaseId : (persistedId || state.viewPresetBaseId),
          camera: activeViewPresetId
            ? state.camera
            : { ...state.camera, preset: persistedId ? 'custom' : state.camera.preset },
        });
      }
      updateControls();
    } catch {
      viewPresets = [];
    }
  }

  function updateBoardAppearance(mutator, { notify = true } = {}) {
    const next = cloneBoardAppearance(boardAppearance);
    mutator(next);
    if (Number(next.thicknessMm) !== Number(boxModel.board?.caliperMm)) {
      boxModel.setBoardCaliper(next.thicknessMm);
    }
    boardAppearance = canonicalBoardAppearance(next);
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
    const name = await requestPresetName(elements.namedPreset?.dataset?.customName || 'My Render Preset');
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

  async function updateNamedPreset() {
    if (!activeNamedPresetId) return saveNamedPreset();
    const existing = namedPresets.find((entry) => entry.id === activeNamedPresetId);
    if (!existing || existing.builtIn) return false;
    const preset = await saveRenderPreset({
      id: existing.id,
      name: existing.name,
      renderSettings: getState(),
      boardAppearance,
      thumbnailId: existing.thumbnailId,
    });
    namedPresets = [preset, ...namedPresets.filter((entry) => entry.id !== preset.id)];
    updateControls();
    return true;
  }

  async function duplicateNamedPreset() {
    const source = namedPresets.find((entry) => entry.id === (elements.namedPreset?.value || activeNamedPresetId));
    if (!source) return false;
    const name = await requestPresetName(`${source.name} (2)`);
    if (!name.trim()) return false;
    const preset = await saveRenderPreset({ name, renderSettings: source.renderSettings, boardAppearance: source.boardAppearance, modifiedFromId: source.id });
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
    boardAppearance = canonicalBoardAppearance(preset.boardAppearance);
    updateState(preset.renderSettings);
    renderer?.setBoardAppearance?.(boardAppearance);
    persistSettings();
    onStateChange(getState());
    updateControls();
    return true;
  }

  function setBoardCaliper(caliperMm, { notify = true } = {}) {
    boxModel.setBoardCaliper(caliperMm);
    boardAppearance = canonicalBoardAppearance(boardAppearance);
    renderer?.setBoardAppearance?.(boardAppearance);
    renderer?.markInteraction?.();
    renderer?.render?.();
    updateControls();
    if (notify) {
      persistSettings();
      onStateChange(getState());
    }
  }

  async function removeNamedPreset() {
    const id = elements.namedPreset?.value || activeNamedPresetId;
    if (!id) return false;
    await deleteRenderPreset(id);
    namedPresets = namedPresets.filter((entry) => entry.id !== id);
    activeNamedPresetId = '';
    if (elements.undoNamedPreset) elements.undoNamedPreset.hidden = false;
    windowRef.clearTimeout(renderUndoTimer);
    renderUndoTimer = windowRef.setTimeout(() => {
      if (elements.undoNamedPreset) elements.undoNamedPreset.hidden = true;
    }, 10_000);
    updateControls();
    return true;
  }

  async function undoNamedPresetDelete() {
    const restored = await undoDeleteRenderPreset();
    if (!restored) return false;
    namedPresets = [restored, ...namedPresets.filter((entry) => entry.id !== restored.id)];
    activeNamedPresetId = restored.id;
    if (elements.undoNamedPreset) elements.undoNamedPreset.hidden = true;
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
    renderContextState = 'initializing';
    renderContextRecoveryCount = 0;
  }

  async function exportImage(format) {
    if (operationProgress?.isBusy?.()) return false;
    const exportState = getState();
    const preflight = runExportPreflight({ kind: 'image', format });
    if (preflight.status === 'blocked') {
      elements.status.textContent = t('renderPreflightBlocked');
      return false;
    }
    const dimensions = boxModel.dimensions;
    const extension = format === 'png' ? 'png' : 'jpg';
    const suggestedName = formatOutputName(dimensions, exportState.presetId, exportState.longEdge, extension);
    const destinationPromise = requestSaveDestination({
      suggestedName,
      types: createSaveTypes(format),
      windowRef,
    });
    return runForegroundExport({
      id: `render-image-${format}`,
      labelKey: 'projectExporting',
      work: async ({ signal, report, cancel }) => {
        if (!renderer && !(await activate())) return false;
        exportController?.abort();
        const controller = signal ? { signal, abort: cancel } : new AbortController();
        exportController = controller;
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
          report({ stageKey: 'operationProcessing', fraction: 0.25 });
          const blob = await renderStill({
            renderer,
            settings: exportState,
            format,
            documentRef,
            signal: controller.signal,
          });
          const destination = await destinationPromise;
          if (!destination) {
            cancel();
            return false;
          }
          report({ stageKey: 'exportWritingFile', fraction: 0.9 });
          await writeSaveDestination({
            destination,
            blob,
            suggestedName,
            types: createSaveTypes(format),
            windowRef,
            documentRef,
            signal: controller.signal,
            onProgress: (written, total) => report({
              stageKey: 'exportWritingFile',
              fraction: 0.9 + (total ? (written / total) * 0.1 : 0.1),
            }),
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
      },
    });
  }

  async function runExperimentalPathTracing() {
    if (!isPathTracingEnabled()) return false;
    if (!hasVisibleRenderArtwork()) return handleMissingArtwork();
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
    button.addEventListener('click', () => updateState(applyRenderPreset(state, button.dataset.renderPreset, { preserveProjectSpecific: false })));
  }

  async function exportGlbAsset() {
    if (operationProgress?.isBusy?.()) return false;
    const exportState = getState();
    const preflight = runExportPreflight({ kind: 'glb', format: 'glb' });
    if (preflight.status === 'blocked') {
      elements.status.textContent = t('renderPreflightBlocked');
      return false;
    }
    const dimensions = boxModel.dimensions;
    const suggestedName = `carton-${Number(dimensions.width).toFixed(2)}x${Number(dimensions.height).toFixed(2)}x${Number(dimensions.depth).toFixed(2)}mm-${exportState.material.profile}.glb`;
    const destinationPromise = requestSaveDestination({
      suggestedName,
      types: createSaveTypes('glb'),
      windowRef,
    });
    return runForegroundExport({
      id: 'render-glb',
      labelKey: 'projectExporting',
      work: async ({ signal, report, cancel }) => {
        if (!renderer && !(await activate())) return false;
        exportController?.abort();
        const controller = signal ? { signal, abort: cancel } : new AbortController();
        exportController = controller;
        setBusy(true);
        elements.status.textContent = t('renderGlbExporting');
        try {
          const { exportGlb } = await import('./GlbExportService.js');
          const textureSize = exportState.output.glb.textureSize === 'auto'
            ? 2048
            : Number(exportState.output.glb.textureSize);
          const synced = await syncScene({
            force: true,
            purpose: 'render-export',
            targetDpi: getRenderTextureDpi(boxModel, { width: textureSize, height: textureSize }),
          });
          if (!synced || !renderer) throw new Error('Render scene could not be prepared for GLB export.');
          const blob = await exportGlb({
            renderer,
            options: exportState.output.glb,
            signal: controller.signal,
            onProgress: (progress) => {
              report({ stageKey: 'operationProcessing', fraction: 0.05 + progress * 0.85 });
              elements.status.textContent = `${t('renderGlbExporting')} ${Math.round(progress * 100)}%`;
            },
          });
          const destination = await destinationPromise;
          if (!destination) {
            cancel();
            return false;
          }
          await writeSaveDestination({
            destination,
            blob,
            suggestedName,
            types: createSaveTypes('glb'),
            windowRef,
            documentRef,
            signal: controller.signal,
            onProgress: (written, total) => report({
              stageKey: 'exportWritingFile',
              fraction: 0.9 + (total ? (written / total) * 0.1 : 0.1),
            }),
          });
          elements.status.textContent = t('renderGlbExported');
          return true;
        } catch (error) {
          if (error?.name !== 'AbortError') {
            console.error('Could not export GLB', error);
            elements.status.textContent = t('renderGlbExportFailed');
          }
          return false;
        } finally {
          if (!disposed && exportController === controller) setBusy(false);
          if (exportController === controller) exportController = null;
        }
      },
    });
  }

  async function exportTurntableAsset() {
    if (operationProgress?.isBusy?.()) return false;
    const exportState = getState();
    const preflight = runExportPreflight({ kind: 'sequence', format: exportState.output.sequence.format });
    if (preflight.status === 'blocked') {
      elements.status.textContent = t('renderPreflightBlocked');
      return false;
    }
    const sequenceOptions = sanitizeTurntableOptions(exportState.output.sequence);
    const suggestedName = `carton-turntable-${sequenceOptions.frames}f-${sequenceOptions.longEdge}px.zip`;
    const destinationPromise = requestSaveDestination({
      suggestedName,
      types: createSaveTypes('zip'),
      windowRef,
    });
    return runForegroundExport({
      id: 'render-turntable',
      labelKey: 'projectExporting',
      work: async ({ signal, report, cancel }) => {
        if (!renderer && !(await activate())) return false;
        exportController?.abort();
        const controller = signal ? { signal, abort: cancel } : new AbortController();
        exportController = controller;
        setBusy(true);
        elements.status.textContent = t('renderTurntableExporting');
        try {
          const { exportTurntable } = await import('./TurntableExportService.js');
          const dimensions = getTurntableDimensions(exportState, sequenceOptions.longEdge);
          if (!isTurntableWithinPixelBudget({ ...sequenceOptions, ...dimensions })) {
            throw new Error(t('renderTurntableTooLarge'));
          }
          const synced = await syncScene({
            force: true,
            purpose: 'render-export',
            targetDpi: getRenderTextureDpi(boxModel, dimensions),
          });
          if (!synced || !renderer) throw new Error('Render scene could not be prepared for turntable export.');
          const blob = await exportTurntable({
            renderer,
            settings: exportState,
            options: sequenceOptions,
            documentRef,
            signal: controller.signal,
            onProgress: (progress) => {
              report({ stageKey: 'operationProcessing', fraction: 0.05 + progress * 0.85 });
              elements.status.textContent = `${t('renderTurntableExporting')} ${Math.round(progress * 100)}%`;
            },
          });
          const destination = await destinationPromise;
          if (!destination) {
            cancel();
            return false;
          }
          await writeSaveDestination({
            destination,
            blob,
            suggestedName,
            types: createSaveTypes('zip'),
            windowRef,
            documentRef,
            signal: controller.signal,
            onProgress: (written, total) => report({
              stageKey: 'exportWritingFile',
              fraction: 0.9 + (total ? (written / total) * 0.1 : 0.1),
            }),
          });
          elements.status.textContent = t('renderTurntableExported');
          return true;
        } catch (error) {
          if (error?.name !== 'AbortError') {
            console.error('Could not export turntable', error);
            elements.status.textContent = error?.message || t('renderTurntableExportFailed');
          }
          return false;
        } finally {
          if (!disposed && exportController === controller) setBusy(false);
          if (exportController === controller) exportController = null;
        }
      },
    });
  }
  elements.cameraPreset.addEventListener('change', (event) => change((next) => { next.camera.preset = event.target.value; }));
  elements.projection.addEventListener('change', (event) => change((next) => { next.camera.projection = event.target.value; }));
  elements.fov.addEventListener('input', (event) => change((next) => { next.camera.fov = Number(event.target.value); }));
  const updateAdvancedCamera = (field, value) => change((next) => {
    next.camera[field] = Number(value);
    if (['heading', 'elevation', 'cameraDistance'].includes(field)) {
      const { center, radius } = getBoxCenterRadius();
      const distance = field === 'cameraDistance'
        ? Math.max(0.01, Number(value))
        : Math.max(0.01, Number(next.camera.cameraDistance || radius * 3));
      next.camera.position = cameraPositionFromHeading({
        heading: field === 'heading' ? Number(value) : Number(next.camera.heading),
        elevation: field === 'elevation' ? Number(value) : Number(next.camera.elevation),
        distance,
        target: center,
      });
      next.camera.target = center;
      next.camera.preset = 'custom';
      next.activeViewPresetId = '';
    }
  });
  elements.heading?.addEventListener('change', (event) => updateAdvancedCamera('heading', event.target.value));
  elements.cameraElevation?.addEventListener('change', (event) => updateAdvancedCamera('elevation', event.target.value));
  elements.panX?.addEventListener('change', (event) => updateAdvancedCamera('horizontalPan', event.target.value));
  elements.panY?.addEventListener('change', (event) => updateAdvancedCamera('verticalPan', event.target.value));
  elements.cameraDistance?.addEventListener('change', (event) => updateAdvancedCamera('cameraDistance', event.target.value));
  elements.frameHeight?.addEventListener('change', (event) => change((next) => {
    next.camera.frameHeight = Number(event.target.value);
    next.camera.orthographicHeight = Number(event.target.value);
  }));
  elements.lens?.addEventListener('change', (event) => change((next) => {
    const value = event.target.value;
    if (value !== 'custom') next.camera.fov = value === '35' ? 38.2 : value === '50' ? 27 : 16.1;
    next.camera.lens = value;
  }));
  elements.verticalCorrection?.addEventListener('change', (event) => change((next) => {
    next.camera.verticalCorrection = event.target.checked;
    next.camera.keepVerticalsParallel = event.target.checked;
  }));
  elements.fitCamera?.addEventListener('click', () => {
    renderer?.fitCameraToFrame?.({ aspect: getRenderOutputDimensions(state).width / getRenderOutputDimensions(state).height });
    const camera = renderer?.getCameraState?.();
    if (camera) change((next) => {
      next.camera = { ...next.camera, ...camera, preset: 'custom' };
      next.activeViewPresetId = '';
    });
  });
  elements.resetCamera?.addEventListener('click', () => {
    if (activeViewPresetId && viewPresets.some((entry) => entry.id === activeViewPresetId)) {
      applyViewPreset(activeViewPresetId);
      return;
    }
    renderer?.resetView?.();
    const camera = renderer?.getCameraState?.();
    if (camera) change((next) => {
      next.camera = { ...next.camera, ...camera };
      next.activeViewPresetId = '';
    });
  });
  elements.mirrorCamera?.addEventListener('click', () => {
    const camera = getState().camera;
    const target = Array.isArray(camera.target) && camera.target.length === 3
      ? [...camera.target]
      : [0, 0, 0];
    const mirroredPosition = [
      2 * target[0] - camera.position[0],
      camera.position[1],
      camera.position[2],
    ];
    const mirroredHeading = normalizeDegrees(
      Math.atan2(mirroredPosition[0] - target[0], mirroredPosition[2] - target[2]) * 180 / Math.PI,
    );
    const distance = Math.max(0.01, Math.hypot(
      mirroredPosition[0] - target[0],
      mirroredPosition[1] - target[1],
      mirroredPosition[2] - target[2],
    ));
    change((next) => {
      next.camera.preset = 'custom';
      next.camera.heading = mirroredHeading;
      next.camera.position = mirroredPosition;
      next.camera.target = target;
      next.camera.cameraDistance = distance;
      next.activeViewPresetId = '';
    });
  });
  elements.viewPreset?.addEventListener('change', (event) => applyViewPreset(event.target.value));
  elements.saveViewPreset?.addEventListener('click', saveCurrentViewPreset);
  elements.deleteViewPreset?.addEventListener('click', removeCurrentViewPreset);
  elements.duplicateViewPreset?.addEventListener('click', async () => {
    const id = elements.viewPreset?.value || activeViewPresetId;
    if (!id) return;
    const source = viewPresets.find((entry) => entry.id === id);
    const copy = await duplicateRenderViewPreset(id, source?.name || 'View preset');
    if (copy) {
      viewPresets = [copy, ...viewPresets.filter((entry) => entry.id !== copy.id)];
      activeViewPresetId = copy.id;
      updateControls();
    }
  });
  elements.aspect.addEventListener('change', (event) => change((next) => { next.aspect = event.target.value; }));
  elements.longEdge.addEventListener('change', (event) => change((next) => { next.longEdge = Number(event.target.value); }));
  elements.material.addEventListener('change', (event) => change((next) => { next.material.profile = event.target.value; }));
  elements.azimuth.addEventListener('input', (event) => change((next) => { next.lighting.azimuth = Number(event.target.value); }));
  elements.elevation.addEventListener('input', (event) => change((next) => { next.lighting.elevation = Number(event.target.value); }));
  elements.intensity.addEventListener('input', (event) => change((next) => { next.lighting.intensity = Number(event.target.value); }));
  elements.environment.addEventListener('change', (event) => change((next) => { next.lighting.environment = event.target.value; }));
  elements.environmentIntensity.addEventListener('input', (event) => change((next) => { next.lighting.environmentIntensity = Number(event.target.value); }));
  elements.environmentMapPreset?.addEventListener('change', async (event) => {
    const value = event.target.value;
    if (value === 'custom') return;
    environmentAssetLoadGeneration += 1;
    environmentAsset = null;
    const next = clone(state);
    next.lighting.environmentMap = {
      ...next.lighting.environmentMap,
      source: value === 'none' ? 'none' : 'builtin',
      presetId: value === 'none' ? 'no-reflections' : value,
      assetId: '',
    };
    updateState(next);
    const preset = getEnvironmentMapPreset(next.lighting.environmentMap.presetId);
    if (!preset?.assetUrl || !active) return;
    elements.status.textContent = t('renderEnvironmentLoading');
    try {
      const loadedAsset = await ensureEnvironmentAsset({ surfaceError: true });
      if (!loadedAsset || state.lighting?.environmentMap?.presetId !== preset.id) return;
      await renderer?.setEnvironmentAsset?.(loadedAsset);
      updateControls();
      renderer?.render?.();
      elements.status.textContent = t('renderEnvironmentLoaded');
    } catch (error) {
      elements.status.textContent = getUserErrorMessage(error, 'renderEnvironmentInvalid');
    }
  });
  elements.environmentMapFile?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await setEnvironmentMapFile(file);
      elements.status.textContent = t('renderEnvironmentLoaded');
    } catch (error) {
      elements.status.textContent = getUserErrorMessage(error, 'renderEnvironmentInvalid');
    } finally {
      event.target.value = '';
    }
  });
  elements.clearEnvironmentMap?.addEventListener('click', clearEnvironmentMap);
  elements.environmentMapUsage?.addEventListener('change', (event) => change((next) => { next.lighting.environmentMap.usage = event.target.value; }));
  elements.environmentMapRotation?.addEventListener('input', (event) => change((next) => { next.lighting.environmentMap.rotation = Number(event.target.value); }));
  elements.environmentMapBackgroundIntensity?.addEventListener('input', (event) => change((next) => { next.lighting.environmentMap.backgroundIntensity = Number(event.target.value); }));
  elements.environmentMapBackgroundBlur?.addEventListener('input', (event) => change((next) => { next.lighting.environmentMap.backgroundBlur = Number(event.target.value); }));
  elements.environmentMapResolution?.addEventListener('change', (event) => change((next) => { next.lighting.environmentMap.resolutionCap = Number(event.target.value); }));
  elements.exposure.addEventListener('input', (event) => change((next) => { next.lighting.exposure = Number(event.target.value); }));
  elements.backgroundMode.addEventListener('change', (event) => change((next) => { next.background.mode = event.target.value; }));
  elements.backgroundColor.addEventListener('input', (event) => change((next) => { next.background.color = event.target.value; }));
  elements.backgroundFile?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await setBackgroundImage(file);
      elements.status.textContent = t('renderBackgroundLoaded');
    } catch (error) {
      elements.status.textContent = error?.message || t('renderBackgroundInvalid');
    } finally {
      event.target.value = '';
    }
  });
  elements.clearBackground?.addEventListener('click', clearBackgroundImage);
  elements.backgroundFit?.addEventListener('change', (event) => change((next) => { next.background.image.fit = event.target.value; }));
  elements.backgroundPositionX?.addEventListener('input', (event) => change((next) => { next.background.image.positionX = Number(event.target.value); }));
  elements.backgroundPositionY?.addEventListener('input', (event) => change((next) => { next.background.image.positionY = Number(event.target.value); }));
  elements.backgroundZoom?.addEventListener('input', (event) => change((next) => { next.background.image.zoom = Number(event.target.value); }));
  elements.backgroundBrightness?.addEventListener('input', (event) => change((next) => { next.background.image.brightness = Number(event.target.value); }));
  elements.backgroundOverlayOpacity?.addEventListener('input', (event) => change((next) => { next.background.image.overlayOpacity = Number(event.target.value); }));
  elements.backgroundOverlayColor?.addEventListener('input', (event) => change((next) => { next.background.image.overlayColor = event.target.value; }));
  elements.backgroundBlur?.addEventListener('input', (event) => change((next) => { next.background.image.blur = Number(event.target.value); }));
  elements.shadowEnabled.addEventListener('change', (event) => change((next) => { next.shadows.enabled = event.target.checked; }));
  elements.shadowIntensity.addEventListener('input', (event) => change((next) => { next.shadows.intensity = Number(event.target.value); }));
  elements.shadowBlur.addEventListener('input', (event) => change((next) => { next.shadows.blur = Number(event.target.value); }));
  elements.transparentShadow.addEventListener('change', (event) => change((next) => { next.shadows.includeInTransparentExport = event.target.checked; }));
  elements.shadowMapSize?.addEventListener('change', (event) => change((next) => { next.shadows.mapSize = Number(event.target.value); }));
  elements.floorReflectionEnabled?.addEventListener('change', (event) => change((next) => { next.floor.reflection.enabled = event.target.checked; }));
  elements.floorReflectionStrength?.addEventListener('input', (event) => change((next) => { next.floor.reflection.strength = Number(event.target.value); }));
  elements.floorReflectionBlur?.addEventListener('input', (event) => change((next) => { next.floor.reflection.blur = Number(event.target.value); }));
  elements.floorReflectionFade?.addEventListener('input', (event) => change((next) => { next.floor.reflection.fadeDistance = Number(event.target.value); }));
  elements.transparentReflection?.addEventListener('change', (event) => change((next) => { next.floor.reflection.includeInTransparentExport = event.target.checked; }));
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
  elements.aaInteractive?.addEventListener('change', (event) => change((next) => { next.effects.antialiasing.interactive = event.target.value; }));
  elements.aaSettled?.addEventListener('change', (event) => change((next) => { next.effects.antialiasing.settled = event.target.value; }));
  elements.aaExport?.addEventListener('change', (event) => change((next) => { next.effects.antialiasing.export = event.target.value; }));
  elements.aaTaaSamples?.addEventListener('input', (event) => change((next) => { next.effects.antialiasing.taaSamples = Number(event.target.value); }));
  elements.qualityInteractive?.addEventListener('change', (event) => change((next) => { next.quality.interactive = event.target.value; }));
  elements.qualityExport?.addEventListener('change', (event) => change((next) => { next.quality.export = event.target.value; }));
  elements.qualityHtml?.addEventListener('change', (event) => change((next) => { next.quality.html = event.target.value; }));
  elements.namedPreset?.addEventListener('change', applyNamedPreset);
  elements.saveNamedPreset?.addEventListener('click', saveNamedPreset);
  elements.updateNamedPreset?.addEventListener('click', updateNamedPreset);
  elements.duplicateNamedPreset?.addEventListener('click', duplicateNamedPreset);
  elements.deleteNamedPreset?.addEventListener('click', removeNamedPreset);
  elements.undoViewPreset?.addEventListener('click', undoCurrentViewPresetDelete);
  elements.undoNamedPreset?.addEventListener('click', undoNamedPresetDelete);
  if (elements.experimentalPathTracing) {
    elements.experimentalPathTracing.hidden = !isPathTracingEnabled();
    elements.experimentalPathTracing.addEventListener('click', runExperimentalPathTracing);
  }
  elements.png.addEventListener('click', () => openExportDialog('png'));
  elements.jpg.addEventListener('click', () => openExportDialog('jpg'));
  elements.exportKind?.addEventListener('change', (event) => {
    exportDialogDraftKind = event.target.value;
    updateExportDialog();
  });
  elements.exportSizing?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.sizingMode = event.target.value;
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportFormat?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.format = event.target.value;
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportWidth?.addEventListener('input', (event) => {
    const next = clone(state);
    next.output.widthPx = Number(event.target.value);
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportHeight?.addEventListener('input', (event) => {
    const next = clone(state);
    next.output.heightPx = Number(event.target.value);
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportUnit?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.printUnit = event.target.value;
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportPrintWidth?.addEventListener('input', (event) => {
    const next = clone(state);
    next.output.printWidth = Number(event.target.value);
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportPrintHeight?.addEventListener('input', (event) => {
    const next = clone(state);
    next.output.printHeight = Number(event.target.value);
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportPpi?.addEventListener('input', (event) => {
    const next = clone(state);
    next.output.ppi = Number(event.target.value);
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportJpegQuality?.addEventListener('input', (event) => {
    const next = clone(state);
    next.output.jpegQuality = Number(event.target.value);
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportSequenceFrames?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.sequence.frames = Number(event.target.value);
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportSequenceLongEdge?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.sequence.longEdge = Number(event.target.value);
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportSequenceFormat?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.sequence.format = event.target.value;
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportGlbTextureSize?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.glb.textureSize = event.target.value === 'auto' ? 'auto' : Number(event.target.value);
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportGlbMaterialMode?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.glb.materialMode = event.target.value;
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportGlbIncludeCamera?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.glb.includeCamera = event.target.checked;
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportLockAspect?.addEventListener('change', (event) => {
    const next = clone(state);
    next.output.lockAspect = event.target.checked;
    state = sanitizeRenderSettings(next);
    updateExportDialog();
  });
  elements.exportForm?.addEventListener('submit', async (event) => {
    if (event.submitter?.value !== 'confirm') return;
    event.preventDefault();
    const preflight = updateExportPreflight();
    if (preflight?.status === 'blocked') return;
    const format = elements.exportFormat.value;
    const next = clone(state);
    next.output.format = format;
    next.output.sizingMode = elements.exportSizing.value;
    next.output.widthPx = Number(elements.exportWidth.value);
    next.output.heightPx = Number(elements.exportHeight.value);
    next.output.printUnit = elements.exportUnit.value;
    next.output.printWidth = Number(elements.exportPrintWidth.value);
    next.output.printHeight = Number(elements.exportPrintHeight.value);
    next.output.ppi = Number(elements.exportPpi.value);
    next.output.jpegQuality = Number(elements.exportJpegQuality.value);
    next.output.kind = elements.exportKind?.value || 'image';
    next.output.sequence.frames = Number(elements.exportSequenceFrames?.value || next.output.sequence.frames);
    next.output.sequence.longEdge = Number(elements.exportSequenceLongEdge?.value || next.output.sequence.longEdge);
    next.output.sequence.format = elements.exportSequenceFormat?.value || next.output.sequence.format;
    next.output.glb.textureSize = elements.exportGlbTextureSize?.value === 'auto'
      ? 'auto'
      : Number(elements.exportGlbTextureSize?.value || next.output.glb.textureSize);
    next.output.glb.materialMode = elements.exportGlbMaterialMode?.value || next.output.glb.materialMode;
    next.output.glb.includeCamera = elements.exportGlbIncludeCamera?.checked !== false;
    next.output.lockAspect = elements.exportLockAspect?.checked !== false;
    updateState(next);
    elements.exportDialog.close();
    if (next.output.kind === 'glb') await exportGlbAsset();
    else if (next.output.kind === 'sequence') await exportTurntableAsset();
    else await exportImage(format);
  });
  elements.exportDialog?.addEventListener('close', () => {
    exportDialogDraftKind = null;
    updateExportDialog();
  });
  elements.back?.addEventListener('click', onBackToPreview);
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
    applySettings,
    setHtmlExportQuality,
    resetForProject,
    exportImage,
    exportGlb: exportGlbAsset,
    exportTurntable: exportTurntableAsset,
    openExportDialog,
    getState,
    getRenderAssets,
    restoreRenderAssets,
    setBackgroundImage,
    clearBackgroundImage,
    setEnvironmentMapFile,
    clearEnvironmentMap,
    setBoardCaliper,
    refreshArtworkVisibility,
    getBoardAppearance() {
      return cloneBoardAppearance(boardAppearance);
    },
    refreshArtwork() {
      if (!active) return Promise.resolve(false);
      return syncScene({ force: true });
    },
    whenStable,
    runExportPreflight,
    render() {
      renderer?.render();
    },
    getDiagnostics() {
      const diagnostics = renderer?.getDiagnostics() || {
        backend: 'WebGL2',
        contextState: active ? (renderContextState === 'initializing' ? 'unavailable' : renderContextState) : 'initializing',
        panels: 0,
        geometries: 0,
        textures: 0,
        calls: 0,
      };
      const normalized = {
        ...diagnostics,
        contextState: renderContextState === 'initializing' ? diagnostics.contextState : renderContextState,
        contextRecoveryCount: Math.max(diagnostics.contextRecoveryCount || 0, renderContextRecoveryCount),
      };
      return normalized.health ? normalized : { ...normalized, health: getRenderHealth(normalized) };
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
