import { clearCurrentProject } from '../project/ProjectStore.js';
import { getLocale, t } from '../i18n.js';

export function createFileMenu({
  triggerButton,
  popoverContainer,
  onNewProject = () => {},
  onOpenProject = () => {},
  onSaveProject = () => {},
  showToast = () => {},
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
      <button type="button" class="file-menu-item" id="menuNewProjectBtn">
        <span class="file-menu-item-title">${t('newProjectMenu') || 'New...'}</span>
        <span class="file-menu-shortcut">Ctrl+N</span>
      </button>
      <button type="button" class="file-menu-item" id="menuOpenProjectBtn">
        <span class="file-menu-item-title">${t('openProjectMenu') || 'Open...'}</span>
        <span class="file-menu-shortcut">Ctrl+O</span>
      </button>
      <button type="button" class="file-menu-item" id="menuSaveProjectBtn">
        <span class="file-menu-item-title">${t('saveProjectMenu') || 'Save...'}</span>
        <span class="file-menu-shortcut">Ctrl+S</span>
      </button>
    `;

    popoverContainer.querySelector('#menuNewProjectBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onNewProject();
    });

    popoverContainer.querySelector('#menuOpenProjectBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onOpenProject();
    });

    popoverContainer.querySelector('#menuSaveProjectBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onSaveProject();
    });
  }

  triggerButton.addEventListener('click', (e) => {
    e.stopPropagation();
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
