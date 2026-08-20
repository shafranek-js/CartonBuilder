/**
 * Strict XML and SVG security preflight scanner using standard DOMParser / @xmldom/xmldom.
 */

import { DOMParser as XmldomParser } from "@xmldom/xmldom";

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

function findNamespaceUri(elem, prefix) {
  let curr = elem;
  const xmlnsAttr = `xmlns:${prefix}`;
  while (curr && curr.nodeType === 1) {
    if (curr.hasAttribute && curr.hasAttribute(xmlnsAttr)) {
      return curr.getAttribute(xmlnsAttr);
    }
    if (curr.attributes) {
      for (let i = 0; i < curr.attributes.length; i++) {
        if ((curr.attributes[i].name || "").toLowerCase() === xmlnsAttr.toLowerCase()) {
          return curr.attributes[i].value;
        }
      }
    }
    curr = curr.parentNode;
  }
  return null;
}

/**
 * Recursively inspect an XML DOM Element and its subtree against the security allowlist.
 */
function inspectElement(elem, issues) {
  if (!elem || elem.nodeType !== 1) return;

  const rawTagName = elem.tagName || elem.nodeName || "";
  const tagName = rawTagName.toLowerCase();

  // Namespace check for element prefix
  if (rawTagName.includes(":")) {
    const prefix = rawTagName.split(":")[0].toLowerCase();
    if (prefix !== "xml" && prefix !== "xmlns" && !findNamespaceUri(elem, prefix)) {
      issues.push({
        code: "SVG_XML_SYNTAX_ERROR",
        severity: "ERROR",
        message: `Undeclared XML namespace prefix "${prefix}" on element <${rawTagName}>.`,
      });
    }
  }

  // Strip prefix if any (e.g. svg:rect -> rect)
  const localName = (elem.localName || tagName.split(":").pop() || "").toLowerCase();

  if (!ALLOWED_ELEMENTS.has(localName)) {
    issues.push({
      code: "SVG_SECURITY_ELEMENT_FORBIDDEN",
      severity: "ERROR",
      message: `Forbidden element <${rawTagName}> in SVG.`,
    });
  }

  // Inspect all attributes
  if (elem.attributes) {
    for (let i = 0; i < elem.attributes.length; i++) {
      const attr = elem.attributes[i];
      const attrName = (attr.name || attr.nodeName || "").toLowerCase();
      const rawValue = attr.value ?? attr.nodeValue ?? "";
      const decodedVal = decodeXmlEntities(rawValue);
      const cleanVal = decodedVal.replace(/[\u0000-\u001F\u007F-\u009F\s]/g, "");

      // Namespace check for attribute prefix
      if (attrName.includes(":")) {
        const prefix = attrName.split(":")[0].toLowerCase();
        if (prefix !== "xml" && prefix !== "xmlns" && !findNamespaceUri(elem, prefix)) {
          issues.push({
            code: "SVG_XML_SYNTAX_ERROR",
            severity: "ERROR",
            message: `Undeclared XML namespace prefix "${prefix}" in attribute "${attrName}".`,
          });
        }
      }

      // Event handlers: onload, onclick, onerror, etc.
      if (/^on[a-z]+/i.test(attrName)) {
        issues.push({
          code: "SVG_SECURITY_EVENT_HANDLER_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden inline event handler "${attrName}" on <${rawTagName}>.`,
        });
      }

      // JavaScript / dangerous URI schemes
      if (/^javascript:/i.test(cleanVal) || /javascript:/i.test(cleanVal)) {
        issues.push({
          code: "SVG_SECURITY_JAVASCRIPT_URI_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden "javascript:" URI in attribute "${attrName}" on <${rawTagName}>.`,
        });
      }

      if (/^(?:data|file|vbscript|blob):/i.test(cleanVal)) {
        issues.push({
          code: "SVG_SECURITY_DANGEROUS_URI_FORBIDDEN",
          severity: "ERROR",
          message: `Forbidden URI scheme in attribute "${attrName}" on <${rawTagName}>.`,
        });
      }

      // Fragment-only policy for href / xlink:href / src
      const localAttrName = attrName.split(":").pop() || "";
      if (localAttrName === "href" || localAttrName === "src") {
        if (!cleanVal.startsWith("#")) {
          issues.push({
            code: "SVG_SECURITY_EXTERNAL_LINK_FORBIDDEN",
            severity: "ERROR",
            message: `Forbidden non-fragment URL "${decodedVal}" in attribute "${attrName}".`,
          });
        }
      }

      // Style attribute inspection
      if (localAttrName === "style") {
        inspectStyleContent(rawValue, `style attribute on <${rawTagName}>`, issues);
      }
    }
  }

  // If this is a <style> element, inspect text content
  if (localName === "style") {
    const styleText = elem.textContent || elem.nodeValue || "";
    inspectStyleContent(styleText, "<style> element", issues);
  }

  // Inspect children
  if (elem.childNodes) {
    for (let i = 0; i < elem.childNodes.length; i++) {
      const child = elem.childNodes[i];
      if (child.nodeType === 1) {
        inspectElement(child, issues);
      }
    }
  }
}

