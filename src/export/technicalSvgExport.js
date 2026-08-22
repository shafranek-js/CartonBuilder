import { DOMParser as XmlDomParser } from '@xmldom/xmldom';

import { AppError } from '../errors.js';
import { validateSvgV4Export } from '../workflow/export/svgMetadata.mjs';
import { sha256Async, utf8ByteLength } from '../workflow/workflow/crypto.js';
import { scanSvgSecurity } from '../workflow/workflow/security.js';

export const TECHNICAL_SVG_PROVENANCE_SCHEMA = 'cartonbuilder.technical-svg-provenance.v1';

const PBD_METADATA_ID = 'cartonbuilder-metadata';
const PROVENANCE_METADATA_ID = 'cartonbuilder-export-provenance';
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

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

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail(`missing-${field}`);
  return value;
}

function parseSvgXml(markup) {
  const parserIssues = [];
  let document;
  try {
    document = new XmlDomParser({
      onError: (level, message) => {
        if (level === 'error' || level === 'fatalError' || /unclosed|mismatched|syntax|invalid|redefined/i.test(message)) {
          parserIssues.push(String(message));
        }
      },
    }).parseFromString(markup, 'image/svg+xml');
  } catch (error) {
    fail('canonical-svg-xml-invalid', { issues: [String(error?.message || error)] });
  }

  const parserErrorElements = document?.getElementsByTagName?.('parsererror');
  if (parserErrorElements?.length) parserIssues.push('parsererror element present');
  const rootName = String(document?.documentElement?.nodeName || '').toLowerCase();
  if (parserIssues.length > 0 || rootName !== 'svg') {
    fail('canonical-svg-xml-invalid', {
      issues: parserIssues.length > 0 ? parserIssues : [`root element is ${rootName || 'missing'}`],
    });
  }
  return document;
}

function getMetadataElements(document) {
  const nodes = document.getElementsByTagName('metadata');
  return Array.from({ length: nodes.length }, (_, index) => nodes.item(index));
}

function metadataWithId(elements, id) {
  return elements.filter((element) => element?.getAttribute?.('id') === id);
}

