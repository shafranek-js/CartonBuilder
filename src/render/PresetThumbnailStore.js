import { getDatabase, PRESET_THUMBNAILS_STORE } from '../project/db.js';

function clone(value) {
  return structuredClone(value);
}

export async function getPresetThumbnail(id) {
  if (!id) return null;
  try {
    const database = await getDatabase();
    return (await database.get(PRESET_THUMBNAILS_STORE, id)) || null;
  } catch {
    return null;
  }
}

export async function savePresetThumbnail({ id, presetId, kind = 'render', blob, dataUrl = '' } = {}) {
  if (!id || !presetId) return null;
  const entry = { id, presetId, kind, blob: blob instanceof Blob ? blob : null, dataUrl: String(dataUrl || ''), updatedAt: new Date().toISOString() };
  try {
    const database = await getDatabase();
    await database.put(PRESET_THUMBNAILS_STORE, entry);
  } catch {
    return clone(entry);
  }
  return clone(entry);
}

export async function deletePresetThumbnail(id) {
  if (!id) return;
  try {
    const database = await getDatabase();
    await database.delete(PRESET_THUMBNAILS_STORE, id);
  } catch {
    // Optional cache.
  }
}

