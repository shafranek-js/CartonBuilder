import './styles/main.css';

import { createArtworkApp } from './artwork/ArtworkApp.js';
import { initializeI18n, t } from './i18n.js';
import { BoxNetModel } from './model/BoxNetModel.js';
import {
  EDGES,
  FACE_BY_NORMAL,
  OPPOSITE_EDGE,
  getAdjacentBasis,
  rectanglesOverlap,
} from './model/geometry.js';
import { createLazyPreview3DFacade } from './preview3d/lazyPreview3d.js';
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
import { FROZEN_PBD_ARTIFACT_SHA256 } from './workflow/index.js';

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

const fileMenuTriggerBtn = document.getElementById('fileMenuTriggerBtn');
const fileMenuPopover = document.getElementById('fileMenuPopover');
const projectFileInput = document.getElementById('projectFileInput');

const handleOpenProject = () => {
  if (operationProgress?.isBusy?.()) return;
  const input = document.getElementById('projectFileInput');
  if (input) input.click();
};

const handleSaveProject = () => {
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
    onExport: (type) => artworkApp?.exportDeliverable?.(type),
    onRenderExport: (kind) => renderApp?.openExportDialog?.('png', kind),
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

let currentStep = 'box';
let artworkApp;
let preview3dFacade;
let renderApp;
const WORKFLOW_MODE_STORAGE_KEY = 'cartonBuilder.workflowMode.default';
function readWorkflowMode() {
  try {
    const storage = window.localStorage;
    const stored = storage?.getItem(WORKFLOW_MODE_STORAGE_KEY)
      || storage?.getItem('cartonBuilder.workflowMode');
    return stored === 'technical' ? 'technical' : 'quick';
  } catch {
    return 'quick';
  }
}
let workflowMode = readWorkflowMode();
let technicalDocument = null;
let technicalAssets = null;
let activeCartonModel = model;
let technicalValidation = {
  structural: 'NOT_GENERATED',
  geometry: 'NOT_GENERATED',
  contract: 'NOT_GENERATED',
};

const cartonModelBridge = {
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
  getDielinePrimitives: () => activeCartonModel.getDielinePrimitives?.() || [],
  getArtworkSurfaces: () => activeCartonModel.getArtworkSurfaces?.() || [],
  getArtworkMaskPaths: () => activeCartonModel.getArtworkMaskPaths?.() || [],
  getCanonicalSemanticSvg: () => activeCartonModel.getCanonicalSemanticSvg?.() || null,
  getSourceIdentity: () => activeCartonModel.getSourceIdentity?.() || null,
  toJSON: () => activeCartonModel.toJSON(),
  updateDimensions: (...args) => activeCartonModel.updateDimensions(...args),
  setBoardCaliper: (...args) => activeCartonModel.setBoardCaliper?.(...args),
  setBoardConstruction: (...args) => activeCartonModel.setBoardConstruction?.(...args),
};

const workflowModeInputs = [...document.querySelectorAll('input[name="cartonWorkflowMode"]')];
const quickWorkflowEditor = document.getElementById('quickWorkflowEditor');
const technicalWorkflowEditor = document.getElementById('technicalWorkflowEditor');
const technicalHostFrame = document.getElementById('technicalHostFrame');
const technicalHostStatus = document.getElementById('technicalHostStatus');
const technicalHostValidation = document.getElementById('technicalHostValidation');

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
  activeCartonModel = nextModel || model;
  technicalDocument = nextDocument;
  cartonModelBridge.mode = workflowMode;
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
  for (const input of workflowModeInputs) input.checked = input.value === workflowMode;
  if (quickWorkflowEditor) quickWorkflowEditor.hidden = workflowMode !== 'quick';
  if (technicalWorkflowEditor) technicalWorkflowEditor.hidden = workflowMode !== 'technical';
  if (workflowMode === 'technical') ensurePbdHost()?.start();
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
  if (workflowMode === 'technical' && (step === 'preview' || step === 'render')) return false;
  if (step === 'artwork' && workflowMode === 'technical' && !(await acceptTechnicalCarton())) return false;
  showStep(step);
  return true;
}

function updateStepNavigationStates() {
  const isBoxComplete = workflowMode === 'technical'
    ? Boolean(technicalDocument?.isComplete || technicalValidationIsReady())
    : model.isComplete;
  const hasArtwork = Boolean(artworkApp?.artwork?.hasArtwork);

  const boxBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'box');
  const artworkBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'artwork');
  const previewBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'preview');
  const renderBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'render');

  if (boxBtn) boxBtn.disabled = false;
  if (artworkBtn) artworkBtn.disabled = !isBoxComplete;
  const technicalPreviewReady = workflowMode !== 'technical';
  if (previewBtn) previewBtn.disabled = !isBoxComplete || !hasArtwork || !technicalPreviewReady;
  if (renderBtn) renderBtn.disabled = !isBoxComplete || !hasArtwork || !technicalPreviewReady;

  if (artworkBtn) artworkBtn.classList.toggle('unlocked', isBoxComplete);
  if (previewBtn) previewBtn.classList.toggle('unlocked', isBoxComplete && hasArtwork && technicalPreviewReady);
  if (renderBtn) renderBtn.classList.toggle('unlocked', isBoxComplete && hasArtwork && technicalPreviewReady);
}

