import { openDB } from 'idb';

const DATABASE_NAME = 'carton-builder';
const DATABASE_VERSION = 3;

export const PROJECTS_STORE = 'projects';
export const PRESETS_STORE = 'presets';
export const SCENE_PRESETS_STORE = 'scenePresets';

let databasePromise = null;

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDB(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
          database.createObjectStore(PROJECTS_STORE);
        }
        if (!database.objectStoreNames.contains(PRESETS_STORE)) {
          database.createObjectStore(PRESETS_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(SCENE_PRESETS_STORE)) {
          database.createObjectStore(SCENE_PRESETS_STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return databasePromise;
}
