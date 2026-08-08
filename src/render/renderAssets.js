import { AppError } from '../errors.js';
import { sha256 } from '../artwork/fileValidation.js';
import {
  detectRenderEnvironmentType,
  MAX_RENDER_ENVIRONMENT_BYTES,
  normalizeRenderEnvironmentAsset,
  RENDER_ENVIRONMENT_TYPES,
} from './environmentAssets.js';

export const MAX_RENDER_BACKGROUND_BYTES = 25 * 1024 * 1024;
export const MAX_RENDER_BACKGROUND_PIXELS = 50 * 1000 * 1000;
export const RENDER_BACKGROUND_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
});

function hasBytes(bytes, expected, offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function detectRenderBackgroundType(bytes) {
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

function normalizeFileName(fileName, extension) {
  const base = String(fileName || 'background')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 200) || 'background';
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}

export async function validateRenderBackground(file, {
  createImageBitmapFn = globalThis.createImageBitmap,
} = {}) {
  if (!(file instanceof Blob)) throw new AppError('renderBackgroundRequired');
  if (file.size === 0) throw new AppError('renderBackgroundEmpty');
  if (file.size > MAX_RENDER_BACKGROUND_BYTES) throw new AppError('renderBackgroundTooLarge');

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mimeType = detectRenderBackgroundType(header);
  if (!mimeType || !RENDER_BACKGROUND_TYPES[mimeType]) {
    throw new AppError('renderBackgroundUnsupported');
  }
  if (file.type && file.type !== mimeType && !(file.type === 'image/jpg' && mimeType === 'image/jpeg')) {
    throw new AppError('renderBackgroundTypeMismatch');
  }

  let width = 0;
  let height = 0;
  let bitmap = null;
  if (typeof createImageBitmapFn === 'function') {
    try {
      bitmap = await createImageBitmapFn(file);
      width = Number(bitmap.width) || 0;
      height = Number(bitmap.height) || 0;
      if (width && height && width * height > MAX_RENDER_BACKGROUND_PIXELS) {
        throw new AppError('renderBackgroundDimensionsTooLarge');
      }
    } finally {
      bitmap?.close?.();
    }
  }

  const checksum = await sha256(file);
  const extension = RENDER_BACKGROUND_TYPES[mimeType];
  return {
    assetId: checksum,
    sha256: checksum,
    fileName: normalizeFileName(file.name, extension),
    mimeType,
    width,
    height,
    blob: new Blob([file], { type: mimeType }),
  };
}

export function normalizeRenderAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  if (asset.kind === 'environment' || RENDER_ENVIRONMENT_TYPES[asset.mimeType]) {
    return normalizeRenderEnvironmentAsset(asset);
  }
  const mimeType = RENDER_BACKGROUND_TYPES[asset.mimeType] ? asset.mimeType : '';
  const assetId = String(asset.assetId || asset.sha256 || '').trim().slice(0, 128);
  if (!assetId || !mimeType || !(asset.blob instanceof Blob)) return null;
  return {
    assetId,
    sha256: String(asset.sha256 || asset.assetId || assetId),
    fileName: normalizeFileName(asset.fileName, RENDER_BACKGROUND_TYPES[mimeType]),
    mimeType,
    width: Math.max(0, Math.round(Number(asset.width) || 0)),
    height: Math.max(0, Math.round(Number(asset.height) || 0)),
    blob: new Blob([asset.blob], { type: mimeType }),
  };
}

export async function validateRenderAssets(assets = []) {
  if (!Array.isArray(assets)) throw new AppError('projectRenderAssetInvalid');
  const normalized = [];
  const seen = new Set();
  for (const asset of assets) {
    const entry = normalizeRenderAsset(asset);
    if (!entry) throw new AppError('projectRenderAssetInvalid');
    if (!/^[a-f0-9]{64}$/i.test(entry.assetId) || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
      throw new AppError('projectRenderAssetInvalid');
    }
    const detectedType = entry.kind === 'environment'
      ? detectRenderEnvironmentType(
        new Uint8Array(await entry.blob.slice(0, 64 * 1024).arrayBuffer()),
      )
      : detectRenderBackgroundType(
      new Uint8Array(await entry.blob.slice(0, 16).arrayBuffer()),
      );
    if (detectedType !== entry.mimeType) throw new AppError('projectRenderAssetInvalid');
    if (seen.has(entry.assetId)) continue;
    if (entry.kind === 'environment' && entry.blob.size > MAX_RENDER_ENVIRONMENT_BYTES) {
      throw new AppError('renderEnvironmentTooLarge');
    }
    if (entry.kind !== 'environment' && entry.blob.size > MAX_RENDER_BACKGROUND_BYTES) {
      throw new AppError('renderBackgroundTooLarge');
    }
    if (entry.sha256 !== await sha256(entry.blob)) {
      throw new AppError('projectRenderAssetChecksumMismatch');
    }
    seen.add(entry.assetId);
    normalized.push(entry);
  }
  return normalized;
}
