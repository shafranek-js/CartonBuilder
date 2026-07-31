import { clearCurrentProject } from '../project/ProjectStore.js';
import { COLOR_THEMES, applyTheme, getSavedTheme } from './ThemeManager.js';
import { getLocale, t } from '../i18n.js';

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
    const currentThemeId = getSavedTheme();
    const isRu = getLocale() === 'ru';

    const themeOptionsHtml = COLOR_THEMES.map((theme) => {
      const selected = theme.id === currentThemeId ? 'selected' : '';
      const name = isRu ? theme.nameRu : theme.nameEn;
      return `<option value="${theme.id}" ${selected}>${name}</option>`;
    }).join('');

    popoverContainer.innerHTML = `
      <div class="settings-popover-header">
        <strong>⚙️ ${t('settings') || 'Settings'}</strong>
      </div>

      <div class="settings-group">
        <label class="settings-label" for="themeSelect">
          🎨 <span>${t('theme') || 'Color Theme'}</span>
        </label>
        <select id="themeSelect" class="settings-select">
          ${themeOptionsHtml}
        </select>
      </div>

      <div class="settings-group">
        <label class="settings-label">
          <span>CartonBuilder v1.0.0</span>
        </label>
        <p class="settings-desc">Interactive 2D/3D Carton Packaging Dieline & Artwork Studio.</p>
      </div>

      <div class="settings-group">
        <button type="button" class="settings-danger-btn" id="clearDataBtn">
          🗑️ ${t('clearProjectData') || 'Clear Saved Project Data'}
        </button>
      </div>
    `;

    popoverContainer.querySelector('#themeSelect')?.addEventListener('change', (e) => {
      const selectedTheme = applyTheme(e.target.value, documentRef);
      const name = isRu ? selectedTheme.nameRu : selectedTheme.nameEn;
      showToast(`${t('themeApplied') || 'Theme applied:'} ${name}`);
    });

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
