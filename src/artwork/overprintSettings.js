const OVERPRINT_STORAGE_KEY = 'carton-builder-overprint';
const DEFAULT_OVERPRINT = false;

const listeners = new Set();

function getStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function isOverprintEnabled() {
  const storage = getStorage();
  if (!storage) return DEFAULT_OVERPRINT;
  try {
    const stored = storage.getItem(OVERPRINT_STORAGE_KEY);
    if (stored === null) return DEFAULT_OVERPRINT;
    return stored === '1' || stored === 'true';
  } catch {
    return DEFAULT_OVERPRINT;
  }
}

export function setOverprintEnabled(enabled) {
  const next = Boolean(enabled);
  const storage = getStorage();
  try {
    if (storage) storage.setItem(OVERPRINT_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // non-persistent environment: still notify below
  }
  for (const listener of [...listeners]) {
    try {
      listener(next);
    } catch {
      // listener failures must not break the toggle
    }
  }
  return next;
}

export function subscribeOverprint(listener) {
  if (typeof listener === 'function') listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOverprintMode() {
  return isOverprintEnabled() ? 1 : 0;
}
