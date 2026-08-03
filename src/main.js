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
import { createContactsMenu } from './ui/ContactsMenu.js';
import { createPanelDock } from './ui/PanelDock.js';
import { applyTheme, getSavedTheme } from './ui/ThemeManager.js';
import { createRenderApp } from './render/RenderApp.js';
import { DEFAULT_RENDER_SETTINGS } from './render/RenderSettings.js';
import { readRenderSettings, writeRenderSettings } from './render/renderSettingsStorage.js';
import { restoreStartupProject } from './project/firstRunExample.js';

initializeI18n();
applyTheme(getSavedTheme());

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
  const input = document.getElementById('projectFileInput');
  if (input) input.click();
};

const handleSaveProject = () => {
  if (artworkApp?.saveProjectArchive) {
    artworkApp.saveProjectArchive();
  }
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
      if (artworkApp?.saveProjectArchive) {
        await artworkApp.saveProjectArchive();
      }
      await resetAndReload();
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
      fileMenu?.togglePopover(false);
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
    },
  });
}

window.addEventListener('keydown', async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    handleSaveProject();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    handleOpenProject();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    handleNewProject();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    handlePlaceArtwork();
  }
});

const settingsTriggerBtn = document.getElementById('settingsTriggerBtn');
const settingsPopover = document.getElementById('settingsPopover');

if (settingsTriggerBtn && settingsPopover) {
  createSettingsModal({
    triggerButton: settingsTriggerBtn,
    popoverContainer: settingsPopover,
    getRenderDiagnostics: () => renderApp?.getDiagnostics?.() || null,
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
let resetArtworkAfterBoxCompletion = false;

function updateStepNavigationStates() {
  const isBoxComplete = model.isComplete;
  const hasArtwork = Boolean(artworkApp?.artwork?.hasArtwork);

  const boxBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'box');
  const artworkBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'artwork');
  const previewBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'preview');
  const renderBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'render');

  if (boxBtn) boxBtn.disabled = false;
  if (artworkBtn) artworkBtn.disabled = !isBoxComplete;
  if (previewBtn) previewBtn.disabled = !isBoxComplete || !hasArtwork;
  if (renderBtn) renderBtn.disabled = !isBoxComplete || !hasArtwork;
}

function showStep(step) {
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
        ? model.isComplete
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
    if (resetArtworkAfterBoxCompletion) {
      artworkApp?.resetPlacementForNewDimensions();
      resetArtworkAfterBoxCompletion = false;
    } else {
      artworkApp?.fitToScreen();
    }
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
    showStep('artwork');
  },
  onDimensionReset: () => {
    resetArtworkAfterBoxCompletion = true;
    preview3dFacade?.resetForProject();
    updateStepNavigationStates();
  },
  onLayoutReset: () => {
    preview3dFacade?.resetForProject();
    updateStepNavigationStates();
  },
  onChange: () => {
    updateStepNavigationStates();
    artworkApp?.scheduleSave();
  },
});

artworkApp = createArtworkApp({
  boxModel: model,
  boxApp,
  onBack: () => showStep('box'),
  onPreview: (warnings) => {
    previewWarning.textContent = warnings.join(' ');
    updateStepNavigationStates();
    showStep('preview');
  },
  onBackToEditor: () => showStep('artwork'),
  onProjectLoaded: (snapshot, project = null) => {
    preview3dFacade?.resetForProject();
    renderApp?.restoreRenderAssets?.(project?.renderAssets || []);
    renderApp?.restoreState(snapshot.render, snapshot.renderAppearance);
    const hasArtwork = Boolean(snapshot.artworks?.length);
    let targetStep = 'box';
    if (snapshot.workflowStep === 'render' && hasArtwork && model.isComplete) {
      targetStep = 'render';
    } else if (snapshot.workflowStep === 'preview' && hasArtwork) {
      targetStep = 'preview';
    } else if (snapshot.workflowStep === 'artwork' && (model.isComplete || hasArtwork)) {
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
    boxModel: model,
    artwork: artworkApp.artwork,
    getArtworks: () => artworkApp.getArtworks(),
    getArtworksJson: () => artworkApp.getArtworksJson(),
    getRenderState: () => renderApp?.getState?.(),
    setHtmlExportQuality: (value) => renderApp?.setHtmlExportQuality?.(value),
  }),
});

renderApp = createRenderApp({
  boxModel: model,
  getArtworks: () => artworkApp.getArtworks(),
  getArtworksJson: () => artworkApp.getArtworksJson(),
  initialState: storedRenderSettings?.renderSettings || DEFAULT_RENDER_SETTINGS,
  initialBoardAppearance: storedRenderSettings?.boardAppearance,
  onStateChange: () => {
    writeRenderSettings({
      renderSettings: renderApp?.getState?.() || DEFAULT_RENDER_SETTINGS,
      boardAppearance: renderApp?.getBoardAppearance?.(),
    });
    artworkApp?.notifyRenderStateChanged?.();
  },
  setArtworkQuality: (...args) => artworkApp?.setArtworkQuality?.(...args),
  updateArtworkFinish: (...args) => artworkApp?.updateArtworkFinish?.(...args),
  onBackToPreview: () => showStep('preview'),
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
  showStep,
  artwork: artworkApp,
  preview3d: preview3dFacade,
  render: renderApp,
};

for (const button of stepButtons) {
  button.addEventListener('click', () => {
    if (!button.disabled) showStep(button.dataset.stepTarget);
  });
}

document.getElementById('openRenderButton')?.addEventListener('click', () => showStep('render'));

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
});

export { model };
