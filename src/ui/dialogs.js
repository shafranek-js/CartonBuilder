import { formatNumber } from '../export/svgExport.js';

export function createResultDialog({
  windowRef,
  model,
  backdrop,
  closeButton,
  exportButton,
  dialogSummary,
  continueButton,
  onExport,
}) {
  let returnFocus = continueButton;

  function populateSummary() {
    const { width, height, depth } = model.dimensions;
    const rows = [
      ['Width', `${formatNumber(width)} mm`],
      ['Height', `${formatNumber(height)} mm`],
      ['Depth', `${formatNumber(depth)} mm`],
      ['Panels', '6 / 6'],
    ];

    dialogSummary.replaceChildren();
    for (const [label, value] of rows) {
      const labelElement = dialogSummary.ownerDocument.createElement('span');
      labelElement.textContent = label;
      const valueElement = dialogSummary.ownerDocument.createElement('strong');
      valueElement.textContent = value;
      dialogSummary.append(labelElement, valueElement);
    }
  }

  function open() {
    if (!model.isComplete) return false;

    returnFocus = dialogSummary.ownerDocument.activeElement || continueButton;
    populateSummary();
    backdrop.hidden = false;
    exportButton.focus();
    windowRef.dispatchEvent(
      new windowRef.CustomEvent('box-net-complete', { detail: model.toJSON() }),
    );
    return true;
  }

  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    const focusTarget = returnFocus?.isConnected ? returnFocus : continueButton;
    focusTarget.focus();
  }

  function handleKeydown(event) {
    if (backdrop.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    const first = closeButton;
    const last = exportButton;
    const activeElement = dialogSummary.ownerDocument.activeElement;

    if (event.shiftKey && (activeElement === first || !backdrop.contains(activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (activeElement === last || !backdrop.contains(activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener('click', close);
  exportButton.addEventListener('click', onExport);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  windowRef.addEventListener('keydown', handleKeydown);

  return { open, close, isOpen: () => !backdrop.hidden };
}
