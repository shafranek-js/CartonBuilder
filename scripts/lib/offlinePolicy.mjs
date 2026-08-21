const ALLOWED_EXACT_REFERENCE_URLS = [
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
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

function stripComments(text) {
  // Replace HTML comments
  let cleaned = text.replace(/<!--[\s\S]*?-->/g, (match) => " ".repeat(match.length));
  // Replace block comments /* ... */
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, (match) => " ".repeat(match.length));
  // Replace single-line comments // ... when // is not preceded by :
  cleaned = cleaned.replace(/(^|[^:])\/\/[^\r\n]*/g, (match, prefix) => prefix + " ".repeat(match.length - prefix.length));
  return cleaned;
}

export function findForbiddenNetworkReferences(text) {
  const original = decodeUrlEntities(String(text));
  const stripped = stripComments(original);
  const matches = [];
  const patterns = [
    /\b(?:https?|wss?):\/\/[^\s"'<>\`\\)]+/gi,
    /(?<![:\w])\/\/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?::[0-9]+)?(?:[/?#][^\s"'<>\`]*)?/g,
  ];

  for (const pattern of patterns) {
    for (const match of stripped.matchAll(pattern)) {
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
