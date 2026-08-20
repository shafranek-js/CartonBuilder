/**
 * Pure SVG export metadata and validation helpers for the incremental M4
 * source extraction. SVG v3 adds renderer-only safe-zone state while retaining
 * presentation and bleed metadata; the semantic model remains unchanged.
 */

export const NS = "http://www.w3.org/2000/svg";
export const APP_VERSION = "0.9.34";
export const SVG_EXPORT_SCHEMA_VERSION = "pbd.svg.v3";
export const SVG_V4_EXPORT_SCHEMA_VERSION = "pbd.svg.v4";
export const SVG_SEMANTIC_LAYERS = [
  { id: "regions", role: "FILL_REGIONS" },
  { id: "boundaries", role: "FREE_BOUNDARY" },
  { id: "folds", role: "FOLD_BOUNDARY" },
  { id: "features", role: "OPEN_CUT_FEATURES" },
  { id: "anchors", role: "NAMED_ANCHORS" },
  { id: "sequence", role: "ASSEMBLY_SEQUENCE" },
  { id: "labels", role: "ANNOTATIONS" },
  { id: "dimensions", role: "DIMENSION_ANNOTATIONS" },
  { id: "diagnostics", role: "ENGINEERING_DIAGNOSTICS" },
  { id: "bleed", role: "ARTWORK_BLEED_REFERENCE" },
  { id: "safe-zones", role: "ARTWORK_SAFE_ZONE_REFERENCE" },
];

const SVG_SAFE_ZONE_FACE_IDS = ["FRONT", "BACK", "SIDE_1", "SIDE_2", "TOP", "BOTTOM"];
const SVG_V4_ASSEMBLY_STAGE_IDS = ["erect-body", "bottom-dust", "bottom-close", "top-dust", "top-close"];

export function esc(value) {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] || character));
}

function normalizedMetadataTransform(value) {
  const entries = [value?.a, value?.b, value?.c, value?.d].map(Number);
  if (!entries.every((entry) => Number.isInteger(entry) && Math.abs(entry) <= 1))
    return null;
  const [a, b, c, d] = entries;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) !== 1 || a * a + b * b !== 1 || c * c + d * d !== 1 || a * c + b * d !== 0)
    return null;
  return { a, b, c, d };
}

export function buildSvgExportMetadata(model, options = {}) {
  const presentationTransform = normalizedMetadataTransform(options.presentationTransform) || { a: 1, b: 0, c: 0, d: 1 };
  const rawWidth = Number(options.bleed?.widthMm);
  const widthMm = Number.isFinite(rawWidth) && rawWidth >= .1 && rawWidth <= 20 ? rawWidth : 3;
  const canvas = options.canvas && typeof options.canvas === "object" ? {
    widthMm: Number(options.canvas.widthMm),
    heightMm: Number(options.canvas.heightMm),
    referenceWidthMm: Number(options.canvas.referenceWidthMm),
    referenceHeightMm: Number(options.canvas.referenceHeightMm),
    viewBox: Array.isArray(options.canvas.viewBox) ? options.canvas.viewBox.map(Number) : [],
  } : null;
  const renderedFaceIds = Array.isArray(options.safeZones?.renderedFaceIds) ? options.safeZones.renderedFaceIds.slice() : [];
  const unavailableFaceIds = Array.isArray(options.safeZones?.unavailableFaceIds) ? options.safeZones.unavailableFaceIds.slice() : [];
  const safeZones = {
    enabled: options.safeZones?.enabled === true,
    included: options.safeZones?.included === true,
    cutMarginMm: Number(options.safeZones?.cutMarginMm ?? 3),
    foldMarginMm: Number(options.safeZones?.foldMarginMm ?? 5),
    glueSeamMinimumMm: 5,
    renderedFaceIds,
    unavailableFaceIds,
  };
  return {
    format: "CartonBuilder SVG Reference",
    schemaVersion: SVG_EXPORT_SCHEMA_VERSION,
    modelSchemaVersion: model?.schemaVersion || null,
    engineVersion: model?.engineVersion || APP_VERSION,
    units: "mm",
    referenceOnly: true,
    productionCertified: false,
    cartonType: model?.input?.cartonType || null,
    orientation: model?.input?.orientation || null,
    dimensionReference: model?.requestedDimensionReference || null,
    includeDimensions: options.includeDimensions === true,
    includeDiagnostics: options.includeDiagnostics === true,
    presentationTransform,
    bleed: { included: options.bleed?.enabled === true, widthMm },
    safeZones,
    canvas,
    semanticLayers: SVG_SEMANTIC_LAYERS.map((layer) => ({ ...layer })),
  };
}

