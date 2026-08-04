const STORAGE_KEY = 'cartonBuilder.ui.sections';

export function getSectionKey(detailsEl) {
  if (!detailsEl) return null;
  if (detailsEl.dataset?.sectionId) return detailsEl.dataset.sectionId;
  if (detailsEl.id) return detailsEl.id;

  const summary = detailsEl.querySelector('summary');
  const i18nKey = summary?.getAttribute('data-i18n');
  const stepContainer = detailsEl.closest('.workflow-step');
  const stepId = stepContainer?.id || 'global';

  if (i18nKey) return `${stepId}:${i18nKey}`;
  return null;
}

export function readSectionStates(storage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSectionStates(states, storage) {
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(states));
  } catch {
    // Ignore storage errors
  }
}

export function initSectionStatePersistence({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  storage = windowRef?.localStorage,
} = {}) {
  const states = readSectionStates(storage);

  function applySavedStates() {
    const detailsElements = documentRef.querySelectorAll('details');
    detailsElements.forEach((detailsEl) => {
      const key = getSectionKey(detailsEl);
      if (key && typeof states[key] === 'boolean') {
        detailsEl.open = states[key];
      }
    });
  }

  applySavedStates();

  function handleToggle(e) {
    const detailsEl = e.target;
    if (detailsEl?.tagName?.toLowerCase() !== 'details') return;
    const key = getSectionKey(detailsEl);
    if (!key) return;

    states[key] = detailsEl.open;
    saveSectionStates(states, storage);
  }

  documentRef.addEventListener('toggle', handleToggle, true);

  return {
    states,
    applySavedStates,
    destroy() {
      documentRef.removeEventListener('toggle', handleToggle, true);
    },
  };
}
