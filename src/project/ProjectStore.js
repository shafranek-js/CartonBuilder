import { getDatabase, PROJECTS_STORE } from './db.js';

const CURRENT_PROJECT_ID = 'current';
let memoryProject = null;

export async function saveCurrentProject({ snapshot, artworkBlobs, renderAssets = [], technicalAssets = null }) {
  const record = {
    snapshot,
    artworkBlobs: artworkBlobs || [],
    renderAssets: renderAssets || [],
    technicalAssets: technicalAssets || null,
  };
  if (typeof indexedDB === 'undefined') {
    memoryProject = record;
    return;
  }
  const database = await getDatabase();
  await database.put(PROJECTS_STORE, record, CURRENT_PROJECT_ID);
  memoryProject = record;
}

export async function loadCurrentProject() {
  if (typeof indexedDB === 'undefined') return memoryProject;
  const database = await getDatabase();
  return (await database.get(PROJECTS_STORE, CURRENT_PROJECT_ID)) || null;
}

export async function clearCurrentProject() {
  memoryProject = null;
  if (typeof indexedDB === 'undefined') return;
  const database = await getDatabase();
  await database.delete(PROJECTS_STORE, CURRENT_PROJECT_ID);
}
