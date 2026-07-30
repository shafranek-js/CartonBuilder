export const MAX_ARTWORK_BYTES = 100 * 1024 * 1024;

const SUPPORTED_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
});

function hasBytes(bytes, expected, offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function detectArtworkType(bytes) {
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (hasBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf';
  }
  return null;
}

export async function validateArtworkFile(file) {
  if (!(file instanceof Blob)) throw new Error('Choose an artwork file.');
  if (file.size === 0) throw new Error('The artwork file is empty.');
  if (file.size > MAX_ARTWORK_BYTES) throw new Error('Artwork files are limited to 100 MB.');

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detectedType = detectArtworkType(header);
  if (!detectedType || !SUPPORTED_TYPES[detectedType]) {
    throw new Error('Use a PNG, JPG/JPEG or PDF file.');
  }
  if (file.type && file.type !== detectedType && !(file.type === 'image/jpg' && detectedType === 'image/jpeg')) {
    throw new Error('The file content does not match its declared type.');
  }
  return {
    mimeType: detectedType,
    extension: SUPPORTED_TYPES[detectedType],
  };
}

export async function sha256(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
