import { getDatabase, PROJECTS_STORE } from './db.js';

const CURRENT_PROJECT_ID = 'current';

export async function saveCurrentProject({ snapshot, originalBlob, previewBlob }) {
  const database = await getDatabase();
  await database.put(PROJECTS_STORE, {
    snapshot,
    originalBlob: originalBlob || null,
    previewBlob: previewBlob || null,
  }, CURRENT_PROJECT_ID);
}

export async function loadCurrentProject() {
  const database = await getDatabase();
  return database.get(PROJECTS_STORE, CURRENT_PROJECT_ID);
}

export async function clearCurrentProject() {
  const database = await getDatabase();
  await database.delete(PROJECTS_STORE, CURRENT_PROJECT_ID);
}