function regionPointBounds(region) {
  const points = (region?.contour?.segments || []).flatMap((segment) => [segment.start, segment.end]).filter(Boolean);
  if (!points.length)
    return null;
  const xs = points.map((point) => Number(point.x));
  const ys = points.map((point) => Number(point.y));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return [minX, minY, maxX, maxY].every(Number.isFinite) ? { minX, maxX, minY, maxY, x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;
}

function panelLayerClass(region) {
  if (region?.kind === "GLUE_FLAP" || region?.role?.includes("GLUE_FLAP"))
    return "glue";
  if (region?.role?.includes("SNAP_LOCK"))
    return "locking";
  if (region?.kind === "TONGUE" || region?.role?.includes("DUST"))
    return "inner";
  return "shell";
}

function bodyPanelId(panel) {
  return panel ? `body.${String(panel).toLowerCase()}` : null;
}

function foldStageFor(model, fold, childPanelId) {
  const roleText = String(fold?.semanticRole || fold?.id || "");
  const end = roleText.startsWith("TOP.") ? "top" : roleText.startsWith("BOTTOM.") ? "bottom" : null;
  const role = String(fold?.semanticRole || "");
  if (role.startsWith("BODY."))
    return "erect-body";
  if (role.includes("DUST"))
    return `${end || "closure"}-dust`;
  const closure = end === "top" ? model?.topClosure : end === "bottom" ? model?.bottomClosure : null;
  const sequence = closure?.sequence?.stages || [];
  const sequenceStage = sequence.find((stage) => stage.actions?.some((action) => action.entityId === childPanelId));
  if (sequenceStage)
    return end === "top" ? "top-close" : sequenceStage.role === "SUPPORT" ? "bottom-dust" : "bottom-close";
  return `${end || "closure"}-close`;
}

function explicitFoldParentChild(model, fold, panelIds) {
  const owners = (fold?.owners || []).filter((id) => panelIds.has(id));
  if (owners.length !== 2)
    return null;
  const role = String(fold.semanticRole || "");
  const relations = (model?.relations || []).filter((relation) => relation.type === "FOLD" && relation.details?.structuralEdgeId === fold.id);
  if (relations.length === 1 && panelIds.has(relations[0].sourceId) && panelIds.has(relations[0].targetId))
    return { parentPanelId: relations[0].targetId, childPanelId: relations[0].sourceId };
  const bodyChain = {
    "BODY.SIDE1_TO_FRONT": ["body.front", "body.side1"],
    "BODY.FRONT_TO_SIDE2": ["body.front", "body.side2"],
    "BODY.SIDE2_TO_BACK": ["body.side2", "body.back"],
    "BODY.BACK_TO_GLUE": ["body.back", "body.glueFlap"],
    "BODY.GLUE_TO_SIDE1": ["body.side1", "body.glueFlap"],
  }[role];
  if (bodyChain && bodyChain.every((id) => panelIds.has(id)))
    return { parentPanelId: bodyChain[0], childPanelId: bodyChain[1] };
  if (role.endsWith(".MAJOR_ROOT")) {
    const closureEnd = role.split(".")[0];
    const closure = closureEnd === "TOP" ? model?.topClosure : model?.bottomClosure;
    const host = bodyPanelId(closure?.majorHost);
    const child = owners.find((id) => id !== host) || null;
    if (host && child)
      return { parentPanelId: host, childPanelId: child };
  }
  if (role.endsWith(".TONGUE_ROOT")) {
    const child = owners.find((id) => id.endsWith(".tongue"));
    const parent = owners.find((id) => id !== child);
    if (child && parent)
      return { parentPanelId: parent, childPanelId: child };
  }
  if (role.includes(".DUST_") && role.endsWith("_ROOT")) {
    const child = owners.find((id) => id.includes(".dust."));
    const parent = owners.find((id) => id !== child);
    if (child && parent)
      return { parentPanelId: parent, childPanelId: child };
  }
  const nonGlue = owners.filter((id) => !id.endsWith("glueFlap"));
  if (owners.some((id) => id.endsWith("glueFlap")) && nonGlue.length === 1)
    return { parentPanelId: nonGlue[0], childPanelId: "body.glueFlap" };
  return null;
}

function signedFoldAngleDeg(fold, childRegion) {
  const geometry = fold?.geometry;
  const bounds = regionPointBounds(childRegion);
  if (!geometry || geometry.kind !== "LINE" || !bounds)
    return null;
  const axisX = Number(geometry.end.x) - Number(geometry.start.x);
  const axisY = Number(geometry.end.y) - Number(geometry.start.y);
  const hingeX = (Number(geometry.start.x) + Number(geometry.end.x)) / 2;
  const hingeY = (Number(geometry.start.y) + Number(geometry.end.y)) / 2;
  const childX = bounds.x - hingeX;
  const childY = bounds.y - hingeY;
  const cross = childX * axisY - childY * axisX;
  return cross === 0 ? null : (cross > 0 ? 90 : -90);
}

function pointDistanceToSegment(point, start, end) {
  const px = Number(point?.x), py = Number(point?.y);
  const ax = Number(start?.x), ay = Number(start?.y);
  const bx = Number(end?.x), by = Number(end?.y);
  if (![px, py, ax, ay, bx, by].every(Number.isFinite))
    return Infinity;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0)
    return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function foldHingeMatchesRegion(fold, region, toleranceMm) {
  if (fold?.geometry?.kind !== "LINE" || !region?.contour?.segments)
    return false;
  const start = fold.geometry.start;
  const end = fold.geometry.end;
  const segments = region.contour.segments.filter((segment) => segment.kind === "LINE");
  return segments.some((segment) => pointDistanceToSegment(start, segment.start, segment.end) <= toleranceMm && pointDistanceToSegment(end, segment.start, segment.end) <= toleranceMm);
}

function decodeSvgMetadata(markup) {
  const match = typeof markup === "string" ? markup.match(/<metadata id="cartonbuilder-metadata"[^>]*>([\s\S]*?)<\/metadata>/) : null;
  if (!match)
    return null;
  try {
    return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">" ).replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
}

function escapeSvgRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function interactionStage(interaction) {
  if (interaction.type === "tuck-insertion")
    return String(interaction.tonguePanelId || "").startsWith("closure.bottom") ? "bottom-close" : "top-close";
  return "bottom-close";
}

function foldActionDescriptor(fold, stageIndex) {
  const foldId = String(fold.foldId || "");
  if (foldId.endsWith("dust-left-root") || foldId.endsWith("dust-right-root"))
    return { order: 10, parallelGroup: `${fold.assemblyStage}-pair` };
  if (/snap\.side(?:A|B)\.root$/.test(foldId))
    return { order: 10, parallelGroup: "bottom-snap-side-pair" };
  if (foldId.endsWith("major-root"))
    return { order: 10 };
  if (foldId.endsWith("tongue-root") || foldId.endsWith("snap.locking.root"))
    return { order: 20 };
  return { order: (stageIndex + 1) * 10 };
}

function compareAssemblyActions(a, b, stageOrderById) {
  const stageDelta = (stageOrderById.get(a.stage) ?? Number.MAX_SAFE_INTEGER) - (stageOrderById.get(b.stage) ?? Number.MAX_SAFE_INTEGER);
  if (stageDelta)
    return stageDelta;
  const orderDelta = Number(a.order) - Number(b.order);
  if (orderDelta)
    return orderDelta;
  return String(a.foldId || a.relationId || "").localeCompare(String(b.foldId || b.relationId || ""));
}

export function validateSvgV4Assembly(metadata) {
  const issues = [];
  const warnings = [];
  const panels = Array.isArray(metadata?.panels) ? metadata.panels : [];
  const panelIds = new Set(panels.map((panel) => panel?.id).filter(Boolean));
  const features = Array.isArray(metadata?.features) ? metadata.features : [];
  const featureIds = new Set(features.map((feature) => feature?.id).filter(Boolean));
  const foldGraph = Array.isArray(metadata?.folding?.foldGraph) ? metadata.folding.foldGraph : [];
  const foldIds = new Set(foldGraph.map((fold) => fold?.foldId).filter(Boolean));
  const receivingOpenings = Array.isArray(metadata?.receivingOpenings) ? metadata.receivingOpenings : [];
  const receivingOpeningIds = new Set(receivingOpenings.map((opening) => opening?.id).filter(Boolean));
  const interactions = Array.isArray(metadata?.interactions) ? metadata.interactions : [];
  const stages = Array.isArray(metadata?.assembly?.stages) ? metadata.assembly.stages : [];
  const actions = Array.isArray(metadata?.assembly?.actions) ? metadata.assembly.actions : [];
  const stageIds = new Set(stages.map((stage) => stage?.id).filter(Boolean));
  const stageOrderById = new Map(stages.map((stage) => [stage?.id, Number(stage?.order)]));

  if (!stages.length)
    issues.push({ code: "SVG_V4_ASSEMBLY_STAGES_MISSING", severity: "ERROR" });
  for (const stageId of SVG_V4_ASSEMBLY_STAGE_IDS)
    if (!stageIds.has(stageId))
      issues.push({ code: "SVG_V4_ASSEMBLY_EXPECTED_STAGE_MISSING", stageId, severity: "ERROR" });
  for (const stage of stages) {
    if (!stage?.id || !Number.isFinite(Number(stage.order)) || Number(stage.order) <= 0)
      issues.push({ code: "SVG_V4_ASSEMBLY_STAGE_INVALID", stageId: stage?.id, severity: "ERROR" });
    if (stages.filter((entry) => entry?.id === stage?.id).length > 1)
      issues.push({ code: "SVG_V4_ASSEMBLY_STAGE_DUPLICATE", stageId: stage?.id, severity: "ERROR" });
  }
  const seenActionIds = new Set();
  const actionsByStage = new Map();
  for (const action of actions) {
    if (!action?.type || !stageIds.has(action.stage))
      issues.push({ code: "SVG_V4_ASSEMBLY_ACTION_STAGE_INVALID", relationId: action?.relationId, foldId: action?.foldId, stage: action?.stage, severity: "ERROR" });
    if (!Number.isFinite(Number(action?.order)) || Number(action.order) <= 0)
      issues.push({ code: "SVG_V4_ASSEMBLY_ACTION_ORDER_INVALID", relationId: action?.relationId, foldId: action?.foldId, severity: "ERROR" });
    if (action?.parallelGroup !== undefined && (typeof action.parallelGroup !== "string" || !action.parallelGroup))
      issues.push({ code: "SVG_V4_ASSEMBLY_PARALLEL_GROUP_INVALID", relationId: action?.relationId, foldId: action?.foldId, severity: "ERROR" });
    const actionId = action?.foldId || action?.relationId;
    if (actionId && seenActionIds.has(actionId))
      issues.push({ code: "SVG_V4_ASSEMBLY_ACTION_DUPLICATE", actionId, severity: "ERROR" });
    if (actionId)
      seenActionIds.add(actionId);
    if (action.type === "fold") {
      const fold = foldGraph.find((entry) => entry?.foldId === action.foldId);
      if (!fold)
        issues.push({ code: "SVG_V4_ASSEMBLY_FOLD_REFERENCE_INVALID", foldId: action.foldId, severity: "ERROR" });
      else if (fold.assemblyStage !== action.stage)
        issues.push({ code: "SVG_V4_ASSEMBLY_FOLD_STAGE_MISMATCH", foldId: action.foldId, severity: "ERROR" });
    } else if (action.type === "interaction" || action.type === "insert" || action.type === "engage") {
      const interaction = interactions.find((entry) => entry?.relationId === action.relationId);
      if (!interaction)
        issues.push({ code: "SVG_V4_ASSEMBLY_INTERACTION_REFERENCE_INVALID", relationId: action.relationId, severity: "ERROR" });
      else if (action.type === "interaction" && interaction.type !== "tuck-insertion")
        issues.push({ code: "SVG_V4_ASSEMBLY_COMPOSITE_INTERACTION_TYPE_INVALID", relationId: action.relationId, severity: "ERROR" });
    } else {
      issues.push({ code: "SVG_V4_ASSEMBLY_ACTION_TYPE_INVALID", type: action.type, severity: "ERROR" });
    }
    if (!actionsByStage.has(action.stage))
      actionsByStage.set(action.stage, []);
    actionsByStage.get(action.stage).push(action);
  }
  for (const [stage, stageActions] of actionsByStage) {
    let previousOrder = -Infinity;
    const orderGroups = new Map();
    for (const action of stageActions) {
      const order = Number(action.order);
      if (order < previousOrder)
        issues.push({ code: "SVG_V4_ASSEMBLY_ACTION_ORDER_UNSORTED", stage, severity: "ERROR" });
      previousOrder = order;
      if (!orderGroups.has(order))
        orderGroups.set(order, []);
      orderGroups.get(order).push(action);
    }
    for (const [order, sameOrder] of orderGroups) {
      if (sameOrder.length > 1 && (sameOrder.some((action) => !action.parallelGroup) || new Set(sameOrder.map((action) => action.parallelGroup)).size !== 1))
        issues.push({ code: "SVG_V4_ASSEMBLY_PARALLEL_ORDER_AMBIGUOUS", stage, order, severity: "ERROR" });
      if (sameOrder.length > 1 && sameOrder.some((action) => action.parallelGroup && Number(action.order) !== order))
        issues.push({ code: "SVG_V4_ASSEMBLY_PARALLEL_ORDER_INVALID", stage, order, severity: "ERROR" });
    }
  }
  for (const interaction of interactions) {
    if (!interaction?.relationId || !interaction?.type)
      issues.push({ code: "SVG_V4_INTERACTION_INVALID", relationId: interaction?.relationId, severity: "ERROR" });
    if (interaction.type === "tuck-insertion") {
      for (const [key, values] of Object.entries({
        tonguePanelId: panelIds,
        closurePanelId: panelIds,
        tongueFoldId: foldIds,
        closureFoldId: foldIds,
        receivingOpeningId: receivingOpeningIds,
      })) {
        if (!values.has(interaction[key]))
          issues.push({ code: "SVG_V4_INTERACTION_REFERENCE_INVALID", relationId: interaction.relationId, key, value: interaction[key], severity: "ERROR" });
      }
      if (interaction.motionModel !== undefined && interaction.motionModel !== "TUCK_STANDARD")
        warnings.push({ code: "SVG_V4_INTERACTION_MOTION_MODEL_UNKNOWN", relationId: interaction.relationId, severity: "WARN" });
    } else if (interaction.type === "lock-engagement") {
      for (const [key, values] of Object.entries({ lockingPanelId: panelIds, lockingFeatureId: featureIds, receivingOpeningId: receivingOpeningIds })) {
        if (!values.has(interaction[key]))
          issues.push({ code: "SVG_V4_INTERACTION_REFERENCE_INVALID", relationId: interaction.relationId, key, value: interaction[key], severity: "ERROR" });
      }
    } else {
      issues.push({ code: "SVG_V4_INTERACTION_TYPE_INVALID", relationId: interaction.relationId, type: interaction.type, severity: "ERROR" });
    }
    if (!seenActionIds.has(interaction.relationId))
      issues.push({ code: "SVG_V4_INTERACTION_ACTION_MISSING", relationId: interaction.relationId, severity: "ERROR" });
    if (interaction.type === "tuck-insertion") {
      const closureFold = foldGraph.find((fold) => fold.foldId === interaction.closureFoldId);
      const tongueFold = foldGraph.find((fold) => fold.foldId === interaction.tongueFoldId);
      if (closureFold && (closureFold.childPanelId !== interaction.closurePanelId || closureFold.assemblyStage !== interactionStage(interaction)))
        issues.push({ code: "SVG_V4_TUCK_CLOSURE_FOLD_LINK_INVALID", relationId: interaction.relationId, severity: "ERROR" });
      if (tongueFold && (tongueFold.parentPanelId !== interaction.closurePanelId || tongueFold.childPanelId !== interaction.tonguePanelId || tongueFold.assemblyStage !== interactionStage(interaction)))
        issues.push({ code: "SVG_V4_TUCK_TONGUE_FOLD_LINK_INVALID", relationId: interaction.relationId, severity: "ERROR" });
      for (const action of actions)
        if (action.type === "fold" && action.stage === interactionStage(interaction) && [interaction.closureFoldId, interaction.tongueFoldId].includes(action.foldId))
          issues.push({ code: "SVG_V4_TUCK_FOLD_ACTION_CONFLICT", relationId: interaction.relationId, foldId: action.foldId, severity: "ERROR" });
    }
  }
  for (const end of ["top", "bottom"]) {
    const tonguePanelId = `closure.${end}.tongue`;
    const lockingPanelId = `closure.${end}.snap.locking`;
    if (panelIds.has(tonguePanelId) && !interactions.some((interaction) => interaction.type === "tuck-insertion" && interaction.tonguePanelId === tonguePanelId))
      issues.push({ code: "SVG_V4_REQUIRED_TUCK_INTERACTION_MISSING", end, severity: "ERROR" });
    if (panelIds.has(lockingPanelId) && !interactions.some((interaction) => interaction.type === "lock-engagement" && interaction.lockingPanelId === lockingPanelId))
      issues.push({ code: "SVG_V4_REQUIRED_LOCK_INTERACTION_MISSING", end, severity: "ERROR" });
  }
  return { valid: issues.length === 0, issues, warnings };
}

export function buildSvgV4ExportMetadata(model, options = {}) {
  const base = buildSvgExportMetadata(model, options);
  const panelIds = new Set((model?.regions || []).map((region) => region.id));
  const regionById = new Map((model?.regions || []).map((region) => [region.id, region]));
  const folds = (model?.edges || []).filter((edge) => edge.role === "FOLD_BOUNDARY" && edge.referenceAccountingOnly !== true && edge.render !== false);
  const geometryToleranceMm = 0.001;
  const hingeValidationToleranceMm = geometryToleranceMm + (Number(model?.material?.thickness) > 0 ? Number(model.material.thickness) : 0);
  // STE is the active foldable-conversion candidate. Preserve the frozen RTE
  // export shape while exposing exact semantic hinge endpoints for STE only.
  // These coordinates come from the already-owned FOLD_BOUNDARY edge; they do
  // not introduce a second/display geometry or alter metrics.
  const includeHingeGeometry = model?.input?.cartonType === "STE";
  const foldGraph = [];
  const graphIssues = [];
  const graphWarnings = [];
  for (const fold of folds) {
    const link = explicitFoldParentChild(model, fold, panelIds);
    if (!link) {
      graphIssues.push({ code: "FOLD_PANEL_LINK_UNRESOLVED", foldId: fold.id, severity: "ERROR" });
      continue;
    }
    const targetAngleDeg = signedFoldAngleDeg(fold, regionById.get(link.childPanelId));
    if (!Number.isFinite(targetAngleDeg))
      graphIssues.push({ code: "FOLD_ANGLE_UNRESOLVED", foldId: fold.id, severity: "ERROR" });
    if (!foldHingeMatchesRegion(fold, regionById.get(link.parentPanelId), hingeValidationToleranceMm) || !foldHingeMatchesRegion(fold, regionById.get(link.childPanelId), hingeValidationToleranceMm))
      graphWarnings.push({ code: "FOLD_HINGE_CONTOUR_TOLERANCE", foldId: fold.id, severity: "WARN", toleranceMm: hingeValidationToleranceMm });
    foldGraph.push({
      foldId: fold.id,
      parentPanelId: link.parentPanelId,
      childPanelId: link.childPanelId,
      targetAngleDeg,
      assemblyStage: foldStageFor(model, fold, link.childPanelId),
      geometryType: fold.geometry?.kind || null,
      ...(includeHingeGeometry && fold.geometry?.kind === "LINE" ? {
        geometry: {
          kind: "LINE",
          start: { x: Number(fold.geometry.start.x), y: Number(fold.geometry.start.y) },
          end: { x: Number(fold.geometry.end.x), y: Number(fold.geometry.end.y) },
        },
      } : {}),
    });
  }
  const rootPanelId = panelIds.has("body.front") ? "body.front" : (model?.body?.regions || [])[0]?.id || model?.regions?.[0]?.id || null;
  const parentCounts = new Map();
  for (const fold of foldGraph)
    parentCounts.set(fold.childPanelId, (parentCounts.get(fold.childPanelId) || 0) + 1);
  for (const panelId of panelIds)
    if (panelId !== rootPanelId && parentCounts.get(panelId) !== 1)
      graphIssues.push({ code: "PANEL_PARENT_COUNT_INVALID", panelId, severity: "ERROR", count: parentCounts.get(panelId) || 0 });
  const childrenByParent = new Map();
  for (const fold of foldGraph) {
    if (!panelIds.has(fold.parentPanelId) || !panelIds.has(fold.childPanelId))
      graphIssues.push({ code: "FOLD_PANEL_REFERENCE_INVALID", foldId: fold.foldId, severity: "ERROR" });
    if (!childrenByParent.has(fold.parentPanelId))
      childrenByParent.set(fold.parentPanelId, []);
    childrenByParent.get(fold.parentPanelId).push(fold.childPanelId);
  }
  const visitState = new Map();
  const visit = (panelId, path = []) => {
    const state = visitState.get(panelId) || "UNVISITED";
    if (state === "VISITING") {
      graphIssues.push({ code: "FOLD_GRAPH_CYCLE", panelId, path: [...path, panelId], severity: "ERROR" });
      return;
    }
    if (state === "VISITED")
      return;
    visitState.set(panelId, "VISITING");
    for (const childPanelId of childrenByParent.get(panelId) || [])
      visit(childPanelId, [...path, panelId]);
    visitState.set(panelId, "VISITED");
  };
  if (rootPanelId)
    visit(rootPanelId);
  for (const panelId of panelIds)
    if (!visitState.has(panelId))
      visit(panelId);
  const foldByRole = (end, suffix) => foldGraph.find((fold) => fold.foldId === `fold.${end}.${suffix}`)?.foldId || foldGraph.find((fold) => String(fold.foldId).startsWith(`fold.${end}.`) && String(fold.foldId).includes(suffix))?.foldId || null;
  const receivingOpeningByEnd = (end, targetId) => (model?.edges || []).find((edge) => edge.semanticRole === `${end}.RECEIVING_OPENING` && (!targetId || edge.owners?.includes(targetId)))?.id || null;
  const interactions = [];
  for (const relation of model?.relations || []) {
    if (relation.type === "INSERT") {
      const end = relation.id?.split(".")[1] || "top";
      const closurePanelId = `closure.${end}.major`;
      interactions.push({ type: "tuck-insertion", relationId: relation.id, tonguePanelId: relation.sourceId, closurePanelId, tongueFoldId: foldByRole(end, "tongue-root"), closureFoldId: foldByRole(end, "major-root"), receivingOpeningId: receivingOpeningByEnd(end.toUpperCase(), relation.targetId) });
    } else if (relation.type === "INTERLOCK") {
      const sourceFeature = (model?.features || []).find((feature) => feature.id === relation.sourceId);
      interactions.push({ type: "lock-engagement", relationId: relation.id, lockingPanelId: sourceFeature?.hostRegionId || null, lockingFeatureId: relation.sourceId, receivingOpeningId: relation.targetId, engagementType: relation.details?.engagementType || relation.role || null });
    }
  }
  const receivingOpenings = [
    ...(model?.edges || []).filter((edge) => String(edge.semanticRole || "").endsWith("RECEIVING_OPENING")).map((edge) => ({
      id: edge.id,
      entityKind: "edge",
      semanticRole: edge.semanticRole,
      hostPanelIds: Array.isArray(edge.owners) ? edge.owners.slice() : [],
    })),
    ...(model?.features || []).filter((feature) => String(feature.role || "").includes("RECEIVER")).map((feature) => ({
      id: feature.id,
      entityKind: "feature",
      semanticRole: feature.role,
      hostPanelIds: feature.hostRegionId ? [feature.hostRegionId] : [],
    })),
  ];
  const glueTargetPanelId = panelIds.has("body.side1") ? "body.side1" : null;
  const stages = [
    { id: "erect-body", order: 10 },
    { id: "bottom-dust", order: 20 },
    { id: "bottom-close", order: 30 },
    { id: "top-dust", order: 40 },
    { id: "top-close", order: 50 },
  ];
  const exportedInteractions = interactions.map((interaction) => interaction.type === "tuck-insertion" ? { ...interaction, motionModel: "TUCK_STANDARD" } : interaction);
  const tuckOwnedFoldIds = new Set(exportedInteractions.filter((interaction) => interaction.type === "tuck-insertion").flatMap((interaction) => [interaction.closureFoldId, interaction.tongueFoldId]).filter(Boolean));
  const stageOrderById = new Map(stages.map((stage) => [stage.id, stage.order]));
  const foldStageIndexes = new Map();
  const actions = foldGraph.filter((fold) => !tuckOwnedFoldIds.has(fold.foldId)).map((fold) => {
    const stageIndex = foldStageIndexes.get(fold.assemblyStage) || 0;
    foldStageIndexes.set(fold.assemblyStage, stageIndex + 1);
    const descriptor = foldActionDescriptor(fold, stageIndex);
    return { type: "fold", foldId: fold.foldId, stage: fold.assemblyStage, order: descriptor.order, ...(descriptor.parallelGroup ? { parallelGroup: descriptor.parallelGroup } : {}) };
  });
  exportedInteractions.forEach((interaction) => actions.push({
    type: interaction.type === "tuck-insertion" ? "interaction" : "engage",
    relationId: interaction.relationId,
    stage: interactionStage(interaction),
    order: interaction.type === "tuck-insertion" ? 10 : 30,
  }));
  actions.sort((a, b) => compareAssemblyActions(a, b, stageOrderById));
  const dimensions = model?.input || {};
  const material = model?.material || {};
  const creaseProfile = {
    ...(Number.isFinite(Number(material.insideLoss)) ? { insideLossMm: Number(material.insideLoss) } : {}),
    ...(Number.isFinite(Number(material.outsideGain)) ? { outsideGainMm: Number(material.outsideGain) } : {}),
  };
  const assemblyValidation = validateSvgV4Assembly({ panels: (model?.regions || []).map((region) => ({ id: region.id })), features: (model?.features || []).map((feature) => ({ id: feature.id })), folding: { foldGraph }, assembly: { stages, actions }, interactions, receivingOpenings });
  return {
    ...base,
    format: "Parametric Packaging SVG Reference",
    schemaVersion: SVG_V4_EXPORT_SCHEMA_VERSION,
    dimensionReference: ["INNER", "CREASE", "OUTER"].includes(model?.requestedDimensionReference) ? model.requestedDimensionReference : null,
    // These are nominal user/model dimensions. Resolved manufacture/outer values
    // and compensated panel pitches remain in CartonModel geometry only.
    dimensions: { lengthMm: Number(dimensions.width), widthMm: Number(dimensions.depth), heightMm: Number(dimensions.height) },
    material: {
      type: "folding-carton",
      caliperMm: Number(material.thickness),
      ...(material.grainDirection ? { grainDirection: material.grainDirection } : {}),
      ...(Object.keys(creaseProfile).length ? { creaseProfile } : {}),
    },
    coordinateConvention: { svgPlane: "XY", outsideNormal: "+Z" },
    geometryToleranceMm,
    capabilities: {
      panelGeometry: true,
      foldGraph: true,
      signedFoldAngles: true,
      assemblySequence: true,
      interactions: true,
      adhesiveBonds: true,
      physicalCreaseProfile: false,
    },
    conversionHints: {
      allowGenericCreaseFallback: true,
      allowGenericTuckMotion: true,
    },
    panels: (model?.regions || []).map((region) => ({ id: region.id, semanticRole: region.role, kind: region.kind, layerClass: panelLayerClass(region), artworkSide: "outside", entityId: region.id })),
    features: (model?.features || []).map((feature) => ({ id: feature.id, semanticRole: feature.role, kind: feature.kind, hostPanelId: feature.hostRegionId || null })),
    folding: { rootPanelId, foldGraph, graphValidation: { valid: graphIssues.length === 0, issues: graphIssues, warnings: graphWarnings } },
    assembly: { stages, actions, assemblyValidation },
    interactions: exportedInteractions,
    receivingOpenings,
    bonds: glueTargetPanelId ? [{ type: "adhesive", sourcePanelId: "body.glueFlap", targetPanelId: glueTargetPanelId, targetSurface: "inner" }] : [],
    diagnostics: { graphIssues, graphWarnings },
  };
}

export function validateSvgV4Export(markup) {
  const issues = [];
  if (typeof markup !== "string" || !markup.startsWith("<svg "))
    return { valid: false, issues: [{ code: "SVG_NOT_MARKUP", severity: "ERROR", message: "SVG export must be markup beginning with an svg root." }] };
  if (!markup.includes(`data-export-schema-version="${SVG_V4_EXPORT_SCHEMA_VERSION}"`))
    issues.push({ code: "SVG_V4_SCHEMA_VERSION_MISSING", severity: "ERROR" });
  const metadata = decodeSvgMetadata(markup);
  if (!metadata)
    issues.push({ code: "SVG_V4_METADATA_INVALID", severity: "ERROR" });
  if (metadata) {
    if (metadata.format !== "Parametric Packaging SVG Reference" || metadata.schemaVersion !== SVG_V4_EXPORT_SCHEMA_VERSION)
      issues.push({ code: "SVG_V4_METADATA_FORMAT_INVALID", severity: "ERROR" });
    if (metadata.units !== "mm" || metadata.referenceOnly !== true || metadata.productionCertified !== false)
      issues.push({ code: "SVG_V4_STATUS_INVALID", severity: "ERROR" });
    if (!["INNER", "CREASE", "OUTER"].includes(metadata.dimensionReference))
      issues.push({ code: "SVG_V4_DIMENSION_REFERENCE_INVALID", severity: "ERROR" });
    if (!metadata.dimensions || ![metadata.dimensions.lengthMm, metadata.dimensions.widthMm, metadata.dimensions.heightMm].every((value) => Number.isFinite(value) && value > 0))
      issues.push({ code: "SVG_V4_DIMENSIONS_INVALID", severity: "ERROR" });
    if (!Number.isFinite(metadata.material?.caliperMm) || metadata.material.caliperMm <= 0)
      issues.push({ code: "SVG_V4_CALIPER_INVALID", severity: "ERROR" });
    if (!metadata.capabilities || Object.entries({ panelGeometry: true, foldGraph: true, signedFoldAngles: true, assemblySequence: true, interactions: true, adhesiveBonds: true }).some(([key, expected]) => metadata.capabilities[key] !== expected) || metadata.capabilities.physicalCreaseProfile !== false)
      issues.push({ code: "SVG_V4_CAPABILITIES_INVALID", severity: "ERROR" });
    if (!metadata.conversionHints || metadata.conversionHints.allowGenericCreaseFallback !== true || metadata.conversionHints.allowGenericTuckMotion !== true)
      issues.push({ code: "SVG_V4_CONVERSION_HINTS_INVALID", severity: "ERROR" });
    const panels = Array.isArray(metadata.panels) ? metadata.panels : [];
    const panelIds = new Set(panels.map((panel) => panel.id));
    if (!metadata.folding?.rootPanelId || !panelIds.has(metadata.folding.rootPanelId))
      issues.push({ code: "SVG_V4_ROOT_PANEL_INVALID", severity: "ERROR" });
    if (metadata.folding?.graphValidation?.valid !== true)
      issues.push({ code: "SVG_V4_GRAPH_INVALID", severity: "ERROR" });
    for (const panel of panels) {
      if (!["shell", "inner", "outer", "glue", "locking"].includes(panel.layerClass))
        issues.push({ code: "SVG_V4_PANEL_LAYER_INVALID", panelId: panel.id, severity: "ERROR" });
      const path = new RegExp('<path[^>]+id="' + escapeSvgRegex(panel.id) + '"[^>]+data-layer-class="' + escapeSvgRegex(panel.layerClass) + '"[^>]+data-artwork-side="outside"');
      if (!path.test(markup))
        issues.push({ code: "SVG_V4_PANEL_ATTRIBUTE_MISSING", panelId: panel.id, severity: "ERROR" });
    }
    const features = Array.isArray(metadata.features) ? metadata.features : [];
    const featureIds = new Set(features.map((feature) => feature.id));
    for (const feature of features) {
      if (!feature?.id || !feature.semanticRole || !feature.hostPanelId || !panelIds.has(feature.hostPanelId))
        issues.push({ code: "SVG_V4_FEATURE_INVALID", featureId: feature?.id, severity: "ERROR" });
      const featurePattern = new RegExp('<path[^>]+data-entity-id="' + escapeSvgRegex(feature.id) + '"[^>]+data-semantic-role="' + escapeSvgRegex(feature.semanticRole) + '"');
      if (!featurePattern.test(markup))
        issues.push({ code: "SVG_V4_FEATURE_ENTITY_MISSING", featureId: feature.id, severity: "ERROR" });
    }
    const folds = Array.isArray(metadata.folding?.foldGraph) ? metadata.folding.foldGraph : [];
    const assemblyActions = Array.isArray(metadata.assembly?.actions) ? metadata.assembly.actions : [];
    const assemblyActionByFoldId = new Map(assemblyActions.filter((action) => action?.type === "fold").map((action) => [action.foldId, action]));
    const interactionByFoldId = new Map((metadata.interactions || []).flatMap((interaction) => interaction.type === "tuck-insertion" ? [[interaction.closureFoldId, interaction], [interaction.tongueFoldId, interaction]] : []));
    for (const fold of folds) {
      if (!panelIds.has(fold.parentPanelId) || !panelIds.has(fold.childPanelId) || !Number.isFinite(fold.targetAngleDeg) || Math.abs(fold.targetAngleDeg) > 180 || !fold.assemblyStage)
        issues.push({ code: "SVG_V4_FOLD_INVALID", foldId: fold.foldId, severity: "ERROR" });
      const foldPattern = new RegExp('<path[^>]+id="' + escapeSvgRegex(fold.foldId) + '"[^>]+data-parent-panel="' + escapeSvgRegex(fold.parentPanelId) + '"[^>]+data-child-panel="' + escapeSvgRegex(fold.childPanelId) + '"[^>]+data-target-angle-deg="' + escapeSvgRegex(fold.targetAngleDeg) + '"[^>]+data-assembly-stage="' + escapeSvgRegex(fold.assemblyStage) + '"');
      if (!foldPattern.test(markup))
        issues.push({ code: "SVG_V4_FOLD_ATTRIBUTE_MISSING", foldId: fold.foldId, severity: "ERROR" });
      const foldAction = assemblyActionByFoldId.get(fold.foldId);
      const interactionController = interactionByFoldId.get(fold.foldId);
      if (foldAction) {
        const foldActionPattern = new RegExp('<path[^>]+id="' + escapeSvgRegex(fold.foldId) + '"[^>]+data-assembly-order="' + escapeSvgRegex(foldAction.order) + '"' + (foldAction.parallelGroup ? '[^>]+data-parallel-group="' + escapeSvgRegex(foldAction.parallelGroup) + '"' : '') );
        if (!foldActionPattern.test(markup))
          issues.push({ code: "SVG_V4_FOLD_ACTION_ATTRIBUTE_MISSING", foldId: fold.foldId, severity: "ERROR" });
      } else if (interactionController) {
        const interactionPattern = new RegExp('<path[^>]+id="' + escapeSvgRegex(fold.foldId) + '"[^>]+data-interaction-relation-id="' + escapeSvgRegex(interactionController.relationId) + '"');
        if (!interactionPattern.test(markup))
          issues.push({ code: "SVG_V4_FOLD_INTERACTION_ATTRIBUTE_MISSING", foldId: fold.foldId, severity: "ERROR" });
      } else {
        issues.push({ code: "SVG_V4_FOLD_ACTION_ATTRIBUTE_MISSING", foldId: fold.foldId, severity: "ERROR" });
      }
    }
    const receivingOpenings = Array.isArray(metadata.receivingOpenings) ? metadata.receivingOpenings : [];
    const receivingOpeningIds = new Set(receivingOpenings.map((opening) => opening.id));
    for (const opening of receivingOpenings) {
      if (!opening?.id || !["edge", "feature"].includes(opening.entityKind) || !Array.isArray(opening.hostPanelIds) || opening.hostPanelIds.some((panelId) => !panelIds.has(panelId)))
        issues.push({ code: "SVG_V4_RECEIVING_OPENING_INVALID", openingId: opening?.id, severity: "ERROR" });
      const openingPattern = opening.entityKind === "edge"
        ? new RegExp('<path(?=[^>]*id="' + escapeSvgRegex(opening.id) + '")(?=[^>]*data-entity-kind="receiving-opening")[^>]*>')
        : new RegExp('<path(?=[^>]*data-opening-id="' + escapeSvgRegex(opening.id) + '")(?=[^>]*data-entity-kind="receiving-opening")[^>]*>');
      if (!openingPattern.test(markup))
        issues.push({ code: "SVG_V4_RECEIVING_OPENING_ENTITY_MISSING", openingId: opening.id, severity: "ERROR" });
    }
    const allIds = new Set([...panelIds, ...featureIds, ...folds.map((fold) => fold.foldId), ...receivingOpeningIds, ...(metadata.bonds || []).flatMap((bond) => Object.values(bond).filter((value) => typeof value === "string"))]);
    for (const interaction of metadata.interactions || [])
      for (const key of ["tonguePanelId", "closurePanelId", "tongueFoldId", "closureFoldId", "receivingOpeningId", "lockingPanelId", "lockingFeatureId"]) if (interaction[key] && (!allIds.has(interaction[key]) || (key === "receivingOpeningId" && !receivingOpeningIds.has(interaction[key])))) issues.push({ code: "SVG_V4_INTERACTION_REFERENCE_INVALID", key, value: interaction[key], severity: "ERROR" });
    for (const bond of metadata.bonds || []) for (const key of ["sourcePanelId", "targetPanelId"]) if (!panelIds.has(bond[key])) issues.push({ code: "SVG_V4_BOND_REFERENCE_INVALID", key, value: bond[key], severity: "ERROR" });
    if (metadata.assembly?.assemblyValidation?.valid !== true)
      issues.push({ code: "SVG_V4_ASSEMBLY_INVALID", severity: "ERROR" });
    const computedAssemblyValidation = validateSvgV4Assembly(metadata);
    if (!computedAssemblyValidation.valid)
      issues.push(...computedAssemblyValidation.issues);
  }
  if (/\stransform\s*=/.test(markup))
    issues.push({ code: "SVG_V4_ENGINEERING_TRANSFORM_FORBIDDEN", severity: "ERROR" });
  return { valid: issues.length === 0, issues };
}

export function validateSvgExport(markup) {
  if (typeof markup === "string" && markup.includes(`data-export-schema-version="${SVG_V4_EXPORT_SCHEMA_VERSION}"`))
    return validateSvgV4Export(markup);
  const issues = [];
  if (typeof markup !== "string" || !markup.startsWith("<svg "))
    return { valid: false, issues: [{ code: "SVG_NOT_MARKUP", severity: "ERROR", message: "SVG export must be markup beginning with an svg root." }] };
  if (!markup.includes(`data-export-schema-version="${SVG_EXPORT_SCHEMA_VERSION}"`))
    issues.push({ code: "SVG_SCHEMA_VERSION_MISSING", severity: "ERROR", message: "SVG export is missing its versioned schema attribute." });
  if (!markup.includes('id="cartonbuilder-metadata"'))
    issues.push({ code: "SVG_METADATA_MISSING", severity: "ERROR", message: "SVG export is missing the CartonBuilder metadata block." });
  const metadataMatch = markup.match(/<metadata id="cartonbuilder-metadata"[^>]*>([\s\S]*?)<\/metadata>/);
  let metadata = null;
  let metadataParsed = false;
  if (metadataMatch) {
    try {
      const decoded = metadataMatch[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      metadata = JSON.parse(decoded);
      metadataParsed = true;
    } catch {
      issues.push({ code: "SVG_METADATA_INVALID", severity: "ERROR", message: "SVG metadata must contain valid JSON." });
    }
  }
  if (metadataParsed && (!metadata || typeof metadata !== "object" || Array.isArray(metadata)))
    issues.push({ code: "SVG_METADATA_INVALID", severity: "ERROR", message: "SVG metadata must contain a JSON object." });
  if (metadata) {
    if (metadata.format !== "CartonBuilder SVG Reference")
      issues.push({ code: "SVG_METADATA_FORMAT_INVALID", severity: "ERROR", message: "SVG metadata format is invalid." });
    if (metadata.schemaVersion !== SVG_EXPORT_SCHEMA_VERSION)
      issues.push({ code: "SVG_METADATA_SCHEMA_VERSION_INVALID", severity: "ERROR", message: "SVG metadata must declare the current SVG schema version." });
    if (metadata.units !== "mm")
      issues.push({ code: "SVG_METADATA_UNITS_INVALID", severity: "ERROR", message: "SVG metadata units must be millimetres." });
    if (metadata.referenceOnly !== true || metadata.productionCertified !== false)
      issues.push({ code: "SVG_METADATA_STATUS_INVALID", severity: "ERROR", message: "SVG metadata must remain reference-only and not production certified." });
    if (!Array.isArray(metadata.semanticLayers) || metadata.semanticLayers.length !== SVG_SEMANTIC_LAYERS.length || metadata.semanticLayers.some((layer, index) => layer?.id !== SVG_SEMANTIC_LAYERS[index].id || layer?.role !== SVG_SEMANTIC_LAYERS[index].role))
      issues.push({ code: "SVG_METADATA_LAYERS_INVALID", severity: "ERROR", message: "SVG metadata semanticLayers must match the canonical layer catalog." });
    if (typeof metadata.engineVersion !== "string" || !metadata.engineVersion || (metadata.modelSchemaVersion !== null && typeof metadata.modelSchemaVersion !== "string"))
      issues.push({ code: "SVG_METADATA_VERSION_FIELDS_INVALID", severity: "ERROR", message: "SVG metadata version fields are incomplete." });
    if (!normalizedMetadataTransform(metadata.presentationTransform))
      issues.push({ code: "SVG_PRESENTATION_TRANSFORM_INVALID", severity: "ERROR", message: "SVG presentationTransform must be one of the eight supported orthogonal transforms." });
    const bleedValid = metadata.bleed && typeof metadata.bleed === "object" && typeof metadata.bleed.included === "boolean" && Number.isFinite(metadata.bleed.widthMm) && metadata.bleed.widthMm >= .1 && metadata.bleed.widthMm <= 20;
    if (!bleedValid)
      issues.push({ code: "SVG_BLEED_METADATA_INVALID", severity: "ERROR", message: "SVG bleed metadata must declare inclusion and a width from 0.1 to 20 mm." });
    const hasBleedLayer = markup.includes('id="bleed" data-semantic-layer="bleed" data-layer-role="ARTWORK_BLEED_REFERENCE"');
    if (bleedValid && metadata.bleed.included !== hasBleedLayer)
      issues.push({ code: "SVG_BLEED_LAYER_STATE_MISMATCH", severity: "ERROR", message: "SVG bleed metadata and layer presence must agree." });
    if (hasBleedLayer) {
      const widthMatch = markup.match(/id="bleed"[^>]*data-bleed-width-mm="([^"]+)"/);
      if (!widthMatch || Math.abs(Number(widthMatch[1]) - metadata.bleed.widthMm) > 1e-4)
        issues.push({ code: "SVG_BLEED_LAYER_WIDTH_MISMATCH", severity: "ERROR", message: "SVG bleed layer width must match its metadata." });
    }
    const canvas = metadata.canvas;
    const canvasValid = canvas && typeof canvas === "object" && [canvas.widthMm, canvas.heightMm, canvas.referenceWidthMm, canvas.referenceHeightMm].every((value) => Number.isFinite(value) && value > 0) && Array.isArray(canvas.viewBox) && canvas.viewBox.length === 4 && canvas.viewBox.every(Number.isFinite) && canvas.viewBox[2] > 0 && canvas.viewBox[3] > 0;
    if (!canvasValid) {
      issues.push({ code: "SVG_CANVAS_METADATA_INVALID", severity: "ERROR", message: "SVG canvas metadata must declare positive physical and reference bounds." });
    } else {
      const expansion = bleedValid && metadata.bleed.included ? metadata.bleed.widthMm * 2 : 0;
      if (Math.abs(canvas.widthMm - canvas.referenceWidthMm - expansion) > 1e-4 || Math.abs(canvas.heightMm - canvas.referenceHeightMm - expansion) > 1e-4)
        issues.push({ code: "SVG_BLEED_CANVAS_SIZE_MISMATCH", severity: "ERROR", message: "SVG physical canvas must expand by twice the included Bleed width." });
      const rootWidth = Number(markup.match(/<svg[^>]*\swidth="([^"]+)mm"/)?.[1]);
      const rootHeight = Number(markup.match(/<svg[^>]*\sheight="([^"]+)mm"/)?.[1]);
      const rootViewBox = (markup.match(/<svg[^>]*\sviewBox="([^"]+)"/)?.[1] || "").trim().split(/\s+/).map(Number);
      if (!Number.isFinite(rootWidth) || !Number.isFinite(rootHeight) || Math.abs(rootWidth - canvas.widthMm) > 1e-4 || Math.abs(rootHeight - canvas.heightMm) > 1e-4 || rootViewBox.length !== 4 || rootViewBox.some((value, index) => !Number.isFinite(value) || Math.abs(value - canvas.viewBox[index]) > 1e-4))
        issues.push({ code: "SVG_CANVAS_ROOT_MISMATCH", severity: "ERROR", message: "SVG root width, height and viewBox must match canvas metadata." });
    }
    const safe = metadata.safeZones;
    const rendered = Array.isArray(safe?.renderedFaceIds) ? safe.renderedFaceIds : [];
    const unavailable = Array.isArray(safe?.unavailableFaceIds) ? safe.unavailableFaceIds : [];
    const uniqueRendered = new Set(rendered);
    const uniqueUnavailable = new Set(unavailable);
    const allFaces = [...rendered, ...unavailable];
    const safeValid = safe && typeof safe === "object" && typeof safe.enabled === "boolean" && typeof safe.included === "boolean" && Number.isFinite(safe.cutMarginMm) && safe.cutMarginMm >= 3 && safe.cutMarginMm <= 20 && Number.isFinite(safe.foldMarginMm) && safe.foldMarginMm >= 3 && safe.foldMarginMm <= 20 && safe.glueSeamMinimumMm === 5 && uniqueRendered.size === rendered.length && uniqueUnavailable.size === unavailable.length && allFaces.every((faceId) => SVG_SAFE_ZONE_FACE_IDS.includes(faceId)) && !rendered.some((faceId) => uniqueUnavailable.has(faceId)) && (safe.enabled ? new Set(allFaces).size === SVG_SAFE_ZONE_FACE_IDS.length && SVG_SAFE_ZONE_FACE_IDS.every((faceId) => allFaces.includes(faceId)) : rendered.length === 0 && unavailable.length === 0 && safe.included === false) && safe.included === (safe.enabled && rendered.length > 0);
    if (!safeValid)
      issues.push({ code: "SVG_SAFE_ZONE_METADATA_INVALID", severity: "ERROR", message: "SVG safe-zone metadata must describe the six canonical faces and valid CUT/FOLD margins." });
    const hasSafeLayer = markup.includes('id="safe-zones" data-semantic-layer="safe-zones" data-layer-role="ARTWORK_SAFE_ZONE_REFERENCE"');
    if (safeValid && safe.included !== hasSafeLayer)
      issues.push({ code: "SVG_SAFE_ZONE_LAYER_STATE_MISMATCH", severity: "ERROR", message: "SVG safe-zone metadata and layer presence must agree." });
    if (hasSafeLayer && safeValid) {
      const groupCut = Number(markup.match(/id="safe-zones"[^>]*data-cut-margin-mm="([^"]+)"/)?.[1]);
      const groupFold = Number(markup.match(/id="safe-zones"[^>]*data-fold-margin-mm="([^"]+)"/)?.[1]);
      const groupGlue = Number(markup.match(/id="safe-zones"[^>]*data-glue-seam-minimum-mm="([^"]+)"/)?.[1]);
      if (Math.abs(groupCut - safe.cutMarginMm) > 1e-4 || Math.abs(groupFold - safe.foldMarginMm) > 1e-4 || Math.abs(groupGlue - safe.glueSeamMinimumMm) > 1e-4)
        issues.push({ code: "SVG_SAFE_ZONE_MARGIN_MISMATCH", severity: "ERROR", message: "SVG safe-zone layer margins must match metadata." });
      const pathMatches = [...markup.matchAll(/<path id="safe-zone\.([^"]+)"[^>]*data-face-id="([^"]+)"[^>]*data-source-region-id="([^"]+)"[^>]*data-cut-margin-mm="([^"]+)"[^>]*data-fold-margin-mm="([^"]+)"/g)];
      const pathFaceIds = pathMatches.map((match) => match[2]);
      if (pathFaceIds.length !== rendered.length || new Set(pathFaceIds).size !== pathFaceIds.length || rendered.some((faceId) => !pathFaceIds.includes(faceId)) || pathMatches.some((match) => Math.abs(Number(match[4]) - safe.cutMarginMm) > 1e-4 || Math.abs(Number(match[5]) - safe.foldMarginMm) > 1e-4))
        issues.push({ code: "SVG_SAFE_ZONE_FACE_MISMATCH", severity: "ERROR", message: "SVG safe-zone paths must match rendered face metadata and margins." });
      const pathTags = [...markup.matchAll(/<path id="safe-zone\.[^"]+"[^>]*>/g)].map((match) => match[0]);
      const edgeAttributesValid = pathTags.every((tag) => ["left", "right", "bottom", "top"].every((side) => {
        const kind = tag.match(new RegExp(`data-${side}-edge-kind="([^"]+)"`))?.[1];
        const edgeRole = tag.match(new RegExp(`data-${side}-edge-role="([^"]+)"`))?.[1];
        const margin = Number(tag.match(new RegExp(`data-${side}-margin-mm="([^"]+)"`))?.[1]);
        const base = edgeRole === "FOLD_BOUNDARY" ? safe.foldMarginMm : edgeRole === "FREE_BOUNDARY" ? safe.cutMarginMm : NaN;
        const expected = kind === "CUT" && edgeRole === "FREE_BOUNDARY" ? base : kind === "FOLD" && edgeRole === "FOLD_BOUNDARY" ? base : kind === "GLUE_SEAM" ? base : NaN;
        return Number.isFinite(margin) && Number.isFinite(expected) && Math.abs(margin - expected) <= 1e-4;
      }));
      if (!edgeAttributesValid)
        issues.push({ code: "SVG_SAFE_ZONE_EDGE_MARGIN_INVALID", severity: "ERROR", message: "Every Safe Zone edge must declare a valid CUT, FOLD or Glue/Seam margin." });
    }
    const transformAttribute = markup.match(/data-presentation-transform="([^"]+)"/)?.[1];
    const expectedTransform = metadata.presentationTransform ? [metadata.presentationTransform.a, metadata.presentationTransform.b, metadata.presentationTransform.c, metadata.presentationTransform.d].join(",") : null;
    if (transformAttribute !== expectedTransform)
      issues.push({ code: "SVG_PRESENTATION_TRANSFORM_MISMATCH", severity: "ERROR", message: "SVG presentation transform attribute must match its metadata." });
  }
  for (const layer of SVG_SEMANTIC_LAYERS.filter((entry) => !["dimensions", "diagnostics", "bleed", "safe-zones"].includes(entry.id))) {
    if (!markup.includes(`id="${layer.id}"`))
      issues.push({ code: "SVG_LAYER_MISSING", severity: "ERROR", message: `SVG export is missing semantic layer ${layer.id}.` });
    if (!markup.includes(`data-semantic-layer="${layer.id}"`))
      issues.push({ code: "SVG_LAYER_METADATA_MISSING", severity: "ERROR", message: `SVG export is missing semantic metadata for ${layer.id}.` });
  }
  for (const layer of SVG_SEMANTIC_LAYERS.filter((entry) => ["dimensions", "diagnostics", "bleed", "safe-zones"].includes(entry.id)))
    if (markup.includes(`id="${layer.id}"`) && !markup.includes(`data-semantic-layer="${layer.id}"`))
      issues.push({ code: "SVG_OPTIONAL_LAYER_METADATA_MISSING", severity: "ERROR", message: `SVG export is missing semantic metadata for optional layer ${layer.id}.` });
  return { valid: issues.length === 0, issues };
}
