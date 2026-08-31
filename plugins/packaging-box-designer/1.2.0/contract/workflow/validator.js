/**
 * Master carton-workflow.v1 bundle validator.
 * Integrates schema validation, XML security scanner, size preflight, and PBD canonical model/svg validators.
 */

import { sha256Async, utf8ByteLength } from "./crypto.js";
import { scanSvgSecurity } from "./security.js";
import { validateCompiledCartonWorkflowSchema } from "./compiledSchema.js";
import { validateModelExport } from "../export/modelJson.mjs";
import { validateSvgV4Export } from "../export/svgMetadata.mjs";

export const CONTRACT_VERSION = "carton-workflow.v1";
export const WORKFLOW_MODE = "technical";
export const ALLOWED_CARTON_TYPES = Object.freeze(["RTE", "STE", "TT_SL123"]);

export const DEFAULT_LIMITS = Object.freeze({
  maxModelBytes: 10 * 1024 * 1024, // 10 MB
  maxSvgBytes: 15 * 1024 * 1024,   // 15 MB
});

/**
 * Validate a carton-workflow.v1 bundle asynchronously.
 * Guaranteed never to throw uncaught exceptions; safely handles cyclic and oversized inputs.
 *
 * @param {unknown} bundle
 * @param {object} [options]
 * @param {number} [options.maxModelBytes]
 * @param {number} [options.maxSvgBytes]
 * @param {string} [options.expectedProducer]
 * @param {string} [options.expectedArtifactSha256]
 * @param {string} [options.expectedArtifactVersion]
 * @returns {Promise<{ valid: boolean, errors: string[], issues: Array<{ code: string, severity: string, message: string }>, model?: Record<string, unknown> }>}
 */
