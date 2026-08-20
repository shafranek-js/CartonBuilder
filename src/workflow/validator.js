/**
 * Master carton-workflow.v1 bundle validator.
 * Directly integrates PBD canonical validateModelExport and validateSvgV4Export without duplicate code.
 */

import { sha256Async, sha256, utf8ByteLength } from "./crypto.js";
import { scanSvgSecurity } from "./security.js";
import { validateModelExport } from "./pbd-export/modelJson.js";
import { validateSvgV4Export } from "./pbd-export/svgMetadata.js";

export const CONTRACT_VERSION = "carton-workflow.v1";
export const WORKFLOW_MODE = "technical";
export const ALLOWED_CARTON_TYPES = Object.freeze(["RTE", "STE", "TT_SL123"]);

export const DEFAULT_LIMITS = Object.freeze({
  maxModelBytes: 10 * 1024 * 1024,   // 10 MB
  maxSvgBytes: 15 * 1024 * 1024,     // 15 MB
  maxBundleBytes: 25 * 1024 * 1024,  // 25 MB
});

/**
 * Validate a carton-workflow.v1 bundle asynchronously using Web Crypto API.
 *
 * @param {unknown} bundle
 * @param {typeof DEFAULT_LIMITS} [options]
 * @returns {Promise<{ valid: boolean, errors: string[], issues: Array<{ code: string, severity: string, message: string }>, model?: Record<string, unknown> }>}
 */
