import './styles/main.css';

import { createArtworkApp } from './artwork/ArtworkApp.js';
import { initializeI18n, t } from './i18n.js';
import { BoxNetModel } from './model/BoxNetModel.js';
import { QUICK_CONSTRUCTION_MIGRATION_FLAG } from './model/quickCustomNet.js';
import {
  EDGES,
  FACE_BY_NORMAL,
  OPPOSITE_EDGE,
  getAdjacentBasis,
  rectanglesOverlap,
} from './model/geometry.js';
import { createLazyPreview3DFacade } from './preview3d/lazyPreview3d.js';
import { composeArtworkTexture } from './preview3d/textureComposer.js';
import { createBoxNetApp } from './ui/app.js';
import { createSettingsModal } from './ui/SettingsModal.js';
import { createFileMenu } from './ui/FileMenu.js';
import { createEditMenu } from './ui/EditMenu.js';
import { createViewMenu } from './ui/ViewMenu.js';
import { createContactsMenu } from './ui/ContactsMenu.js';
import { createPanelDock } from './ui/PanelDock.js';
import { createOperationProgress } from './ui/OperationProgress.js';
import { applyTheme, getSavedTheme } from './ui/ThemeManager.js';
import { initSectionStatePersistence } from './ui/SectionStateManager.js';
import { initSliderSteppers } from './ui/SliderStepper.js';
import { createRenderApp } from './render/RenderApp.js';
import { DEFAULT_RENDER_SETTINGS } from './render/RenderSettings.js';
import { readRenderSettings, writeRenderSettings } from './render/renderSettingsStorage.js';
import { restoreStartupProject } from './project/firstRunExample.js';
import { TechnicalCartonDocument } from './carton/TechnicalCartonDocument.js';
import { createCartonDocument } from './carton/createCartonDocument.js';
import { createTechnicalBoxModelAdapter } from './carton/technicalBoxModelAdapter.js';
import { createPbdHost } from './host/pbdHostProtocol.js';
import { createViewerHost } from './host/viewerHostProtocol.js';
import { normalizeTechnicalViewerState } from './project/technicalViewerState.js';
import { FROZEN_PBD_ARTIFACT_SHA256 } from './workflow/index.js';
import {
  canPersistWorkflow,
  completeWorkflowBootstrap,
  createWorkflowBootstrapState,
  resolveWorkflowSelection,
} from './workflow/workflowSelectionState.js';

initializeI18n();
applyTheme(getSavedTheme());
initSectionStatePersistence();
initSliderSteppers();

const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
const storedRenderSettings = readRenderSettings();
const boxStep = document.getElementById('boxStep');
const artworkStep = document.getElementById('artworkStep');
const previewStep = document.getElementById('previewStep');
const renderStep = document.getElementById('renderStep');
const stepButtons = [...document.querySelectorAll('.step')];
const previewWarning = document.getElementById('previewWarning');
let currentStep = 'workflow';
let workflowMode = null;
let workflowChosen = false;
let workflowBootstrap = createWorkflowBootstrapState();
let startupRestoring = workflowBootstrap.restoring;

const fileMenuTriggerBtn = document.getElementById('fileMenuTriggerBtn');
const fileMenuPopover = document.getElementById('fileMenuPopover');
const projectFileInput = document.getElementById('projectFileInput');

const handleOpenProject = () => {
  if (operationProgress?.isBusy?.()) return;
  const input = document.getElementById('projectFileInput');
  if (input) input.click();
};

const handleSaveProject = () => {
  if (!workflowChosen) return Promise.resolve({ status: 'blocked', reason: 'workflow-selection-required' });
  if (artworkApp?.saveProjectArchive) {
    return artworkApp.saveProjectArchive();
  }
  return Promise.resolve({ status: 'failed' });
};

