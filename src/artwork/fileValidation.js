import { AppError } from '../errors.js';

export const MAX_ARTWORK_BYTES = 100 * 1024 * 1024;

const SUPPORTED_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
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
  if (hasBytes(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return 'image/gif';
  }
  if (hasBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return 'video/webm';
  }
  if (hasBytes(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    return 'video/mp4';
  }
  return null;
}

export async function validateArtworkFile(file) {
  if (!(file instanceof Blob)) throw new AppError('artworkFileRequired');
  if (file.size === 0) throw new AppError('artworkFileEmpty');
  if (file.size > MAX_ARTWORK_BYTES) throw new AppError('artworkFileTooLarge');

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detectedType = detectArtworkType(header);
  if (!detectedType || !SUPPORTED_TYPES[detectedType]) {
    throw new AppError('artworkFileUnsupported');
  }
  const isMediaAlias = (
    (detectedType === 'application/pdf' && (file.type === 'application/octet-stream' || file.type === 'application/postscript'))
    || (detectedType === 'video/mp4' && (file.type === 'video/quicktime' || file.type === 'application/octet-stream'))
    || (detectedType === 'video/webm' && file.type === 'application/octet-stream')
  );
  if (
    file.type
    && file.type !== detectedType
    && !(file.type === 'image/jpg' && detectedType === 'image/jpeg')
    && !isMediaAlias
  ) {
    throw new AppError('artworkFileTypeMismatch');
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
