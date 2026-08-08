export function createRenderCache({ maxBytes = 96 * 1024 * 1024, maxEntries = 24 } = {}) {
  const entries = new Map();
  let totalBytes = 0;

  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    totalBytes -= entry.bytes;
  }

  return {
    get maxBytes() {
      return maxBytes;
    },

    get size() {
      return entries.size;
    },

    get bytes() {
      return totalBytes;
    },

    has(key) {
      return entries.has(key);
    },

    get(key) {
      if (!entries.has(key)) return undefined;
      const entry = entries.get(key);
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },

    set(key, value, bytes = value?.bytes || 0) {
      remove(key);
      entries.set(key, { ...value, bytes });
      totalBytes += bytes;
      while (entries.size > maxEntries || (totalBytes > maxBytes && entries.size > 1)) {
        remove(entries.keys().next().value);
      }
    },

    delete(key) {
      remove(key);
    },

    clear() {
      entries.clear();
      totalBytes = 0;
    },
  };
}

export function renderCacheKey({
  docId,
  pageIndex = 0,
  scale = 1,
  box = 'CropBox',
  visibility = null,
  usage = 'Print',
  dpi = null,
  targetWidthMm = null,
  overprintMode = 0,
  processMask = 15,
  spotBehaviors = null,
  separationBehaviors = null,
}) {
  const visibilityHash = visibility ? JSON.stringify(visibility) : '';
  const behaviors = spotBehaviors ?? separationBehaviors;
  const behaviorsHash = behaviors ? behaviors.join(',') : '';
  return [
    docId,
    pageIndex,
    Number(scale).toFixed(4),
    box,
    usage,
    overprintMode,
    processMask,
    behaviorsHash,
    dpi || '',
    targetWidthMm ? Number(targetWidthMm).toFixed(2) : '',
    visibilityHash,
  ].join('|');
}