const handleNewProject = async () => {
  const isModified = artworkApp?.hasModifiedArtwork ? artworkApp.hasModifiedArtwork() : false;
  
  const resetAndReload = async () => {
    const { clearCurrentProject } = await import('./project/ProjectStore.js');
    await clearCurrentProject();
    window.location.reload();
  };

  if (!isModified) {
    await resetAndReload();
    return;
  }

  const dialog = document.getElementById('unsavedChangesDialog');
  if (!dialog) {
    if (window.confirm('Create new project? Unsaved changes will be cleared.')) {
      await resetAndReload();
    }
    return;
  }

  const saveBtn = dialog.querySelector('#saveAndNewProjectBtn');
  const dontSaveBtn = dialog.querySelector('#dontSaveProjectBtn');
  const cancelBtn = dialog.querySelector('#cancelNewProjectBtn');

  const cleanup = () => {
    try { dialog.close(); } catch {}
    saveBtn?.removeEventListener('click', onSave);
    dontSaveBtn?.removeEventListener('click', onDontSave);
    cancelBtn?.removeEventListener('click', onCancel);
  };

  const onSave = async () => {
    cleanup();
    try {
      const result = await handleSaveProject();
      if (result?.status === 'succeeded') await resetAndReload();
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  const onDontSave = async () => {
    cleanup();
    await resetAndReload();
  };

  const onCancel = () => {
    cleanup();
  };

  saveBtn?.addEventListener('click', onSave);
  dontSaveBtn?.addEventListener('click', onDontSave);
  cancelBtn?.addEventListener('click', onCancel);

  dialog.showModal();
};

const editMenuTriggerBtn = document.getElementById('editMenuTriggerBtn');
const editMenuPopover = document.getElementById('editMenuPopover');
const artworkFileInput = document.getElementById('artworkFileInput');

const handlePlaceArtwork = () => {
  if (!workflowChosen) return;
  if (artworkFileInput) artworkFileInput.click();
};

const handleUndo = () => {
  if (artworkApp?.history) {
    artworkApp.history.undo();
  }
};

const handleRedo = () => {
  if (artworkApp?.history) {
    artworkApp.history.redo();
  }
};

const handleRemoveArtwork = () => {
  artworkApp?.removeSelectedArtwork?.();
};

let fileMenu = null;
let editMenu = null;
let viewMenu = null;
let contactsMenu = null;

if (fileMenuTriggerBtn && fileMenuPopover) {
  fileMenu = createFileMenu({
    triggerButton: fileMenuTriggerBtn,
    popoverContainer: fileMenuPopover,
    onNewProject: handleNewProject,
    onOpenProject: handleOpenProject,
    onSaveProject: handleSaveProject,
    onPlaceArtwork: handlePlaceArtwork,
    onExport: (type) => { if (workflowChosen) return artworkApp?.exportDeliverable?.(type); return undefined; },
    onRenderExport: (kind) => { if (workflowChosen) return renderApp?.openExportDialog?.('png', kind); return undefined; },
    canPersistProject: () => canPersistWorkflow(workflowChosen),
    onOpen: () => {
      editMenu?.togglePopover(false);
      contactsMenu?.togglePopover(false);
    },
  });
}

if (editMenuTriggerBtn && editMenuPopover) {
  editMenu = createEditMenu({
    triggerButton: editMenuTriggerBtn,
    popoverContainer: editMenuPopover,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onReplaceArtwork: handlePlaceArtwork,
    onRemoveArtwork: handleRemoveArtwork,
    onOpen: () => {
      editMenu?.togglePopover(false);
      viewMenu?.togglePopover(false);
      contactsMenu?.togglePopover(false);
    },
  });
}

if (editMenuTriggerBtn && editMenuPopover) {
  editMenu = createEditMenu({
    triggerButton: editMenuTriggerBtn,
    popoverContainer: editMenuPopover,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onReplaceArtwork: handlePlaceArtwork,
    onRemoveArtwork: handleRemoveArtwork,
    onOpen: () => {
      fileMenu?.togglePopover(false);
      viewMenu?.togglePopover(false);
      contactsMenu?.togglePopover(false);
    },
  });
}

const viewMenuTriggerBtn = document.getElementById('viewMenuTriggerBtn');
const viewMenuPopover = document.getElementById('viewMenuPopover');

if (viewMenuTriggerBtn && viewMenuPopover) {
  viewMenu = createViewMenu({
    triggerButton: viewMenuTriggerBtn,
    popoverContainer: viewMenuPopover,
    onOverprintToggle: async (next) => artworkApp?.setOverprintEnabled?.(next),
    isOverprintAvailable: () => artworkApp?.isOverprintAvailable?.() ?? false,
    onSeparations: () => artworkApp?.openSeparations?.(),
    onPrepressOverlayToggle: (name, visible) => artworkApp?.setPrepressOverlay?.(name, visible),
    getPrepressOverlayState: () => artworkApp?.getPrepressOverlayState?.() || {},
    onOpen: () => {
      fileMenu?.togglePopover(false);
      editMenu?.togglePopover(false);
      contactsMenu?.togglePopover(false);
    },
  });
}

const contactsMenuTriggerBtn = document.getElementById('contactsMenuTriggerBtn');
const contactsMenuPopover = document.getElementById('contactsMenuPopover');

if (contactsMenuTriggerBtn && contactsMenuPopover) {
  contactsMenu = createContactsMenu({
    triggerButton: contactsMenuTriggerBtn,
    popoverContainer: contactsMenuPopover,
    onOpen: () => {
      fileMenu?.togglePopover(false);
      editMenu?.togglePopover(false);
      viewMenu?.togglePopover(false);
    },
  });
}

window.addEventListener('keydown', async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!operationProgress?.isBusy?.()) handleSaveProject();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    if (!operationProgress?.isBusy?.()) handleOpenProject();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    if (!operationProgress?.isBusy?.()) handleNewProject();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    if (!operationProgress?.isBusy?.()) handlePlaceArtwork();
  }
});

const settingsTriggerBtn = document.getElementById('settingsTriggerBtn');
const settingsPopover = document.getElementById('settingsPopover');

function showSettingsToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 1800);
}

const operationProgress = createOperationProgress({
  root: document.getElementById('operationProgress'),
  label: document.getElementById('operationProgressLabel'),
  detail: document.getElementById('operationProgressDetail'),
  progress: document.getElementById('operationProgressBar'),
  cancelButton: document.getElementById('operationProgressCancel'),
  announcer: document.getElementById('announcer'),
  showToast: showSettingsToast,
  onBusyChange: (busy, { lockMode } = {}) => {
    fileMenu?.setBusy?.(busy);
    const appContent = document.querySelector('.app-content');
    if (appContent) {
      appContent.toggleAttribute('aria-busy', busy);
      appContent.inert = Boolean(busy && lockMode === 'workspace');
    }
  },
});

if (settingsTriggerBtn && settingsPopover) {
  createSettingsModal({
    triggerButton: settingsTriggerBtn,
    popoverContainer: settingsPopover,
    showToast: showSettingsToast,
    getRenderDiagnostics: () => renderApp?.getDiagnostics?.() || null,
    getRenderSettingsSnapshot: () => renderApp
      ? { renderSettings: renderApp.getState(), boardAppearance: renderApp.getBoardAppearance() }
      : null,
    applyRenderSettingsSnapshot: async ({ renderSettings, boardAppearance }) => {
      if (!renderApp) return false;
      renderApp.applySettings({ renderSettings, boardAppearance });
      return true;
    },
  });
}

const panelDock = createPanelDock({
  stage: document.getElementById('artworkStage'),
  leftPanel: document.getElementById('artworkSidebarLeft'),
  rightPanel: document.getElementById('artworkSidebarRight'),
  leftEdge: document.getElementById('panelEdgeLeft'),
  rightEdge: document.getElementById('panelEdgeRight'),
  leftPin: document.getElementById('pinLeftPanel'),
  rightPin: document.getElementById('pinRightPanel'),
});

