/**
 * Pure pbd.model.v1 JSON export contract for the incremental M4 source extraction.
 * The semantic CartonModel remains the source of truth; presentation-only state
 * (Transform, Bleed, Safe Zones and UI visibility) is intentionally not exported.
 */

export const MODEL_EXPORT_SCHEMA_VERSION = "pbd.model.v1";
export const EXPORT_SEMANTIC_LAYERS = Object.freeze(["regions", "boundaries", "folds", "features", "dimensions"]);

const DEFAULT_VISIBLE_LAYERS = Object.freeze({
  regions: true,
  boundaries: true,
  folds: true,
  features: true,
  anchors: false,
  sequence: true,
  labels: true,
  dimensions: true,
  diagnostics: false,
});
const DEFAULT_VALIDATION_DOMAINS = Object.freeze(["STRUCTURAL", "GEOMETRY", "PROFILE", "PRODUCTION"]);
const DEFAULT_VALIDATION_CONTRACT_VERSION = "pbd.validation.v1";
const DEFAULT_APP_VERSION = "0.9.34";

function normalizeVisibleLayers(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.keys(DEFAULT_VISIBLE_LAYERS).map((key) => [key, source[key] === undefined ? DEFAULT_VISIBLE_LAYERS[key] : source[key] === true]));
}

function resolveDependencies(deps = {}) {
  return {
    normalizeLayers: typeof deps.normalizeLayers === "function" ? deps.normalizeLayers : normalizeVisibleLayers,
    appVersion: typeof deps.appVersion === "function" ? deps.appVersion : () => DEFAULT_APP_VERSION,
    validationContractVersion: typeof deps.validationContractVersion === "string" ? deps.validationContractVersion : DEFAULT_VALIDATION_CONTRACT_VERSION,
    validationDomains: Array.isArray(deps.validationDomains) ? deps.validationDomains : DEFAULT_VALIDATION_DOMAINS,
  };
}

