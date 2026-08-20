/**
 * Compiled standalone JSON Schema validator for carton-workflow.v1.
 * Strict implementation of schemas/carton-workflow.v1.schema.json.
 */

const ALLOWED_TOP_KEYS = new Set([
  "contractVersion",
  "workflowMode",
  "source",
  "modelJson",
  "semanticSvg",
  "capabilities",
]);

const ALLOWED_SOURCE_KEYS = new Set([
  "producer",
  "producerVersion",
  "modelEngineVersion",
  "contractPackageVersion",
  "artifactVersion",
  "artifactSha256",
  "modelSchemaVersion",
  "svgSchemaVersion",
  "cartonType",
  "profileIds",
  "referenceOnly",
  "productionCertified",
]);

const ALLOWED_MODEL_KEYS = new Set(["mediaType", "byteLength", "sha256", "text"]);

const ALLOWED_SVG_KEYS = new Set(["assetId", "mediaType", "byteLength", "sha256", "units", "markup"]);

const ALLOWED_CAPABILITIES_KEYS = new Set(["artwork2d", "flatExport", "foldPreview", "technicalRender"]);

const SHA256_REGEX = /^[a-f0-9]{64}$/;
const ASSET_ID_REGEX = /^svg-[a-f0-9]{16}$/;

/**
 * Validate bundle against compiled carton-workflow.v1 JSON Schema.
 *
 * @param {unknown} bundle
 * @returns {Array<{ code: string, severity: string, message: string }>}
 */