let artworkApp;
let preview3dFacade;
let renderApp;
let viewerHost;
let technicalPreviewGeneration = 0;
let technicalArtworkGeneration = 0;
let technicalDocument = null;
let technicalAssets = null;
let technicalViewerState = null;
let activeCartonModel = model;
let technicalValidation = {
  structural: 'NOT_GENERATED',
  geometry: 'NOT_GENERATED',
  contract: 'NOT_GENERATED',
};

const cartonModelBridge = {
  get mode() { return activeCartonModel.mode || 'quick'; },
  get dimensions() { return activeCartonModel.dimensions; },
  get board() { return activeCartonModel.board; },
  get construction() { return activeCartonModel.construction; },
  get isComplete() { return Boolean(activeCartonModel.isComplete); },
  get rootId() { return activeCartonModel.rootId || null; },
  getElements: () => activeCartonModel.getElements(),
  getPanels: () => activeCartonModel.getPanels(),
  getPanel: (id) => activeCartonModel.getPanel?.(id) || null,
  getChildren: (id) => activeCartonModel.getChildren?.(id) || [],
  getFeatures: () => activeCartonModel.getFeatures?.() || [],
  getBounds: () => activeCartonModel.getBounds(),
  getCanonicalViewBoxBounds: () => activeCartonModel.getCanonicalViewBoxBounds?.() || null,
  getDielinePrimitives: () => activeCartonModel.getDielinePrimitives?.() || [],
  getArtworkSurfaces: () => activeCartonModel.getArtworkSurfaces?.() || [],
  getArtworkReferenceFrame: () => activeCartonModel.getArtworkReferenceFrame?.() || null,
  getArtworkMaskPaths: () => activeCartonModel.getArtworkMaskPaths?.() || [],
  getPresentationTransform: () => activeCartonModel.getPresentationTransform?.() || null,
  getCanonicalSemanticSvg: () => activeCartonModel.getCanonicalSemanticSvg?.() || null,
  getSourceIdentity: () => activeCartonModel.getSourceIdentity?.() || null,
  toJSON: () => activeCartonModel.toJSON(),
  updateDimensions: (...args) => activeCartonModel.updateDimensions(...args),
  setBoardCaliper: (...args) => activeCartonModel.setBoardCaliper?.(...args),
  setBoardConstruction: (...args) => activeCartonModel.setBoardConstruction?.(...args),
};

const workflowModeCards = [...document.querySelectorAll('[data-workflow-mode]')];
const quickWorkflowEditor = document.getElementById('quickWorkflowEditor');
const technicalWorkflowEditor = document.getElementById('technicalWorkflowEditor');
const technicalHostFrame = document.getElementById('technicalHostFrame');
const technicalHostStatus = document.getElementById('technicalHostStatus');
const technicalHostValidation = document.getElementById('technicalHostValidation');
const technicalPreviewPanel = document.getElementById('technicalPreviewPanel');
const technicalViewerFrame = document.getElementById('technicalViewerFrame');
const technicalViewerStatus = document.getElementById('technicalViewerStatus');
const technicalViewerModelInfo = document.getElementById('technicalViewerModelInfo');
const quickPreviewActions = document.getElementById('quickPreviewActions');
const quickPreviewContent = document.getElementById('quickPreviewContent');
const openRenderButton = document.getElementById('openRenderButton');
const presetTriggerBtn = document.getElementById('presetTriggerBtn');

function technicalSourceSnapshot() {
  if (!technicalDocument) return null;
  const serialized = technicalDocument.serialize();
  const { text: _modelText, ...modelJson } = serialized.modelJson || {};
  const { markup: _svgMarkup, ...semanticSvg } = serialized.semanticSvg || {};
  return {
    mode: 'technical',
    source: structuredClone(serialized.source),
    capabilities: structuredClone(serialized.capabilities),
    modelJson,
    semanticSvg,
    modelSha256: serialized.modelSha256,
    svgSha256: serialized.svgSha256,
    semanticSvgAssetId: serialized.semanticSvgAssetId,
  };
}

function technicalAssetBlobs(documentRef = technicalDocument) {
  if (!documentRef) return null;
  const serialized = documentRef.serialize();
  return {
    modelBlob: new Blob([serialized.modelJson.text], { type: serialized.modelJson.mediaType || 'application/json' }),
    svgBlob: new Blob([serialized.semanticSvg.markup], { type: serialized.semanticSvg.mediaType || 'image/svg+xml' }),
  };
}

function setActiveCartonModel(nextModel, nextDocument = null) {
  if (viewerHost && (technicalDocument !== nextDocument || nextModel?.mode !== 'technical')) {
    technicalPreviewGeneration += 1;
    viewerHost.dispose({ cancelActive: true });
  }
  activeCartonModel = nextModel || model;
  technicalDocument = nextDocument;
  const caliperMm = Number(activeCartonModel.board?.caliperMm);
  if (Number.isFinite(caliperMm)) {
    renderApp?.setBoardCaliper?.(caliperMm, { notify: false });
    preview3dFacade?.setBoardCaliper?.(caliperMm);
  }
}

let pbdHost;
let technicalReplacementFaultInjector = null;

async function runTechnicalReplacementPhase(phase, operation) {
  await technicalReplacementFaultInjector?.(phase);
  return operation();
}

function updateTechnicalHostStatus(message, level = '') {
  if (!technicalHostStatus) return;
  technicalHostStatus.textContent = message;
  technicalHostStatus.dataset.level = level;
}