export async function validateCartonWorkflowBundle(bundle, options = {}) {
  const issues = [];
  const limits = { ...DEFAULT_LIMITS, ...options };

  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return {
      valid: false,
      errors: ["Bundle must be a non-null object."],
      issues: [{ code: "BUNDLE_NOT_OBJECT", severity: "ERROR", message: "Bundle must be an object." }]
    };
  }

  // 1. Total bundle preflight size check (if bundle is raw text or serialized)
  const bundleString = JSON.stringify(bundle);
  const bundleBytes = utf8ByteLength(bundleString);
  if (bundleBytes > limits.maxBundleBytes) {
    return {
      valid: false,
      errors: [`[BUNDLE_OVERSIZED] Total bundle size (${bundleBytes} bytes) exceeds limit of ${limits.maxBundleBytes} bytes.`],
      issues: [{
        code: "BUNDLE_OVERSIZED",
        severity: "ERROR",
        message: `Total bundle size (${bundleBytes} bytes) exceeds limit of ${limits.maxBundleBytes} bytes.`
      }]
    };
  }

  // 2. Contract version and workflow mode
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

  // 3. Source block validation
  const source = bundle.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    issues.push({ code: "SOURCE_INVALID", severity: "ERROR", message: "Bundle source block is missing or invalid." });
  } else {
    if (!source.producer || typeof source.producer !== "string") {
      issues.push({ code: "SOURCE_PRODUCER_MISSING", severity: "ERROR", message: "source.producer must be a non-empty string." });
    }
    if (!source.engineVersion || typeof source.engineVersion !== "string") {
      issues.push({ code: "SOURCE_ENGINE_VERSION_MISSING", severity: "ERROR", message: "source.engineVersion must be a non-empty string." });
    }
    if (source.modelSchemaVersion !== "pbd.model.v1") {
      issues.push({ code: "SOURCE_MODEL_SCHEMA_INVALID", severity: "ERROR", message: "source.modelSchemaVersion must be pbd.model.v1." });
    }
    if (source.svgSchemaVersion !== "pbd.svg.v4") {
      issues.push({ code: "SOURCE_SVG_SCHEMA_INVALID", severity: "ERROR", message: "source.svgSchemaVersion must be pbd.svg.v4." });
    }
    if (typeof source.artifactSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(source.artifactSha256)) {
      issues.push({ code: "SOURCE_ARTIFACT_SHA256_INVALID", severity: "ERROR", message: "source.artifactSha256 must be a 64-character hex string." });
    }
    if (!ALLOWED_CARTON_TYPES.includes(source.cartonType)) {
      issues.push({
        code: "SOURCE_CARTON_TYPE_INVALID",
        severity: "ERROR",
        message: `source.cartonType must be one of: ${ALLOWED_CARTON_TYPES.join(", ")}, got "${source.cartonType}".`
      });
    }
    if (!Array.isArray(source.profileIds) || source.profileIds.some((id) => typeof id !== "string")) {
      issues.push({ code: "SOURCE_PROFILE_IDS_INVALID", severity: "ERROR", message: "source.profileIds must be an array of string identifiers." });
    }
    if (source.referenceOnly !== true || source.productionCertified !== false) {
      issues.push({
        code: "SOURCE_STATUS_INVALID",
        severity: "ERROR",
        message: "source status must remain referenceOnly: true and productionCertified: false."
      });
    }
  }

  // 4. Capabilities validation
  const cap = bundle.capabilities;
  if (!cap || typeof cap !== "object" || Array.isArray(cap)) {
    issues.push({ code: "CAPABILITIES_INVALID", severity: "ERROR", message: "Bundle capabilities block is missing or invalid." });
  } else {
    for (const key of ["artwork2d", "flatExport", "foldPreview", "technicalRender"]) {
      if (typeof cap[key] !== "boolean") {
        issues.push({ code: "CAPABILITY_FIELD_INVALID", severity: "ERROR", message: `capabilities.${key} must be a boolean.` });
      }
    }
  }

  // 5. Model JSON validation with preflight limits & hash check
  let parsedModel = null;
  const modelJson = bundle.modelJson;
  if (!modelJson || typeof modelJson !== "object" || Array.isArray(modelJson)) {
    issues.push({ code: "MODEL_JSON_MISSING", severity: "ERROR", message: "bundle.modelJson is missing or invalid." });
  } else {
    if (modelJson.mediaType !== "application/json") {
      issues.push({ code: "MODEL_MEDIA_TYPE_INVALID", severity: "ERROR", message: 'modelJson.mediaType must be "application/json".' });
    }
    if (typeof modelJson.text !== "string" || modelJson.text.length < 2) {
      issues.push({ code: "MODEL_TEXT_MISSING", severity: "ERROR", message: "modelJson.text must be non-empty JSON text." });
    } else {
      const actualModelBytes = utf8ByteLength(modelJson.text);
      if (actualModelBytes > limits.maxModelBytes) {
        issues.push({
          code: "MODEL_OVERSIZED",
          severity: "ERROR",
          message: `Model JSON size (${actualModelBytes} bytes) exceeds limit of ${limits.maxModelBytes} bytes.`
        });
      }
      if (modelJson.byteLength !== actualModelBytes) {
        issues.push({
          code: "MODEL_BYTE_LENGTH_MISMATCH",
          severity: "ERROR",
          message: `modelJson.byteLength mismatch: declared ${modelJson.byteLength}, actual ${actualModelBytes}.`
        });
      }

      const computedModelSha = await sha256Async(modelJson.text);
      if (typeof modelJson.sha256 !== "string" || modelJson.sha256.toLowerCase() !== computedModelSha.toLowerCase()) {
        issues.push({
          code: "MODEL_SHA256_MISMATCH",
          severity: "ERROR",
          message: `modelJson.sha256 mismatch: declared "${modelJson.sha256}", computed "${computedModelSha}".`
        });
      }

      // Parse JSON only after limits & hash validation
      try {
        parsedModel = JSON.parse(modelJson.text);
      } catch (err) {
        issues.push({ code: "MODEL_JSON_SYNTAX_ERROR", severity: "ERROR", message: `Failed to parse modelJson.text: ${err.message}` });
      }

      if (parsedModel) {
        // Run canonical PBD validateModelExport
        const modelExportValidation = validateModelExport(parsedModel);
        if (!modelExportValidation.valid) {
          issues.push(...modelExportValidation.issues);
        }
      }
    }
  }

  // 6. Semantic SVG validation with security preflight & hash check
  const semanticSvg = bundle.semanticSvg;
  if (!semanticSvg || typeof semanticSvg !== "object" || Array.isArray(semanticSvg)) {
    issues.push({ code: "SEMANTIC_SVG_MISSING", severity: "ERROR", message: "bundle.semanticSvg is missing or invalid." });
  } else {
    if (typeof semanticSvg.assetId !== "string" || !semanticSvg.assetId) {
      issues.push({ code: "SVG_ASSET_ID_MISSING", severity: "ERROR", message: "semanticSvg.assetId must be a non-empty string identifier." });
    }
    if (semanticSvg.mediaType !== "image/svg+xml") {
      issues.push({ code: "SVG_MEDIA_TYPE_INVALID", severity: "ERROR", message: 'semanticSvg.mediaType must be "image/svg+xml".' });
    }
    if (semanticSvg.units !== "mm") {
      issues.push({ code: "SVG_UNITS_INVALID", severity: "ERROR", message: 'semanticSvg.units must be "mm".' });
    }
    if (typeof semanticSvg.markup !== "string" || semanticSvg.markup.length < 10) {
      issues.push({ code: "SVG_MARKUP_INVALID", severity: "ERROR", message: "semanticSvg.markup must be a non-empty SVG string." });
    } else {
      const actualSvgBytes = utf8ByteLength(semanticSvg.markup);
      if (actualSvgBytes > limits.maxSvgBytes) {
        issues.push({
          code: "SVG_OVERSIZED",
          severity: "ERROR",
          message: `SVG size (${actualSvgBytes} bytes) exceeds limit of ${limits.maxSvgBytes} bytes.`
        });
      }
      if (semanticSvg.byteLength !== actualSvgBytes) {
        issues.push({
          code: "SVG_BYTE_LENGTH_MISMATCH",
          severity: "ERROR",
          message: `semanticSvg.byteLength mismatch: declared ${semanticSvg.byteLength}, actual ${actualSvgBytes}.`
        });
      }

      const computedSvgSha = await sha256Async(semanticSvg.markup);
      if (typeof semanticSvg.sha256 !== "string" || semanticSvg.sha256.toLowerCase() !== computedSvgSha.toLowerCase()) {
        issues.push({
          code: "SVG_SHA256_MISMATCH",
          severity: "ERROR",
          message: `semanticSvg.sha256 mismatch: declared "${semanticSvg.sha256}", computed "${computedSvgSha}".`
        });
      }

      // Security preflight scan
      const securityIssues = scanSvgSecurity(semanticSvg.markup);
      if (securityIssues.length > 0) {
        issues.push(...securityIssues);
      }

      // Canonical PBD validateSvgV4Export
      const svgValidation = validateSvgV4Export(semanticSvg.markup);
      if (!svgValidation.valid) {
        issues.push(...svgValidation.issues);
      }
    }
  }

  // 7. Cross-consistency checks
  if (source && parsedModel?.input) {
    if (source.cartonType && parsedModel.input.cartonType && source.cartonType !== parsedModel.input.cartonType) {
      issues.push({
        code: "CROSS_CARTON_TYPE_MISMATCH",
        severity: "ERROR",
        message: `source.cartonType "${source.cartonType}" does not match modelJson.input.cartonType "${parsedModel.input.cartonType}".`
      });
    }
  }

  return {
    valid: issues.length === 0,
    errors: issues.map((i) => `[${i.code}] ${i.message || i.code}`),
    issues,
    model: parsedModel
  };
}
