/**
 * Factory for creating canonical carton-workflow.v1 exchange bundles.
 */

import { sha256Async, utf8ByteLength } from "./crypto.js";
import { CONTRACT_VERSION, WORKFLOW_MODE } from "./validator.js";

export const FROZEN_PBD_ARTIFACT_SHA256 = "0c5560eff56147dc17fc268639cd346c59bdea6d35d510cc2d581e0c9fd5c1fc";
export const PBD_PRODUCER_VERSION = "1.2.0";
export const CONTRACT_PACKAGE_VERSION = "1.0.0";

/**
 * Asynchronously build a carton-workflow.v1 bundle from a generated model and SVG markup.
 *
 * @param {object} params
 * @param {string} params.cartonType
 * @param {object} params.modelExport
 * @param {string} params.svgMarkup
 * @param {object} [params.options]
 * @returns {Promise<object>} Canonical carton-workflow.v1 bundle
 */
export async function buildCartonWorkflowBundleAsync({ cartonType, modelExport, svgMarkup, options = {} }) {
  const modelText = JSON.stringify(modelExport, null, 2);
  const modelBytes = utf8ByteLength(modelText);
  const modelSha = await sha256Async(modelText);

  const svgBytes = utf8ByteLength(svgMarkup);
  const svgSha = await sha256Async(svgMarkup);
  const assetId = `svg-${svgSha.slice(0, 16)}`;

  const rawProfiles = modelExport.ruleResolution?.activeProfiles || [];
  const profileIds = rawProfiles
    .map((p) => (typeof p === "string" ? p : p?.profile?.id || p?.id || p?.name))
    .filter((id) => typeof id === "string" && id.length > 0);

  const capabilities = {
    artwork2d: options.capabilities?.artwork2d ?? true,
    flatExport: options.capabilities?.flatExport ?? true,
    foldPreview: options.capabilities?.foldPreview ?? true,
    technicalRender: options.capabilities?.technicalRender ?? false,
  };

  return {
    contractVersion: CONTRACT_VERSION,
    workflowMode: WORKFLOW_MODE,
    source: {
      producer: "packaging-box-designer",
      producerVersion: options.producerVersion || PBD_PRODUCER_VERSION,
      modelEngineVersion: modelExport.engineVersion || "0.9.34",
      contractPackageVersion: options.contractPackageVersion || CONTRACT_PACKAGE_VERSION,
      artifactVersion: options.artifactVersion || PBD_PRODUCER_VERSION,
      artifactSha256: options.artifactSha256 || FROZEN_PBD_ARTIFACT_SHA256,
      modelSchemaVersion: "pbd.model.v1",
      svgSchemaVersion: "pbd.svg.v4",
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
      assetId,
      mediaType: "image/svg+xml",
      byteLength: svgBytes,
      sha256: svgSha,
      units: "mm",
      markup: svgMarkup,
    },
    capabilities,
  };
}
