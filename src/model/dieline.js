function coordinate(value) {
  return Number(value.toFixed(7));
}

function pointKey(point) {
  return `${coordinate(point.x)},${coordinate(point.y)}`;
}

function segmentKey(start, end) {
  const first = pointKey(start);
  const second = pointKey(end);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function panelSegments(panel) {
  const points = Array.isArray(panel.polygon) && panel.polygon.length >= 3
    ? panel.polygon
    : [
        { x: panel.x, y: panel.y },
        { x: panel.x + panel.width, y: panel.y },
        { x: panel.x + panel.width, y: panel.y + panel.height },
        { x: panel.x, y: panel.y + panel.height },
      ];
  return points.map((start, index) => ({
    start: { ...start },
    end: { ...points[(index + 1) % points.length] },
  }));
}

function hingeSegments(elements = []) {
  return new Set(elements
    .map((element) => element.hinge)
    .filter((hinge) => hinge?.parentPoint && hinge?.childPoint)
    .map((hinge) => segmentKey(hinge.parentPoint, hinge.childPoint)));
}

export function getDielineSegments(model) {
  const edges = new Map();

  const elements = typeof model.getElements === 'function' ? model.getElements() : model.getPanels();
  const explicitFolds = hingeSegments(elements);
  for (const panel of elements) {
    for (const segment of panelSegments(panel)) {
      const key = segmentKey(segment.start, segment.end);
      const entry = edges.get(key);
      if (entry) {
        entry.count += 1;
        entry.panelIds.push(panel.id);
      } else {
        edges.set(key, { ...segment, count: 1, panelIds: [panel.id] });
      }
    }
  }

  const cut = [];
  const fold = [];
  for (const edge of edges.values()) {
    const key = segmentKey(edge.start, edge.end);
    const segment = {
      start: { ...edge.start },
      end: { ...edge.end },
      panelIds: edge.panelIds.slice(),
    };
    if (edge.count === 1) cut.push(segment);
    else if (edge.count === 2 || explicitFolds.has(key)) fold.push(segment);
  }

  return { cut, fold };
}

export function getPanelMaskPath(model) {
  const elements = typeof model.getElements === 'function' ? model.getElements() : model.getPanels();
  return elements
    .map((panel) => {
      const points = Array.isArray(panel.polygon) && panel.polygon.length >= 3
        ? panel.polygon
        : [
            { x: panel.x, y: panel.y },
            { x: panel.x + panel.width, y: panel.y },
            { x: panel.x + panel.width, y: panel.y + panel.height },
            { x: panel.x, y: panel.y + panel.height },
          ];
      return `${points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join('')}Z`;
    })
    .join('');
}
