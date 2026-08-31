/**
 * Cryptographic and UTF-8 utilities using standard Web Crypto API.
 */

/**
 * Compute SHA-256 hex string asynchronously using standard Web Crypto API.
 *
 * @param {string | Uint8Array} input
 * @returns {Promise<string>}
 */
export async function sha256Async(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error("Web Crypto API (crypto.subtle.digest) is required for SHA-256 verification.");
  }
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Calculate the exact UTF-8 byte length of a string.
 *
 * @param {string} text
 * @returns {number}
 */
export function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}
