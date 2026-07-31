import { formatNumber } from '../export/svgExport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgElement(documentRef, name, attributes = {}) {
  const element = documentRef.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function getViewMetrics(svg, model) {
  const bounds = model.getBounds();
  const maxDimension = Math.max(bounds.width, bounds.height);
  const paddingFactor = Math.min(0.3, 0.18 + model.panelCount * 0.02);
  const padding = Math.max(16, maxDimension * paddingFactor);
  const view = {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };

  const pixelWidth = Math.max(svg.clientWidth, 1);
  const pixelHeight = Math.max(svg.clientHeight, 1);
  const scale = Math.max(0.0001, Math.min(pixelWidth / view.width, pixelHeight / view.height));
  const unitPerPixel = 1 / scale;

  return {
    view,
    strokeWidth: unitPerPixel,
    fontSize: 12 * unitPerPixel,
    buttonRadius: 7 * unitPerPixel,
    buttonOffset: 10 * unitPerPixel,
    actionStroke: 1.2 * unitPerPixel,
    hitPadding: 18 * unitPerPixel,
  };
}

function getEdgeCenter(panel, edge, offset) {
  switch (edge) {
    case 'top':
      return { x: panel.x + panel.width / 2, y: panel.y - offset };
    case 'right':
      return { x: panel.x + panel.width + offset, y: panel.y + panel.height / 2 };
    case 'bottom':
      return { x: panel.x + panel.width / 2, y: panel.y + panel.height + offset };
    case 'left':
      return { x: panel.x - offset, y: panel.y + panel.height / 2 };
    default:
      throw new Error(`Unknown edge: ${edge}`);
  }
}

function appendActionButton({
  documentRef,
  group,
  x,
  y,
  radius,
  strokeWidth,
  type,
  label,
  onActivate,
}) {
  const action = createSvgElement(documentRef, 'g', {
    class: type === 'plus' ? 'edge-action plus-action' : 'remove-action',
    role: 'button',
    tabindex: '0',
    'aria-label': label,
    transform: `translate(${x} ${y})`,
  });

  const title = createSvgElement(documentRef, 'title');
  title.textContent = label;
  action.appendChild(title);

  action.appendChild(createSvgElement(documentRef, 'circle', {
    class: 'action-circle',
    cx: 0,
    cy: 0,
    r: radius,
    'stroke-width': strokeWidth,
  }));

  const arm = radius * 0.48;
  action.appendChild(createSvgElement(documentRef, 'line', {
    class: 'action-line',
    x1: -arm,
    y1: 0,
    x2: arm,
    y2: 0,
    'stroke-width': strokeWidth,
  }));

  if (type === 'plus') {
    action.appendChild(createSvgElement(documentRef, 'line', {
      class: 'action-line',
      x1: 0,
      y1: -arm,
      x2: 0,
      y2: arm,
      'stroke-width': strokeWidth,
    }));
  }

  action.addEventListener('click', (event) => {
    event.stopPropagation();
    onActivate();
  });
  action.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  });

  group.appendChild(action);
}

export function createBoxNetRenderer({
  svg,
  panelCount,
  continueButton,
  cancelButton,
  model,
  onAddPanel,
  onDeletePanel,
}) {
  const documentRef = svg.ownerDocument;

  function renderPanel(panel, metrics) {
    const group = createSvgElement(documentRef, 'g', {
      class: `panel-group panel-${panel.faceKey}`,
      'data-panel-id': panel.id,
    });

    group.appendChild(createSvgElement(documentRef, 'rect', {
      class: 'panel-hitbox',
      x: panel.x - metrics.hitPadding,
      y: panel.y - metrics.hitPadding,
      width: panel.width + metrics.hitPadding * 2,
      height: panel.height + metrics.hitPadding * 2,
    }));

    const panelTitle = createSvgElement(documentRef, 'title');
    panelTitle.textContent = `${panel.faceName}: ${formatNumber(panel.width)} × ${formatNumber(panel.height)} mm`;
    group.appendChild(panelTitle);

    group.appendChild(createSvgElement(documentRef, 'rect', {
      class: 'panel-shape',
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
    }));

    if (panel.faceKey === 'front' || panel.faceKey === 'bottom') {
      const labelY = panel.faceKey === 'bottom'
        ? panel.y + panel.height * 0.66
        : panel.y + panel.height / 2;
      const label = createSvgElement(documentRef, 'text', {
        class: 'panel-label',
        x: panel.x + panel.width / 2,
        y: labelY,
        'font-size': metrics.fontSize,
      });
      label.textContent = panel.faceName;
      group.appendChild(label);
    }

    if (model.canDelete(panel.id)) {
      const removeY = panel.faceKey === 'bottom'
        ? panel.y + panel.height * 0.31
        : panel.y + panel.height / 2;
      appendActionButton({
        documentRef,
        group,
        x: panel.x + panel.width / 2,
        y: removeY,
        radius: metrics.buttonRadius,
        strokeWidth: metrics.actionStroke,
        type: 'minus',
        label: `Remove ${panel.faceName}`,
        onActivate: () => onDeletePanel(panel.id),
      });
    }

    for (const edge of model.getEligibleEdges(panel.id)) {
      const point = getEdgeCenter(panel, edge, metrics.buttonOffset);
      const potential = model.getPotential(panel.id, edge);
      appendActionButton({
        documentRef,
        group,
        x: point.x,
        y: point.y,
        radius: metrics.buttonRadius,
        strokeWidth: metrics.actionStroke,
        type: 'plus',
        label: `Add ${potential.faceName} to the ${edge} edge of ${panel.faceName}`,
        onActivate: () => onAddPanel(panel.id, edge),
      });
    }

    svg.appendChild(group);
  }

  return function render() {
    const metrics = getViewMetrics(svg, model);
    svg.replaceChildren();
    svg.setAttribute(
      'viewBox',
      `${metrics.view.x} ${metrics.view.y} ${metrics.view.width} ${metrics.view.height}`,
    );

    for (const panel of model.getPanels()) {
      renderPanel(panel, metrics);
    }

    panelCount.textContent = `${model.panelCount}/6`;
    continueButton.disabled = !model.isComplete;

    if (cancelButton) {
      const isModified = model.panelCount > 1 ||
        model.dimensions.width !== 150 ||
        model.dimensions.height !== 90 ||
        model.dimensions.depth !== 40;
      cancelButton.disabled = !isModified;
    }
    svg.setAttribute(
      'aria-label',
      `Interactive box net with ${model.panelCount} of 6 panels placed`,
    );
  };
}
