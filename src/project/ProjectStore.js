import { openDB } from 'idb';

const DATABASE_NAME = 'carton-builder';
const DATABASE_VERSION = 1;
const STORE_NAME = 'projects';
const CURRENT_PROJECT_ID = 'current';

async function getDatabase() {
  return openDB(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    },
  });
}

export async function saveCurrentProject({ snapshot, originalBlob, previewBlob }) {
  const database = await getDatabase();
  await database.put(STORE_NAME, {
    snapshot,
    originalBlob: originalBlob || null,
    previewBlob: previewBlob || null,
  }, CURRENT_PROJECT_ID);
}

export async function loadCurrentProject() {
  const database = await getDatabase();
  return database.get(STORE_NAME, CURRENT_PROJECT_ID);
}

export async function clearCurrentProject() {
  const database = await getDatabase();
  await database.delete(STORE_NAME, CURRENT_PROJECT_ID);
}
