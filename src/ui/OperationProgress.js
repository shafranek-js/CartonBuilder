import { t } from '../i18n.js';

const SHOW_DELAY_MS = 200;
const MIN_VISIBLE_MS = 240;

function clampFraction(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

/**
 * Coordinates one user-visible foreground operation at a time.
 * The controller owns only operation state and presentation; the caller owns
 * the actual work and reports stage/progress through the handle.
 */
export function createOperationProgress({
  root,
  label,
  detail,
  progress,
  cancelButton,
  announcer = null,
  windowRef = window,
  showToast = () => {},
  onBusyChange = () => {},
  translate = t,
  showDelayMs = SHOW_DELAY_MS,
  minVisibleMs = MIN_VISIBLE_MS,
} = {}) {
  let active = null;
  let showTimer = null;
  let visibleAt = 0;

  function setText(element, key, params = {}) {
    if (!element) return;
    element.textContent = key ? translate(key, params) : '';
  }

function setProgress(value) {
    const fraction = clampFraction(value);
    if (!progress) return;
    if (fraction === null) {
      progress.removeAttribute('value');
      progress.removeAttribute('aria-valuenow');
      progress.classList.add('is-indeterminate');
      return;
    }
    progress.classList.remove('is-indeterminate');
    progress.value = fraction * 100;
    progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  }

  function setVisible(value) {
    if (!root) return;
    root.hidden = !value;
    root.setAttribute('aria-hidden', String(!value));
    if (value) visibleAt = Date.now();
  }

  function finishPresentation() {
    if (showTimer) {
      windowRef.clearTimeout(showTimer);
      showTimer = null;
    }
    const elapsed = Date.now() - visibleAt;
    const delay = root?.hidden ? 0 : Math.max(0, minVisibleMs - elapsed);
    windowRef.setTimeout(() => {
      if (active) return;
      setVisible(false);
      onBusyChange(false);
    }, delay);
  }

  function cancel() {
    if (!active?.cancellable) return;
    active.controller.abort();
  }

  cancelButton?.addEventListener('click', cancel);

  async function run({
    id,
    labelKey,
    labelParams = {},
    cancellable = false,
    lockMode = 'actions',
    work,
  } = {}) {
    if (active) {
      showToast(translate('operationInProgress'));
      return { status: 'busy' };
    }
    if (typeof work !== 'function') throw new TypeError('Operation work must be a function.');

    const controller = new AbortController();
    const operation = { id, cancellable, controller, lockMode, lastFraction: null };
    active = operation;
    onBusyChange(true, { id, lockMode });
    setText(label, labelKey, labelParams);
    setText(detail, 'operationPreparing');
    setProgress(null);
    if (cancelButton) cancelButton.hidden = !cancellable;
    if (announcer) announcer.textContent = translate(labelKey, labelParams);
    showTimer = windowRef.setTimeout(() => {
      showTimer = null;
      if (active === operation) setVisible(true);
    }, showDelayMs);

    const handle = {
      id,
      signal: controller.signal,
      report({ stageKey = 'operationProcessing', stageParams = {}, params = stageParams, fraction = null } = {}) {
        if (active !== operation) return;
        setText(detail, stageKey, params);
        const nextFraction = clampFraction(fraction);
        if (nextFraction !== null) {
          operation.lastFraction = operation.lastFraction === null
            ? nextFraction
            : Math.max(operation.lastFraction, nextFraction);
        }
        setProgress(nextFraction === null ? null : operation.lastFraction);
        if (announcer && stageKey) announcer.textContent = translate(stageKey, params);
      },
      cancel,
      get cancelled() {
        return controller.signal.aborted;
      },
    };

    try {
      const value = await work(handle);
      if (controller.signal.aborted) return { status: 'cancelled' };
      return { status: 'succeeded', value };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return { status: 'cancelled', error };
      return { status: 'failed', error };
    } finally {
      if (active === operation) {
        active = null;
        finishPresentation();
      }
    }
  }

  return {
    run,
    cancel,
    isBusy: () => Boolean(active),
    get activeId() {
      return active?.id || null;
    },
  };
}