export async function validateCartonWorkflowBundle(bundle, options = {}) {
  try {
    const issues = [];
    const limits = { ...DEFAULT_LIMITS, ...options };

    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
      return {
        valid: false,
        errors: ["[BUNDLE_NOT_OBJECT] Bundle must be a non-null object."],
        issues: [{ code: "BUNDLE_NOT_OBJECT", severity: "ERROR", message: "Bundle must be a non-null object." }],
      };
    }

    // 1. Structural Schema Validation (catches extra properties, type errors, enum mismatches)
    const schemaIssues = validateCompiledCartonWorkflowSchema(bundle);
    if (schemaIssues.length > 0) {
      issues.push(...schemaIssues);
    }

    const source = bundle.source;
    if (source && typeof source === "object" && !Array.isArray(source)) {
      // 2. Trusted Host Verification Options
      if (options.expectedProducer && source.producer !== options.expectedProducer) {
        issues.push({
          code: "PRODUCER_MISMATCH",
          severity: "ERROR",
          message: `Expected producer "${options.expectedProducer}", got "${source.producer}".`,
        });
      }

      if (options.expectedArtifactSha256 && source.artifactSha256 !== options.expectedArtifactSha256) {
        issues.push({
          code: "ARTIFACT_SHA256_MISMATCH",
          severity: "ERROR",
          message: `Expected artifactSha256 "${options.expectedArtifactSha256}", got "${source.artifactSha256}".`,
        });
      }

      if (options.expectedArtifactVersion && source.artifactVersion !== options.expectedArtifactVersion) {
        issues.push({
          code: "ARTIFACT_VERSION_MISMATCH",
          severity: "ERROR",
          message: `Expected artifactVersion "${options.expectedArtifactVersion}", got "${source.artifactVersion}".`,
        });
      }
    }

    // 3. Model JSON Validation (with short-circuit preflight)
    let parsedModel = null;
    const modelJson = bundle.modelJson;
    if (modelJson && typeof modelJson === "object" && typeof modelJson.text === "string") {
      const actualModelBytes = utf8ByteLength(modelJson.text);

      if (actualModelBytes > limits.maxModelBytes) {
        // SHORT-CIRCUIT: Do not compute SHA-256 or parse JSON if oversized
        issues.push({
          code: "MODEL_OVERSIZED",
          severity: "ERROR",
          message: `Model JSON size (${actualModelBytes} bytes) exceeds limit of ${limits.maxModelBytes} bytes.`,
        });
      } else {
        if (modelJson.byteLength !== actualModelBytes) {
          issues.push({
            code: "MODEL_BYTE_LENGTH_MISMATCH",
            severity: "ERROR",
            message: `modelJson.byteLength mismatch: declared ${modelJson.byteLength}, actual ${actualModelBytes}.`,
          });
        }

        const computedModelSha = await sha256Async(modelJson.text);
        if (typeof modelJson.sha256 !== "string" || modelJson.sha256.toLowerCase() !== computedModelSha.toLowerCase()) {
          issues.push({
            code: "MODEL_SHA256_MISMATCH",
            severity: "ERROR",
            message: `modelJson.sha256 mismatch: declared "${modelJson.sha256}", computed "${computedModelSha}".`,
          });
        }

        try {
          parsedModel = JSON.parse(modelJson.text);
        } catch (err) {
          issues.push({
            code: "MODEL_JSON_SYNTAX_ERROR",
            severity: "ERROR",
            message: `Failed to parse modelJson.text: ${err.message}`,
          });
        }

        if (parsedModel) {
          const modelExportValidation = validateModelExport(parsedModel);
          if (!modelExportValidation.valid) {
            issues.push(...modelExportValidation.issues);
          }
        }
      }
    }

    // 4. Semantic SVG Validation (with short-circuit preflight)
    const semanticSvg = bundle.semanticSvg;
    if (semanticSvg && typeof semanticSvg === "object" && typeof semanticSvg.markup === "string") {
      const actualSvgBytes = utf8ByteLength(semanticSvg.markup);

      if (actualSvgBytes > limits.maxSvgBytes) {
        // SHORT-CIRCUIT: Do not compute SHA-256 or parse XML if oversized
        issues.push({
          code: "SVG_OVERSIZED",
          severity: "ERROR",
          message: `SVG size (${actualSvgBytes} bytes) exceeds limit of ${limits.maxSvgBytes} bytes.`,
        });
      } else {
        if (semanticSvg.byteLength !== actualSvgBytes) {
          issues.push({
            code: "SVG_BYTE_LENGTH_MISMATCH",
            severity: "ERROR",
            message: `semanticSvg.byteLength mismatch: declared ${semanticSvg.byteLength}, actual ${actualSvgBytes}.`,
          });
        }

        const computedSvgSha = await sha256Async(semanticSvg.markup);
        if (typeof semanticSvg.sha256 !== "string" || semanticSvg.sha256.toLowerCase() !== computedSvgSha.toLowerCase()) {
          issues.push({
            code: "SVG_SHA256_MISMATCH",
            severity: "ERROR",
            message: `semanticSvg.sha256 mismatch: declared "${semanticSvg.sha256}", computed "${computedSvgSha}".`,
          });
        }

        // Verify content-addressed assetId
        const expectedAssetId = `svg-${computedSvgSha.slice(0, 16)}`;
        if (semanticSvg.assetId && semanticSvg.assetId !== expectedAssetId) {
          issues.push({
            code: "SVG_ASSET_ID_MISMATCH",
            severity: "ERROR",
            message: `semanticSvg.assetId "${semanticSvg.assetId}" does not match content hash "${expectedAssetId}".`,
          });
        }

        // XML and security preflight scan
        const securityIssues = scanSvgSecurity(semanticSvg.markup);
        if (securityIssues.length > 0) {
          issues.push(...securityIssues);
        }

        // Canonical PBD SVG v4 validation
        const svgValidation = validateSvgV4Export(semanticSvg.markup);
        if (!svgValidation.valid) {
          issues.push(...svgValidation.issues);
        }
      }
    }

    // 5. Cross-consistency checks
    if (source && parsedModel?.input) {
      if (source.cartonType && parsedModel.input.cartonType && source.cartonType !== parsedModel.input.cartonType) {
        issues.push({
          code: "CROSS_CARTON_TYPE_MISMATCH",
          severity: "ERROR",
          message: `source.cartonType "${source.cartonType}" does not match modelJson.input.cartonType "${parsedModel.input.cartonType}".`,
        });
      }
    }

    return {
      valid: issues.length === 0,
      errors: issues.map((i) => `[${i.code}] ${i.message || i.code}`),
      issues,
      model: parsedModel,
    };
  } catch (err) {
    return {
      valid: false,
      errors: [`[VALIDATOR_UNCAUGHT_ERROR] Unexpected validator error: ${err.message}`],
      issues: [{ code: "VALIDATOR_UNCAUGHT_ERROR", severity: "ERROR", message: err.message }],
    };
  }
}