function updateTechnicalValidation(state = {}) {
  technicalValidation = {
    structural: state.structural || 'NOT_GENERATED',
    geometry: state.geometry || 'NOT_GENERATED',
    contract: state.contract || 'NOT_GENERATED',
  };
  if (technicalHostValidation) {
    const { structural, geometry, contract } = technicalValidation;
    technicalHostValidation.textContent = `Structural ${structural} · Geometry ${geometry} · Contract ${contract}`;
    technicalHostValidation.dataset.valid = String(structural === 'VALID' && geometry === 'VALID' && contract === 'VALID');
  }
  updateStepNavigationStates();
}

function ensurePbdHost() {
  if (pbdHost || !technicalHostFrame) return pbdHost;
  pbdHost = createPbdHost({
    iframe: technicalHostFrame,
    locale: document.documentElement.lang || 'en',
    onReady: () => updateTechnicalHostStatus(t('technicalPluginReady')),
    onValidation: updateTechnicalValidation,
    onError: (error) => updateTechnicalHostStatus(error?.message || error?.code || t('technicalPluginError'), 'error'),
  });
  return pbdHost;
}

function updateTechnicalViewerStatus(message, level = '') {
  if (!technicalViewerStatus) return;
  technicalViewerStatus.textContent = message;
  technicalViewerStatus.dataset.level = level;
}

function viewerCanvasToBinary(canvas, label) {
  if (!canvas) throw new Error(`${label} canvas is missing.`);
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' }).then(async (blob) => {
      if (!blob) throw new Error(`${label} canvas did not produce a blob.`);
      return { data: await blob.arrayBuffer(), mimeType: 'image/png' };
    });
  }
  if (typeof canvas.toBlob !== 'function') throw new Error(`${label} canvas cannot be exported.`);
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error(`${label} canvas did not produce a blob.`));
        return;
      }
      try {
        resolve({ data: await blob.arrayBuffer(), mimeType: 'image/png' });
      } catch (error) {
        reject(error);
      }
    }, 'image/png');
  });
}

function ensureViewerHost() {
  if (viewerHost || !technicalViewerFrame) return viewerHost;
  viewerHost = createViewerHost({
    iframe: technicalViewerFrame,
    locale: document.documentElement.lang || 'en',
    expectedPluginOrigin: 'null',
    capabilities: {
      artwork2d: false,
      flatExport: false,
      foldPreview: true,
      technicalRender: false,
      referenceOnly: true,
      productionCertified: false,
    },
    onReady: () => updateTechnicalViewerStatus(t('technicalViewerReady'), 'success'),
    onModelLoaded: ({ cartonType, panelIds = [], animationNames = [] } = {}) => {
      if (technicalViewerModelInfo) {
        technicalViewerModelInfo.textContent = `${cartonType || 'technical'} · ${panelIds.length} panels · ${animationNames.length} animations`;
      }
      updateTechnicalViewerStatus(t('technicalViewerLoaded'), 'success');
    },
    onState: ({ state } = {}) => {
      try {
        technicalViewerState = normalizeTechnicalViewerState(state, { allowNull: false });
        artworkApp?.scheduleSave?.();
      } catch (error) {
        updateTechnicalViewerStatus(error.message || t('technicalViewerError'), 'error');
      }
    },
    onGlbExported: ({ byteLength } = {}) => {
      if (byteLength) updateTechnicalViewerStatus(`${t('technicalViewerExported')} ${byteLength} B`, 'success');
    },
    onError: (error) => updateTechnicalViewerStatus(error?.message || error?.code || t('technicalViewerError'), 'error'),
    onCancelled: () => updateTechnicalViewerStatus(t('technicalViewerCancelled')),
  });
  return viewerHost;
}

async function createTechnicalArtworkPayload() {
  if (!technicalDocument || cartonModelBridge.mode !== 'technical') {
    throw new Error('Technical Preview requires an accepted technical dieline.');
  }
  const artworks = artworkApp?.getArtworks?.() || [];
  const composed = await composeArtworkTexture({
    boxModel: cartonModelBridge,
    artworks,
    documentRef: document,
    purpose: 'preview',
    includeFinishMaps: true,
    materialProfile: 'matte',
  });
  const artworkAtlas = await viewerCanvasToBinary(composed.canvas, 'Artwork atlas');
  const maps = {};
  for (const key of ['alpha', 'normal', 'roughness', 'metalness']) {
    if (composed.materialMaps?.[key]) maps[key] = await viewerCanvasToBinary(composed.materialMaps[key], `${key} artwork map`);
  }
  let artworkMetadata = null;
  try {
    artworkMetadata = JSON.parse(artworkApp?.getArtworksJson?.() || 'null');
  } catch {
    artworkMetadata = null;
  }
  return {
    artworkAtlas,
    maps,
    finishMetadata: {
      artworks: artworkMetadata,
      atlas: {
        width: composed.width,
        height: composed.height,
        dpi: composed.dpi,
        mapKeys: Object.keys(maps),
      },
    },
  };
}

async function createTechnicalViewerPayload() {
  if (!technicalDocument || cartonModelBridge.mode !== 'technical') {
    throw new Error('Technical Preview requires an accepted technical dieline.');
  }
  const canonicalSvg = technicalDocument.getCanonicalSemanticSvg();
  const artworkPayload = await createTechnicalArtworkPayload();
  const sourceIdentity = technicalDocument.getSourceIdentity();
  return {
    semanticSvg: {
      text: canonicalSvg.markup,
      byteLength: canonicalSvg.byteLength,
      sha256: canonicalSvg.sha256,
    },
    ...artworkPayload,
    state: technicalViewerState,
    name: `${sourceIdentity.cartonType || 'technical'}-technical.svg`,
    finishMetadata: {
      cartonType: sourceIdentity.cartonType || null,
      sourceIdentity,
      ...artworkPayload.finishMetadata,
    },
  };
}

function disposeTechnicalPreview() {
  technicalPreviewGeneration += 1;
  viewerHost?.dispose?.({ cancelActive: true });
  updateTechnicalViewerStatus(t('technicalViewerLoading'));
  if (technicalViewerModelInfo) technicalViewerModelInfo.textContent = '';
}

