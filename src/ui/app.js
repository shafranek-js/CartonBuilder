import { createExportSvg, formatNumber, getExportFilename } from '../export/svgExport.js';
import { getUserErrorMessage, t } from '../i18n.js';
import { createBoxNetRenderer } from './renderer.js';

export function createBoxNetApp({
  model,
  documentRef = document,
  windowRef = window,
  onContinue = () => {},
  beforeDimensionReset = () => true,
  onDimensionReset = () => {},
  onLayoutReset = () => {},
  onChange = () => {},
}) {
  const svg = documentRef.getElementById('workspace');
  const panelCount = documentRef.getElementById('panelCount');
  const continueButton = documentRef.getElementById('continueButton');
  const cancelButton = documentRef.getElementById('cancelButton');
  const toast = documentRef.getElementById('toast');
  const announcer = documentRef.getElementById('announcer');
  const workspaceWrap = documentRef.querySelector('.workspace-wrap');
  const dimensionInputs = {
    width: documentRef.getElementById('boxWidth'),
    height: documentRef.getElementById('boxHeight'),
    depth: documentRef.getElementById('boxDepth'),
  };

  let lastDimensions = { ...model.dimensions };
  let toastTimer = null;
  let announceTimer = null;

  function announce(message) {
    windowRef.clearTimeout(announceTimer);
    announcer.textContent = '';
    announceTimer = windowRef.setTimeout(() => {
      announcer.textContent = message;
    }, 0);
  }

  function showToast(message) {
    windowRef.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = windowRef.setTimeout(() => toast.classList.remove('visible'), 1800);
  }

  function readDimensions() {
    return {
      width: Number(dimensionInputs.width.value),
      height: Number(dimensionInputs.height.value),
      depth: Number(dimensionInputs.depth.value),
    };
  }

  function restoreDimensionInputs() {
    for (const [key, input] of Object.entries(dimensionInputs)) {
      input.value = formatNumber(lastDimensions[key]);
    }
  }

  function applyDimensionChange() {
    const nextDimensions = readDimensions();

    try {
      const hasAddedPanels = model.panelCount > 1;
      const changed = Object.keys(nextDimensions).some(
        (key) => nextDimensions[key] !== lastDimensions[key],
      );
      if (!changed) return;

      if (hasAddedPanels) {
        const resetDecision = beforeDimensionReset(nextDimensions);
        if (!resetDecision) {
          restoreDimensionInputs();
          return;
        }
        if (resetDecision !== 'confirmed') {
          const shouldReset = windowRef.confirm(t('dimensionsReset'));
          if (!shouldReset) {
            restoreDimensionInputs();
            return;
          }
        }
      }

      model.reset(nextDimensions);
      lastDimensions = { ...model.dimensions };
      onDimensionReset(nextDimensions);
      render();
      onChange();
      announce(t('dimensionsUpdated'));
    } catch (error) {
      restoreDimensionInputs();
      showToast(getUserErrorMessage(error, 'invalidDimensions'));
    }
  }

  function addPanel(panelId, edge) {
    const result = model.addPanel(panelId, edge);
    render();
    onChange();

    if (result) {
      announce(t('panelAdded', {
        name: result.faceName,
        count: model.panelCount,
        complete: model.isComplete ? t('boxCompleteSuffix') : '',
      }));
    }

    return result;
  }

  function deletePanel(panelId) {
    const panel = model.getPanel(panelId);
    const result = model.deletePanel(panelId);
    render();
    onChange();

    if (result && panel) {
      announce(t('panelRemoved', { name: panel.faceName, count: model.panelCount }));
    }

    return result;
  }

  const render = createBoxNetRenderer({
    svg,
    panelCount,
    continueButton,
    model,
    onAddPanel: addPanel,
    onDeletePanel: deletePanel,
  });

  function exportSvg() {
    const content = createExportSvg(model);
    const blob = new windowRef.Blob([content], { type: 'image/svg+xml;charset=utf-8' });
    const url = windowRef.URL.createObjectURL(blob);
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = getExportFilename(model.dimensions);
    documentRef.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    windowRef.URL.revokeObjectURL(url);
  }

  for (const input of Object.values(dimensionInputs)) {
    input.addEventListener('change', applyDimensionChange);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  continueButton.addEventListener('click', () => {
    if (!model.isComplete) return;
    windowRef.dispatchEvent(
      new windowRef.CustomEvent('box-net-complete', { detail: model.toJSON() }),
    );
    onContinue();
  });
  const DEFAULT_BOX_DIMENSIONS = Object.freeze({ width: 150, height: 90, depth: 40 });

  cancelButton.addEventListener('click', () => {
    const isModified = model.panelCount > 1 ||
      model.dimensions.width !== DEFAULT_BOX_DIMENSIONS.width ||
      model.dimensions.height !== DEFAULT_BOX_DIMENSIONS.height ||
      model.dimensions.depth !== DEFAULT_BOX_DIMENSIONS.depth;

    if (isModified && !windowRef.confirm(t('resetBoxConfirm'))) return;

    model.reset(DEFAULT_BOX_DIMENSIONS);
    lastDimensions = { ...DEFAULT_BOX_DIMENSIONS };
    restoreDimensionInputs();
    onLayoutReset();
    render();
    onChange();
    showToast(t('boxReset'));
    windowRef.dispatchEvent(new windowRef.CustomEvent('box-net-cancelled'));
  });

  if (typeof windowRef.ResizeObserver === 'function') {
    const resizeObserver = new windowRef.ResizeObserver(render);
    resizeObserver.observe(workspaceWrap);
  } else {
    windowRef.addEventListener('resize', render);
  }

  const publicApi = {
    model,
    render,
    addPanel,
    deletePanel,
    reset(dimensions) {
      model.reset(dimensions || lastDimensions);
      onLayoutReset();
      lastDimensions = { ...model.dimensions };
      restoreDimensionInputs();
      render();
    },
    loadState(state) {
      model.restore(state);
      lastDimensions = { ...model.dimensions };
      restoreDimensionInputs();
      render();
    },
    exportSvg,
    getState() {
      return model.toJSON();
    },
  };

  const scheduleRender = windowRef.requestAnimationFrame
    ? windowRef.requestAnimationFrame.bind(windowRef)
    : (callback) => callback();
  scheduleRender(render);

  return publicApi;
}