function parseMetadataJson(element, reason) {
  try {
    return JSON.parse(String(element?.textContent ?? ''));
  } catch {
    fail(reason);
  }
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (typeof left !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
}

function inspectTechnicalSvgMetadata(markup, { requireProvenance = false, expectedProvenance = null } = {}) {
  const securityIssues = scanSvgSecurity(markup);
  if (securityIssues.length > 0) {
    fail(requireProvenance ? 'exported-svg-security-invalid' : 'canonical-svg-security-invalid', {
      issues: securityIssues,
    });
  }

  const document = parseSvgXml(markup);
  const elements = getMetadataElements(document);
  const pbdMetadataElements = metadataWithId(elements, PBD_METADATA_ID);
  const provenanceMetadataElements = metadataWithId(elements, PROVENANCE_METADATA_ID);

  if (pbdMetadataElements.length !== 1) {
    fail('pbd-metadata-count-invalid', { count: pbdMetadataElements.length });
  }
  if (!requireProvenance && provenanceMetadataElements.length !== 0) {
    fail('canonical-svg-already-has-provenance', { count: provenanceMetadataElements.length });
  }

  const pbdMetadata = parseMetadataJson(pbdMetadataElements[0], 'pbd-metadata-invalid');
  if (!requireProvenance) return { document, pbdMetadata, pbdMetadataElement: pbdMetadataElements[0] };

  if (provenanceMetadataElements.length !== 1) {
    fail('provenance-metadata-count-invalid', { count: provenanceMetadataElements.length });
  }
  const provenanceElement = provenanceMetadataElements[0];
  if (provenanceElement.getAttribute('data-schema-version') !== TECHNICAL_SVG_PROVENANCE_SCHEMA) {
    fail('provenance-schema-version-invalid');
  }
  const parsedProvenance = parseMetadataJson(provenanceElement, 'provenance-json-invalid');
  if (!deepEqual(parsedProvenance, expectedProvenance)) fail('provenance-mismatch');
  return {
    document,
    pbdMetadata,
    pbdMetadataElement: pbdMetadataElements[0],
    provenanceMetadataElement: provenanceElement,
    provenance: parsedProvenance,
  };
}

function locatePbdMetadataEnd(markup) {
  const openingTags = /<metadata\b[^>]*>/gi;
  for (const match of markup.matchAll(openingTags)) {
    const idMatch = match[0].match(/\bid\s*=\s*(["'])(.*?)\1/i);
    if (!idMatch || idMatch[2] !== PBD_METADATA_ID) continue;
    const closePattern = /<\/metadata\s*>/gi;
    closePattern.lastIndex = match.index + match[0].length;
    const closeMatch = closePattern.exec(markup);
    if (!closeMatch) fail('pbd-metadata-insertion-point-missing');
    return closeMatch.index + closeMatch[0].length;
  }
  fail('pbd-metadata-insertion-point-missing');
}

async function validateTechnicalSource(canonicalSvg, sourceIdentity) {
  if (!sourceIdentity || sourceIdentity.mode !== 'technical') fail('source-identity-invalid');
  if (!canonicalSvg || typeof canonicalSvg !== 'object') fail('canonical-svg-missing');
  requireString(canonicalSvg.markup, 'canonical-svg-markup');
  requireString(canonicalSvg.assetId, 'semantic-svg-asset-id');
  requireString(canonicalSvg.mediaType, 'semantic-svg-media-type');
  if (canonicalSvg.mediaType !== 'image/svg+xml') fail('semantic-svg-media-type-invalid');
  if (canonicalSvg.units !== 'mm') fail('semantic-svg-units-invalid');
  if (!SHA256_PATTERN.test(canonicalSvg.sha256 || '')) fail('semantic-svg-sha256-invalid');
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

  const actualByteLength = utf8ByteLength(canonicalSvg.markup);
  if (canonicalSvg.byteLength !== actualByteLength) {
    fail('canonical-svg-byte-length-mismatch', {
      declared: canonicalSvg.byteLength,
      actual: actualByteLength,
    });
  }
  const actualSha256 = await sha256Async(canonicalSvg.markup);
  if (canonicalSvg.sha256 !== actualSha256) {
    fail('canonical-svg-sha256-mismatch', {
      declared: canonicalSvg.sha256,
      actual: actualSha256,
    });
  }
  const expectedAssetId = `svg-${actualSha256.slice(0, 16)}`;
  if (canonicalSvg.assetId !== expectedAssetId) {
    fail('canonical-svg-asset-id-mismatch', {
      declared: canonicalSvg.assetId,
      expected: expectedAssetId,
    });
  }
  if (sourceIdentity.svgSha256 !== actualSha256) {
    fail('source-svg-sha256-mismatch', {
      declared: sourceIdentity.svgSha256,
      actual: actualSha256,
    });
  }
  if (sourceIdentity.semanticSvgAssetId !== expectedAssetId) {
    fail('source-svg-asset-id-mismatch', {
      declared: sourceIdentity.semanticSvgAssetId,
      expected: expectedAssetId,
    });
  }
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
 * Validate the structural metadata/provenance contract of an exported SVG.
 * The input is parsed only for validation; it is never serialized back.
 */
export function validateTechnicalSvgProvenance(markup, expectedProvenance) {
  return inspectTechnicalSvgMetadata(markup, {
    requireProvenance: true,
    expectedProvenance,
  });
}

/**
 * Export a validated technical workflow SVG by inserting deterministic
 * provenance into the canonical PBD markup. No SVG DOM serialization or
 * geometry reconstruction is allowed on this path.
 */
export async function createTechnicalSvgExport(model) {
  const canonicalSvg = model?.getCanonicalSemanticSvg?.();
  const sourceIdentity = model?.getSourceIdentity?.();
  await validateTechnicalSource(canonicalSvg, sourceIdentity);

  const canonicalMarkup = canonicalSvg.markup;
  const canonicalValidation = validateSvgV4Export(canonicalMarkup);
  if (!canonicalValidation.valid) fail('canonical-svg-invalid', { issues: canonicalValidation.issues });
  const { pbdMetadata } = inspectTechnicalSvgMetadata(canonicalMarkup);
  if (pbdMetadata.cartonType !== sourceIdentity.cartonType) fail('pbd-metadata-carton-type-mismatch');
  if (pbdMetadata.referenceOnly !== true || pbdMetadata.productionCertified !== false) fail('pbd-metadata-status-invalid');

  const provenance = buildProvenance(sourceIdentity, canonicalSvg);
  const provenanceMarkup = `<metadata id="${PROVENANCE_METADATA_ID}" data-schema-version="${TECHNICAL_SVG_PROVENANCE_SCHEMA}">${escapeXmlText(JSON.stringify(provenance))}</metadata>`;
  const pbdMetadataEnd = locatePbdMetadataEnd(canonicalMarkup);
  const exportedMarkup = `${canonicalMarkup.slice(0, pbdMetadataEnd)}${provenanceMarkup}${canonicalMarkup.slice(pbdMetadataEnd)}`;

  const exportedValidation = validateSvgV4Export(exportedMarkup);
  if (!exportedValidation.valid) fail('exported-svg-invalid', { issues: exportedValidation.issues });
  validateTechnicalSvgProvenance(exportedMarkup, provenance);
  return exportedMarkup;
}
