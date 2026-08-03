import { openDB } from 'idb';

const DATABASE_NAME = 'carton-builder';
const DATABASE_VERSION = 6;

export const PROJECTS_STORE = 'projects';
export const PRESETS_STORE = 'presets';
export const SCENE_PRESETS_STORE = 'scenePresets';
export const RENDER_PRESETS_STORE = 'renderPresets';
export const RENDER_ASSETS_STORE = 'renderAssets';
export const RENDER_VIEW_PRESETS_STORE = 'renderViewPresets';
export const PRESET_THUMBNAILS_STORE = 'presetThumbnails';

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
        if (!database.objectStoreNames.contains(RENDER_PRESETS_STORE)) {
          database.createObjectStore(RENDER_PRESETS_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(RENDER_ASSETS_STORE)) {
          database.createObjectStore(RENDER_ASSETS_STORE, { keyPath: 'assetId' });
        }
        if (!database.objectStoreNames.contains(RENDER_VIEW_PRESETS_STORE)) {
          database.createObjectStore(RENDER_VIEW_PRESETS_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(PRESET_THUMBNAILS_STORE)) {
          database.createObjectStore(PRESET_THUMBNAILS_STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return databasePromise;
}
