import { clearCurrentProject } from '../project/ProjectStore.js';
import { t } from '../i18n.js';

export function createSettingsModal({
  triggerButton,
  popoverContainer,
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
      <div class="settings-popover-header">
        <strong>⚙️ ${t('settings') || 'Settings'}</strong>
      </div>

      <div class="settings-group">
        <label class="settings-label">
          <span>CartonBuilder v1.0.0</span>
        </label>
        <p class="settings-desc">Interactive 2D/3D Carton Packaging Dieline & Artwork Studio.</p>
      </div>

      <div class="settings-group">
        <button type="button" class="settings-danger-btn" id="clearDataBtn">
          🗑️ Clear Saved Project Data
        </button>
      </div>
    `;

    popoverContainer.querySelector('#clearDataBtn')?.addEventListener('click', handleClearData);
  }

  async function handleClearData() {
    if (!windowRef.confirm('Are you sure you want to clear saved project state and reset to clean defaults?')) {
      return;
    }

    try {
      await clearCurrentProject();
      showToast('Project data cleared. Reloading...');
      windowRef.setTimeout(() => windowRef.location.reload(), 600);
    } catch {
      showToast('Could not clear project data.');
    }
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
