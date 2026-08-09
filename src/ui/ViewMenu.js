import { t } from '../i18n.js';
import { isOverprintEnabled } from '../artwork/overprintSettings.js';

export function createViewMenu({
  triggerButton,
  popoverContainer,
  onOverprintToggle = async () => {},
  isOverprintAvailable = () => true,
  onSeparations = () => {},
  onPrepressOverlayToggle = () => {},
  getPrepressOverlayState = () => ({}),
  onOpen = () => {},
  documentRef = document,
}) {
  let isOpen = false;
  let checkMark = false;

  function togglePopover(open) {
    isOpen = open !== undefined ? open : !isOpen;
    popoverContainer.hidden = !isOpen;
    triggerButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      renderContent();
    }
  }

  function renderContent() {
    const overlays = getPrepressOverlayState() || {};
    const overlayItems = ['trim', 'bleed', 'safe', 'dieline', 'marks'].map((name) => `
      <button type="button" class="file-menu-item view-menu-toggle prepress-overlay-toggle" id="menuPrepressOverlay${name}" role="menuitemcheckbox" aria-checked="${Boolean(overlays[name])}">
        <span class="file-menu-item-title">${name[0].toUpperCase() + name.slice(1)} overlay</span><span class="file-menu-shortcut">${overlays[name] ? '✓' : ''}</span>
      </button>`).join('');
    if (isOverprintAvailable()) {
      const enabled = isOverprintEnabled();
      checkMark = enabled;
      popoverContainer.innerHTML = `
        <button type="button" class="file-menu-item view-menu-toggle" id="menuEnableOverprintBtn" role="menuitemcheckbox" aria-checked="${enabled}">
          <span class="file-menu-item-title">${t('enableOverprint') || 'Overprint Preview'}</span>
          <span class="file-menu-shortcut">${enabled ? '✓' : ''}</span>
        </button>
        <button type="button" class="file-menu-item" id="menuSeparationsBtn" role="menuitem">
          <span class="file-menu-item-title">${t('separations') || 'Separations…'}</span>
        </button>
        <div class="file-menu-divider"></div>
        <div class="view-menu-note" role="note">Prepress overlays</div>
        ${overlayItems}
        <div class="view-menu-note" id="overprintProofNote" role="note">
          ${t('overprintProofNote') || 'Monitor preview is not a contract color proof.'}
        </div>
      `;
      popoverContainer.querySelector('#menuEnableOverprintBtn')?.addEventListener('click', async () => {
        const next = !isOverprintEnabled();
        const succeeded = await onOverprintToggle(next);
        if (succeeded !== false) {
          checkMark = next;
          const item = popoverContainer.querySelector('#menuEnableOverprintBtn');
          if (item) {
            item.setAttribute('aria-checked', String(next));
            const shortcut = item.querySelector('.file-menu-shortcut');
            if (shortcut) shortcut.textContent = next ? '✓' : '';
          }
        }
        togglePopover(false);
      });
      popoverContainer.querySelector('#menuSeparationsBtn')?.addEventListener('click', () => {
        togglePopover(false);
        onSeparations();
      });
      for (const name of ['trim', 'bleed', 'safe', 'dieline', 'marks']) {
        popoverContainer.querySelector(`#menuPrepressOverlay${name}`)?.addEventListener('click', () => {
          const next = !Boolean(getPrepressOverlayState()?.[name]);
          onPrepressOverlayToggle(name, next);
          renderContent();
        });
      }
      return;
    }
    popoverContainer.innerHTML = `
      <div class="file-menu-item view-menu-status" id="overprintStatusRow" role="menuitem" aria-disabled="true">
        <span class="file-menu-item-title">${t('overprintPreview') || 'Overprint Preview'}</span>
        <span class="file-menu-shortcut">${t('overprintUnavailable') || 'not available'}</span>
      </div>
      <div class="view-menu-note" id="overprintProofNote" role="note">
        ${t('overprintProofNote') || 'Monitor preview is not a contract color proof.'}
      </div>
      <div class="file-menu-divider"></div>
      <div class="view-menu-note" role="note">Prepress overlays</div>
      ${overlayItems}
    `;
    for (const name of ['trim', 'bleed', 'safe', 'dieline', 'marks']) {
      popoverContainer.querySelector(`#menuPrepressOverlay${name}`)?.addEventListener('click', () => {
        const next = !Boolean(getPrepressOverlayState()?.[name]);
        onPrepressOverlayToggle(name, next);
        renderContent();
      });
    }
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