async function refreshTechnicalPreview() {
  const generation = ++technicalPreviewGeneration;
  const host = ensureViewerHost();
  if (!host) return false;
  host.start();
  updateTechnicalViewerStatus(t('technicalViewerLoadingModel'));
  try {
    const payload = await createTechnicalViewerPayload();
    if (generation !== technicalPreviewGeneration || workflowMode !== 'technical' || currentStep !== 'preview') return false;
    await host.load(payload);
    return generation === technicalPreviewGeneration;
  } catch (error) {
    if (generation === technicalPreviewGeneration) {
      updateTechnicalViewerStatus(error?.message || t('technicalViewerError'), 'error');
    }
    return false;
  }
}

async function refreshTechnicalArtwork() {
  const generation = ++technicalArtworkGeneration;
  const host = ensureViewerHost();
  if (!host?.getState?.().loadId) return refreshTechnicalPreview();
  try {
    const payload = await createTechnicalArtworkPayload();
    if (generation !== technicalArtworkGeneration || workflowMode !== 'technical' || currentStep !== 'preview') return false;
    await host.setArtworkAtlas(payload.artworkAtlas, payload.maps);
    return generation === technicalArtworkGeneration;
  } catch (error) {
    if (generation === technicalArtworkGeneration) updateTechnicalViewerStatus(error?.message || t('technicalViewerError'), 'error');
    return false;
  }
}

function updateTechnicalPreviewUi() {
  const technical = workflowMode === 'technical' && currentStep === 'preview';
  if (previewStep) previewStep.dataset.previewMode = technical ? 'technical' : 'quick';
  if (technicalPreviewPanel) technicalPreviewPanel.hidden = !technical;
  if (quickPreviewContent) quickPreviewContent.hidden = technical;
  if (quickPreviewActions) quickPreviewActions.hidden = workflowMode === 'technical';
  if (openRenderButton) openRenderButton.disabled = workflowMode === 'technical';
}

function technicalValidationIsReady() {
  return technicalValidation.structural === 'VALID'
    && technicalValidation.geometry === 'VALID'
    && technicalValidation.contract === 'VALID';
}

async function restoreTechnicalCarton({ snapshot, technicalAssets: restoredAssets }) {
  const document = await createCartonDocument(
    snapshot.cartonSource,
    restoredAssets,
    {
      expectedProducer: 'packaging-box-designer',
      expectedArtifactSha256: FROZEN_PBD_ARTIFACT_SHA256,
      expectedArtifactVersion: '1.2.0',
    },
  );
  workflowMode = 'technical';
  technicalViewerState = normalizeTechnicalViewerState(snapshot.technicalViewer, { allowNull: false });
  setActiveCartonModel(createTechnicalBoxModelAdapter(document), document);
  technicalAssets = {
    modelBlob: restoredAssets.modelBlob,
    svgBlob: restoredAssets.svgBlob,
  };
  updateTechnicalValidation({ structural: 'VALID', geometry: 'VALID', contract: 'VALID' });
  const host = ensurePbdHost();
  host?.start();
  updateTechnicalHostStatus(t('technicalPluginLoading'));
  try {
    const rebuilt = await host?.loadCarton?.(document.getBundle());
    if (rebuilt?.modelJson?.sha256 !== snapshot.cartonSource.modelSha256
      || rebuilt?.semanticSvg?.sha256 !== snapshot.cartonSource.svgSha256) {
      throw new Error('PBD_CARTON_RESTORE_HASH_MISMATCH');
    }
    updateTechnicalHostStatus(t('technicalBundleAccepted'), 'success');
  } catch (error) {
    // The validated technical document remains active in CartonBuilder. The
    // plugin is expected to expose its own explicit read-only fallback rather
    // than silently showing its default RTE model.
    updateTechnicalHostStatus(`${t('technicalPluginRestoreFailed')} ${error?.message || ''}`.trim(), 'error');
  }
}

function applyWorkflowModeUi() {
  for (const card of workflowModeCards) {
    const active = workflowChosen && card.dataset.workflowMode === workflowMode;
    card.disabled = startupRestoring;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', String(active));
    card.dataset.current = String(active);
    const currentStatus = card.querySelector('.workflow-current');
    if (currentStatus) currentStatus.hidden = !active;
  }
  if (quickWorkflowEditor) quickWorkflowEditor.hidden = !workflowChosen || workflowMode !== 'quick';
  if (technicalWorkflowEditor) technicalWorkflowEditor.hidden = !workflowChosen || workflowMode !== 'technical';
  if (presetTriggerBtn) {
    presetTriggerBtn.disabled = !workflowChosen || workflowMode !== 'quick';
    presetTriggerBtn.title = !workflowChosen ? t('workflowSelectionRequired') : 'Box Presets Library';
  }
  if (workflowChosen && workflowMode === 'technical') ensurePbdHost()?.start();
  updateTechnicalPreviewUi();
  updateStepNavigationStates();
}

