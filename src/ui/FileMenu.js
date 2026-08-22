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
  onRenderExport = () => {},
  canPersistProject = () => true,
  onOpen = () => {},
  showToast = () => {},
  windowRef = window,
  documentRef = document,
}) {
  let isOpen = false;
  let isBusy = false;

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
      if (isBusy || !canPersistProject()) return;
      togglePopover(false);
      if (type === 'render-glb') onRenderExport('glb');
      else if (type === 'render-sequence') onRenderExport('sequence');
      else onExport(type);
    });
  }

  function renderContent() {
    const persistenceDisabled = !canPersistProject();
    const persistenceHint = t('workflowSelectionRequired') || 'Choose a workflow before using this command.';
    const disabledAttribute = (disabled) => disabled ? ' disabled' : '';
    popoverContainer.innerHTML = `
      <button type="button" class="file-menu-item" id="menuNewProjectBtn"${isBusy ? ' disabled' : ''}>
        <span class="file-menu-item-title">${t('newProjectMenu') || 'New...'}</span>
        <span class="file-menu-shortcut">Ctrl+N</span>
      </button>
      <button type="button" class="file-menu-item" id="menuOpenProjectBtn"${isBusy ? ' disabled' : ''}>
        <span class="file-menu-item-title">${t('openProjectMenu') || 'Open...'}</span>
        <span class="file-menu-shortcut">Ctrl+O</span>
      </button>
      <button type="button" class="file-menu-item" id="menuSaveProjectBtn"${disabledAttribute(isBusy || persistenceDisabled)}${persistenceDisabled ? ` title="${persistenceHint}"` : ''}>
        <span class="file-menu-item-title">${t('saveProjectMenu') || 'Save...'}</span>
        <span class="file-menu-shortcut">Ctrl+S</span>
      </button>
      <div class="file-menu-divider"></div>
      <button type="button" class="file-menu-item" id="menuPlaceArtworkBtn"${disabledAttribute(isBusy || persistenceDisabled)}${persistenceDisabled ? ` title="${persistenceHint}"` : ''}>
        <span class="file-menu-item-title">${t('placeArtworkMenu') || 'Place Artwork...'}</span>
        <span class="file-menu-shortcut">Shift+Ctrl+P</span>
      </button>
      <div class="file-menu-divider"></div>
      <div class="file-menu-item file-menu-submenu-anchor${persistenceDisabled ? ' is-disabled' : ''}" id="menuExportItem"${persistenceDisabled ? ` title="${persistenceHint}"` : ''}>
        <span class="file-menu-item-title">${t('exportMenu') || 'Export'}</span>
        <span class="file-menu-submenu-caret">▸</span>
        <div class="file-menu-submenu">
          <div class="file-menu-item file-menu-submenu-anchor">
            <span class="file-menu-item-title">${t('export2d') || 'Export 2D'}</span>
            <span class="file-menu-submenu-caret">▸</span>
            <div class="file-menu-submenu">
              <button type="button" class="file-menu-item" id="menuExportPngBtn"${disabledAttribute(isBusy || persistenceDisabled)}>
                <span class="file-menu-item-title">${t('exportPng') || 'Export PNG'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportJpgBtn"${disabledAttribute(isBusy || persistenceDisabled)}>
                <span class="file-menu-item-title">${t('exportJpg') || 'Export JPG'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportSvgBtn"${disabledAttribute(isBusy || persistenceDisabled)}>
                <span class="file-menu-item-title">${t('dielineSvg') || 'Dieline SVG'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportPdfBtn"${disabledAttribute(isBusy || persistenceDisabled)}>
                <span class="file-menu-item-title">${t('exportPdf') || 'Export PDF'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportPrepressPdfBtn"${disabledAttribute(isBusy || persistenceDisabled)}>
                <span class="file-menu-item-title">${t('exportPrepressPdf') || 'Prepress PDF (not PDF/X)'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportPrepressSvgBtn"${disabledAttribute(isBusy || persistenceDisabled)}>
                <span class="file-menu-item-title">${t('exportPrepressSvg') || 'Prepress SVG'}</span>
              </button>
            </div>
          </div>
          <div class="file-menu-item file-menu-submenu-anchor">
            <span class="file-menu-item-title">${t('export3d') || 'Export 3D'}</span>
            <span class="file-menu-submenu-caret">▸</span>
            <div class="file-menu-submenu">
              <button type="button" class="file-menu-item" id="menuExport3dHtmlBtn"${disabledAttribute(isBusy || persistenceDisabled)}>
                <span class="file-menu-item-title">${t('export3dHtml') || 'Export HTML'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportGlbBtn"${disabledAttribute(isBusy || persistenceDisabled)}>
                <span class="file-menu-item-title">${t('export3dGlb') || 'Binary glTF (.glb)'}</span>
              </button>
              <button type="button" class="file-menu-item" id="menuExportTurntableBtn"${disabledAttribute(isBusy || persistenceDisabled)}>
                <span class="file-menu-item-title">${t('exportTurntable') || 'Turntable ZIP'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    popoverContainer.querySelector('#menuNewProjectBtn')?.addEventListener('click', () => {
      if (isBusy) return;
      togglePopover(false);
      onNewProject();
    });

    popoverContainer.querySelector('#menuOpenProjectBtn')?.addEventListener('click', () => {
      if (isBusy) return;
      togglePopover(false);
      onOpenProject();
    });

    popoverContainer.querySelector('#menuSaveProjectBtn')?.addEventListener('click', () => {
      if (isBusy || !canPersistProject()) return;
      togglePopover(false);
      onSaveProject();
    });

    popoverContainer.querySelector('#menuPlaceArtworkBtn')?.addEventListener('click', () => {
      if (isBusy || !canPersistProject()) return;
      togglePopover(false);
      onPlaceArtwork();
    });

    bindExportButton('#menuExportPngBtn', 'png');
    bindExportButton('#menuExportJpgBtn', 'jpg');
    bindExportButton('#menuExportSvgBtn', 'svg');
    bindExportButton('#menuExportPdfBtn', 'pdf');
    bindExportButton('#menuExportPrepressPdfBtn', 'prepress-pdf');
    bindExportButton('#menuExportPrepressSvgBtn', 'prepress-svg');
    bindExportButton('#menuExport3dHtmlBtn', 'html');
    bindExportButton('#menuExportGlbBtn', 'render-glb');
    bindExportButton('#menuExportTurntableBtn', 'render-sequence');
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
    setBusy(value) {
      isBusy = Boolean(value);
      triggerButton.setAttribute('aria-busy', String(isBusy));
      if (isOpen) renderContent();
    },
  };
}
