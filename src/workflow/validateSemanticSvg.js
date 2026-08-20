/**
 * Browser-safe validator for pbd.svg.v4 semantic SVG exports with strict security preflight.
 */

export const SVG_V4_SCHEMA_VERSION = "pbd.svg.v4";
export const SVG_ALLOWED_FORMATS = Object.freeze([
  "Parametric Packaging SVG Reference",
  "CartonBuilder SVG Reference"
]);
export const SVG_SEMANTIC_LAYERS = [
  { id: "regions", role: "FILL_REGIONS" },
  { id: "boundaries", role: "FREE_BOUNDARY" },
  { id: "folds", role: "FOLD_BOUNDARY" },
  { id: "features", role: "OPEN_CUT_FEATURES" },
  { id: "anchors", role: "NAMED_ANCHORS" },
  { id: "sequence", role: "ASSEMBLY_SEQUENCE" },
  { id: "labels", role: "ANNOTATIONS" },
  { id: "dimensions", role: "DIMENSION_ANNOTATIONS" },
  { id: "diagnostics", role: "ENGINEERING_DIAGNOSTICS" },
  { id: "bleed", role: "ARTWORK_BLEED_REFERENCE" },
  { id: "safe-zones", role: "ARTWORK_SAFE_ZONE_REFERENCE" },
];

/**
 * Scan SVG markup for disallowed active content or external network resources.
 *
 * @param {string} markup
 * @returns {Array<{ code: string, severity: string, message: string }>}
 */