/**
 * Scan SVG markup for disallowed active content or external network resources using a true XML DOM parser.
 *
 * @param {string} markup
 * @param {object} [options]
 * @param {() => void} [options.onParserCalled] Diagnostic hook to verify when parser is invoked
 * @returns {Array<{ code: string, severity: string, message: string }>}
 */
export function scanSvgSecurity(markup, options = {}) {
  const issues = [];
  if (typeof markup !== "string") {
    return [{ code: "SVG_NOT_STRING", severity: "ERROR", message: "SVG markup must be a string." }];
  }

  // 1. Rejection of <!DOCTYPE (XXE prevention) before parsing
  if (/<!DOCTYPE\b/i.test(markup)) {
    issues.push({
      code: "SVG_SECURITY_DOCTYPE_FORBIDDEN",
      severity: "ERROR",
      message: "Forbidden <!DOCTYPE declaration in SVG.",
    });
  }

  // 2. Comprehensive check of ALL processing instructions (<? ... ?>)
  const piRegex = /<\?([\s\S]*?)\?>/g;
  let piMatch;
  while ((piMatch = piRegex.exec(markup)) !== null) {
    const fullPi = piMatch[0];
    const matchIndex = piMatch.index;

    // Standard XML declaration must start with <?xml followed by whitespace or ?>
    const isXmlDecl = /^<\?xml(?:\s|[\r\n]|\?>)/i.test(fullPi);

    if (isXmlDecl) {
      // XML declaration is ONLY allowed at the very start of the document (ignoring leading whitespace / BOM)
      const prefix = markup.slice(0, matchIndex).replace(/^\uFEFF/, "").trim();
      if (prefix.length > 0) {
        issues.push({
          code: "SVG_SECURITY_PROCESSING_INSTRUCTION_FORBIDDEN",
          severity: "ERROR",
          message: "Forbidden XML declaration occurring after non-whitespace content.",
        });
      }
    } else {
      // Any other processing instruction (e.g. <?xml-stylesheet ...?>) is strictly forbidden
      const piNameMatch = fullPi.match(/^<\?([^\s>]+)/);
      const piName = piNameMatch ? piNameMatch[1] : "pi";
      issues.push({
        code: "SVG_SECURITY_PROCESSING_INSTRUCTION_FORBIDDEN",
        severity: "ERROR",
        message: `Forbidden processing instruction "<?${piName}" found in SVG.`,
      });
    }
  }

  // SHORT-CIRCUIT: Do NOT invoke DOMParser if pre-parse security violations are detected
  if (issues.length > 0) {
    return issues;
  }

  // 3. Diagnostic callback to verify parser invocation
  if (typeof options.onParserCalled === "function") {
    options.onParserCalled();
  }

  // 4. True XML parsing with standard DOMParser (browser) or @xmldom/xmldom (Node)
  const parserErrors = [];
  let doc = null;

  try {
    if (typeof globalThis.DOMParser !== "undefined" && !globalThis.__FORCE_XMLDOM__) {
      const parser = new globalThis.DOMParser();
      doc = parser.parseFromString(markup, "image/svg+xml");
      const parserErrorsInDoc = doc.getElementsByTagName("parsererror");
      if (parserErrorsInDoc && parserErrorsInDoc.length > 0) {
        parserErrors.push(parserErrorsInDoc[0].textContent || "XML parsing error");
      }
    } else {
      const parser = new XmldomParser({
        errorHandler: {
          error: (msg) => parserErrors.push(msg),
          fatalError: (msg) => parserErrors.push(msg),
          warning: (msg) => {
            if (/unclosed|mismatched|syntax|invalid|redefined/i.test(msg)) {
              parserErrors.push(msg);
            }
          },
        },
      });
      doc = parser.parseFromString(markup, "image/svg+xml");
    }
  } catch (err) {
    parserErrors.push(err.message);
  }

  if (parserErrors.length > 0) {
    issues.push({
      code: "SVG_XML_SYNTAX_ERROR",
      severity: "ERROR",
      message: `Malformed SVG XML: ${parserErrors.join("; ")}`,
    });
    return issues;
  }

  if (!doc || !doc.documentElement) {
    issues.push({
      code: "SVG_XML_SYNTAX_ERROR",
      severity: "ERROR",
      message: "Malformed SVG XML: root element missing.",
    });
    return issues;
  }

  // 5. Recursive inspection of DOM tree
  inspectElement(doc.documentElement, issues);

  return issues;
}
