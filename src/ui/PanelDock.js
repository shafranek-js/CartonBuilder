import { t } from '../i18n.js';

const STORAGE_KEY = 'cartonBuilder.ui.panels';
const HIDE_DELAY = 300;

function readStoredState(storage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      left: { pinned: parsed?.left?.pinned === true },
      right: { pinned: parsed?.right?.pinned === true },
    };
  } catch {
    return null;
  }
}

export function createPanelDock({
  stage,
  leftPanel,
  rightPanel,
  leftEdge,
  rightEdge,
  leftPin,
  rightPin,
  documentRef = document,
  windowRef = window,
  storage = windowRef.localStorage,
}) {
  const stored = readStoredState(storage);
  const state = {
    left: { pinned: stored?.left?.pinned ?? true, open: true },
    right: { pinned: stored?.right?.pinned ?? true, open: true },
  };
  const timers = { left: null, right: null };
  const elements = {
    left: { panel: leftPanel, edge: leftEdge, pin: leftPin },
    right: { panel: rightPanel, edge: rightEdge, pin: rightPin },
  };

  function clearTimer(side) {
    if (timers[side] != null) {
      windowRef.clearTimeout(timers[side]);
      timers[side] = null;
    }
  }

  function persist() {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        left: { pinned: state.left.pinned },
        right: { pinned: state.right.pinned },
      }));
    } catch {
      // The dock still works when storage is unavailable.
    }
  }

  function syncSide(side) {
    const entry = state[side];
    const { edge, pin } = elements[side];
    stage.setAttribute(`data-${side}`, entry.pinned ? 'pinned' : entry.open ? 'open' : 'closed');
    const actionKey = `${entry.pinned ? 'unpin' : 'pin'}${side === 'left' ? 'Left' : 'Right'}Panel`;
    pin.setAttribute('aria-pressed', String(entry.pinned));
    pin.setAttribute('aria-label', t(actionKey));
    pin.setAttribute('title', t(actionKey));
    edge.hidden = entry.pinned || entry.open;
    edge.setAttribute('aria-expanded', String(entry.open || entry.pinned));
  }

  function open(side) {
    clearTimer(side);
    state[side].open = true;
    syncSide(side);
  }

  function close(side) {
    if (state[side].pinned) return;
    state[side].open = false;
    syncSide(side);
  }

  function scheduleClose(side) {
    clearTimer(side);
    timers[side] = windowRef.setTimeout(() => close(side), HIDE_DELAY);
  }

  function togglePin(side) {
    const entry = state[side];
    entry.pinned = !entry.pinned;
    if (entry.pinned) entry.open = true;
    persist();
    syncSide(side);
  }

  function bindSide(side) {
    const { panel, edge, pin } = elements[side];
    edge.addEventListener('mouseenter', () => open(side));
    edge.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open(side);
    });
    panel.addEventListener('mouseenter', () => open(side));
    panel.addEventListener('mouseleave', () => scheduleClose(side));
    pin.addEventListener('click', () => togglePin(side));
  }

  bindSide('left');
  bindSide('right');
  syncSide('left');
  syncSide('right');
  documentRef.addEventListener('carton-locale-changed', () => {
    syncSide('left');
    syncSide('right');
  });

  return {
    openPanels() {
      open('left');
      open('right');
    },
    dispose() {
      clearTimer('left');
      clearTimer('right');
    },
  };
}
