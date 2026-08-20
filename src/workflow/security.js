/**
 * Strict XML and SVG security preflight scanner with true XML parsing and element/attribute allowlisting.
 */

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "text",
  "tspan",
  "defs",
  "mask",
  "clippath",
  "pattern",
  "metadata",
  "title",
  "desc",
  "style",
  "lineargradient",
  "radialgradient",
  "stop",
  "use",
]);

/**
 * Fully decode all XML named and numeric entities (decimal and hexadecimal).
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeXmlEntities(text) {
  if (typeof text !== "string") return "";
  let current = text;
  for (let round = 0; round < 5; round++) {
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
 * Check style text for dangerous expressions or non-fragment URLs.
 *
 * @param {string} rawStyle
 * @param {string} location
 * @param {Array<{ code: string, severity: string, message: string }>} issues
 */
function inspectStyleContent(rawStyle, location, issues) {
  const decoded = decodeXmlEntities(rawStyle);

  if (/@import\b/i.test(decoded)) {
    issues.push({
      code: "SVG_SECURITY_STYLE_IMPORT_FORBIDDEN",
      severity: "ERROR",
      message: `Forbidden @import found in ${location}.`,
    });
  }

  if (/expression\s*\(|-moz-binding|behavior\s*:/i.test(decoded)) {
    issues.push({
      code: "SVG_SECURITY_DANGEROUS_STYLE_FORBIDDEN",
      severity: "ERROR",
      message: `Forbidden dynamic CSS expression found in ${location}.`,
    });
  }

  // Extract all url(...) references
  const urlRegex = /url\s*\(\s*(?:["']([^"']+)["']|([^'")]+))\s*\)/gi;
  let match;
  while ((match = urlRegex.exec(decoded)) !== null) {
    const rawTarget = match[1] ?? match[2] ?? "";
    const target = rawTarget.trim();

    // In SVG v4, url references must only be local fragment identifiers (e.g. url(#mask-1))
    if (!target.startsWith("#") || /^(?:https?|file|ftp|data|blob|javascript):/i.test(target) || /^\/\//.test(target)) {
      issues.push({
        code: "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN",
        severity: "ERROR",
        message: `Forbidden external URL reference "${target}" in ${location}.`,
      });
    }
  }
}

/**
 * Recursive descent lightweight XML parser and structural validator.
 */
function parseAndInspectXml(markup, issues) {
  let pos = 0;
  const len = markup.length;
  const tagStack = [];

  while (pos < len) {
    const nextOpen = markup.indexOf("<", pos);
    if (nextOpen === -1) break;

    // Skip comments <!-- ... -->
    if (markup.startsWith("<!--", nextOpen)) {
      const closeComment = markup.indexOf("-->", nextOpen + 4);
      if (closeComment === -1) {
        issues.push({ code: "SVG_XML_SYNTAX_ERROR", severity: "ERROR", message: "Unclosed XML comment." });
        return;
      }
      pos = closeComment + 3;
      continue;
    }

    // Skip CDATA <![CDATA[ ... ]]>
    if (markup.startsWith("<![CDATA[", nextOpen)) {
      const closeCdata = markup.indexOf("]]>", nextOpen + 9);
      if (closeCdata === -1) {
        issues.push({ code: "SVG_XML_SYNTAX_ERROR", severity: "ERROR", message: "Unclosed CDATA section." });
        return;
      }
      pos = closeCdata + 3;
      continue;
    }

    // Find closing >
    let inQuote = false;
    let quoteChar = "";
    let closeIndex = -1;

    for (let i = nextOpen + 1; i < len; i++) {
      const char = markup[i];
      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuote) {
        inQuote = false;
      } else if (char === ">" && !inQuote) {
        closeIndex = i;
        break;
      }
    }

    if (closeIndex === -1) {
      issues.push({ code: "SVG_XML_SYNTAX_ERROR", severity: "ERROR", message: "Malformed XML: unclosed tag." });
      return;
    }

    const tagContent = markup.slice(nextOpen + 1, closeIndex).trim();
    pos = closeIndex + 1;

    // Closing tag: </tag>
    if (tagContent.startsWith("/")) {
      const closingTagName = tagContent.slice(1).trim().toLowerCase();
      if (tagStack.length === 0 || tagStack[tagStack.length - 1] !== closingTagName) {
        issues.push({
          code: "SVG_XML_SYNTAX_ERROR",
          severity: "ERROR",
          message: `Mismatched closing tag "</${closingTagName}>".`,
        });
        return;
      }
      tagStack.pop();
      continue;
    }

    const isSelfClosing = tagContent.endsWith("/");
    const cleanContent = isSelfClosing ? tagContent.slice(0, -1).trim() : tagContent;

    const spaceIdx = cleanContent.search(/\s/);
    const tagName = (spaceIdx === -1 ? cleanContent : cleanContent.slice(0, spaceIdx)).toLowerCase();
    const attrString = spaceIdx === -1 ? "" : cleanContent.slice(spaceIdx).trim();

    // Check tag against allowlist
    if (!ALLOWED_ELEMENTS.has(tagName)) {
      issues.push({
        code: "SVG_SECURITY_ELEMENT_FORBIDDEN",
        severity: "ERROR",
        message: `Forbidden element <${tagName}> in SVG.`,
      });
    }

    if (!isSelfClosing) {
      tagStack.push(tagName);
    }

    // Parse attributes
    const attrRegex = /([a-zA-Z0-9:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const rawValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
      const decodedVal = decodeXmlEntities(rawValue);
      const cleanVal = decodedVal.replace(/[\u0000-\u001F\u007F-\u009F\s]/g, "");

      // Event handlers
      if (/^on[a-z]+/i.test(attrName)) {
        issues.push({
          code: "SVG_SECURITY_EVENT_HANDLER_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden inline event handler "${attrName}" on <${tagName}>.`,
        });
      }

      // JavaScript / data / file URI schemes
      if (/^javascript:/i.test(cleanVal) || /javascript:/i.test(cleanVal)) {
        issues.push({
          code: "SVG_SECURITY_JAVASCRIPT_URI_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden "javascript:" URI in attribute "${attrName}" on <${tagName}>.`,
        });
      }

      if (/^(?:data|file|vbscript|blob):/i.test(cleanVal)) {
        issues.push({
          code: "SVG_SECURITY_DANGEROUS_URI_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden URI scheme "${cleanVal}" in attribute "${attrName}" on <${tagName}>.`,
        });
      }

      // Fragment-only policy for href/xlink:href/src
      if (attrName === "href" || attrName === "xlink:href" || attrName === "src") {
        if (!cleanVal.startsWith("#")) {
          issues.push({
            code: "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN",
            severity: "ERROR",
            message: `Forbidden non-fragment URL "${decodedVal}" in attribute "${attrName}".`,
          });
        }
      }

      // Style attribute inspection
      if (attrName === "style") {
        inspectStyleContent(rawValue, `style attribute on <${tagName}>`, issues);
      }
    }
  }

  if (tagStack.length > 0) {
    issues.push({
      code: "SVG_XML_SYNTAX_ERROR",
      severity: "ERROR",
      message: `Unclosed tags remaining in XML: ${tagStack.join(", ")}.`,
    });
  }
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

  // 1. Rejection of <!DOCTYPE (XXE prevention)
  if (/<!DOCTYPE\b/i.test(markup)) {
    issues.push({
      code: "SVG_SECURITY_DOCTYPE_FORBIDDEN",
      severity: "ERROR",
      message: "Forbidden <!DOCTYPE declaration in SVG.",
    });
  }

  // 2. Rejection of processing instructions
  if (/<\?[\s\S]*?\?>/i.test(markup)) {
    const piMatch = markup.match(/<\?([a-zA-Z0-9_-]+)/);
    const piName = piMatch ? piMatch[1].toLowerCase() : "";
    if (piName !== "xml") {
      issues.push({
        code: "SVG_SECURITY_PROCESSING_INSTRUCTION_FORBIDDEN",
        severity: "ERROR",
        message: `Forbidden processing instruction "<?${piName}" found in SVG.`,
      });
    }
  }

  // 3. Inspect style elements
  const styleBlockRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleBlockRegex.exec(markup)) !== null) {
    inspectStyleContent(styleMatch[1], "<style> block", issues);
  }

  // 4. Parse and inspect full XML tree
  parseAndInspectXml(markup, issues);

  return issues;
}
