export function createRenderDeduper() {
  const inflight = new Map();
  return {
    run(key, fn) {
      if (inflight.has(key)) return inflight.get(key);
      const promise = Promise.resolve().then(fn);
      inflight.set(key, promise);
      promise.then(
        () => inflight.delete(key),
        () => inflight.delete(key),
      );
      return promise;
    },
    has(key) {
      return inflight.has(key);
    },
    get size() {
      return inflight.size;
    },
    clear() {
      inflight.clear();
    },
  };
}
