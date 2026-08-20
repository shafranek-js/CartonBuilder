/**
 * Pure SVG diagnostic and measurement-layer renderers for the incremental M4
 * source extraction. These layers are visual-only and remain outside semantic
 * geometry, metrics and production certification.
 */

export const SVG_DIAGNOSTIC_TOPOLOGY_EPS = 1e-5;

export function svgDiagnosticEscape(value) {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] || character));
}

export function svgDiagnosticBboxOfPoints(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function projectedSvgPoint(point, sy, project) {
  const screenPoint = { x: Number(point.x), y: sy(Number(point.y)) };
  return project ? project(screenPoint) : screenPoint;
}

export function renderThicknessDiagnostic(model, sy, project = null) {
  if (!model || model.input?.cartonType !== "RTE" || !model.body || !Array.isArray(model.body.x) || model.body.x.length < 5)
    return "";
  const t = Number(model.input.thickness);
  if (!Number.isFinite(t) || t <= 0)
    return "";
  const parts = [];
  for (const edge of model.edges || []) {
    if (edge.role !== "FOLD_BOUNDARY" || edge.render === false || edge.referenceAccountingOnly || edge.geometry?.kind !== "LINE")
      continue;
    const a = edge.geometry.start || edge.a;
    const b = edge.geometry.end || edge.b;
    if (!a || !b)
      continue;
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const length = Math.hypot(dx, dy);
    if (!(length > SVG_DIAGNOSTIC_TOPOLOGY_EPS))
      continue;
    const half = t / 2;
    const nx = -dy / length;
    const ny = dx / length;
    const p1 = { x: Number(a.x) + nx * half, y: Number(a.y) + ny * half };
    const p2 = { x: Number(b.x) + nx * half, y: Number(b.y) + ny * half };
    const p3 = { x: Number(b.x) - nx * half, y: Number(b.y) - ny * half };
    const p4 = { x: Number(a.x) - nx * half, y: Number(a.y) - ny * half };
    const mid = { x: (Number(a.x) + Number(b.x)) / 2 + nx * (t * .8), y: (Number(a.y) + Number(b.y)) / 2 + ny * (t * .8) };
    const screenA = projectedSvgPoint(a, sy, project);
    const screenB = projectedSvgPoint(b, sy, project);
    const screenMid = projectedSvgPoint(mid, sy, project);
    const screenAngle = Math.atan2(screenB.y - screenA.y, screenB.x - screenA.x) * 180 / Math.PI;
    let labelAngle = ((screenAngle + 180) % 360) - 180;
    if (labelAngle > 90 || labelAngle < -90)
      labelAngle += 180;
    const key = `thickness-fold-${edge.id}`;
    const label = `t=${t.toFixed(2)}`;
    const pathPoint = (point) => { const screen = projectedSvgPoint(point, sy, project); return `${screen.x.toFixed(4)},${screen.y.toFixed(4)}`; };
    parts.push(`<path class="thickness-relief thickness-fold-band" d="M ${pathPoint(p1)} L ${pathPoint(p2)} L ${pathPoint(p3)} L ${pathPoint(p4)} Z" data-diagnostic="${svgDiagnosticEscape(key)}" data-edge-id="${svgDiagnosticEscape(edge.id)}" data-thickness-mm="${t.toFixed(4)}"><title>${svgDiagnosticEscape(edge.semanticRole || edge.id)} · fold thickness ${t.toFixed(2)} mm; visual diagnostic only</title></path><text class="thickness-diagnostic-label" x="${screenMid.x.toFixed(4)}" y="${screenMid.y.toFixed(4)}" transform="rotate(${labelAngle.toFixed(2)} ${screenMid.x.toFixed(4)} ${screenMid.y.toFixed(4)})">${svgDiagnosticEscape(label)}</text>`);
  }
  if (!parts.length)
    return "";
  return `<g id="diagnostics" data-semantic-layer="diagnostics" data-layer-role="ENGINEERING_DIAGNOSTICS" class="diagnostic-layer" data-diagnostic="thickness-folds"><title>Engineering-only Thickness layer. Each visible semantic fold receives a centered t-wide envelope; Thickness marks are visual diagnostics only and are excluded from semantic geometry, metrics, validation and production export.</title>${parts.join("")}</g>`;
}

export function renderDimensionsLayer(model, sy, project = null) {
  if (!model || !model.body || !Array.isArray(model.body.x))
    return "";
  const t = Number(model.input?.thickness);
  if (!Number.isFinite(t) || t <= 0)
    return "";
  const parts = [];
  const bodyRegions = model.body.regions || [];
  const bodyById = new Map(bodyRegions.map((region) => [region.id, region]));
  const point = (x, y) => { const screen = projectedSvgPoint({ x, y }, sy, project); return `${screen.x.toFixed(4)},${screen.y.toFixed(4)}`; };
  const labelText = (value) => Number(value).toFixed(2);
  const addDimension = (id, a, b, value, label, witnessA = a, witnessB = b) => {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const length = Math.hypot(dx, dy);
    if (!(length > SVG_DIAGNOSTIC_TOPOLOGY_EPS))
      return;
    const ux = dx / length;
    const uy = dy / length;
    const arrow = Math.min(3.2, Math.max(.65, length * .028));
    const headWidth = Math.min(.9, Math.max(.28, arrow * .42));
    const nx = -uy;
    const ny = ux;
    const mid = { x: (Number(a.x) + Number(b.x)) / 2 + nx * Math.max(2.5, t), y: (Number(a.y) + Number(b.y)) / 2 + ny * Math.max(2.5, t) };
    const screenA = projectedSvgPoint(a, sy, project);
    const screenB = projectedSvgPoint(b, sy, project);
    const screenWitnessA = projectedSvgPoint(witnessA, sy, project);
    const screenWitnessB = projectedSvgPoint(witnessB, sy, project);
    const screenMid = projectedSvgPoint(mid, sy, project);
    const screenAngle = Math.atan2(screenB.y - screenA.y, screenB.x - screenA.x) * 180 / Math.PI;
    let labelAngle = ((screenAngle + 180) % 360) - 180;
    if (labelAngle > 90 || labelAngle < -90)
      labelAngle += 180;
    const pA = { x: Number(a.x) + ux * arrow - nx * headWidth, y: Number(a.y) + uy * arrow - ny * headWidth };
    const pB = { x: Number(a.x) + ux * arrow + nx * headWidth, y: Number(a.y) + uy * arrow + ny * headWidth };
    const pC = { x: Number(b.x) - ux * arrow - nx * headWidth, y: Number(b.y) - uy * arrow - ny * headWidth };
    const pD = { x: Number(b.x) - ux * arrow + nx * headWidth, y: Number(b.y) - uy * arrow + ny * headWidth };
    parts.push(`<g class="dimension" data-diagnostic="dimension-${svgDiagnosticEscape(id)}" data-measure-mm="${Number(value).toFixed(4)}"><line class="dimension-extension" x1="${screenWitnessA.x.toFixed(4)}" y1="${screenWitnessA.y.toFixed(4)}" x2="${screenA.x.toFixed(4)}" y2="${screenA.y.toFixed(4)}"/><line class="dimension-extension" x1="${screenWitnessB.x.toFixed(4)}" y1="${screenWitnessB.y.toFixed(4)}" x2="${screenB.x.toFixed(4)}" y2="${screenB.y.toFixed(4)}"/><line class="dimension-line" x1="${screenA.x.toFixed(4)}" y1="${screenA.y.toFixed(4)}" x2="${screenB.x.toFixed(4)}" y2="${screenB.y.toFixed(4)}"/><path class="dimension-arrow" d="M ${point(a.x, a.y)} L ${point(pA.x, pA.y)} M ${point(a.x, a.y)} L ${point(pB.x, pB.y)} M ${point(b.x, b.y)} L ${point(pC.x, pC.y)} M ${point(b.x, b.y)} L ${point(pD.x, pD.y)}"/><text class="dimension-text" x="${screenMid.x.toFixed(4)}" y="${screenMid.y.toFixed(4)}" transform="rotate(${labelAngle.toFixed(2)} ${screenMid.x.toFixed(4)} ${screenMid.y.toFixed(4)})"><title>${svgDiagnosticEscape(label)} · ${labelText(value)} mm</title>${labelText(value)}</text></g>`);
  };
  const panelDimensionY = Number(bodyById.get("body.side1") ? svgDiagnosticBboxOfPoints(bodyById.get("body.side1").points).minY : 0) - Math.max(5, t * 2);
  for (const id of ["body.side1", "body.front", "body.side2", "body.back", "body.glueFlap"]) {
    const region = bodyById.get(id);
    if (!region)
      continue;
    const box = svgDiagnosticBboxOfPoints(region.points);
    const width = box.maxX - box.minX;
    addDimension(`panel-${id.replace("body.", "")}-width`, { x: box.minX, y: panelDimensionY }, { x: box.maxX, y: panelDimensionY }, width, `${id} width`, { x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY });
  }
  const side1 = bodyById.get("body.side1");
  if (side1) {
    const box = svgDiagnosticBboxOfPoints(side1.points);
    const height = box.maxY - box.minY;
    addDimension("body-height", { x: box.minX - Math.max(5, t * 2), y: box.minY }, { x: box.minX - Math.max(5, t * 2), y: box.maxY }, height, "Body height", { x: box.minX, y: box.minY }, { x: box.minX, y: box.maxY });
  }
  for (const closure of [model.topClosure, model.bottomClosure]) {
    for (const region of closure?.regions || []) {
      const box = svgDiagnosticBboxOfPoints(region.points);
      const top = region.id.includes(".top.");
      const y = top ? box.maxY + Math.max(3, t) : box.minY - Math.max(3, t);
      const x = box.minX;
      const width = box.maxX - box.minX;
      const depth = box.maxY - box.minY;
      addDimension(`${region.id}-width`, { x, y }, { x: box.maxX, y }, width, `${region.id} width`, { x: box.minX, y: top ? box.maxY : box.minY }, { x: box.maxX, y: top ? box.maxY : box.minY });
      addDimension(`${region.id}-depth`, { x: box.maxX + Math.max(3, t), y: box.minY }, { x: box.maxX + Math.max(3, t), y: box.maxY }, depth, `${region.id} depth`, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY });
    }
  }
  return `<g id="dimensions" data-semantic-layer="dimensions" data-layer-role="DIMENSION_ANNOTATIONS" class="dimensions-layer" data-diagnostic="dimensions"><title>Semantic dimensions with witness and measurement lines. Thickness envelopes are provided exclusively by the separate Thickness layer; this layer is visual-only and excluded from production SVG, paper area, Trim and validation.</title>${parts.join("")}</g>`;
}

