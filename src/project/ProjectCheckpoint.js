function cloneValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.slice(0, value.size, value.type);
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const item of value) result.push(cloneValue(item, seen));
    return result;
  }
  const result = {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value)) result[key] = cloneValue(item, seen);
  return result;
}

/**
 * Session-local, transactional project checkpoint.  The store deliberately
 * does not share its value with autosave storage: a normal autosave can never
 * overwrite the recoverable pre-change version.
 */
export class ProjectCheckpointStore {
  #value = null;

  async createProjectCheckpoint(payload, { verify = async () => {}, write = async () => {} } = {}) {
    const candidate = cloneValue(payload);
    await verify(cloneValue(candidate));
    await write(cloneValue(candidate));
    this.#value = candidate;
    return cloneValue(candidate);
  }

  async restoreProjectCheckpoint({ verify = async () => {} } = {}) {
    if (!this.#value) return null;
    const candidate = cloneValue(this.#value);
    await verify(cloneValue(candidate));
    return candidate;
  }

  discardProjectCheckpoint() {
    this.#value = null;
  }

  hasProjectCheckpoint() {
    return this.#value !== null;
  }

  getProjectCheckpoint() {
    return cloneValue(this.#value);
  }
}

export { cloneValue as cloneProjectCheckpointValue };
