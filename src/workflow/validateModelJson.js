/**
 * Browser-safe validator for pbd.model.v1 semantic model exports.
 * Mirrors the canonical PBD export validation rules without divergent interpretation.
 */

export const MODEL_EXPORT_SCHEMA_VERSION = "pbd.model.v1";
export const EXPORT_SEMANTIC_LAYERS = Object.freeze(["regions", "boundaries", "folds", "features", "dimensions"]);
export const VALIDATION_CONTRACT_VERSION = "pbd.validation.v1";
export const VALIDATION_DOMAINS = Object.freeze(["STRUCTURAL", "GEOMETRY", "PROFILE", "PRODUCTION"]);

/**
 * Validate a model JSON object against the pbd.model.v1 contract.
 *
 * @param {unknown} model
 * @returns {{ valid: boolean, issues: Array<{ code: string, severity: string, message: string }> }}
 */
export function validateModelJson(model) {
  const issues = [];
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    return {
      valid: false,
      issues: [{ code: "MODEL_NOT_OBJECT", severity: "ERROR", message: "Model export must be an object." }]
    };
  }

  const requiredFields = [
    "exportSchemaVersion",
    "exportMetadata",
    "schemaVersion",
    "engineVersion",
    "units",
    "requestedDimensionReference",
    "resolvedDimensions",
    "input",
    "material",
    "body",
    "regions",
    "edges",
    "features",
    "relations",
    "topClosure",
    "bottomClosure",
    "outerBoundary",
    "ruleResolution",
    "validation",
    "outputMetrics",
    "provenance"
  ];

  for (const key of requiredFields) {
    if (!(key in model)) {
      issues.push({ code: "EXPORT_FIELD_MISSING", severity: "ERROR", message: `Model export is missing ${key}.` });
    }
  }

  if (model.exportSchemaVersion !== MODEL_EXPORT_SCHEMA_VERSION) {
    issues.push({
      code: "EXPORT_SCHEMA_VERSION_INVALID",
      severity: "ERROR",
      message: `Model export must declare ${MODEL_EXPORT_SCHEMA_VERSION}.`
    });
  }

  if (model.units !== "mm") {
    issues.push({ code: "EXPORT_UNITS_INVALID", severity: "ERROR", message: "Model export units must be mm." });
  }

  const metadata = model.exportMetadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    issues.push({ code: "EXPORT_METADATA_INVALID", severity: "ERROR", message: "Model export metadata must be an object." });
  } else {
    if (metadata.format !== "CartonBuilder Model JSON" || metadata.schemaVersion !== MODEL_EXPORT_SCHEMA_VERSION) {
      issues.push({ code: "EXPORT_METADATA_FORMAT_INVALID", severity: "ERROR", message: "Model export metadata format/version is invalid." });
    }
    if (metadata.units !== "mm" || metadata.referenceOnly !== true || metadata.productionCertified !== false) {
      issues.push({
        code: "EXPORT_METADATA_STATUS_INVALID",
        severity: "ERROR",
        message: "Model export metadata must remain millimetre, reference-only and not production certified."
      });
    }
    if (
      !Array.isArray(metadata.semanticLayers) ||
      metadata.semanticLayers.length !== EXPORT_SEMANTIC_LAYERS.length ||
      metadata.semanticLayers.some((layer, index) => layer !== EXPORT_SEMANTIC_LAYERS[index])
    ) {
      issues.push({
        code: "EXPORT_METADATA_LAYERS_INVALID",
        severity: "ERROR",
        message: "Model export metadata semanticLayers must match canonical layer catalog."
      });
    }
  }

  for (const key of ["regions", "edges", "features", "relations", "provenance"]) {
    if (key in model && !Array.isArray(model[key])) {
      issues.push({ code: "EXPORT_COLLECTION_INVALID", severity: "ERROR", message: `${key} must be an array.` });
    }
  }

  const resolvedDims = model.resolvedDimensions;
  const positiveDimensions = ["inner", "manufacture", "outer"].every((key) => {
    const dim = resolvedDims?.[key];
    return dim && ["width", "depth", "height"].every((axis) => Number.isFinite(dim[axis]) && dim[axis] > 0);
  });
  if (!positiveDimensions) {
    issues.push({
      code: "EXPORT_DIMENSIONS_INVALID",
      severity: "ERROR",
      message: "Resolved inner/manufacture/outer dimensions must contain finite positive width, depth and height."
    });
  }

  const material = model.material;
  if (
    !material ||
    typeof material !== "object" ||
    !Number.isFinite(material.thickness) ||
    material.thickness <= 0 ||
    !Number.isFinite(material.insideLoss) ||
    !Number.isFinite(material.outsideGain) ||
    typeof material.materialProfileId !== "string" ||
    !material.materialProfileId
  ) {
    issues.push({
      code: "EXPORT_MATERIAL_INVALID",
      severity: "ERROR",
      message: "Model material must contain thickness, compensation and profile identity."
    });
  }

  const body = model.body;
  if (
    !body ||
    typeof body !== "object" ||
    typeof body.id !== "string" ||
    !body.id ||
    !Array.isArray(body.regions) ||
    !Array.isArray(body.baseEdges) ||
    !body.hosts ||
    typeof body.hosts !== "object" ||
    !body.pitches ||
    typeof body.pitches !== "object" ||
    !Array.isArray(body.x) ||
    !Array.isArray(body.provenance)
  ) {
    issues.push({ code: "EXPORT_BODY_INVALID", severity: "ERROR", message: "Model body semantic block is incomplete." });
  }

  const outerBoundary = model.outerBoundary;
  if (
    !outerBoundary ||
    typeof outerBoundary !== "object" ||
    !Array.isArray(outerBoundary.edgeIds) ||
    typeof outerBoundary.closed !== "boolean" ||
    typeof outerBoundary.connected !== "boolean"
  ) {
    issues.push({ code: "EXPORT_OUTER_BOUNDARY_INVALID", severity: "ERROR", message: "Model outerBoundary semantic block is incomplete." });
  }

  const ruleResolution = model.ruleResolution;
  if (
    !ruleResolution ||
    typeof ruleResolution !== "object" ||
    !Array.isArray(ruleResolution.activeProfiles) ||
    !Array.isArray(ruleResolution.overrides) ||
    !Number.isInteger(ruleResolution.ruleCount) ||
    ruleResolution.ruleCount < 0
  ) {
    issues.push({ code: "EXPORT_RULE_RESOLUTION_INVALID", severity: "ERROR", message: "Model ruleResolution semantic block is incomplete." });
  }

  const metrics = model.outputMetrics;
  if (
    !metrics ||
    typeof metrics !== "object" ||
    !Number.isFinite(metrics.totalCreaseLength) ||
    !Number.isFinite(metrics.totalTrimLength) ||
    !Number.isFinite(metrics.paperUtilization) ||
    !Number.isFinite(metrics.materialArea) ||
    !Number.isFinite(metrics.boundingArea)
  ) {
    issues.push({ code: "EXPORT_METRICS_INVALID", severity: "ERROR", message: "Model outputMetrics semantic block is incomplete." });
  }

  const validation = model.validation;
  if (!validation || typeof validation !== "object") {
    issues.push({ code: "EXPORT_VALIDATION_INVALID", severity: "ERROR", message: "Model validation block is missing or invalid." });
  } else {
    if (validation.validationContractVersion !== VALIDATION_CONTRACT_VERSION) {
      issues.push({
        code: "EXPORT_VALIDATION_CONTRACT_INVALID",
        severity: "ERROR",
        message: `Model validation must declare ${VALIDATION_CONTRACT_VERSION}.`
      });
    }
    for (const domain of VALIDATION_DOMAINS) {
      const entry = validation.domains?.[domain];
      if (
        !entry ||
        typeof entry.status !== "string" ||
        !Number.isInteger(entry.errorCount) ||
        !Number.isInteger(entry.warningCount) ||
        !Number.isInteger(entry.blockingErrorCount) ||
        !Array.isArray(entry.issueCodes)
      ) {
        issues.push({
          code: "EXPORT_VALIDATION_DOMAIN_INVALID",
          severity: "ERROR",
          message: `Model validation domain ${domain} is incomplete.`
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
