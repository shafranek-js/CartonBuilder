import {
  BUILT_IN_PRESETS,
  deletePreset,
  exportPresetsJson,
  formatPresetDimensions,
  getUserPresets,
  importPresetsFromJson,
  savePreset,
} from '../project/PresetStore.js';
import { getUserErrorMessage } from '../i18n.js';

export function createPresetPicker({
  triggerButton,
  popoverContainer,
  model,
  onApplyPreset = () => {},
  showToast = () => {},
  announce = () => {},
  windowRef = window,
  documentRef = document,
}) {
  let isOpen = false;
  let userPresets = [];

  function togglePopover(open) {
    isOpen = open !== undefined ? open : !isOpen;
    popoverContainer.hidden = !isOpen;
    triggerButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      refreshPresetsList();
    }
  }

  async function refreshPresetsList() {
    userPresets = await getUserPresets();
    renderPopoverContent();
  }

  function renderPopoverContent() {
    const currentDims = model.dimensions;
    const defaultName = formatPresetDimensions(currentDims);

    const userItemsHtml = userPresets.length === 0
      ? '<p class="preset-empty-text">No custom presets saved yet</p>'
      : userPresets.map((preset) => `
        <div class="preset-item" data-id="${preset.id}">
          <div class="preset-info">
            <span class="preset-title">${escapeHtml(preset.name)}</span>
            <span class="preset-badge">${formatPresetDimensions(preset.dimensions)}</span>
          </div>
          <div class="preset-actions">
            <button type="button" class="preset-apply-btn" data-action="apply" data-id="${preset.id}">Apply</button>
            <button type="button" class="preset-delete-btn" data-action="delete" data-id="${preset.id}" title="Delete preset">✕</button>
          </div>
        </div>
      `).join('');

    const builtInItemsHtml = BUILT_IN_PRESETS.map((preset) => `
      <div class="preset-item built-in-item" data-id="${preset.id}">
        <div class="preset-info">
          <span class="preset-title">${escapeHtml(preset.name)}</span>
          <span class="preset-badge">${formatPresetDimensions(preset.dimensions)}</span>
        </div>
        <div class="preset-actions">
          <button type="button" class="preset-apply-btn" data-action="apply" data-id="${preset.id}">Apply</button>
        </div>
      </div>
    `).join('');

    popoverContainer.innerHTML = `
      <div class="preset-popover-header">
        <strong>Presets Library</strong>
        <button type="button" class="preset-save-btn" id="savePresetBtn">
          💾 Save Current (${defaultName})
        </button>
        <div class="preset-io-btns">
          <button type="button" class="preset-io-btn" id="importPresetsBtn" title="Import presets from .cartonpreset file">
            📥 Import
          </button>
          <button type="button" class="preset-io-btn" id="exportPresetsBtn" title="Export presets to .cartonpreset file" ${userPresets.length === 0 ? 'disabled' : ''}>
            📤 Export
          </button>
        </div>
        <input type="file" id="presetFileInput" accept=".cartonpreset,.carton_preset,.json,application/json" hidden>
      </div>
      <div class="preset-section">
        <h4 class="preset-section-title">My Presets</h4>
        <div class="preset-list">${userItemsHtml}</div>
      </div>
      <div class="preset-section">
        <h4 class="preset-section-title">Standard Presets</h4>
        <div class="preset-list">${builtInItemsHtml}</div>
      </div>
    `;

    // Wire popover action buttons
    popoverContainer.querySelector('#savePresetBtn')?.addEventListener('click', handleSavePreset);
    popoverContainer.querySelector('#exportPresetsBtn')?.addEventListener('click', handleExportPresets);

    const importBtn = popoverContainer.querySelector('#importPresetsBtn');
    const fileInput = popoverContainer.querySelector('#presetFileInput');

    importBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', (e) => handleImportPresets(e.target.files[0]));

    popoverContainer.querySelectorAll('[data-action="apply"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        handleApplyPreset(id);
      });
    });

    popoverContainer.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        handleDeletePreset(id);
      });
    });
  }

  function handleExportPresets() {
    if (userPresets.length === 0) return;
    try {
      const jsonString = exportPresetsJson(userPresets);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = documentRef.createElement('a');
      link.href = url;
      link.download = `carton-presets-${Date.now()}.cartonpreset`;
      link.click();
      URL.revokeObjectURL(url);

      showToast(`Exported ${userPresets.length} presets`);
      announce(`Exported ${userPresets.length} presets to JSON file`);
    } catch (error) {
      showToast(getUserErrorMessage(error, 'exportError'));
    }
  }

  async function handleImportPresets(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target.result;
        const count = await importPresetsFromJson(content);
        showToast(`Imported ${count} presets!`);
        announce(`Imported ${count} presets`);
        await refreshPresetsList();
      } catch (error) {
        showToast(error.message || 'Failed to import presets');
      }
    };
    reader.readAsText(file);
  }

  async function handleSavePreset() {
    const currentDims = model.dimensions;
    const defaultName = formatPresetDimensions(currentDims);
    const name = windowRef.prompt('Enter preset name:', defaultName);

    if (name === null) return; // User cancelled

    try {
      const saved = await savePreset({
        name: name.trim() || defaultName,
        dimensions: { ...currentDims },
        netState: model.toJSON(),
      });
      showToast(`Preset "${saved.name}" saved!`);
      announce(`Preset ${saved.name} saved`);
      await refreshPresetsList();
    } catch (error) {
      showToast(getUserErrorMessage(error, 'saveError'));
    }
  }

  function handleApplyPreset(presetId) {
    const target = [...BUILT_IN_PRESETS, ...userPresets].find((p) => p.id === presetId);
    if (!target) return;

    try {
      onApplyPreset(target);
      togglePopover(false);
      showToast(`Applied preset: ${target.name}`);
      announce(`Applied preset ${target.name}`);
    } catch (error) {
      showToast(getUserErrorMessage(error, 'applyError'));
    }
  }

  async function handleDeletePreset(presetId) {
    const target = userPresets.find((p) => p.id === presetId);
    if (!target) return;

    if (!windowRef.confirm(`Delete preset "${target.name}"?`)) return;

    try {
      await deletePreset(presetId);
      showToast(`Deleted preset: ${target.name}`);
      await refreshPresetsList();
    } catch (error) {
      showToast(getUserErrorMessage(error, 'deleteError'));
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
  }

  // Event Listeners
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
    refreshPresetsList,
    getUserPresets: () => userPresets,
  };
}