/**
 * Render the shared RTE/STE assembly boundary as a visual-only diagnostic.
 *
 * This intentionally accepts only STE. RTE remains the frozen calibrated
 * reference, while STE is the family where we want to make reuse explicit:
 * one Four-Panel Body, two Friction-Tuck closures, one same-wide-panel host
 * policy and the receiving edge used by the tuck insertion relation.
 */
export function renderReuseDiagnostic(model, sy, project = null) {
  if (!model || model.input?.cartonType !== "STE" || !model.body)
    return "";
  const parts = [];
  const bodyRegions = Array.isArray(model.body.regions) ? model.body.regions : [];
  const bodyById = new Map(bodyRegions.map((region) => [region.id, region]));
  const boxFor = (region) => {
    const points = Array.isArray(region?.points) ? region.points : [];
    if (points.length < 3)
      return null;
    const box = svgDiagnosticBboxOfPoints(points);
    return [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite) ? box : null;
  };
  const screenBox = (box) => [
    projectedSvgPoint({ x: box.minX, y: box.minY }, sy, project),
    projectedSvgPoint({ x: box.maxX, y: box.minY }, sy, project),
    projectedSvgPoint({ x: box.maxX, y: box.maxY }, sy, project),
    projectedSvgPoint({ x: box.minX, y: box.maxY }, sy, project),
  ];
  const boxPath = (box) => `M ${screenBox(box).map((point) => `${point.x.toFixed(4)} ${point.y.toFixed(4)}`).join(" L ")} Z`;
  const boxCenter = (box) => projectedSvgPoint({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, sy, project);
  const addRegion = (region, className, role, title) => {
    const box = boxFor(region);
    if (!box)
      return null;
    parts.push(`<path class="${className}" data-reuse-role="${svgDiagnosticEscape(role)}" data-region-id="${svgDiagnosticEscape(region.id)}" d="${boxPath(box)}"><title>${svgDiagnosticEscape(title)} · visual reuse diagnostic only</title></path>`);
    return box;
  };
  const addLabel = (box, text, className = "reuse-diagnostic-label") => {
    if (!box)
      return;
    const center = boxCenter(box);
    parts.push(`<text class="${className}" x="${center.x.toFixed(4)}" y="${center.y.toFixed(4)}">${svgDiagnosticEscape(text)}</text>`);
  };

  const bodyBoxes = bodyRegions.map((region) => ({ region, box: addRegion(region, "reuse-body-shared", "BODY_ASSEMBLY_SHARED", "Shared Four-Panel Body") })).filter((entry) => entry.box);
  if (bodyBoxes.length) {
    const bodyUnion = {
      minX: Math.min(...bodyBoxes.map(({ box }) => box.minX)),
      minY: Math.min(...bodyBoxes.map(({ box }) => box.minY)),
      maxX: Math.max(...bodyBoxes.map(({ box }) => box.maxX)),
      maxY: Math.max(...bodyBoxes.map(({ box }) => box.maxY)),
    };
    addLabel(bodyUnion, "SHARED BODY · FOUR-PANEL");
  }

  const hosts = new Set([model.topClosure?.majorHost, model.bottomClosure?.majorHost].filter(Boolean));
  for (const panel of hosts) {
    const region = bodyById.get(`body.${String(panel).toLowerCase()}`);
    const box = addRegion(region, "reuse-host-panel", "FRICTION_TUCK_HOST", `STE Friction-Tuck host ${panel}`);
    addLabel(box, `HOST ${panel} · TOP + BOTTOM`, "reuse-host-label");
  }

  for (const [end, closure] of [["TOP", model.topClosure], ["BOTTOM", model.bottomClosure]]) {
    const closureBoxes = (closure?.regions || []).map((region) => ({ region, box: addRegion(region, end === "TOP" ? "reuse-closure-top" : "reuse-closure-bottom", "FRICTION_TUCK_SHARED", `Shared Friction-Tuck ${end} closure`) })).filter((entry) => entry.box);
    if (closureBoxes.length) {
      const closureUnion = {
        minX: Math.min(...closureBoxes.map(({ box }) => box.minX)),
        minY: Math.min(...closureBoxes.map(({ box }) => box.minY)),
        maxX: Math.max(...closureBoxes.map(({ box }) => box.maxX)),
        maxY: Math.max(...closureBoxes.map(({ box }) => box.maxY)),
      };
      addLabel(closureUnion, `SHARED FRICTION-TUCK · ${end}`);
    }
  }

  for (const edge of model.edges || []) {
    if (!(edge.semanticRole || "").endsWith("RECEIVING_OPENING"))
      continue;
    const start = edge.geometry?.start || edge.a;
    const end = edge.geometry?.end || edge.b;
    if (!start || !end)
      continue;
    const a = projectedSvgPoint(start, sy, project);
    const b = projectedSvgPoint(end, sy, project);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const receivingPanel = String(edge.id || "").match(/^edge\.(?:top|bottom)\.([^.]+)\.receiving$/i)?.[1]?.toUpperCase() || edge.semanticRole.split(".")[1] || "PANEL";
    parts.push(`<path class="reuse-receiving-edge" data-reuse-role="RECEIVING_EDGE_SHARED" data-edge-id="${svgDiagnosticEscape(edge.id)}" d="M ${a.x.toFixed(4)} ${a.y.toFixed(4)} L ${b.x.toFixed(4)} ${b.y.toFixed(4)}"><title>${svgDiagnosticEscape(edge.semanticRole)} · shared semantic receiving edge · visual reuse diagnostic only</title></path>`);
    parts.push(`<text class="reuse-receiving-label" x="${mid.x.toFixed(4)}" y="${mid.y.toFixed(4)}">RECEIVING ${svgDiagnosticEscape(receivingPanel)}</text>`);
  }

  const topHost = model.topClosure?.majorHost || "—";
  const bottomHost = model.bottomClosure?.majorHost || "—";
  const topReceiving = model.topClosure?.receivingPanel || "—";
  const bottomReceiving = model.bottomClosure?.receivingPanel || "—";
  const summaryText = `STE reuse: BODY shared · TUCK shared · HOST ${topHost}/${bottomHost} · RECEIVE ${topReceiving}/${bottomReceiving}`;
  const summaryBox = bodyBoxes[0]?.box || { minX: 0, minY: 0, maxX: 80, maxY: 20 };
  const summary = projectedSvgPoint({ x: summaryBox.minX, y: summaryBox.maxY + 8 }, sy, project);
  parts.push(`<text class="reuse-diagnostic-summary" x="${summary.x.toFixed(4)}" y="${summary.y.toFixed(4)}">${svgDiagnosticEscape(summaryText)}</text>`);
  return `<g id="reuse-diagnostics" data-semantic-layer="reuse-diagnostics" data-layer-role="REUSE_ASSEMBLY_DIAGNOSTICS" class="reuse-diagnostic-layer" data-diagnostic="ste-reuse" data-session-only="true"><title>STE shared assembly diagnostic. Visual only; excluded from CartonModel, metrics, validation and production/export output.</title>${parts.join("")}</g>`;
}