function showStep(step) {
  if (workflowMode === 'technical' && (step === 'preview' || step === 'render')) return false;
  currentStep = step;
  boxStep.hidden = step !== 'box';
  artworkStep.hidden = step !== 'artwork';
  previewStep.hidden = step !== 'preview';
  renderStep.hidden = step !== 'render';

  updateStepNavigationStates();

  const stepOrder = ['box', 'artwork', 'preview', 'render'];
  const currentIndex = stepOrder.indexOf(step);

  for (const button of stepButtons) {
    const target = button.dataset.stepTarget;
    const targetIndex = stepOrder.indexOf(target);
    const isActive = target === step;
    const isCompletedPreviousStep = targetIndex < currentIndex && (
      target === 'box'
        ? (workflowMode === 'technical'
          ? Boolean(technicalDocument?.isComplete || technicalValidationIsReady())
          : model.isComplete)
        : target === 'artwork'
          ? Boolean(artworkApp?.artwork?.hasArtwork)
          : target === 'preview' || target === 'render'
            ? model.isComplete && Boolean(artworkApp?.artwork?.hasArtwork)
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
    requestAnimationFrame(() => {
      preview3dFacade?.activate();
    });
  } else if (step === 'render') {
    preview3dFacade?.suspend();
    requestAnimationFrame(() => {
      renderApp?.activate();
    });
  } else {
    preview3dFacade?.suspend();
    renderApp?.deactivate();
  }

  if (artworkApp) {
    artworkApp.persistWorkflowStep(step);
  }
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
  onConstructionChange: () => {
    // Construction changes invalidate all derived polygon/UV/hinge resources.
    // The active facade/render app will lazily rebuild on its next frame.
    preview3dFacade?.resetForProject?.();
    renderApp?.resetForProject?.();
    updateStepNavigationStates();
  },
  hasArtwork: () => Boolean(artworkApp?.artwork?.hasArtwork),
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
    } else if (snapshot.workflowStep === 'preview' && hasArtwork && workflowMode !== 'technical') {
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
  },
  getWorkflowStep: () => currentStep,
  getRenderState: () => renderApp?.getState?.() || DEFAULT_RENDER_SETTINGS,
  getRenderBoardAppearance: () => renderApp?.getBoardAppearance?.(),
  getRenderAssets: () => renderApp?.getRenderAssets?.() || [],
  getCartonSource: () => technicalSourceSnapshot() || { mode: 'quick', box: model.toJSON() },
  getWorkflowSelection: () => workflowMode,
  getTechnicalAssets: () => technicalAssets,
  canPersistProject: () => true,
  restoreCartonDocument: restoreTechnicalCarton,
  getPreview3dState: () => preview3dFacade?.getState?.() || null,
  operationProgress,
  onRenderStateChanged: () => artworkApp?.scheduleSave(),
  onArtworkQualityChanged: async ({ kind } = {}) => {
    const refreshes = [];
    if (kind === 'preview') {
      const previewRefresh = preview3dFacade?.refreshArtwork?.();
      if (previewRefresh && typeof previewRefresh.then === 'function') refreshes.push(previewRefresh);
    }
    const renderRefresh = renderApp?.refreshArtwork?.();
    if (renderRefresh && typeof renderRefresh.then === 'function') refreshes.push(renderRefresh);
    await Promise.all(refreshes);
  },
  onStateChanged: () => updateStepNavigationStates(),
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
    return artworkApp.createSnapshot(currentStep);
  },
  showStep: transitionToStep,
  artwork: artworkApp,
  preview3d: preview3dFacade,
  render: renderApp,
  testHooks: {
    setTechnicalReplacementFaultInjector(injector = null) {
      technicalReplacementFaultInjector = typeof injector === 'function' ? injector : null;
    },
  },
};

async function handleWorkflowModeChange(input) {
    if (!input.checked) return;
    if (input.value === workflowMode) return;
    if (artworkApp?.artwork?.hasArtwork && !window.confirm(t('workflowChangeClearsArtwork'))) {
      applyWorkflowModeUi();
      return;
    }
    if (artworkApp?.artwork?.hasArtwork) {
      try {
        await artworkApp.createProjectCheckpoint({ reason: 'workflow-switch' });
      } catch (error) {
        applyWorkflowModeUi();
        updateTechnicalHostStatus(error?.message || t('projectSaveFailed'), 'error');
        return;
      }
    }
    artworkApp?.clearArtworkForCartonChange?.();
    workflowMode = input.value === 'technical' ? 'technical' : 'quick';
    technicalDocument = null;
    technicalAssets = null;
    technicalValidation = { structural: 'NOT_GENERATED', geometry: 'NOT_GENERATED', contract: 'NOT_GENERATED' };
    setActiveCartonModel(model, null);
    preview3dFacade?.resetForProject?.();
    renderApp?.resetForProject?.();
    applyWorkflowModeUi();
    artworkApp?.scheduleSave?.();
}

for (const input of workflowModeInputs) {
  input.addEventListener('change', () => { void handleWorkflowModeChange(input); });
}

applyWorkflowModeUi();

for (const button of stepButtons) {
  button.addEventListener('click', () => {
    if (!button.disabled) void transitionToStep(button.dataset.stepTarget);
  });
}

document.getElementById('openRenderButton')?.addEventListener('click', () => void transitionToStep('render'));

restoreStartupProject({
  restoreAutosave: () => artworkApp.restoreAutosave(),
  restoreExample: () => artworkApp.restoreProjectFromUrl(
    new URL('Calmdownol_template.carton', document.baseURI).href,
  ),
  storage: window.localStorage,
});
window.addEventListener('beforeunload', () => {
  preview3dFacade.dispose();
  renderApp.dispose();
  pbdHost?.dispose?.();
});

export { model };