async function acceptTechnicalCarton() {
  const host = ensurePbdHost();
  if (!host?.getState().initialized) {
    updateTechnicalHostStatus(t('technicalPluginNotReady'), 'error');
    return false;
  }
  updateTechnicalHostStatus(t('technicalBundleRequesting'));
  let checkpointCreated = false;
  try {
    const bundle = await host.requestCarton();
    const nextDocument = await TechnicalCartonDocument.create(bundle, {
      expectedProducer: 'packaging-box-designer',
      expectedArtifactSha256: FROZEN_PBD_ARTIFACT_SHA256,
      expectedArtifactVersion: '1.2.0',
    });
    const currentIdentity = technicalDocument?.getSourceIdentity?.();
    const nextIdentity = nextDocument.getSourceIdentity();
    const changed = !currentIdentity
      || currentIdentity.modelSha256 !== nextIdentity.modelSha256
      || currentIdentity.svgSha256 !== nextIdentity.svgSha256;

    if (!changed) {
      updateTechnicalHostStatus(t('technicalBundleAccepted'), 'success');
      updateTechnicalValidation({ structural: 'VALID', geometry: 'VALID', contract: 'VALID' });
      return true;
    }

    if (technicalDocument && artworkApp?.artwork?.hasArtwork
      && !window.confirm(t('workflowChangeClearsArtwork'))) {
      updateTechnicalHostStatus(t('technicalBundleRejected'), 'error');
      return false;
    }

    try {
      await artworkApp?.createProjectCheckpoint?.({ reason: 'technical-model-replacement' });
      checkpointCreated = true;
    } catch (error) {
      updateTechnicalHostStatus(error?.message || t('technicalBundleRejected'), 'error');
      return false;
    }

    try {
      if (technicalDocument && artworkApp?.artwork?.hasArtwork) {
        await runTechnicalReplacementPhase('clear-artwork', () => {
          artworkApp.clearArtworkForCartonChange?.();
        });
      }
      await runTechnicalReplacementPhase('activate-model', () => {
        technicalViewerState = null;
        setActiveCartonModel(createTechnicalBoxModelAdapter(nextDocument), nextDocument);
      });
      await runTechnicalReplacementPhase('update-technical-assets', () => {
        technicalAssets = technicalAssetBlobs(nextDocument);
      });
      await runTechnicalReplacementPhase('reset-preview', () => {
        preview3dFacade?.resetForProject?.();
      });
      await runTechnicalReplacementPhase('reset-render', () => {
        renderApp?.resetForProject?.();
      });
      await runTechnicalReplacementPhase('final-save', () => artworkApp.commitProjectSave('artwork'));
    } catch (error) {
      if (checkpointCreated) {
        try {
          await artworkApp?.restoreProjectCheckpoint?.({ schedule: false });
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
      }
      throw error;
    }
    updateTechnicalHostStatus(t('technicalBundleAccepted'), 'success');
    updateTechnicalValidation({ structural: 'VALID', geometry: 'VALID', contract: 'VALID' });
    updateStepNavigationStates();
    return true;
  } catch (error) {
    updateTechnicalHostStatus(error?.message || t('technicalBundleRejected'), 'error');
    return false;
  }
}

async function transitionToStep(step) {
  if (startupRestoring) return false;
  if (step !== 'workflow' && !workflowChosen) return false;
  if (workflowMode === 'technical' && step === 'render') return false;
  if (step === 'artwork' && workflowMode === 'technical' && !(await acceptTechnicalCarton())) return false;
  showStep(step);
  return true;
}

function updateStepNavigationStates() {
  const isBoxComplete = workflowChosen && (workflowMode === 'technical'
    ? Boolean(technicalDocument?.isComplete || technicalValidationIsReady())
    : model.isComplete);
  const hasArtwork = Boolean(artworkApp?.artwork?.hasArtwork);

  const workflowBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'workflow');
  const boxBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'box');
  const artworkBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'artwork');
  const previewBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'preview');
  const renderBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'render');

  if (workflowBtn) workflowBtn.disabled = startupRestoring;
  if (boxBtn) boxBtn.disabled = !workflowChosen;
  if (artworkBtn) artworkBtn.disabled = !workflowChosen || !isBoxComplete;
  const previewReady = workflowChosen && isBoxComplete && hasArtwork;
  const renderReady = previewReady && workflowMode !== 'technical';
  if (previewBtn) previewBtn.disabled = !previewReady;
  if (renderBtn) renderBtn.disabled = !renderReady;

  if (artworkBtn) artworkBtn.classList.toggle('unlocked', isBoxComplete);
  if (previewBtn) previewBtn.classList.toggle('unlocked', previewReady);
  if (renderBtn) renderBtn.classList.toggle('unlocked', renderReady);
  if (openRenderButton) openRenderButton.disabled = !renderReady;
}

function showStep(step) {
  if (startupRestoring && step === 'workflow') return false;
  if (step !== 'workflow' && !workflowChosen) return false;
  if (workflowMode === 'technical' && step === 'render') return false;
  if (!(workflowMode === 'technical' && step === 'preview')) disposeTechnicalPreview();
  currentStep = step;
  const workflowStep = document.getElementById('workflowStep');
  if (workflowStep) workflowStep.hidden = step !== 'workflow';
  boxStep.hidden = step !== 'box';
  artworkStep.hidden = step !== 'artwork';
  previewStep.hidden = step !== 'preview';
  renderStep.hidden = step !== 'render';

  updateStepNavigationStates();
  updateTechnicalPreviewUi();

  const stepOrder = ['workflow', 'box', 'artwork', 'preview', 'render'];
  const currentIndex = stepOrder.indexOf(step);

  for (const button of stepButtons) {
    const target = button.dataset.stepTarget;
    const targetIndex = stepOrder.indexOf(target);
    const isActive = target === step;
    const isCompletedPreviousStep = targetIndex < currentIndex && (
      target === 'workflow'
        ? workflowChosen
        : target === 'box'
          ? (workflowMode === 'technical'
          ? Boolean(technicalDocument?.isComplete || technicalValidationIsReady())
          : model.isComplete)
        : target === 'artwork'
          ? Boolean(artworkApp?.artwork?.hasArtwork)
          : target === 'preview' || target === 'render'
            ? (workflowMode === 'technical'
              ? Boolean(technicalDocument?.isComplete || technicalValidationIsReady())
              : model.isComplete) && Boolean(artworkApp?.artwork?.hasArtwork)
            : false
    );

    button.classList.toggle('active', isActive);
    button.classList.toggle('complete', isCompletedPreviousStep);

    if (isActive) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }

  if (step === 'artwork') {
    panelDock.openPanels();
    // Dimension changes preserve artwork transforms and history. Fit only the
    // editor viewport; never refit or clear the user's artwork placement.
    artworkApp?.fitToScreen();
    preview3dFacade?.suspend();
    renderApp?.deactivate();
    requestAnimationFrame(() => artworkApp?.render());
  } else if (step === 'preview') {
    renderApp?.deactivate();
    if (workflowMode === 'technical') {
      preview3dFacade?.suspend();
      requestAnimationFrame(() => { void refreshTechnicalPreview(); });
    } else {
      requestAnimationFrame(() => {
        preview3dFacade?.activate();
      });
    }
  } else if (step === 'render') {
    preview3dFacade?.suspend();
    requestAnimationFrame(() => {
      renderApp?.activate();
    });
  } else {
    preview3dFacade?.suspend();
    renderApp?.deactivate();
  }

  if (artworkApp && step !== 'workflow') {
    artworkApp.persistWorkflowStep(step);
  }
  return true;
}

