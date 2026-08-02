export const FIRST_RUN_EXAMPLE_STORAGE_KEY = 'carton-builder-first-run-example-v1';

function hasHandledFirstRun(storage) {
  try {
    return storage?.getItem(FIRST_RUN_EXAMPLE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function markFirstRunHandled(storage) {
  try {
    storage?.setItem(FIRST_RUN_EXAMPLE_STORAGE_KEY, 'true');
  } catch {
    // The autosaved example still prevents repeated loading when storage is restricted.
  }
}

export async function restoreStartupProject({
  restoreAutosave,
  restoreExample,
  storage = globalThis.localStorage,
}) {
  const restoredAutosave = await restoreAutosave();
  if (restoredAutosave) {
    markFirstRunHandled(storage);
    return 'autosave';
  }

  if (hasHandledFirstRun(storage)) return 'empty';

  const restoredExample = await restoreExample();
  if (!restoredExample) return 'empty';

  markFirstRunHandled(storage);
  return 'example';
}
