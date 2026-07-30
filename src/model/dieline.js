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
  const left = panel.x;
  const right = panel.x + panel.width;
  const top = panel.y;
  const bottom = panel.y + panel.height;
  return [
    { start: { x: left, y: top }, end: { x: right, y: top } },
    { start: { x: right, y: top }, end: { x: right, y: bottom } },
    { start: { x: right, y: bottom }, end: { x: left, y: bottom } },
    { start: { x: left, y: bottom }, end: { x: left, y: top } },
  ];
}

export function getDielineSegments(model) {
  const edges = new Map();

  for (const panel of model.getPanels()) {
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
    const segment = {
      start: { ...edge.start },
      end: { ...edge.end },
      panelIds: edge.panelIds.slice(),
    };
    if (edge.count === 1) cut.push(segment);
    else if (edge.count === 2) fold.push(segment);
  }

  return { cut, fold };
}

export function getPanelMaskPath(model) {
  return model.getPanels()
    .map((panel) => `M${panel.x} ${panel.y}h${panel.width}v${panel.height}h-${panel.width}Z`)
    .join('');
}
