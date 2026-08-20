/**
 * Factory for creating valid carton-workflow.v1 exchange bundles directly from PBD engine.
 */

import { sha256, utf8ByteLength } from "./crypto.js";
import { CONTRACT_VERSION, WORKFLOW_MODE } from "./validator.js";

export const FROZEN_PBD_ARTIFACT_SHA256 = "0c5560eff56147dc17fc268639cd346c59bdea6d35d510cc2d581e0c9fd5c1fc";

/**
 * Build a carton-workflow.v1 bundle from a generated model and SVG markup.
 *
 * @param {object} params
 * @param {string} params.cartonType
 * @param {object} params.modelExport - Exported pbd.model.v1 object (from engine.buildModelExport)
 * @param {string} params.svgMarkup - Rendered pbd.svg.v4 markup (from engine.renderSvgMarkupV4)
 * @param {object} [params.options]
 * @returns {object} Canonical carton-workflow.v1 bundle
 */
export function buildCartonWorkflowBundle({ cartonType, modelExport, svgMarkup, options = {} }) {
  const modelText = JSON.stringify(modelExport, null, 2);
  const modelBytes = utf8ByteLength(modelText);
  const modelSha = sha256(modelText);

  const svgBytes = utf8ByteLength(svgMarkup);
  const svgSha = sha256(svgMarkup);

  const rawProfiles = modelExport.ruleResolution?.activeProfiles || [];
  const profileIds = rawProfiles
    .map((p) => (typeof p === "string" ? p : p?.profile?.id || p?.id || p?.name))
    .filter((id) => typeof id === "string" && id.length > 0);

  const capabilities = {
    artwork2d: options.capabilities?.artwork2d ?? true,
    flatExport: options.capabilities?.flatExport ?? true,
    foldPreview: options.capabilities?.foldPreview ?? true,
    technicalRender: options.capabilities?.technicalRender ?? true,
  };

  return {
    contractVersion: CONTRACT_VERSION,
    workflowMode: WORKFLOW_MODE,
    source: {
      producer: "packaging-box-designer",
      engineVersion: modelExport.engineVersion || "0.9.34",
      modelSchemaVersion: "pbd.model.v1",
      svgSchemaVersion: "pbd.svg.v4",
      artifactSha256: options.artifactSha256 || FROZEN_PBD_ARTIFACT_SHA256,
      cartonType,
      profileIds,
      referenceOnly: true,
      productionCertified: false,
    },
    modelJson: {
      mediaType: "application/json",
      byteLength: modelBytes,
      sha256: modelSha,
      text: modelText,
    },
    semanticSvg: {
      assetId: options.assetId || `pbd.svg.v4-${cartonType.toLowerCase()}`,
      mediaType: "image/svg+xml",
      byteLength: svgBytes,
      sha256: svgSha,
      units: "mm",
      markup: svgMarkup,
    },
    capabilities,
  };
}
