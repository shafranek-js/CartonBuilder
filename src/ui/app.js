import { createExportSvg, formatNumber, getExportFilename } from '../export/svgExport.js';
import { createResultDialog } from './dialogs.js';
import { createBoxNetRenderer } from './renderer.js';

export function createBoxNetApp({ model, documentRef = document, windowRef = window }) {
  const svg = documentRef.getElementById('workspace');
  const panelCount = documentRef.getElementById('panelCount');
  const continueButton = documentRef.getElementById('continueButton');
  const cancelButton = documentRef.getElementById('cancelButton');
  const resultBackdrop = documentRef.getElementById('resultBackdrop');
  const closeDialogButton = documentRef.getElementById('closeDialogButton');
  const exportButton = documentRef.getElementById('exportButton');
  const dialogSummary = documentRef.getElementById('dialogSummary');
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
        const shouldReset = windowRef.confirm(
          'Changing the box dimensions will reset the current panel layout. Continue?',
        );
        if (!shouldReset) {
          restoreDimensionInputs();
          return;
        }
      }

      model.reset(nextDimensions);
      lastDimensions = { ...model.dimensions };
      render();
      announce('Box dimensions updated. The layout contains the Front Panel only.');
    } catch (error) {
      restoreDimensionInputs();
      showToast(error.message || 'Enter valid positive dimensions.');
    }
  }

  function addPanel(panelId, edge) {
    const result = model.addPanel(panelId, edge);
    render();

    if (result) {
      const completionMessage = model.isComplete ? ' Box net complete.' : '';
      announce(
        `${result.faceName} added. ${model.panelCount} of 6 panels placed.${completionMessage}`,
      );
    }

    return result;
  }

  function deletePanel(panelId) {
    const panel = model.getPanel(panelId);
    const result = model.deletePanel(panelId);
    render();

    if (result && panel) {
      announce(`${panel.faceName} removed. ${model.panelCount} of 6 panels placed.`);
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

  const resultDialog = createResultDialog({
    windowRef,
    model,
    backdrop: resultBackdrop,
    closeButton: closeDialogButton,
    exportButton,
    dialogSummary,
    continueButton,
    onExport: exportSvg,
  });

  for (const input of Object.values(dimensionInputs)) {
    input.addEventListener('change', applyDimensionChange);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  continueButton.addEventListener('click', resultDialog.open);
  cancelButton.addEventListener('click', () => {
    if (model.panelCount > 1 && !windowRef.confirm('Reset the current box layout?')) return;

    model.reset(lastDimensions);
    render();
    showToast('The box layout was reset.');
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
      lastDimensions = { ...model.dimensions };
      restoreDimensionInputs();
      render();
    },
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
