const messages = {
  en: {
    language: 'Language',
    createBox: 'Create Box',
    placeArtwork: 'Place Artwork',
    previewExport: 'Preview / Export',
    boxDimensions: 'Box Dimensions',
    width: 'Width:',
    height: 'Height:',
    depth: 'Depth:',
    designBox: 'Design your box by adding or removing box panels',
    placedPanels: 'Placed panels:',
    continue: 'Continue',
    cancel: 'Cancel',
    dropArtwork: 'Drop artwork here',
    fileHint: 'PNG, JPG or PDF · maximum 100 MB',
    chooseFile: 'Choose file',
    artwork: 'Artwork',
    noFile: 'No file selected',
    replace: 'Replace',
    remove: 'Remove',
    transform: 'Transform',
    centerX: 'Center X',
    centerY: 'Center Y',
    scale: 'Scale',
    opacity: 'Opacity',
    effectiveDpi: 'Effective DPI:',
    fitDieline: 'Fit Dieline',
    fillDieline: 'Fill Dieline',
    center: 'Center',
    rotateLeft: 'Rotate −90°',
    rotateRight: 'Rotate +90°',
    resetTransform: 'Reset Transform',
    layers: 'Layers',
    layer: 'Layer',
    show: 'Show',
    lock: 'Lock',
    dieline: 'Dieline',
    panelNames: 'Panel names',
    highlights: 'Front/Base highlight',
    showFull: 'Show Full Artwork',
    history: 'History',
    undo: 'Undo',
    redo: 'Redo',
    back: 'Back',
    saveProject: 'Save Project',
    openProject: 'Open Project',
    diagnostics: 'Diagnostics',
    preview: 'Preview',
    showDieline: 'Show dieline',
    backToEdit: 'Back to edit',
    exportPng: 'Export PNG',
    exportJpg: 'Export JPG',
    dielineSvg: 'Dieline SVG',
    exportPdf: 'Export PDF',
    choosePdfPage: 'Choose PDF page',
    page: 'Page',
    openPage: 'Open page',
    processing: 'Processing artwork…',
    autosaveFailed: 'Could not autosave the project.',
    pdfPageCount: 'This PDF contains {count} pages.',
    pdfPageCancelled: 'PDF page selection was cancelled.',
    artworkLoadFailed: 'Could not load artwork.',
    artworkProcessingCancelled: 'Artwork processing cancelled.',
    replaceConfirm: 'Replace the current artwork?',
    removeConfirm: 'Remove the current artwork?',
    dropOneFile: 'Drop exactly one artwork file.',
    loadBeforeSave: 'Load artwork before saving the project.',
    projectOpened: 'Project opened.',
    projectOpenFailed: 'Could not open the project.',
    exportPngFailed: 'Could not export PNG.',
    exportJpgFailed: 'Could not export JPG.',
    exportPdfFailed: 'Could not export PDF.',
    artworkRequired: 'Artwork is required.',
    effectiveResolution: 'Effective resolution is {dpi} DPI.',
    panelsUncovered: '{count} panel(s) are not fully covered.',
    artworkOutside: 'Part of the artwork is outside the dieline.',
    dimensionsReset: 'Changing the box dimensions will reset the current panel layout. Continue?',
    dimensionsArtworkReset: 'Changing the box dimensions will reset the panel layout and artwork placement. Continue?',
    dimensionsUpdated: 'Box dimensions updated. The layout contains the Front Panel only.',
    invalidDimensions: 'Enter valid positive dimensions.',
    resetLayoutConfirm: 'Reset the current box layout?',
    layoutReset: 'The box layout was reset.',
    panelAdded: '{name} added. {count} of 6 panels placed.{complete}',
    panelRemoved: '{name} removed. {count} of 6 panels placed.',
    boxCompleteSuffix: ' Box net complete.',
  },
  ru: {
    language: 'Язык',
    createBox: 'Создание коробки',
    placeArtwork: 'Размещение макета',
    previewExport: 'Просмотр / Экспорт',
    boxDimensions: 'Размеры коробки',
    width: 'Ширина:',
    height: 'Высота:',
    depth: 'Глубина:',
    designBox: 'Создайте развёртку, добавляя или удаляя панели',
    placedPanels: 'Размещено панелей:',
    continue: 'Продолжить',
    cancel: 'Сбросить',
    dropArtwork: 'Перетащите макет сюда',
    fileHint: 'PNG, JPG или PDF · не более 100 МБ',
    chooseFile: 'Выбрать файл',
    artwork: 'Макет',
    noFile: 'Файл не выбран',
    replace: 'Заменить',
    remove: 'Удалить',
    transform: 'Трансформация',
    centerX: 'Центр X',
    centerY: 'Центр Y',
    scale: 'Масштаб',
    opacity: 'Прозрачность',
    effectiveDpi: 'Эффективное DPI:',
    fitDieline: 'Вписать в развёртку',
    fillDieline: 'Заполнить развёртку',
    center: 'По центру',
    rotateLeft: 'Повернуть −90°',
    rotateRight: 'Повернуть +90°',
    resetTransform: 'Сбросить трансформацию',
    layers: 'Слои',
    layer: 'Слой',
    show: 'Показ',
    lock: 'Блок.',
    dieline: 'Развёртка',
    panelNames: 'Названия панелей',
    highlights: 'Подсветка Front/Base',
    showFull: 'Показывать макет целиком',
    history: 'История',
    undo: 'Отменить',
    redo: 'Повторить',
    back: 'Назад',
    saveProject: 'Сохранить проект',
    openProject: 'Открыть проект',
    diagnostics: 'Диагностика',
    preview: 'Просмотр',
    showDieline: 'Показывать развёртку',
    backToEdit: 'Вернуться к редактированию',
    exportPng: 'Экспорт PNG',
    exportJpg: 'Экспорт JPG',
    dielineSvg: 'SVG развёртки',
    exportPdf: 'Экспорт PDF',
    choosePdfPage: 'Выберите страницу PDF',
    page: 'Страница',
    openPage: 'Открыть страницу',
    processing: 'Обработка макета…',
    autosaveFailed: 'Не удалось автоматически сохранить проект.',
    pdfPageCount: 'В PDF {count} стр.',
    pdfPageCancelled: 'Выбор страницы PDF отменён.',
    artworkLoadFailed: 'Не удалось загрузить макет.',
    artworkProcessingCancelled: 'Обработка макета отменена.',
    replaceConfirm: 'Заменить текущий макет?',
    removeConfirm: 'Удалить текущий макет?',
    dropOneFile: 'Перетащите ровно один файл макета.',
    loadBeforeSave: 'Загрузите макет перед сохранением проекта.',
    projectOpened: 'Проект открыт.',
    projectOpenFailed: 'Не удалось открыть проект.',
    exportPngFailed: 'Не удалось экспортировать PNG.',
    exportJpgFailed: 'Не удалось экспортировать JPG.',
    exportPdfFailed: 'Не удалось экспортировать PDF.',
    artworkRequired: 'Требуется макет.',
    effectiveResolution: 'Эффективное разрешение: {dpi} DPI.',
    panelsUncovered: 'Макет не полностью покрывает панелей: {count}.',
    artworkOutside: 'Часть макета находится за пределами развёртки.',
    dimensionsReset: 'Изменение размеров сбросит текущую раскладку панелей. Продолжить?',
    dimensionsArtworkReset: 'Изменение размеров сбросит раскладку панелей и размещение макета. Продолжить?',
    dimensionsUpdated: 'Размеры коробки обновлены. В раскладке осталась только Front Panel.',
    invalidDimensions: 'Введите корректные положительные размеры.',
    resetLayoutConfirm: 'Сбросить текущую раскладку коробки?',
    layoutReset: 'Раскладка коробки сброшена.',
    panelAdded: '{name} добавлена. Размещено панелей: {count} из 6.{complete}',
    panelRemoved: '{name} удалена. Размещено панелей: {count} из 6.',
    boxCompleteSuffix: ' Развёртка готова.',
  },
};

let locale = 'en';

export function t(key, parameters = {}) {
  const template = messages[locale]?.[key] || messages.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(parameters[name] ?? `{${name}}`));
}

export function getLocale() {
  return locale;
}

export function setLocale(nextLocale, documentRef = document) {
  locale = nextLocale === 'ru' ? 'ru' : 'en';
  documentRef.documentElement.lang = locale;
  for (const element of documentRef.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  try {
    localStorage.setItem('carton-builder-locale', locale);
  } catch {
    // The UI still works when storage is unavailable.
  }
  documentRef.dispatchEvent(new CustomEvent('carton-locale-changed', {
    detail: { locale },
  }));
  return locale;
}

export function initializeI18n(documentRef = document) {
  let saved = 'en';
  try {
    saved = localStorage.getItem('carton-builder-locale') || 'en';
  } catch {
    // Keep English as the deterministic default.
  }
  const picker = documentRef.getElementById('localePicker');
  if (picker) {
    picker.value = saved === 'ru' ? 'ru' : 'en';
    picker.addEventListener('change', () => setLocale(picker.value, documentRef));
  }
  return setLocale(saved, documentRef);
}
