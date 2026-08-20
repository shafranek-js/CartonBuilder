/**
 * Deterministic JSON stringification for canonical hashing.
 * Sorts all object keys recursively and outputs compact JSON without whitespace.
 * Omit keys with undefined, function, or symbol values, identical to standard JSON.stringify.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined || typeof item === "function" || typeof item === "symbol" ? null : canonicalizeJson(item)));
    return `[${items.join(",")}]`;
  }

  const validKeys = Object.keys(value)
    .filter((key) => value[key] !== undefined && typeof value[key] !== "function" && typeof value[key] !== "symbol")
    .sort();

  const pairs = validKeys.map((key) => {
    const serializedVal = canonicalizeJson(value[key]);
    return `${JSON.stringify(key)}:${serializedVal}`;
  });

  return `{${pairs.join(",")}}`;
}
