import { describe, expect, it, vi } from 'vitest';

import {
  FIRST_RUN_EXAMPLE_STORAGE_KEY,
  restoreStartupProject,
} from '../../src/project/firstRunExample.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
  };
}

describe('first-run example project', () => {
  it('keeps an existing autosave and records that first-run setup is complete', async () => {
    const storage = createStorage();
    const restoreExample = vi.fn();

    await expect(restoreStartupProject({
      restoreAutosave: vi.fn().mockResolvedValue(true),
      restoreExample,
      storage,
    })).resolves.toBe('autosave');

    expect(restoreExample).not.toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalledWith(FIRST_RUN_EXAMPLE_STORAGE_KEY, 'true');
  });

  it('opens and records the example when no autosave exists on first run', async () => {
    const storage = createStorage();
    const restoreExample = vi.fn().mockResolvedValue(true);

    await expect(restoreStartupProject({
      restoreAutosave: vi.fn().mockResolvedValue(false),
      restoreExample,
      storage,
    })).resolves.toBe('example');

    expect(restoreExample).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledWith(FIRST_RUN_EXAMPLE_STORAGE_KEY, 'true');
  });

  it('starts empty after the example has already been handled', async () => {
    const storage = createStorage({ [FIRST_RUN_EXAMPLE_STORAGE_KEY]: 'true' });
    const restoreExample = vi.fn();

    await expect(restoreStartupProject({
      restoreAutosave: vi.fn().mockResolvedValue(false),
      restoreExample,
      storage,
    })).resolves.toBe('empty');

    expect(restoreExample).not.toHaveBeenCalled();
  });

  it('does not mark setup complete when the example cannot be restored', async () => {
    const storage = createStorage();

    await expect(restoreStartupProject({
      restoreAutosave: vi.fn().mockResolvedValue(false),
      restoreExample: vi.fn().mockResolvedValue(false),
      storage,
    })).resolves.toBe('empty');

    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
