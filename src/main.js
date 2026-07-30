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
    requestAnimationFrame(() => artworkApp.render());
  } else if (step === 'preview') {
    requestAnimationFrame(() => artworkApp.renderPreview());
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
  },
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
    stepButtons.find((button) => button.dataset.stepTarget === 'artwork').disabled = false;
    stepButtons.find((button) => button.dataset.stepTarget === 'preview').disabled = !snapshot.artwork;
    showStep(snapshot.workflowStep === 'preview' ? 'preview' : 'artwork');
  },
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
};

for (const button of stepButtons) {
  button.addEventListener('click', () => {
    if (!button.disabled) showStep(button.dataset.stepTarget);
  });
}

artworkApp.restoreAutosave();

export { model };