const boxApp = createBoxNetApp({
  model,
  onContinue: () => {
    updateStepNavigationStates();
    void transitionToStep('artwork');
  },
  onDimensionReset: () => {
    preview3dFacade?.resetForProject();
    renderApp?.setBoardCaliper?.(model.board.caliperMm, { notify: false });
    preview3dFacade?.setBoardCaliper?.(model.board.caliperMm);
    updateStepNavigationStates();
  },
  onLayoutReset: () => {
    preview3dFacade?.resetForProject();
    renderApp?.setBoardCaliper?.(model.board.caliperMm, { notify: false });
    updateStepNavigationStates();
  },
  onBoardConstructionChange: () => {
    renderApp?.setBoardCaliper?.(model.board.caliperMm, { notify: false });
    preview3dFacade?.setBoardCaliper?.(model.board.caliperMm);
  },
  onChange: () => {
    updateStepNavigationStates();
    artworkApp?.scheduleSave();
  },
});

artworkApp = createArtworkApp({
  boxModel: cartonModelBridge,
  boxApp,
  onBack: () => showStep('box'),
  onPreview: (warnings) => {
    previewWarning.textContent = warnings.join(' ');
    updateStepNavigationStates();
    void transitionToStep('preview');
  },
  onBackToEditor: () => showStep('artwork'),
  onProjectLoaded: (snapshot, project = null) => {
    workflowMode = snapshot.workflowSelection === 'technical' ? 'technical' : 'quick';
    workflowChosen = true;
    if (snapshot.cartonSource?.mode !== 'technical') {
      technicalDocument = null;
      technicalAssets = null;
      updateTechnicalValidation({});
      setActiveCartonModel(model, null);
    }
    applyWorkflowModeUi();
    preview3dFacade?.resetForProject();
    renderApp?.restoreRenderAssets?.(project?.renderAssets || []);
    renderApp?.restoreState(snapshot.render, snapshot.renderAppearance);
    const hasArtwork = Boolean(snapshot.artworks?.length);
    let targetStep = 'box';
    const cartonComplete = workflowMode === 'technical' ? Boolean(technicalDocument?.isComplete) : model.isComplete;
    if (snapshot.workflowStep === 'render' && hasArtwork && cartonComplete && workflowMode !== 'technical') {
      targetStep = 'render';
    } else if (snapshot.workflowStep === 'preview' && hasArtwork && cartonComplete) {
      targetStep = 'preview';
    } else if (snapshot.workflowStep === 'artwork' && (cartonComplete || hasArtwork)) {
      targetStep = 'artwork';
    } else if (snapshot.workflowStep === 'box') {
      targetStep = 'box';
    } else if (hasArtwork) {
      targetStep = 'artwork';
    }
    updateStepNavigationStates();
    showStep(targetStep);
    if (snapshot[QUICK_CONSTRUCTION_MIGRATION_FLAG]) {
      window.setTimeout(() => artworkApp?.showToast?.(t('quickConstructionMigrated')), 0);
    }
  },
  getWorkflowStep: () => currentStep,
  getRenderState: () => renderApp?.getState?.() || DEFAULT_RENDER_SETTINGS,
  getRenderBoardAppearance: () => renderApp?.getBoardAppearance?.(),
  getRenderAssets: () => renderApp?.getRenderAssets?.() || [],
  getCartonSource: () => technicalSourceSnapshot() || { mode: 'quick', box: model.toJSON() },
  getWorkflowSelection: () => workflowMode || 'quick',
  getTechnicalAssets: () => technicalAssets,
  getTechnicalViewerState: () => technicalViewerState,
  canPersistProject: () => canPersistWorkflow(workflowChosen),
  restoreCartonDocument: restoreTechnicalCarton,
  getPreview3dState: () => preview3dFacade?.getState?.() || null,
  getTechnicalPreviewState: () => viewerHost?.getState?.() || null,
  operationProgress,
  onRenderStateChanged: () => artworkApp?.scheduleSave(),
  onArtworkQualityChanged: async ({ kind } = {}) => {
    const refreshes = [];
    if (kind === 'preview') {
      if (workflowMode === 'technical' && currentStep === 'preview') {
        const technicalRefresh = refreshTechnicalArtwork();
        if (technicalRefresh && typeof technicalRefresh.then === 'function') refreshes.push(technicalRefresh);
      } else if (workflowMode !== 'technical') {
        const previewRefresh = preview3dFacade?.refreshArtwork?.();
        if (previewRefresh && typeof previewRefresh.then === 'function') refreshes.push(previewRefresh);
      }
    }
    const renderRefresh = renderApp?.refreshArtwork?.();
    if (renderRefresh && typeof renderRefresh.then === 'function') refreshes.push(renderRefresh);
    await Promise.all(refreshes);
  },
  onStateChanged: () => {
    updateStepNavigationStates();
    renderApp?.refreshArtworkVisibility?.();
  },
});