export function validateCompiledCartonWorkflowSchema(bundle) {
  const issues = [];

  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return [{ code: "SCHEMA_NOT_AN_OBJECT", severity: "ERROR", message: "Bundle must be a non-null object." }];
  }

  // 1. Check top-level additionalProperties
  for (const key of Object.keys(bundle)) {
    if (!ALLOWED_TOP_KEYS.has(key)) {
      issues.push({
        code: "SCHEMA_ADDITIONAL_PROPERTY_FORBIDDEN",
        severity: "ERROR",
        message: `Unexpected property "${key}" in bundle root.`,
      });
    }
  }

  // 2. Required top-level fields
  for (const key of ALLOWED_TOP_KEYS) {
    if (!(key in bundle)) {
      issues.push({
        code: "SCHEMA_REQUIRED_PROPERTY_MISSING",
        severity: "ERROR",
        message: `Required property "${key}" is missing in bundle root.`,
      });
    }
  }

  if (bundle.contractVersion !== "carton-workflow.v1") {
    issues.push({
      code: "SCHEMA_CONST_MISMATCH",
      severity: "ERROR",
      message: `contractVersion must be "carton-workflow.v1", got "${bundle.contractVersion}".`,
    });
  }

  if (bundle.workflowMode !== "technical") {
    issues.push({
      code: "SCHEMA_CONST_MISMATCH",
      severity: "ERROR",
      message: `workflowMode must be "technical", got "${bundle.workflowMode}".`,
    });
  }

  // 3. Validate source block
  const source = bundle.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    issues.push({ code: "SCHEMA_SOURCE_INVALID", severity: "ERROR", message: "bundle.source must be an object." });
  } else {
    for (const key of Object.keys(source)) {
      if (!ALLOWED_SOURCE_KEYS.has(key)) {
        issues.push({
          code: "SCHEMA_ADDITIONAL_PROPERTY_FORBIDDEN",
          severity: "ERROR",
          message: `Unexpected property "source.${key}".`,
        });
      }
    }

    for (const key of ALLOWED_SOURCE_KEYS) {
      if (!(key in source)) {
        issues.push({
          code: "SCHEMA_REQUIRED_PROPERTY_MISSING",
          severity: "ERROR",
          message: `Required property "source.${key}" is missing.`,
        });
      }
    }

    if (source.producer !== "packaging-box-designer") {
      issues.push({
        code: "SCHEMA_PRODUCER_INVALID",
        severity: "ERROR",
        message: `source.producer must be "packaging-box-designer", got "${source.producer}".`,
      });
    }

    for (const field of ["producerVersion", "modelEngineVersion", "contractPackageVersion", "artifactVersion"]) {
      if (typeof source[field] !== "string" || source[field].length === 0) {
        issues.push({
          code: "SCHEMA_STRING_INVALID",
          severity: "ERROR",
          message: `source.${field} must be a non-empty string.`,
        });
      }
    }

    if (typeof source.artifactSha256 !== "string" || !SHA256_REGEX.test(source.artifactSha256)) {
      issues.push({
        code: "SCHEMA_SHA256_INVALID",
        severity: "ERROR",
        message: "source.artifactSha256 must match ^[a-f0-9]{64}$.",
      });
    }

    if (source.modelSchemaVersion !== "pbd.model.v1") {
      issues.push({
        code: "SCHEMA_CONST_MISMATCH",
        severity: "ERROR",
        message: 'source.modelSchemaVersion must be "pbd.model.v1".',
      });
    }

    if (source.svgSchemaVersion !== "pbd.svg.v4") {
      issues.push({
        code: "SCHEMA_CONST_MISMATCH",
        severity: "ERROR",
        message: 'source.svgSchemaVersion must be "pbd.svg.v4".',
      });
    }

    if (!["RTE", "STE", "TT_SL123"].includes(source.cartonType)) {
      issues.push({
        code: "SCHEMA_ENUM_MISMATCH",
        severity: "ERROR",
        message: `source.cartonType must be RTE, STE, or TT_SL123; got "${source.cartonType}".`,
      });
    }

    if (!Array.isArray(source.profileIds) || source.profileIds.some((p) => typeof p !== "string")) {
      issues.push({
        code: "SCHEMA_ARRAY_INVALID",
        severity: "ERROR",
        message: "source.profileIds must be an array of strings.",
      });
    }

    if (source.referenceOnly !== true || source.productionCertified !== false) {
      issues.push({
        code: "SCHEMA_STATUS_INVALID",
        severity: "ERROR",
        message: "source must have referenceOnly: true and productionCertified: false.",
      });
    }
  }

  // 4. Validate modelJson block
  const modelJson = bundle.modelJson;
  if (!modelJson || typeof modelJson !== "object" || Array.isArray(modelJson)) {
    issues.push({ code: "SCHEMA_MODEL_JSON_INVALID", severity: "ERROR", message: "bundle.modelJson must be an object." });
  } else {
    for (const key of Object.keys(modelJson)) {
      if (!ALLOWED_MODEL_KEYS.has(key)) {
        issues.push({
          code: "SCHEMA_ADDITIONAL_PROPERTY_FORBIDDEN",
          severity: "ERROR",
          message: `Unexpected property "modelJson.${key}".`,
        });
      }
    }

    for (const key of ALLOWED_MODEL_KEYS) {
      if (!(key in modelJson)) {
        issues.push({
          code: "SCHEMA_REQUIRED_PROPERTY_MISSING",
          severity: "ERROR",
          message: `Required property "modelJson.${key}" is missing.`,
        });
      }
    }

    if (modelJson.mediaType !== "application/json") {
      issues.push({
        code: "SCHEMA_CONST_MISMATCH",
        severity: "ERROR",
        message: 'modelJson.mediaType must be "application/json".',
      });
    }

    if (!Number.isInteger(modelJson.byteLength) || modelJson.byteLength < 1) {
      issues.push({
        code: "SCHEMA_INTEGER_INVALID",
        severity: "ERROR",
        message: "modelJson.byteLength must be a positive integer.",
      });
    }

    if (typeof modelJson.sha256 !== "string" || !SHA256_REGEX.test(modelJson.sha256)) {
      issues.push({
        code: "SCHEMA_SHA256_INVALID",
        severity: "ERROR",
        message: "modelJson.sha256 must match ^[a-f0-9]{64}$.",
      });
    }

    if (typeof modelJson.text !== "string" || modelJson.text.length < 10) {
      issues.push({
        code: "SCHEMA_STRING_INVALID",
        severity: "ERROR",
        message: "modelJson.text must be a string with length >= 10.",
      });
    }
  }

  // 5. Validate semanticSvg block
  const semanticSvg = bundle.semanticSvg;
  if (!semanticSvg || typeof semanticSvg !== "object" || Array.isArray(semanticSvg)) {
    issues.push({ code: "SCHEMA_SEMANTIC_SVG_INVALID", severity: "ERROR", message: "bundle.semanticSvg must be an object." });
  } else {
    for (const key of Object.keys(semanticSvg)) {
      if (!ALLOWED_SVG_KEYS.has(key)) {
        issues.push({
          code: "SCHEMA_ADDITIONAL_PROPERTY_FORBIDDEN",
          severity: "ERROR",
          message: `Unexpected property "semanticSvg.${key}".`,
        });
      }
    }

    for (const key of ALLOWED_SVG_KEYS) {
      if (!(key in semanticSvg)) {
        issues.push({
          code: "SCHEMA_REQUIRED_PROPERTY_MISSING",
          severity: "ERROR",
          message: `Required property "semanticSvg.${key}" is missing.`,
        });
      }
    }

    if (typeof semanticSvg.assetId !== "string" || !ASSET_ID_REGEX.test(semanticSvg.assetId)) {
      issues.push({
        code: "SCHEMA_PATTERN_MISMATCH",
        severity: "ERROR",
        message: `semanticSvg.assetId must match ^svg-[a-f0-9]{16}$, got "${semanticSvg.assetId}".`,
      });
    }

    if (semanticSvg.mediaType !== "image/svg+xml") {
      issues.push({
        code: "SCHEMA_CONST_MISMATCH",
        severity: "ERROR",
        message: 'semanticSvg.mediaType must be "image/svg+xml".',
      });
    }

    if (!Number.isInteger(semanticSvg.byteLength) || semanticSvg.byteLength < 1) {
      issues.push({
        code: "SCHEMA_INTEGER_INVALID",
        severity: "ERROR",
        message: "semanticSvg.byteLength must be a positive integer.",
      });
    }

    if (typeof semanticSvg.sha256 !== "string" || !SHA256_REGEX.test(semanticSvg.sha256)) {
      issues.push({
        code: "SCHEMA_SHA256_INVALID",
        severity: "ERROR",
        message: "semanticSvg.sha256 must match ^[a-f0-9]{64}$.",
      });
    }

    if (semanticSvg.units !== "mm") {
      issues.push({
        code: "SCHEMA_CONST_MISMATCH",
        severity: "ERROR",
        message: 'semanticSvg.units must be "mm".',
      });
    }

    if (typeof semanticSvg.markup !== "string" || semanticSvg.markup.length < 10) {
      issues.push({
        code: "SCHEMA_STRING_INVALID",
        severity: "ERROR",
        message: "semanticSvg.markup must be a string with length >= 10.",
      });
    }
  }

  // 6. Validate capabilities block
  const capabilities = bundle.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    issues.push({ code: "SCHEMA_CAPABILITIES_INVALID", severity: "ERROR", message: "bundle.capabilities must be an object." });
  } else {
    for (const key of Object.keys(capabilities)) {
      if (!ALLOWED_CAPABILITIES_KEYS.has(key)) {
        issues.push({
          code: "SCHEMA_ADDITIONAL_PROPERTY_FORBIDDEN",
          severity: "ERROR",
          message: `Unexpected property "capabilities.${key}".`,
        });
      }
    }

    for (const key of ALLOWED_CAPABILITIES_KEYS) {
      if (typeof capabilities[key] !== "boolean") {
        issues.push({
          code: "SCHEMA_BOOLEAN_INVALID",
          severity: "ERROR",
          message: `capabilities.${key} must be a boolean.`,
        });
      }
    }
  }

  return issues;
}
