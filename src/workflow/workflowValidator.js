/**
 * Master runtime validator for carton-workflow.v1 exchange bundles.
 */

import { canonicalizeJson } from "./canonicalJson.js";
import { sha256, utf8ByteLength } from "./crypto.js";
import { validateModelJson } from "./validateModelJson.js";
import { validateSemanticSvg } from "./validateSemanticSvg.js";

export const CONTRACT_VERSION = "carton-workflow.v1";
export const WORKFLOW_MODE = "technical";
export const ALLOWED_CARTON_TYPES = Object.freeze(["RTE", "STE", "TT_SL123"]);
export const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024; // 25 MB ceiling

/**
 * Validate a carton-workflow.v1 bundle.
 *
 * @param {unknown} bundle
 * @param {{ maxPayloadBytes?: number }} [options]
 * @returns {{ valid: boolean, errors: string[], issues: Array<{ code: string, severity: string, message: string }> }}
 */
export function validateCartonWorkflowBundle(bundle, options = {}) {
  const issues = [];
  const maxBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;

  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return {
      valid: false,
      errors: ["Bundle must be a non-null object."],
      issues: [{ code: "BUNDLE_NOT_OBJECT", severity: "ERROR", message: "Bundle must be an object." }]
    };
  }

  // 1. Check top-level contract version & workflow mode
  if (bundle.contractVersion !== CONTRACT_VERSION) {
    issues.push({
      code: "CONTRACT_VERSION_INVALID",
      severity: "ERROR",
      message: `Bundle must declare contractVersion "${CONTRACT_VERSION}", got "${bundle.contractVersion}".`
    });
  }

  if (bundle.workflowMode !== WORKFLOW_MODE) {
    issues.push({
      code: "WORKFLOW_MODE_INVALID",
      severity: "ERROR",
      message: `Bundle must declare workflowMode "${WORKFLOW_MODE}", got "${bundle.workflowMode}".`
    });
  }

  // 2. Source block validation
  const source = bundle.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    issues.push({ code: "SOURCE_INVALID", severity: "ERROR", message: "Bundle source block is missing or invalid." });
  } else {
    if (!source.producer || typeof source.producer !== "string") {
      issues.push({ code: "SOURCE_PRODUCER_MISSING", severity: "ERROR", message: "Bundle source must declare a producer string." });
    }
    if (!source.engineVersion || typeof source.engineVersion !== "string") {
      issues.push({ code: "SOURCE_ENGINE_VERSION_MISSING", severity: "ERROR", message: "Bundle source must declare an engineVersion." });
    }
    if (source.modelSchemaVersion !== "pbd.model.v1") {
      issues.push({ code: "SOURCE_MODEL_SCHEMA_INVALID", severity: "ERROR", message: "source.modelSchemaVersion must be pbd.model.v1." });
    }
    if (source.svgSchemaVersion !== "pbd.svg.v4") {
      issues.push({ code: "SOURCE_SVG_SCHEMA_INVALID", severity: "ERROR", message: "source.svgSchemaVersion must be pbd.svg.v4." });
    }
    if (!ALLOWED_CARTON_TYPES.includes(source.cartonType)) {
      issues.push({
        code: "SOURCE_CARTON_TYPE_INVALID",
        severity: "ERROR",
        message: `source.cartonType must be one of: ${ALLOWED_CARTON_TYPES.join(", ")}, got "${source.cartonType}".`
      });
    }
    if (source.referenceOnly !== true || source.productionCertified !== false) {
      issues.push({
        code: "SOURCE_STATUS_INVALID",
        severity: "ERROR",
        message: "source status must remain referenceOnly: true and productionCertified: false."
      });
    }
  }

  // 3. Capabilities block validation
  const cap = bundle.capabilities;
  if (!cap || typeof cap !== "object" || Array.isArray(cap)) {
    issues.push({ code: "CAPABILITIES_INVALID", severity: "ERROR", message: "Bundle capabilities block is missing or invalid." });
  } else {
    const requiredCaps = ["artwork2d", "flatExport", "foldPreview", "technicalRender"];
    for (const key of requiredCaps) {
      if (typeof cap[key] !== "boolean") {
        issues.push({ code: "CAPABILITY_FIELD_INVALID", severity: "ERROR", message: `capabilities.${key} must be a boolean.` });
      }
    }
  }

  // 4. Model JSON & SHA-256 verification
  const modelJson = bundle.modelJson;
  if (!modelJson || typeof modelJson !== "object" || Array.isArray(modelJson)) {
    issues.push({ code: "MODEL_JSON_MISSING", severity: "ERROR", message: "bundle.modelJson must be a JSON object." });
  } else {
    // Validate semantic model
    const modelValidation = validateModelJson(modelJson);
    if (!modelValidation.valid) {
      issues.push(...modelValidation.issues);
    }

    // Verify Model JSON SHA-256
    const canonicalModelString = canonicalizeJson(modelJson);
    const expectedModelSha = sha256(canonicalModelString);
    if (typeof bundle.modelJsonSha256 !== "string" || bundle.modelJsonSha256.toLowerCase() !== expectedModelSha.toLowerCase()) {
      issues.push({
        code: "MODEL_SHA256_MISMATCH",
        severity: "ERROR",
        message: `modelJsonSha256 mismatch: declared "${bundle.modelJsonSha256}", computed "${expectedModelSha}".`
      });
    }
  }

  // 5. Semantic SVG & SHA-256 / ByteLength / Security verification
  const semanticSvg = bundle.semanticSvg;
  if (!semanticSvg || typeof semanticSvg !== "object" || Array.isArray(semanticSvg)) {
    issues.push({ code: "SEMANTIC_SVG_MISSING", severity: "ERROR", message: "bundle.semanticSvg must be an object." });
  } else {
    if (semanticSvg.mediaType !== "image/svg+xml") {
      issues.push({ code: "SVG_MEDIA_TYPE_INVALID", severity: "ERROR", message: 'semanticSvg.mediaType must be "image/svg+xml".' });
    }
    if (semanticSvg.units !== "mm") {
      issues.push({ code: "SVG_UNITS_INVALID", severity: "ERROR", message: 'semanticSvg.units must be "mm".' });
    }
    if (typeof semanticSvg.markup !== "string" || semanticSvg.markup.length < 10) {
      issues.push({ code: "SVG_MARKUP_INVALID", severity: "ERROR", message: "semanticSvg.markup must be a valid SVG string." });
    } else {
      // Validate payload size
      const actualByteLength = utf8ByteLength(semanticSvg.markup);
      if (actualByteLength > maxBytes) {
        issues.push({
          code: "PAYLOAD_OVERSIZED",
          severity: "ERROR",
          message: `SVG payload exceeds maximum size limit (${actualByteLength} bytes > ${maxBytes} bytes).`
        });
      }

      if (semanticSvg.byteLength !== actualByteLength) {
        issues.push({
          code: "SVG_BYTE_LENGTH_MISMATCH",
          severity: "ERROR",
          message: `semanticSvg.byteLength mismatch: declared ${semanticSvg.byteLength}, actual ${actualByteLength}.`
        });
      }

      const expectedSvgSha = sha256(semanticSvg.markup);
      if (typeof semanticSvg.sha256 !== "string" || semanticSvg.sha256.toLowerCase() !== expectedSvgSha.toLowerCase()) {
        issues.push({
          code: "SVG_SHA256_MISMATCH",
          severity: "ERROR",
          message: `semanticSvg.sha256 mismatch: declared "${semanticSvg.sha256}", computed "${expectedSvgSha}".`
        });
      }

      // Validate SVG semantics and security
      const svgValidation = validateSemanticSvg(semanticSvg.markup);
      if (!svgValidation.valid) {
        issues.push(...svgValidation.issues);
      }
    }
  }

  // 6. Cross-consistency checks
  if (source && modelJson?.input) {
    if (source.cartonType && modelJson.input.cartonType && source.cartonType !== modelJson.input.cartonType) {
      issues.push({
        code: "CROSS_CARTON_TYPE_MISMATCH",
        severity: "ERROR",
        message: `source.cartonType "${source.cartonType}" does not match modelJson.input.cartonType "${modelJson.input.cartonType}".`
      });
    }
  }

  return {
    valid: issues.length === 0,
    errors: issues.map((i) => `[${i.code}] ${i.message}`),
    issues
  };
}
