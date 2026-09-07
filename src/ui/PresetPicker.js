import {
  deletePreset,
  exportPresetsJson,
  formatPresetDimensions,
  getBuiltInPresets,
  getUserPresets,
  importPresetsFromJson,
  savePreset,
} from '../project/PresetStore.js';
import { getUserErrorMessage, t } from '../i18n.js';

export function createPresetPicker({
  triggerButton,
  popoverContainer,
  model,
  getWorkflowMode = () => 'quick',
  getCurrentTechnicalDocument = () => null,
  onApplyPreset = () => {},
  onApplyTechnicalPreset = () => {},
  showToast = () => {},
  announce = () => {},
  windowRef = window,
  documentRef = document,
}) {
  let isOpen = false;
  let userPresets = [];
  let currentWorkflowMode = typeof getWorkflowMode === 'function' ? getWorkflowMode() : 'quick';

  function getMode() {
    return (typeof getWorkflowMode === 'function' ? getWorkflowMode() : currentWorkflowMode) || 'quick';
  }

  async function setWorkflowMode(mode) {
    currentWorkflowMode = mode;
    if (isOpen) {
      return refreshPresetsList();
    }
  }

  async function togglePopover(open) {
    isOpen = open !== undefined ? open : !isOpen;
    popoverContainer.hidden = !isOpen;
    triggerButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      return refreshPresetsList();
    }
  }

  function close() {
    if (isOpen) {
      togglePopover(false);
    }
  }

  async function refreshPresetsList() {
    const mode = getMode();
    userPresets = await getUserPresets(mode);
    renderPopoverContent();
  }

  function renderPopoverContent() {
    const mode = getMode();
    const isTechnical = mode === 'technical';
    const builtInPresets = getBuiltInPresets(mode);

    let defaultName = '';
    let canSaveCurrent = true;

    if (isTechnical) {
      const doc = getCurrentTechnicalDocument();
      if (doc) {
        const sourceIdentity = doc.getSourceIdentity?.() || {};
        const cartonType = sourceIdentity.cartonType || doc.cartonType || 'Technical';
        const dims = doc.dimensions || { width: 120.6, height: 161.1, depth: 60.6 };
        defaultName = `${cartonType} (${formatPresetDimensions(dims)})`;
      } else {
        defaultName = 'Technical Box';
        canSaveCurrent = false;
      }
    } else {
      const currentDims = model?.dimensions || { width: 150, height: 90, depth: 40 };
      defaultName = formatPresetDimensions(currentDims);
    }

    const formatBadge = (preset) => {
      const dims = formatPresetDimensions(preset.dimensions);
      if (preset.cartonType) {
        return `${escapeHtml(preset.cartonType)} · ${dims}`;
      }
      return dims;
    };

    const userItemsHtml = userPresets.length === 0
      ? `<p class="preset-empty-text">${t('presetEmptyText')}</p>`
      : userPresets.map((preset) => `
        <div class="preset-item" data-id="${preset.id}">
          <div class="preset-info">
            <span class="preset-title">${escapeHtml(preset.name)}</span>
            <span class="preset-badge">${formatBadge(preset)}</span>
          </div>
          <div class="preset-actions">
            <button type="button" class="preset-apply-btn" data-action="apply" data-id="${preset.id}">${t('presetApply')}</button>
            <button type="button" class="preset-delete-btn" data-action="delete" data-id="${preset.id}" title="${t('presetDeleteTitle')}">✕</button>
          </div>
        </div>
      `).join('');

    const builtInItemsHtml = builtInPresets.map((preset) => `
      <div class="preset-item built-in-item" data-id="${preset.id}">
        <div class="preset-info">
          <span class="preset-title">${escapeHtml(preset.name)}</span>
          <span class="preset-badge">${formatBadge(preset)}</span>
        </div>
        <div class="preset-actions">
          <button type="button" class="preset-apply-btn" data-action="apply" data-id="${preset.id}">${t('presetApply')}</button>
        </div>
      </div>
    `).join('');

    const libraryTitle = isTechnical ? t('technicalDielinesTitle') : t('presetsLibraryTitle');
    const standardTitle = isTechnical ? t('standardTechnicalDielinesTitle') : t('standardPresetsTitle');
    const saveCurrentBtnLabel = t('saveCurrentPresetBtn', { name: defaultName });

    popoverContainer.innerHTML = `
      <div class="preset-popover-header">
        <strong>${libraryTitle}</strong>
        <button type="button" class="preset-save-btn" id="savePresetBtn" ${canSaveCurrent ? '' : `disabled title="${t('loadTechnicalFirstTitle')}"`}>
          ${saveCurrentBtnLabel}
        </button>
        <div class="preset-io-btns">
          <button type="button" class="preset-io-btn" id="importPresetsBtn" title="${t('importPresetsTitle')}">
            ${t('importPresetsBtn')}
          </button>
          <button type="button" class="preset-io-btn" id="exportPresetsBtn" title="${t('exportPresetsTitle')}" ${userPresets.length === 0 ? 'disabled' : ''}>
            ${t('exportPresetsBtn')}
          </button>
        </div>
        <input type="file" id="presetFileInput" accept=".cartonpreset,.carton_preset,.json,application/json" hidden>
      </div>
      <div class="preset-section">
        <h4 class="preset-section-title">${t('myPresetsSection')}</h4>
        <div class="preset-list">${userItemsHtml}</div>
      </div>
      <div class="preset-section">
        <h4 class="preset-section-title">${standardTitle}</h4>
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
      const mode = getMode();
      const jsonString = exportPresetsJson(userPresets, mode);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = documentRef.createElement('a');
      link.href = url;
      link.download = `carton-${mode}-presets-${Date.now()}.cartonpreset`;
      link.click();
      URL.revokeObjectURL(url);

      showToast(t('exportedPresetsToast', { count: userPresets.length }));
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
        const mode = getMode();
        const content = event.target.result;
        const count = await importPresetsFromJson(content, mode);
        showToast(t('importedPresetsToast', { count }));
        announce(`Imported ${count} presets`);
        await refreshPresetsList();
      } catch (error) {
        showToast(error.message || 'Failed to import presets');
      }
    };
    reader.readAsText(file);
  }

  async function handleSavePreset() {
    const mode = getMode();
    const isTechnical = mode === 'technical';

    if (isTechnical) {
      const doc = getCurrentTechnicalDocument();
      if (!doc) {
        showToast(t('noActiveTechnicalDieline'));
        return;
      }
      const sourceIdentity = doc.getSourceIdentity?.() || {};
      const cartonType = sourceIdentity.cartonType || doc.cartonType || 'Technical';
      const dims = doc.dimensions || { width: 120.6, height: 161.1, depth: 60.6 };
      const defaultName = `${cartonType} ${formatPresetDimensions(dims)}`;
      const name = windowRef.prompt(t('enterPresetNamePrompt'), defaultName);

      if (name === null) return;

      try {
        const bundle = doc.getBundle ? doc.getBundle() : null;
        const saved = await savePreset({
          name: name.trim() || defaultName,
          workflow: 'technical',
          cartonType,
          dimensions: { ...dims },
          thickness: doc.thickness || 0.46,
          bundle,
        }, 'technical');
        showToast(t('presetSavedToast', { name: saved.name }));
        announce(`Preset ${saved.name} saved`);
        await refreshPresetsList();
      } catch (error) {
        showToast(getUserErrorMessage(error, 'saveError'));
      }
    } else {
      const currentDims = model.dimensions;
      const defaultName = formatPresetDimensions(currentDims);
      const name = windowRef.prompt(t('enterPresetNamePrompt'), defaultName);

      if (name === null) return; // User cancelled

      try {
        const saved = await savePreset({
          name: name.trim() || defaultName,
          workflow: 'quick',
          dimensions: { ...currentDims },
          netState: model.toJSON(),
        }, 'quick');
        showToast(t('presetSavedToast', { name: saved.name }));
        announce(`Preset ${saved.name} saved`);
        await refreshPresetsList();
      } catch (error) {
        showToast(getUserErrorMessage(error, 'saveError'));
      }
    }
  }

  function handleApplyPreset(presetId) {
    const mode = getMode();
    const isTechnical = mode === 'technical';
    const builtInPresets = getBuiltInPresets(mode);
    const target = [...builtInPresets, ...userPresets].find((p) => p.id === presetId);
    if (!target) return;

    try {
      if (isTechnical) {
        onApplyTechnicalPreset(target);
      } else {
        onApplyPreset(target);
      }
      togglePopover(false);
      showToast(t('presetAppliedToast', { name: target.name }));
      announce(`Applied preset ${target.name}`);
    } catch (error) {
      showToast(getUserErrorMessage(error, 'applyError'));
    }
  }

  async function handleDeletePreset(presetId) {
    const target = userPresets.find((p) => p.id === presetId);
    if (!target) return;

    if (!windowRef.confirm(t('deletePresetConfirm', { name: target.name }))) return;

    try {
      await deletePreset(presetId);
      showToast(t('presetDeletedToast', { name: target.name }));
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

  documentRef.addEventListener('carton-locale-changed', () => {
    if (isOpen) {
      renderPopoverContent();
    }
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
    close,
    setWorkflowMode,
    refreshPresetsList,
    getUserPresets: () => userPresets,
  };
}
