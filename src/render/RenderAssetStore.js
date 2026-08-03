import { getDatabase, RENDER_ASSETS_STORE } from '../project/db.js';
import { normalizeRenderAsset, validateRenderAssets } from './renderAssets.js';

function cloneMetadata(asset) {
  if (!asset) return null;
  return {
    assetId: asset.assetId,
    sha256: asset.sha256,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
  };
}

export async function saveRenderAsset(asset) {
  const normalized = normalizeRenderAsset(asset);
  if (!normalized) return null;
  const database = await getDatabase();
  await database.put(RENDER_ASSETS_STORE, normalized);
  return cloneMetadata(normalized);
}

export async function getRenderAsset(assetId) {
  if (!assetId) return null;
  const database = await getDatabase();
  const asset = await database.get(RENDER_ASSETS_STORE, assetId);
  return normalizeRenderAsset(asset);
}

export async function getRenderAssets(assetIds = null) {
  const database = await getDatabase();
  const assets = await database.getAll(RENDER_ASSETS_STORE);
  const filtered = Array.isArray(assetIds)
    ? assets.filter((asset) => assetIds.includes(asset.assetId))
    : assets;
  return filtered.map(normalizeRenderAsset).filter(Boolean);
}

export async function validateAndSaveRenderAssets(assets = []) {
  const validated = await validateRenderAssets(assets);
  const database = await getDatabase();
  for (const asset of validated) await database.put(RENDER_ASSETS_STORE, asset);
  return validated.map(cloneMetadata);
}

export async function deleteRenderAsset(assetId) {
  if (!assetId) return;
  const database = await getDatabase();
  await database.delete(RENDER_ASSETS_STORE, assetId);
}
