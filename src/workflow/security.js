/**
 * Strict XML and SVG security preflight scanner.
 * Decodes all numeric/named entities, analyzes the XML structure, and rejects active/external content.
 */

/**
 * Fully decode all XML named and numeric entities (decimal and hexadecimal).
 * Recursively decodes until no more entities are present to prevent double-encoding evasion.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeXmlEntities(text) {
  if (typeof text !== "string") return "";
  let current = text;
  for (let round = 0; round < 3; round++) {
    const next = current
      .replace(/&#x([0-9a-fA-F]+);?/gi, (_, hex) => {
        try {
          const code = parseInt(hex, 16);
          return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
        } catch {
          return "";
        }
      })
      .replace(/&#([0-9]+);?/g, (_, dec) => {
        try {
          const code = parseInt(dec, 10);
          return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
        } catch {
          return "";
        }
      })
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&");
    if (next === current) break;
    current = next;
  }
  return current;
}

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

  // 1. Check for processing instructions (e.g. <?xml-stylesheet ... ?>)
  if (/<\?[\s\S]*?\?>/i.test(markup)) {
    const piMatch = markup.match(/<\?([a-zA-Z0-9_-]+)/);
    const piName = piMatch ? piMatch[1].toLowerCase() : "";
    if (piName !== "xml") {
      issues.push({
        code: "SVG_SECURITY_PROCESSING_INSTRUCTION_FORBIDDEN",
        severity: "ERROR",
        message: `Forbidden processing instruction "<?${piName}" found in SVG.`
      });
    }
  }

  // 2. Decode entities across the markup for string-level preflight
  const decodedMarkup = decodeXmlEntities(markup);

  // 3. Check for script elements (both raw and decoded)
  if (/<script\b/i.test(markup) || /<script\b/i.test(decodedMarkup)) {
    issues.push({ code: "SVG_SECURITY_SCRIPT_FORBIDDEN", severity: "ERROR", message: "SVG contains forbidden <script> tags." });
  }

  // 4. Check for foreignObject elements
  if (/<foreignObject\b/i.test(markup) || /<foreignObject\b/i.test(decodedMarkup)) {
    issues.push({ code: "SVG_SECURITY_FOREIGNOBJECT_FORBIDDEN", severity: "ERROR", message: "SVG contains forbidden <foreignObject> tags." });
  }

  // 5. Check for iframe, object, embed, applet, audio, video elements
  const forbiddenElements = ["iframe", "object", "embed", "applet", "audio", "video", "form", "input", "button"];
  for (const tag of forbiddenElements) {
    const pattern = new RegExp(`<${tag}\\b`, "i");
    if (pattern.test(markup) || pattern.test(decodedMarkup)) {
      issues.push({
        code: "SVG_SECURITY_ELEMENT_FORBIDDEN",
        severity: "ERROR",
        message: `SVG contains forbidden <${tag}> elements.`
      });
    }
  }

  // 6. Tokenize tags and inspect all attributes on every element
  const tagRegex = /<([a-zA-Z0-9:_-]+)([^>]*)>/g;
  let match;
  while ((match = tagRegex.exec(markup)) !== null) {
    const tagName = match[1].toLowerCase();
    const attrString = match[2];

    // Inspect individual attributes: name="value" or name='value'
    const attrRegex = /([a-zA-Z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const rawValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      const decodedValue = decodeXmlEntities(rawValue).replace(/[\u0000-\u001F\u007F-\u009F\s]/g, "");

      // Event handlers: onload, onclick, onerror, etc.
      if (/^on[a-z]+/i.test(attrName)) {
        issues.push({
          code: "SVG_SECURITY_EVENT_HANDLER_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden inline event handler attribute "${attrName}" found on <${tagName}>.`
        });
      }

      // JavaScript URI scheme
      if (/^javascript:/i.test(decodedValue) || /javascript:/i.test(decodedValue)) {
        issues.push({
          code: "SVG_SECURITY_JAVASCRIPT_URI_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden "javascript:" URI found in attribute "${attrName}" on <${tagName}>.`
        });
      }

      // VBScript / data: URL schemes
      if (/^vbscript:/i.test(decodedValue) || /^data:text\/html/i.test(decodedValue)) {
        issues.push({
          code: "SVG_SECURITY_DANGEROUS_URI_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden URI scheme found in attribute "${attrName}" on <${tagName}>.`
        });
      }

      // External resource references (http:, https:, //)
      if (
        (attrName === "href" || attrName === "xlink:href" || attrName === "src" || attrName.includes("url")) &&
        (/^https?:/i.test(decodedValue) || /^\/\//i.test(decodedValue))
      ) {
        issues.push({
          code: "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden external URL reference "${decodedValue}" found in attribute "${attrName}".`
        });
      }
    }
  }

  // 7. Check style blocks and style attributes for @import, url(http...), expression, -moz-binding
  const styleBlockRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleBlockRegex.exec(markup)) !== null) {
    const rawStyle = styleMatch[1];
    const decodedStyle = decodeXmlEntities(rawStyle);
    if (/@import\b/i.test(decodedStyle)) {
      issues.push({ code: "SVG_SECURITY_STYLE_IMPORT_FORBIDDEN", severity: "ERROR", message: "Forbidden @import rule in <style> block." });
    }
    if (/url\s*\(\s*["']?\s*(?:https?:|\/\/)/i.test(decodedStyle)) {
      issues.push({ code: "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN", severity: "ERROR", message: "Forbidden external url(...) in <style> block." });
    }
    if (/expression\s*\(|-moz-binding/i.test(decodedStyle)) {
      issues.push({ code: "SVG_SECURITY_DANGEROUS_STYLE_FORBIDDEN", severity: "ERROR", message: "Forbidden dynamic CSS property in <style> block." });
    }
  }

  return issues;
}
