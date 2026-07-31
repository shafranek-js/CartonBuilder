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
import { createPanelDock } from './ui/PanelDock.js';
import { applyTheme, getSavedTheme } from './ui/ThemeManager.js';

initializeI18n();
applyTheme(getSavedTheme());

const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
const boxStep = document.getElementById('boxStep');
const artworkStep = document.getElementById('artworkStep');
const previewStep = document.getElementById('previewStep');
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

if (fileMenuTriggerBtn && fileMenuPopover) {
  createFileMenu({
    triggerButton: fileMenuTriggerBtn,
    popoverContainer: fileMenuPopover,
    onOpenProject: handleOpenProject,
    onSaveProject: handleSaveProject,
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
    if (window.confirm('Create new project? Unsaved changes will be cleared.')) {
      try {
        const { clearCurrentProject } = await import('./project/ProjectStore.js');
        await clearCurrentProject();
        window.location.reload();
      } catch (err) {
        console.error(err);
      }
    }
  }
});

const settingsTriggerBtn = document.getElementById('settingsTriggerBtn');
const settingsPopover = document.getElementById('settingsPopover');

if (settingsTriggerBtn && settingsPopover) {
  createSettingsModal({
    triggerButton: settingsTriggerBtn,
    popoverContainer: settingsPopover,
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
let resetArtworkAfterBoxCompletion = false;

function updateStepNavigationStates() {
  const isBoxComplete = model.isComplete;
  const hasArtwork = Boolean(artworkApp?.artwork?.hasArtwork);

  const boxBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'box');
  const artworkBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'artwork');
  const previewBtn = stepButtons.find((btn) => btn.dataset.stepTarget === 'preview');

  if (boxBtn) boxBtn.disabled = false;
  if (artworkBtn) artworkBtn.disabled = !isBoxComplete;
  if (previewBtn) previewBtn.disabled = !isBoxComplete || !hasArtwork;
}

function showStep(step) {
  currentStep = step;
  boxStep.hidden = step !== 'box';
  artworkStep.hidden = step !== 'artwork';
  previewStep.hidden = step !== 'preview';

  updateStepNavigationStates();

  const stepOrder = ['box', 'artwork', 'preview'];
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
    requestAnimationFrame(() => artworkApp?.render());
  } else if (step === 'preview') {
    requestAnimationFrame(() => {
      artworkApp?.renderPreview();
      preview3dFacade?.resume();
    });
  } else {
    preview3dFacade?.suspend();
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
  beforeDimensionReset: () => {
    if (!artworkApp?.hasModifiedArtwork()) return true;
    return window.confirm(t('dimensionsArtworkReset')) ? 'confirmed' : false;
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
  onProjectLoaded: (snapshot) => {
    preview3dFacade?.resetForProject();
    
    let targetStep = 'box';
    if (snapshot.workflowStep === 'preview' && snapshot.artwork) {
      targetStep = 'preview';
    } else if (snapshot.workflowStep === 'artwork' && (model.isComplete || snapshot.artwork)) {
      targetStep = 'artwork';
    } else if (snapshot.workflowStep === 'box') {
      targetStep = 'box';
    } else if (snapshot.artwork) {
      targetStep = 'artwork';
    }
    updateStepNavigationStates();
    showStep(targetStep);
  },
  getWorkflowStep: () => currentStep,
});

preview3dFacade = createLazyPreview3DFacade({
  getOptions: () => ({
    boxModel: model,
    artwork: artworkApp.artwork,
    getPreviewBlob: () => artworkApp.previewBlob,
  }),
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
};

for (const button of stepButtons) {
  button.addEventListener('click', () => {
    if (!button.disabled) showStep(button.dataset.stepTarget);
  });
}

artworkApp.restoreAutosave();
window.addEventListener('beforeunload', () => preview3dFacade.dispose());

export { model };