export function validateModelExport(model, deps = {}) {
  const resolved = resolveDependencies(deps);
  const issues = [];
  const required = ["exportSchemaVersion", "exportMetadata", "schemaVersion", "engineVersion", "units", "requestedDimensionReference", "resolvedDimensions", "input", "material", "body", "regions", "edges", "features", "relations", "topClosure", "bottomClosure", "outerBoundary", "ruleResolution", "validation", "outputMetrics", "provenance"];
  if (!model || typeof model !== "object" || Array.isArray(model))
    return { valid: false, issues: [{ code: "MODEL_NOT_OBJECT", severity: "ERROR", message: "Model export must be an object." }] };
  for (const key of required)
    if (!(key in model))
      issues.push({ code: "EXPORT_FIELD_MISSING", severity: "ERROR", message: `Model export is missing ${key}.` });
  if (model.exportSchemaVersion !== MODEL_EXPORT_SCHEMA_VERSION)
    issues.push({ code: "EXPORT_SCHEMA_VERSION_INVALID", severity: "ERROR", message: `Model export must declare ${MODEL_EXPORT_SCHEMA_VERSION}.` });
  if (!model.exportMetadata || typeof model.exportMetadata !== "object" || model.exportMetadata.schemaVersion !== MODEL_EXPORT_SCHEMA_VERSION)
    issues.push({ code: "EXPORT_METADATA_INVALID", severity: "ERROR", message: "Model export metadata must declare the same schema version." });
  if (model.units !== "mm")
    issues.push({ code: "EXPORT_UNITS_INVALID", severity: "ERROR", message: "Model export units must be mm." });
  const metadata = model.exportMetadata;
  if (metadata && typeof metadata === "object") {
    if (metadata.format !== "CartonBuilder Model JSON" || metadata.schemaVersion !== MODEL_EXPORT_SCHEMA_VERSION)
      issues.push({ code: "EXPORT_METADATA_FORMAT_INVALID", severity: "ERROR", message: "Model export metadata format/version is invalid." });
    if (metadata.units !== "mm" || metadata.referenceOnly !== true || metadata.productionCertified !== false)
      issues.push({ code: "EXPORT_METADATA_STATUS_INVALID", severity: "ERROR", message: "Model export metadata must remain millimetre, reference-only and not production certified." });
    if (!Array.isArray(metadata.semanticLayers) || metadata.semanticLayers.length !== EXPORT_SEMANTIC_LAYERS.length || metadata.semanticLayers.some((layer, index) => layer !== EXPORT_SEMANTIC_LAYERS[index]))
      issues.push({ code: "EXPORT_METADATA_LAYERS_INVALID", severity: "ERROR", message: "Model export metadata semanticLayers must match the canonical layer catalog." });
    if (!metadata.visibleLayers || typeof metadata.visibleLayers !== "object" || !Number.isInteger(metadata.sequenceStage) || metadata.sequenceStage < 0 || metadata.sequenceStage > 3)
      issues.push({ code: "EXPORT_METADATA_STATE_INVALID", severity: "ERROR", message: "Model export metadata visibleLayers/sequenceStage state is invalid." });
  }
  for (const key of ["regions", "edges", "features", "relations", "provenance"])
    if (key in model && !Array.isArray(model[key]))
      issues.push({ code: "EXPORT_COLLECTION_INVALID", severity: "ERROR", message: `${key} must be an array.` });
  const positiveDimensions = ["inner", "manufacture", "outer"].every((key) => {
    const dimensions = model.resolvedDimensions?.[key];
    return dimensions && ["width", "depth", "height"].every((axis) => Number.isFinite(dimensions[axis]) && dimensions[axis] > 0);
  });
  if (!positiveDimensions)
    issues.push({ code: "EXPORT_DIMENSIONS_INVALID", severity: "ERROR", message: "Resolved inner/manufacture/outer dimensions must contain finite positive width, depth and height." });
  const material = model.material;
  if (!material || typeof material !== "object" || !Number.isFinite(material.thickness) || material.thickness <= 0 || !Number.isFinite(material.insideLoss) || !Number.isFinite(material.outsideGain) || typeof material.materialProfileId !== "string" || !material.materialProfileId)
    issues.push({ code: "EXPORT_MATERIAL_INVALID", severity: "ERROR", message: "Model material must contain thickness, compensation and profile identity." });
  const body = model.body;
  if (!body || typeof body !== "object" || typeof body.id !== "string" || !body.id || !Array.isArray(body.regions) || !Array.isArray(body.baseEdges) || !body.hosts || typeof body.hosts !== "object" || !body.pitches || typeof body.pitches !== "object" || !Array.isArray(body.x) || !Array.isArray(body.provenance))
    issues.push({ code: "EXPORT_BODY_INVALID", severity: "ERROR", message: "Model body semantic block is incomplete." });
  const outerBoundary = model.outerBoundary;
  if (!outerBoundary || typeof outerBoundary !== "object" || !Array.isArray(outerBoundary.edgeIds) || typeof outerBoundary.closed !== "boolean" || typeof outerBoundary.connected !== "boolean")
    issues.push({ code: "EXPORT_OUTER_BOUNDARY_INVALID", severity: "ERROR", message: "Model outerBoundary semantic block is incomplete." });
  const ruleResolution = model.ruleResolution;
  if (!ruleResolution || typeof ruleResolution !== "object" || !Array.isArray(ruleResolution.activeProfiles) || !Array.isArray(ruleResolution.overrides) || !Number.isInteger(ruleResolution.ruleCount) || ruleResolution.ruleCount < 0)
    issues.push({ code: "EXPORT_RULE_RESOLUTION_INVALID", severity: "ERROR", message: "Model ruleResolution semantic block is incomplete." });
  const metrics = model.outputMetrics;
  if (!metrics || typeof metrics !== "object" || !Number.isFinite(metrics.totalCreaseLength) || !Number.isFinite(metrics.totalTrimLength) || !Number.isFinite(metrics.paperUtilization) || !Number.isFinite(metrics.materialArea) || !Number.isFinite(metrics.boundingArea))
    issues.push({ code: "EXPORT_METRICS_INVALID", severity: "ERROR", message: "Model outputMetrics semantic block is incomplete." });
  const validation = model.validation;
  for (const key of ["validationContractVersion", "domains", "limits", "structural", "geometry", "profile", "production", "issues"])
    if (!validation || !(key in validation))
      issues.push({ code: "EXPORT_VALIDATION_INVALID", severity: "ERROR", message: `Model validation is missing ${key}.` });
  if (validation?.validationContractVersion !== resolved.validationContractVersion)
    issues.push({ code: "EXPORT_VALIDATION_CONTRACT_INVALID", severity: "ERROR", message: `Model validation must declare ${resolved.validationContractVersion}.` });
  for (const domain of resolved.validationDomains) {
    const entry = validation?.domains?.[domain];
    if (!entry || typeof entry.status !== "string" || !Number.isInteger(entry.errorCount) || !Number.isInteger(entry.warningCount) || !Number.isInteger(entry.blockingErrorCount) || !Array.isArray(entry.issueCodes))
      issues.push({ code: "EXPORT_VALIDATION_DOMAIN_INVALID", severity: "ERROR", message: `Model validation domain ${domain} is incomplete.` });
  }
  if (validation?.limits?.units !== "mm")
    issues.push({ code: "EXPORT_VALIDATION_LIMITS_INVALID", severity: "ERROR", message: "Model validation limits must declare millimetres." });
  return { valid: issues.length === 0, issues };
}

export function buildModelExport(model, options = {}, deps = {}) {
  const resolved = resolveDependencies(deps);
  const payload = { ...model };
  payload.exportSchemaVersion = MODEL_EXPORT_SCHEMA_VERSION;
  payload.exportMetadata = {
    format: "CartonBuilder Model JSON",
    schemaVersion: MODEL_EXPORT_SCHEMA_VERSION,
    engineVersion: model?.engineVersion || resolved.appVersion(),
    units: model?.units || "mm",
    referenceOnly: true,
    productionCertified: false,
    semanticLayers: EXPORT_SEMANTIC_LAYERS.slice(),
    visibleLayers: resolved.normalizeLayers(options.layers),
    sequenceStage: Number.isInteger(Number(options.sequenceStage)) ? Number(options.sequenceStage) : 0,
  };
  return payload;
}

export function getModelExportEligibility(model, options = {}, deps = {}) {
  if (!model)
    return { allowed: false, code: "NO_MODEL", issues: [{ code: "NO_MODEL", severity: "ERROR", message: "No generated model is available for export." }] };
  if (model.validation?.structural !== "VALID" || model.validation?.geometry !== "VALID")
    return { allowed: false, code: "INVALID_GEOMETRY", issues: [{ code: "INVALID_GEOMETRY", severity: "ERROR", message: "Structural and geometry validation must both be VALID before export." }] };
  const contract = validateModelExport(buildModelExport(model, options, deps), deps);
  return { allowed: contract.valid, code: contract.valid ? "READY" : "EXPORT_CONTRACT_INVALID", issues: contract.issues };
}
