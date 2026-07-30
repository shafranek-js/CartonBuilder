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

initializeI18n();

const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
const boxStep = document.getElementById('boxStep');
const artworkStep = document.getElementById('artworkStep');
const previewStep = document.getElementById('previewStep');
const stepButtons = [...document.querySelectorAll('.step')];
const previewWarning = document.getElementById('previewWarning');

let currentStep = 'box';
let artworkApp;
let preview3dFacade;
let resetArtworkAfterBoxCompletion = false;

function showStep(step) {
  currentStep = step;
  boxStep.hidden = step !== 'box';
  artworkStep.hidden = step !== 'artwork';
  previewStep.hidden = step !== 'preview';

  for (const button of stepButtons) {
    const target = button.dataset.stepTarget;
    button.classList.toggle('active', target === step);
    button.classList.toggle(
      'complete',
      target === 'box' ? model.isComplete : target === 'artwork' ? artworkApp?.artwork.hasArtwork : false,
    );
    if (target === step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }

  if (step === 'artwork') {
    preview3dFacade?.suspend();
    requestAnimationFrame(() => artworkApp.render());
  } else if (step === 'preview') {
    requestAnimationFrame(() => {
      artworkApp.renderPreview();
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
    if (resetArtworkAfterBoxCompletion) {
      artworkApp.resetPlacementForNewDimensions();
      resetArtworkAfterBoxCompletion = false;
    }
    stepButtons.find((button) => button.dataset.stepTarget === 'artwork').disabled = false;
    showStep('artwork');
  },
  beforeDimensionReset: () => {
    if (!artworkApp?.hasModifiedArtwork()) return true;
    return window.confirm(t('dimensionsArtworkReset')) ? 'confirmed' : false;
  },
  onDimensionReset: () => {
    resetArtworkAfterBoxCompletion = true;
    preview3dFacade?.resetForProject();
  },
  onLayoutReset: () => preview3dFacade?.resetForProject(),
  onChange: () => artworkApp?.scheduleSave(),
});

artworkApp = createArtworkApp({
  boxModel: model,
  boxApp,
  onBack: () => showStep('box'),
  onPreview: (warnings) => {
    previewWarning.textContent = warnings.join(' ');
    stepButtons.find((button) => button.dataset.stepTarget === 'preview').disabled = false;
    showStep('preview');
  },
  onBackToEditor: () => showStep('artwork'),
  onProjectLoaded: (snapshot) => {
    preview3dFacade?.resetForProject();
    stepButtons.find((button) => button.dataset.stepTarget === 'artwork').disabled = !model.isComplete && !snapshot.artwork;
    stepButtons.find((button) => button.dataset.stepTarget === 'preview').disabled = !snapshot.artwork;
    const targetStep = snapshot.workflowStep === 'preview' && snapshot.artwork
      ? 'preview'
      : (snapshot.workflowStep === 'artwork' || snapshot.artwork)
        ? 'artwork'
        : 'box';
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
