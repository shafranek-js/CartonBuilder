import { getDatabase, PROJECTS_STORE, resetDatabase } from './db.js';

const CURRENT_PROJECT_ID = 'current';
let memoryProject = null;

function isRetryableDatabaseError(error) {
  return ['AbortError', 'InvalidStateError', 'NotFoundError', 'TransactionInactiveError']
    .includes(error?.name);
}

async function putCurrentProject(record) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const database = await getDatabase();
      await database.put(PROJECTS_STORE, record, CURRENT_PROJECT_ID);
      return;
    } catch (error) {
      if (attempt === 1 || !isRetryableDatabaseError(error)) throw error;
      resetDatabase();
    }
  }
}

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
  await putCurrentProject(record);
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
