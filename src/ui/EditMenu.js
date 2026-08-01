import { t } from '../i18n.js';

export function createEditMenu({
  triggerButton,
  popoverContainer,
  onUndo = () => {},
  onRedo = () => {},
  onReplaceArtwork = () => {},
  onRemoveArtwork = () => {},
  onOpen = () => {},
  windowRef = window,
  documentRef = document,
}) {
  let isOpen = false;

  function togglePopover(open) {
    isOpen = open !== undefined ? open : !isOpen;
    popoverContainer.hidden = !isOpen;
    triggerButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      renderContent();
    }
  }

  function renderContent() {
    popoverContainer.innerHTML = `
      <button type="button" class="file-menu-item" id="menuUndoBtn">
        <span class="file-menu-item-title">${t('undo') || 'Undo'}</span>
        <span class="file-menu-shortcut">Ctrl+Z</span>
      </button>
      <button type="button" class="file-menu-item" id="menuRedoBtn">
        <span class="file-menu-item-title">${t('redo') || 'Redo'}</span>
        <span class="file-menu-shortcut">Ctrl+Y</span>
      </button>
      <div class="file-menu-divider"></div>
      <button type="button" class="file-menu-item" id="menuReplaceArtworkBtn">
        <span class="file-menu-item-title">${t('replaceArtworkMenu') || 'Replace Artwork...'}</span>
      </button>
      <button type="button" class="file-menu-item" id="menuRemoveArtworkBtn">
        <span class="file-menu-item-title">${t('removeArtworkMenu') || 'Remove Artwork'}</span>
      </button>
    `;

    popoverContainer.querySelector('#menuUndoBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onUndo();
    });

    popoverContainer.querySelector('#menuRedoBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onRedo();
    });

    popoverContainer.querySelector('#menuReplaceArtworkBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onReplaceArtwork();
    });

    popoverContainer.querySelector('#menuRemoveArtworkBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onRemoveArtwork();
    });
  }

  triggerButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isOpen) onOpen();
    togglePopover();
  });

  documentRef.addEventListener('click', (e) => {
    if (isOpen && !popoverContainer.contains(e.target) && !triggerButton.contains(e.target)) {
      togglePopover(false);
    }
  });

  documentRef.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') {
      togglePopover(false);
    }
  });

  return {
    togglePopover,
  };
}
