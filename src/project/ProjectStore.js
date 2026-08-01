import { getDatabase, PROJECTS_STORE } from './db.js';

const CURRENT_PROJECT_ID = 'current';

export async function saveCurrentProject({ snapshot, artworkBlobs }) {
  const database = await getDatabase();
  await database.put(PROJECTS_STORE, {
    snapshot,
    artworkBlobs: artworkBlobs || [],
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
