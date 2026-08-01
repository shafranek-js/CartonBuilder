import { clearCurrentProject } from '../project/ProjectStore.js';
import { getLocale, t } from '../i18n.js';

export function createFileMenu({
  triggerButton,
  popoverContainer,
  onNewProject = () => {},
  onOpenProject = () => {},
  onSaveProject = () => {},
  onPlaceArtwork = () => {},
  onExport = () => {},
  onOpen = () => {},
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

  function bindExportButton(selector, type) {
    popoverContainer.querySelector(selector)?.addEventListener('click', () => {
      togglePopover(false);
      onExport(type);
    });
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
      <div class="file-menu-divider"></div>
      <button type="button" class="file-menu-item" id="menuPlaceArtworkBtn">
        <span class="file-menu-item-title">${t('placeArtworkMenu') || 'Place Artwork...'}</span>
        <span class="file-menu-shortcut">Shift+Ctrl+P</span>
      </button>
      <div class="file-menu-divider"></div>
      <div class="file-menu-item file-menu-submenu-anchor" id="menuExportItem">
        <span class="file-menu-item-title">${t('exportMenu') || 'Export'}</span>
        <span class="file-menu-submenu-caret">▸</span>
        <div class="file-menu-submenu">
          <div class="file-menu-item file-menu-submenu-anchor">
            <span class="file-menu-item-title">${t('export2d') || 'Export 2D'}</span>
            <span class="file-menu-submenu-caret">▸</span>
            <div class="file-menu-submenu">
              <button type="button" class="file-menu-item" id="menuExportPngBtn">
                <span class="file-menu-item-title">${t('exportPng') || 'Export PNG'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportJpgBtn">
                <span class="file-menu-item-title">${t('exportJpg') || 'Export JPG'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportSvgBtn">
                <span class="file-menu-item-title">${t('dielineSvg') || 'Dieline SVG'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportPdfBtn">
                <span class="file-menu-item-title">${t('exportPdf') || 'Export PDF'}</span>
              </button>
            </div>
          </div>
          <div class="file-menu-item file-menu-submenu-anchor">
            <span class="file-menu-item-title">${t('export3d') || 'Export 3D'}</span>
            <span class="file-menu-submenu-caret">▸</span>
            <div class="file-menu-submenu">
              <button type="button" class="file-menu-item" id="menuExport3dHtmlBtn">
                <span class="file-menu-item-title">${t('export3dHtml') || 'Export HTML'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
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

    popoverContainer.querySelector('#menuPlaceArtworkBtn')?.addEventListener('click', () => {
      togglePopover(false);
      onPlaceArtwork();
    });

    bindExportButton('#menuExportPngBtn', 'png');
    bindExportButton('#menuExportJpgBtn', 'jpg');
    bindExportButton('#menuExportSvgBtn', 'svg');
    bindExportButton('#menuExportPdfBtn', 'pdf');
    bindExportButton('#menuExport3dHtmlBtn', 'html');
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
