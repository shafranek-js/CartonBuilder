import { AppError } from '../errors.js';
import { validateSvgV4Export } from '../workflow/export/svgMetadata.mjs';
import { scanSvgSecurity } from '../workflow/workflow/security.js';

export const TECHNICAL_SVG_PROVENANCE_SCHEMA = 'cartonbuilder.technical-svg-provenance.v1';

const PBD_METADATA_ID = 'cartonbuilder-metadata';
const PROVENANCE_METADATA_ID = 'cartonbuilder-export-provenance';
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const PBD_METADATA_PATTERN = new RegExp(
  `<metadata id="${PBD_METADATA_ID}"[^>]*>[\\s\\S]*?<\\/metadata>`,
  'g',
);
const PROVENANCE_METADATA_PATTERN = new RegExp(
  `<metadata id="${PROVENANCE_METADATA_ID}"[^>]*>[\\s\\S]*?<\\/metadata>`,
  'g',
);

function fail(reason, details = {}) {
  throw new AppError('technicalSvgExportInvalid', { reason, ...details });
}

function escapeXmlText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function decodeXmlText(value) {
  return String(value)
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseMetadataBlock(block) {
  const contentStart = block.indexOf('>') + 1;
  const contentEnd = block.lastIndexOf('</metadata>');
  if (contentStart <= 0 || contentEnd < contentStart) return null;
  try {
    return JSON.parse(decodeXmlText(block.slice(contentStart, contentEnd)));
  } catch {
    return null;
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail(`missing-${field}`);
  return value;
}

function validateTechnicalSource(canonicalSvg, sourceIdentity) {
  if (!sourceIdentity || sourceIdentity.mode !== 'technical') fail('source-identity-invalid');
  if (!canonicalSvg || typeof canonicalSvg !== 'object') fail('canonical-svg-missing');
  requireString(canonicalSvg.markup, 'canonical-svg-markup');
  requireString(canonicalSvg.assetId, 'semantic-svg-asset-id');
  requireString(canonicalSvg.mediaType, 'semantic-svg-media-type');
  if (canonicalSvg.mediaType !== 'image/svg+xml') fail('semantic-svg-media-type-invalid');
  if (canonicalSvg.units !== 'mm') fail('semantic-svg-units-invalid');
  if (!SHA256_PATTERN.test(canonicalSvg.sha256 || '')) fail('semantic-svg-sha256-invalid');
  if (sourceIdentity.svgSha256 !== canonicalSvg.sha256) fail('source-svg-sha256-mismatch');
  if (sourceIdentity.semanticSvgAssetId !== canonicalSvg.assetId) fail('source-svg-asset-id-mismatch');
  if (sourceIdentity.referenceOnly !== true || sourceIdentity.productionCertified !== false) fail('source-status-invalid');
  if (!['RTE', 'STE', 'TT_SL123'].includes(sourceIdentity.cartonType)) fail('source-carton-type-invalid');
  for (const field of [
    'producer',
    'producerVersion',
    'modelEngineVersion',
    'contractPackageVersion',
    'artifactVersion',
    'artifactSha256',
    'modelSchemaVersion',
    'svgSchemaVersion',
  ]) requireString(sourceIdentity[field], `source-${field}`);
  if (!Array.isArray(sourceIdentity.profileIds) || sourceIdentity.profileIds.some((value) => typeof value !== 'string' || !value)) {
    fail('source-profile-ids-invalid');
  }
  if (!SHA256_PATTERN.test(sourceIdentity.modelSha256 || '')) fail('model-sha256-invalid');
}

function buildProvenance(sourceIdentity, canonicalSvg) {
  return {
    format: 'CartonBuilder Technical SVG Export Provenance',
    schemaVersion: TECHNICAL_SVG_PROVENANCE_SCHEMA,
    source: {
      producer: sourceIdentity.producer,
      producerVersion: sourceIdentity.producerVersion,
      modelEngineVersion: sourceIdentity.modelEngineVersion,
      contractPackageVersion: sourceIdentity.contractPackageVersion,
      artifactVersion: sourceIdentity.artifactVersion,
      artifactSha256: sourceIdentity.artifactSha256,
      modelSchemaVersion: sourceIdentity.modelSchemaVersion,
      svgSchemaVersion: sourceIdentity.svgSchemaVersion,
      cartonType: sourceIdentity.cartonType,
      profileIds: sourceIdentity.profileIds.slice(),
    },
    integrity: {
      modelSha256: sourceIdentity.modelSha256,
      semanticSvgAssetId: canonicalSvg.assetId,
      sourceSemanticSvgSha256: canonicalSvg.sha256,
    },
    status: {
      referenceOnly: sourceIdentity.referenceOnly,
      productionCertified: sourceIdentity.productionCertified,
    },
  };
}

/**
 * Export a validated technical workflow SVG by inserting deterministic
 * provenance into the canonical PBD markup. No SVG DOM serialization or
 * geometry reconstruction is allowed on this path.
 */
export function createTechnicalSvgExport(model) {
  const canonicalSvg = model?.getCanonicalSemanticSvg?.();
  const sourceIdentity = model?.getSourceIdentity?.();
  validateTechnicalSource(canonicalSvg, sourceIdentity);

  const canonicalMarkup = canonicalSvg.markup;
  const pbdMetadataMatches = [...canonicalMarkup.matchAll(PBD_METADATA_PATTERN)];
  if (pbdMetadataMatches.length !== 1) fail('pbd-metadata-count-invalid');
  if (PROVENANCE_METADATA_PATTERN.test(canonicalMarkup)) fail('canonical-svg-already-has-provenance');
  PROVENANCE_METADATA_PATTERN.lastIndex = 0;

  const canonicalValidation = validateSvgV4Export(canonicalMarkup);
  if (!canonicalValidation.valid) fail('canonical-svg-invalid', { issues: canonicalValidation.issues });
  const canonicalSecurityIssues = scanSvgSecurity(canonicalMarkup);
  if (canonicalSecurityIssues.length > 0) fail('canonical-svg-security-invalid', { issues: canonicalSecurityIssues });

  const pbdMetadata = parseMetadataBlock(pbdMetadataMatches[0][0]);
  if (!pbdMetadata) fail('pbd-metadata-invalid');
  if (pbdMetadata.cartonType !== sourceIdentity.cartonType) fail('pbd-metadata-carton-type-mismatch');
  if (pbdMetadata.referenceOnly !== true || pbdMetadata.productionCertified !== false) fail('pbd-metadata-status-invalid');

  const provenance = buildProvenance(sourceIdentity, canonicalSvg);
  const provenanceMarkup = `<metadata id="${PROVENANCE_METADATA_ID}" data-schema-version="${TECHNICAL_SVG_PROVENANCE_SCHEMA}">${escapeXmlText(JSON.stringify(provenance))}</metadata>`;
  const pbdMetadataEnd = pbdMetadataMatches[0].index + pbdMetadataMatches[0][0].length;
  const exportedMarkup = `${canonicalMarkup.slice(0, pbdMetadataEnd)}${provenanceMarkup}${canonicalMarkup.slice(pbdMetadataEnd)}`;

  const exportedProvenanceMatches = [...exportedMarkup.matchAll(PROVENANCE_METADATA_PATTERN)];
  if (exportedProvenanceMatches.length !== 1) fail('provenance-metadata-count-invalid');
  const exportedValidation = validateSvgV4Export(exportedMarkup);
  if (!exportedValidation.valid) fail('exported-svg-invalid', { issues: exportedValidation.issues });
  const exportedSecurityIssues = scanSvgSecurity(exportedMarkup);
  if (exportedSecurityIssues.length > 0) fail('exported-svg-security-invalid', { issues: exportedSecurityIssues });
  return exportedMarkup;
}
