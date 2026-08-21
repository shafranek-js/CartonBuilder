const ALLOWED_EXACT_REFERENCE_URLS = [
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/1999/xhtml",
];
const ALLOWED_REFERENCE_PREFIXES = [
  "https://json-schema.org/",
  "https://cartonbuilder.dev/schemas/",
];

function decodeUrlEntities(value) {
  return value
    .replace(/&colon;|&#0*58;|&#x0*3a;/gi, ":")
    .replace(/&sol;|&#0*47;|&#x0*2f;/gi, "/");
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function stripComments(text) {
  let result = "";
  let i = 0;
  const n = text.length;

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inBlockComment = false;
  let inLineComment = false;
  let inHtmlComment = false;
  let lineStartPos = 0;

  while (i < n) {
    if (text[i] === "\n") {
      lineStartPos = i + 1;
      // Single and double quotes cannot span across unescaped newlines
      if (inSingleQuote && (i === 0 || text[i - 1] !== "\\")) inSingleQuote = false;
      if (inDoubleQuote && (i === 0 || text[i - 1] !== "\\")) inDoubleQuote = false;
    }

    if (inHtmlComment) {
      if (text.startsWith("-->", i)) {
        inHtmlComment = false;
        i += 3;
        result += "   ";
      } else {
        result += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    if (inBlockComment) {
      if (text.startsWith("*/", i)) {
        inBlockComment = false;
        i += 2;
        result += "  ";
      } else {
        result += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    if (inLineComment) {
      if (text[i] === "\n" || text[i] === "\r") {
        inLineComment = false;
        result += text[i];
      } else {
        result += " ";
      }
      i++;
      continue;
    }

    if (inSingleQuote) {
      if (text[i] === "\\" && i + 1 < n) {
        result += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (text[i] === "'") inSingleQuote = false;
      result += text[i];
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (text[i] === "\\" && i + 1 < n) {
        result += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (text[i] === '"') inDoubleQuote = false;
      result += text[i];
      i++;
      continue;
    }

    // Inside backtick template literals (e.g. GLSL shaders in Three.js)
    if (inBacktick) {
      if (text[i] === "\\" && i + 1 < n) {
        result += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (text[i] === "`") {
        inBacktick = false;
        result += "`";
        i++;
        continue;
      }
      if (text.startsWith("/*", i)) {
        inBlockComment = true;
        i += 2;
        result += "  ";
        continue;
      }
      if (text.startsWith("//", i)) {
        const linePrefix = text.slice(lineStartPos, i);
        if (/^\s*$/.test(linePrefix)) {
          inLineComment = true;
          i += 2;
          result += "  ";
          continue;
        }
      }
      result += text[i];
      i++;
      continue;
    }

    // Outside quotes and comments:
    if (text.startsWith("<!--", i)) {
      inHtmlComment = true;
      i += 4;
      result += "    ";
      continue;
    }
    if (text.startsWith("/*", i)) {
      inBlockComment = true;
      i += 2;
      result += "  ";
      continue;
    }
    if (text.startsWith("//", i)) {
      const linePrefix = text.slice(lineStartPos, i);
      if (linePrefix.endsWith(":") || /url\s*\(\s*$/i.test(linePrefix)) {
        result += text[i];
        i++;
        continue;
      }
      inLineComment = true;
      i += 2;
      result += "  ";
      continue;
    }
    if (text[i] === "'") {
      inSingleQuote = true;
      result += "'";
      i++;
      continue;
    }
    if (text[i] === '"') {
      inDoubleQuote = true;
      result += '"';
      i++;
      continue;
    }
    if (text[i] === "`") {
      inBacktick = true;
      result += "`";
      i++;
      continue;
    }

    result += text[i];
    i++;
  }

  return result;
}

export function findForbiddenNetworkReferences(text) {
  const original = String(text);
  const stripped = stripComments(original);
  const normalized = decodeUrlEntities(stripped);
  const matches = [];
  const patterns = [
    /\b(?:https?|wss?):\/\/[^\s"'<>\`\\)]+/gi,
    /(?<![:\w/])\/\/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?::[0-9]+)?(?:[/?#][^\s"'<>\`]*)?/g,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const reference = match[0].replace(/[),.;]+$/, "");
      if (
        ALLOWED_EXACT_REFERENCE_URLS.includes(reference) ||
        ALLOWED_REFERENCE_PREFIXES.some((allowed) => reference.startsWith(allowed))
      ) {
        continue;
      }
      matches.push({ reference, line: lineNumberAt(original, match.index ?? 0) });
    }
  }

  return matches.filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.reference === item.reference && candidate.line === item.line) === index
  );
}