export function scanSvgSecurity(markup) {
  const issues = [];
  if (typeof markup !== "string") {
    return [{ code: "SVG_NOT_STRING", severity: "ERROR", message: "SVG markup must be a string." }];
  }

  if (/<script\b/i.test(markup)) {
    issues.push({ code: "SVG_SECURITY_SCRIPT_FORBIDDEN", severity: "ERROR", message: "SVG contains forbidden <script> tags." });
  }

  if (/<foreignObject\b/i.test(markup)) {
    issues.push({ code: "SVG_SECURITY_FOREIGNOBJECT_FORBIDDEN", severity: "ERROR", message: "SVG contains forbidden <foreignObject> tags." });
  }

  if (/\son[a-z]+\s*=/i.test(markup)) {
    issues.push({ code: "SVG_SECURITY_EVENT_HANDLER_FORBIDDEN", severity: "ERROR", message: "SVG contains inline event handlers (on*)." });
  }

  if (/javascript\s*:/i.test(markup)) {
    issues.push({ code: "SVG_SECURITY_JAVASCRIPT_URI_FORBIDDEN", severity: "ERROR", message: "SVG contains javascript: URI schemes." });
  }

  // Scan for external resource loading: href/src/url with http:, https:, //
  const externalUriPattern = /(?:href|src|url)\s*=\s*["']?\s*(?:https?:|\/\/)/i;
  const cssUrlPattern = /url\s*\(\s*["']?\s*(?:https?:|\/\/)/i;
  const cssImportPattern = /@import\b/i;

  if (externalUriPattern.test(markup) || cssUrlPattern.test(markup) || cssImportPattern.test(markup)) {
    issues.push({ code: "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN", severity: "ERROR", message: "SVG contains external resource references or @import." });
  }

  return issues;
}

/**
 * Validate SVG markup against the pbd.svg.v4 contract and security policy.
 *
 * @param {string} markup
 * @returns {{ valid: boolean, metadata: Record<string, unknown> | null, issues: Array<{ code: string, severity: string, message: string }> }}
 */
export function validateSemanticSvg(markup) {
  const issues = [];

  // 1. Security scanning
  const securityIssues = scanSvgSecurity(markup);
  if (securityIssues.length > 0) {
    issues.push(...securityIssues);
  }

  if (typeof markup !== "string" || !markup.startsWith("<svg ")) {
    return {
      valid: false,
      metadata: null,
      issues: [{ code: "SVG_NOT_MARKUP", severity: "ERROR", message: "SVG export must begin with an <svg root." }, ...issues]
    };
  }

  // 2. Schema version attribute
  if (!markup.includes(`data-export-schema-version="${SVG_V4_SCHEMA_VERSION}"`)) {
    issues.push({
      code: "SVG_SCHEMA_VERSION_MISSING",
      severity: "ERROR",
      message: `SVG export is missing data-export-schema-version="${SVG_V4_SCHEMA_VERSION}".`
    });
  }

  // 3. Metadata extraction
  if (!markup.includes('id="cartonbuilder-metadata"')) {
    issues.push({
      code: "SVG_METADATA_MISSING",
      severity: "ERROR",
      message: "SVG export is missing the CartonBuilder metadata block."
    });
  }

  const metadataMatch = markup.match(/<metadata id="cartonbuilder-metadata"[^>]*>([\s\S]*?)<\/metadata>/);
  let metadata = null;
  let metadataParsed = false;
  if (metadataMatch) {
    try {
      const decoded = metadataMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
      metadata = JSON.parse(decoded);
      metadataParsed = true;
    } catch {
      issues.push({ code: "SVG_METADATA_INVALID", severity: "ERROR", message: "SVG metadata must contain valid JSON." });
    }
  }

  if (metadataParsed && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
    issues.push({ code: "SVG_METADATA_INVALID", severity: "ERROR", message: "SVG metadata must contain a JSON object." });
  }

  if (metadata) {
    if (!SVG_ALLOWED_FORMATS.includes(metadata.format)) {
      issues.push({
        code: "SVG_METADATA_FORMAT_INVALID",
        severity: "ERROR",
        message: `SVG metadata format must be one of: ${SVG_ALLOWED_FORMATS.join(", ")}.`
      });
    }
    if (metadata.schemaVersion !== SVG_V4_SCHEMA_VERSION) {
      issues.push({
        code: "SVG_METADATA_SCHEMA_VERSION_INVALID",
        severity: "ERROR",
        message: `SVG metadata schemaVersion must be ${SVG_V4_SCHEMA_VERSION}.`
      });
    }
    if (metadata.units !== "mm") {
      issues.push({ code: "SVG_METADATA_UNITS_INVALID", severity: "ERROR", message: "SVG metadata units must be mm." });
    }
    if (metadata.referenceOnly !== true || metadata.productionCertified !== false) {
      issues.push({
        code: "SVG_METADATA_STATUS_INVALID",
        severity: "ERROR",
        message: "SVG metadata must remain reference-only and not production certified."
      });
    }
    if (!Array.isArray(metadata.panels) || metadata.panels.length === 0) {
      issues.push({ code: "SVG_V4_PANELS_MISSING", severity: "ERROR", message: "SVG v4 metadata must contain panel declarations." });
    }
    if (!metadata.folding || !Array.isArray(metadata.folding.foldGraph)) {
      issues.push({ code: "SVG_V4_FOLD_GRAPH_MISSING", severity: "ERROR", message: "SVG v4 metadata must contain folding foldGraph." });
    }
    if (!metadata.assembly || !Array.isArray(metadata.assembly.actions)) {
      issues.push({ code: "SVG_V4_ASSEMBLY_MISSING", severity: "ERROR", message: "SVG v4 metadata must contain assembly actions." });
    }

    const canvas = metadata.canvas;
    const canvasValid =
      canvas &&
      typeof canvas === "object" &&
      [canvas.widthMm, canvas.heightMm, canvas.referenceWidthMm, canvas.referenceHeightMm].every(
        (val) => Number.isFinite(val) && val > 0
      ) &&
      Array.isArray(canvas.viewBox) &&
      canvas.viewBox.length === 4 &&
      canvas.viewBox.every(Number.isFinite) &&
      canvas.viewBox[2] > 0 &&
      canvas.viewBox[3] > 0;

    if (!canvasValid) {
      issues.push({ code: "SVG_CANVAS_METADATA_INVALID", severity: "ERROR", message: "SVG canvas metadata is incomplete or invalid." });
    }
  }

  // 4. Engineering transform forbidden
  if (/\stransform\s*=/.test(markup)) {
    issues.push({
      code: "SVG_V4_ENGINEERING_TRANSFORM_FORBIDDEN",
      severity: "ERROR",
      message: "SVG v4 geometry must not contain engineering transform attributes."
    });
  }

  return {
    valid: issues.length === 0,
    metadata,
    issues
  };
}