preview3dFacade = createLazyPreview3DFacade({
  getOptions: () => ({
    boxModel: cartonModelBridge,
    artwork: artworkApp.artwork,
    getArtworks: () => artworkApp.getArtworks(),
    getArtworksJson: () => artworkApp.getArtworksJson(),
    getRenderState: () => renderApp?.getState?.(),
    getBoardAppearance: () => renderApp?.getBoardAppearance?.(),
    setHtmlExportQuality: (value) => renderApp?.setHtmlExportQuality?.(value),
  }),
});

renderApp = createRenderApp({
  boxModel: cartonModelBridge,
  getArtworks: () => artworkApp.getArtworks(),
  getArtworksJson: () => artworkApp.getArtworksJson(),
  initialState: storedRenderSettings?.renderSettings || DEFAULT_RENDER_SETTINGS,
  initialBoardAppearance: storedRenderSettings?.boardAppearance,
  onStateChange: () => {
    preview3dFacade?.setBoardAppearance?.(renderApp?.getBoardAppearance?.());
    writeRenderSettings({
      renderSettings: renderApp?.getState?.() || DEFAULT_RENDER_SETTINGS,
      boardAppearance: renderApp?.getBoardAppearance?.(),
    });
    artworkApp?.notifyRenderStateChanged?.();
  },
  setArtworkQuality: (...args) => artworkApp?.setArtworkQuality?.(...args),
  updateArtworkFinish: (...args) => artworkApp?.updateArtworkFinish?.(...args),
  operationProgress,
  onBackToPreview: () => void transitionToStep('preview'),
});

window.BoxNet = {
  BoxNetModel,
  EDGES,
  OPPOSITE_EDGE,
  FACE_BY_NORMAL,
  getAdjacentBasis,
  rectanglesOverlap,
};

window.boxNetApp = boxApp;
window.cartonBuilderApp = {
  get step() {
    return currentStep;
  },
  getState() {
    if (!workflowChosen) return null;
    return artworkApp.createSnapshot(currentStep === 'workflow' ? 'box' : currentStep);
  },
  showStep: transitionToStep,
  artwork: artworkApp,
  preview3d: preview3dFacade,
  technicalPreview: {
    getState: () => viewerHost?.getState?.() || null,
    refresh: refreshTechnicalPreview,
    dispose: disposeTechnicalPreview,
  },
  render: renderApp,
  testHooks: {
    setTechnicalReplacementFaultInjector(injector = null) {
      technicalReplacementFaultInjector = typeof injector === 'function' ? injector : null;
    },
  },
};

async function selectWorkflow(mode) {
  const outcome = await resolveWorkflowSelection({
    currentMode: workflowMode,
    workflowChosen,
    nextMode: mode,
    hasArtwork: Boolean(artworkApp?.artwork?.hasArtwork),
    confirmSwitch: () => window.confirm(t('workflowChangeClearsArtwork')),
    createCheckpoint: () => artworkApp.createProjectCheckpoint({ reason: 'workflow-switch' }),
    clearArtwork: () => artworkApp?.clearArtworkForCartonChange?.(),
    commit: (nextMode) => {
      workflowMode = nextMode;
      workflowChosen = true;
    },
  });

  if (outcome.status === 'repeat') {
    await transitionToStep('box');
    return;
  }

  if (outcome.status === 'cancelled') {
    applyWorkflowModeUi();
    showStep('workflow');
    return;
  }
  if (outcome.status === 'checkpoint-error') {
    applyWorkflowModeUi();
    updateTechnicalHostStatus(outcome.error?.message || t('projectSaveFailed'), 'error');
    showStep('workflow');
    return;
  }

  technicalDocument = null;
  technicalAssets = null;
  technicalValidation = { structural: 'NOT_GENERATED', geometry: 'NOT_GENERATED', contract: 'NOT_GENERATED' };
  setActiveCartonModel(model, null);
  preview3dFacade?.resetForProject?.();
  renderApp?.resetForProject?.();
  applyWorkflowModeUi();
  await transitionToStep('box');
}

for (const card of workflowModeCards) {
  card.addEventListener('click', () => { void selectWorkflow(card.dataset.workflowMode); });
}

applyWorkflowModeUi();

for (const button of stepButtons) {
  button.addEventListener('click', () => {
    if (!button.disabled) void transitionToStep(button.dataset.stepTarget);
  });
}

document.getElementById('openRenderButton')?.addEventListener('click', () => void transitionToStep('render'));

void restoreStartupProject({
  restoreAutosave: () => artworkApp.restoreAutosave(),
  restoreExample: () => artworkApp.restoreProjectFromUrl(
    new URL('Calmdownol_template.carton', document.baseURI).href,
  ),
  storage: window.localStorage,
}).then((result) => {
  workflowBootstrap = completeWorkflowBootstrap(
    { ...workflowBootstrap, mode: workflowMode, chosen: workflowChosen },
    result,
    workflowMode,
  );
  startupRestoring = workflowBootstrap.restoring;
  workflowChosen = workflowBootstrap.chosen;
  workflowMode = workflowBootstrap.mode;
  applyWorkflowModeUi();
  if (result === 'empty') showStep('workflow');
}).catch((error) => {
  console.error('Startup restore failed:', error);
  workflowBootstrap = completeWorkflowBootstrap(workflowBootstrap, 'empty');
  startupRestoring = workflowBootstrap.restoring;
  workflowChosen = workflowBootstrap.chosen;
  workflowMode = workflowBootstrap.mode;
  applyWorkflowModeUi();
  showStep('workflow');
});
window.addEventListener('beforeunload', () => {
  preview3dFacade.dispose();
  renderApp.dispose();
  pbdHost?.dispose?.();
  viewerHost?.dispose?.({ cancelActive: true });
});

export { model };
