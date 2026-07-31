import { clearCurrentProject } from '../project/ProjectStore.js';
import { getLocale, t } from '../i18n.js';

export function createFileMenu({
  triggerButton,
  popoverContainer,
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
      <button type="button" class="file-menu-item" id="menuOpenProjectBtn">
        <span class="file-menu-item-title">📁 ${t('openProject') || 'Open Project'}</span>
        <kbd class="file-menu-kbd">Ctrl+O</kbd>
      </button>
      <button type="button" class="file-menu-item" id="menuSaveProjectBtn">
        <span class="file-menu-item-title">💾 ${t('saveProject') || 'Save Project'}</span>
        <kbd class="file-menu-kbd">Ctrl+S</kbd>
      </button>
      <div class="file-menu-divider"></div>
      <button type="button" class="file-menu-item" id="menuNewProjectBtn">
        <span class="file-menu-item-title">📄 ${t('newProject') || 'New Project'}</span>
      </button>
    `;

    popoverContainer.querySelector('#menuOpenProjectBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onOpenProject();
    });

    popoverContainer.querySelector('#menuSaveProjectBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onSaveProject();
    });

    popoverContainer.querySelector('#menuNewProjectBtn')?.addEventListener('click', async () => {
      togglePopover(false);
      if (windowRef.confirm('Create new project? Unsaved changes will be cleared.')) {
        try {
          await clearCurrentProject();
          showToast('New project created');
          windowRef.setTimeout(() => windowRef.location.reload(), 400);
        } catch {
          showToast('Failed to create new project.');
        }
      }
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
