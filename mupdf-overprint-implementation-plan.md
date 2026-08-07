# План: внедрение MuPDF.js для PDF/AI Overprint Preview

Статус: План имплементации ТЗ «Техническое задание по внедрению MuPDF.js для PDF-AI Overprint Preview.htm»
Источник: `docs/Техническое задание по внедрению MuPDF.js для PDF-AI Overprint Preview.htm`
Дата: 2026-08-06

## Статус выполнения

- **Phase 0 (Capability Spike): ЗАВЕРШЕНА.** Вердикт: stock mupdf не симулирует
  overprint → custom WASM обязателен. Отчёт: `docs/10.mupdf-capability-spike.md`,
  референсы Adobe в `scratch/mupdf-spike/refs/`.
- **Phase 1 (Базовый MuPDF-рендерер): РЕАЛИЗОВАНА.** `src/pdf-renderer/` +
  `src/artwork/pdfArtworkLoader.js`; pdf.js-путь удалён; `pdfOverprint.js` удалён;
  overprint-тугл заменён read-only статусом; page box (CropBox default) в source + UI;
  AI-совместимость (`aiNotPdfCompatible`); error codes + i18n; `build.target es2022`;
  unit 263/263, PDF e2e 4/4, smoke 4/4. Контракт: `docs/11. mupdf-overprint-runtime-specification.md`.
- **Phase 2 (Production rendering): РЕАЛИЗОВАНА.** Отмена рендеров (worker `cancel`
  + client session-latest-wins, stale → AbortError); парольный поток
  (`needsPassword`/`authenticate`, диалог `#passwordDialog`, кэш пароля по sha256,
  `pdfInvalidPassword`/`pdfPasswordCancelled`); disclaimer «not a contract color
  proof» в View menu; memory regression тест (60 циклов, bounded growth); unit
  mock-worker тесты клиента + парольные тесты загрузчика. unit 275/275,
  PDF e2e 4/4, smoke 4/4.
- **Phase 3 (Большие artwork): РЕАЛИЗОВАНА.** Tiled rendering (2048 px, overscan 1,
  `Pixmap+DrawDevice+run`, учёт page_ctm/поворота — `tileMath.js`); лимит 32 Мп →
  `pdfRenderTooLarge`; watchdog (timeout 60 с → terminate → recovery,
  `pdfRenderTimeout`); лимиты безопасности (страницы ≤ 5000 → `pdfTooManyPages`,
  disableJS, parsing только в Worker). Тесты: `mupdfTiling.test.js`
  (тайлы = single, rot 0/90 + 4000×2000), watchdog в `mupdfClient.test.js`.
  unit 281/281, PDF e2e 5/5, smoke 4/4.
- **Phase 4 (Custom WASM wrapper): РЕАЛИЗОВАНА.** Пересобраны mupdf 1.28.0 +
  Emscripten 4.0.8 (`scratch/mupdf-src` + `build-mupdf-custom.sh`): glue
  `toPixmapWithOverprint` (режимы 0/1/2 по логике mudraw -M), CMYK→RGB конверсия;
  артефакты в `src/pdf-renderer/custom/`; worker грузит custom (fallback stock);
  overprint-рендер в DeviceCMYK; реальный тогл «Overprint Preview» в View menu
  (глобальная настройка, пере-рендер всех PDF); `getRendererVersion()`/
  `isOverprintAvailable()`. E2E overprint toggle через custom-рендерер.
  unit 281/281, PDF e2e 5/5, smoke 4/4.
- **Phase 5 (Панель сепараций): РЕАЛИЗОВАНА.** Glue: count/names/coverage/
  behaviors (по-плашечные: composite/spot/disabled); worker команда
  `separations` + `separationBehaviors` в рендере; UI «Separations…» (диалог
  C/M/Y/K coverage + spot-eye-toggles, пере-рендер при скрытии плашки);
  `pdfSeparationVisibility` в модели/проекте. E2E «hide and show a spot plate».
  unit 281/281, PDF e2e 6/6, smoke 4/4.

## Решения, зафиксированные с заказчиком

- Полный охват этапов 0–5 ТЗ.
- Phase 0: разрабатывается харнесс + генерируются тестовые PDF; заказчик предоставляет Adobe-референсы для сравнения.
- pdf.js/CSS-multiply путь **полностью заменяется** MuPDF.js; `pdfOverprint.js` удаляется.
- До custom WASM — read-only статус «Overprint Preview: ON»; реальный тугл — на Phase 4.

## Конвенции проекта

- Код — plain ESM JS (не TS), хотя ТЗ показывает TS. Следуем конвенции; типы mupdf доступны через JSDoc.
- Vite уже настроен: `worker.format: 'es'` — подходит для ESM-only `mupdf`.
- Тесты: vitest (`tests/unit`) + Playwright (`tests/e2e`). Проверки: `npm run test:unit`, `npm run build`, `npm run test:e2e:smoke/full`.
- Документация: любая новая/изменённая фича = обновление `docs/README.md` в том же PR (правило `handoff.md` §8).

---

## Phase 0 — Capability Spike (решающий шлюз)

**Цель:** ответить на главную развилку ТЗ §2/§27 — подходит ли stock `mupdf` (overprint simulation активна по умолчанию) или нужен custom WASM.

Deliverables:

1. `scripts/generate-overprint-tests.mjs` — генератор тестовых PDF 01–12 (pdf-lib/mutool): black overprint/knockout, white overprint, OPM 0/1, spot над CMYK, DeviceN, transparency+spot, knockout groups, PDF/X-1a/X-4, AI-совместимый, AI-несовместимый.
2. `scratch/mupdf-spike/` — отдельный харнесс (изолированный от прод-кода): `index.html` + `spike.mjs`, грузит `mupdf`, рендерит каждый тест через `PDFPage.toPixmap(matrix, DeviceRGB, alpha, showExtras, usage, box)` в режимах `"Print"` и `"View"`, сохраняет PNG в `scratch/mupdf-spike/out/`.
3. Скрипт сравнения `scripts/compare-overprint.mjs` — side-by-side сетка (референсы Adobe + mupdf Print + mupdf View).
4. Заказчик предоставляет скриншоты тестов 01–12 из Illustrator (Overprint Preview) и Acrobat Pro (Output Preview → Simulate Overprinting) с одинаковыми page box / zoom / фоном.
5. Отчёт `docs/10.mupdf-capability-spike.md` (status Planned) с результатами и решением.

Проверки (ТЗ §22–23): сохранение/knockout нижнего цвета, исчезновение white overprint, прозрачность, отсутствие RGB halos, spot/DeviceN, границы clipping. Зафиксировать версию mupdf в диагностике.

**Шлюз Phase 0:** stock проходит Adobe-референсы → используем stock; иначе → Phase 4 обязателен для toggle, Phase 1–3 не блокируются.

---

## Phase 1 — Базовый MuPDF-рендерер (замена pdf.js-пути)

### 1.1 Зависимости и конфиг

- `npm install mupdf --save-exact`, сохранить lock-файл.
- Проверить бандлинг ESM `mupdf` + `.wasm` в Vite (`optimizeDeps.exclude` или перенос wasm в `public/`). Зафиксировать в `vite.config.js`.

### 1.2 Новый модуль `src/pdf-renderer/` (ТЗ §5)

```
src/pdf-renderer/
  mupdfClient.js      — фасад UI↔Worker: requestId, отмена, перезапуск worker
  mupdf.worker.js     — долгоживущий worker, 1 на открытый документ (ТЗ §6)
  protocol.js         — WorkerRequest/WorkerResponse (скелет ТЗ §6/§9)
  documentRegistry.js — documentId → Document, .destroy() lifecycle
  renderScheduler.js  — draft/final, debounce, приоритеты, отмена устаревших
  renderCache.js      — LRU-кэш (key ТЗ §16.3), imageBitmap.close(), лимит памяти
  pixelConverter.js   — Pixmap → RGBA (копирование ДО destroy, ТЗ §17)
  aiCompatibility.js  — recognizeContent + openDocument + isPDF() (ТЗ §7)
  rendererDiagnostics.js — RenderDiagnostics (ТЗ §21), без логов содержимого
  types.js
```

### 1.3 Интеграция с существующим кодом

- `fileProcessing.js`: `loadPdf`/`renderPdfPreview` переписать на MuPdfClient. Убрать `openPdfFromBytes`/`renderPdfPageToBlob` (pdf.js) для PDF/AI.
- `fileLoader.js`: сохранить публичный API (`loadArtworkFile`, `renderPdfWithLayers`); PDF/AI идут через новый рендерер; растр/видео остаются на текущем `fileWorker.js`.
- `artworkRasterizer.js`: `rasterizeArtwork` для PDF получает PNG через новый рендерер на требуемом DPI.
- `export/artworkExport.js`: без изменений — эмбедит `originalBlob` (Original File неизменен).
- **Удалить** `src/artwork/pdfOverprint.js` + `tests/unit/pdfOverprint.test.js` (multiply-хак запрещён). `overprintCache`/`getOverprintBytes` удаляются.
- OCG/layers: проверить поддержку layer config в mupdf; иначе — spike-решение (риск для pdf-layers).

### 1.4 AI-совместимость (ТЗ §7)

- `fileValidation.js`: разрешить `.ai` (postscript/octet-stream с PDF-магией). `classifyArtworkFile` → kind `pdf`/`pdf-compatible-ai`.
- Ошибка `AI_NOT_PDF_COMPATIBLE` с текстом про «Create PDF Compatible File» (EN+RU в `i18n.js`).

### 1.5 Page box (ТЗ §11)

- `pageBox` в `source`/previewState артворка (default `CropBox`): CropBox/TrimBox/BleedBox/MediaBox/ArtBox.
- UI: селект «Page area» в инспекторе артворка; при смене — пере-рендер.
- Передаётся в `toPixmap(..., box)`.

### 1.6 Error codes (ТЗ §20)

- Коды + строки EN/RU: `INVALID_PDF`, `CORRUPTED_PDF`, `AI_NOT_PDF_COMPATIBLE`, `INVALID_PASSWORD`, `RENDER_TOO_LARGE`, `RENDER_TIMEOUT`, `WASM_INITIALIZATION_FAILED`, `OUT_OF_MEMORY`, `OVERPRINT_VALIDATION_FAILED`. Существующие `pdfDamaged`, `pdfPasswordProtected`, `pdfPageInvalid`, `artworkFileTooLarge`, `artworkFileUnsupported` — смапить.

### 1.7 Overprint статус (ТЗ §14, stock-ветка)

- Убрать глобальный тугл из View menu; вместо него read-only «Overprint Preview: ON». `overprintSettings.js` упростить.
- Обновить `tests/e2e/overprint.spec.js`.

### 1.8 Persistенс

- `projectSchema.js` (v10): добавить `pageBox` (позже `overprintMode`) с default-ами; при необходимости schema v11 + migration/round-trip тесты.

### 1.9 Тесты Phase 1

- Unit: `protocol`, `pixelConverter`, `aiCompatibility`, `renderCache`, `renderScheduler`, `fileValidation` (.ai), page-box.
- E2E: обновить `pdf-layers.spec.js`, `overprint.spec.js`; новый `page-box.spec.js`.

**Верификация:** `npm run test:unit`, `npm run build`, `npm run test:e2e:smoke`.

---

## Phase 2 — Production rendering (ТЗ §10, §12, §16.4, §17, §18)

- Draft/final качество; приложение не блокируется (рендер в Worker).
- `requestId` (`crypto.randomUUID()`); stale-ответы отбрасываются; отмена при смене zoom/страницы/pageBox/файла.
- LRU-кэш по ключу ТЗ §16.3; учёт памяти; `imageBitmap.close()` при вытеснении.
- Строгий `.destroy()` всех WASM-объектов в `try/finally`; копировать пиксели до `pixmap.destroy()`.
- `usage = "Print"` (по решению spike; критерий ТЗ §12).
- Пароль: `needsPassword()`/`authenticatePassword()` → `PASSWORD_REQUIRED`/`INVALID_PASSWORD`.
- `rendererDiagnostics.js` → `src/diagnostics.js`; без конфиденциального содержимого.
- UI: статус «Overprint Preview: ON» + предупреждение «Monitor preview is not a contract color proof» (ТЗ §13).

**Тесты:** scheduler/cache/diagnostics; memory regression (50–100 циклов open→render→zoom→render→close).

---

## Phase 3 — Большие artwork (ТЗ §16.1–16.3, §19)

- Лимит пикселей на рендер (30–40 Мп); при превышении — tiled rendering (1024/2048 px, overscan 1–2 px), приоритет тайлов по viewport.
- Watchdog worker: terminate → cleanup → новый worker → `RENDER_TIMEOUT`; recovery.
- Лимиты безопасности: размер файла, число страниц, pixel dimensions; parsing только в Worker; без document JS, внешних URL, embedded files (ТЗ §19).
- Stale-render не появляется на экране.

**Тесты:** e2e stress, watchdog recovery, tiled-рендер.

---

## Phase 4 — Custom WASM wrapper (ТЗ §15; если нужно)

- `wasm-wrapper/`: fork mupdf source на зафиксированный tag/commit; API `setOverprintRenderingMode(0|1|2)` (аналог `mutool draw -M`).
- Воспроизводимый build + reference tests на CI; версия в diagnostics.
- Лицензия: AGPL/commercial — шлюз перед production.
- Реальный тугл «Overprint Preview»: OFF → mode 0, ON → mode 1; mode 2 — под separations.
- `overprintMode` в source/previewState + persist.

---

## Phase 5 — Расширенный prepress UI (ТЗ §14–15)

- Панель separations: spot colors, per-plate visibility, ink coverage.
- Output Intent, rendering profile, preflight warnings.
- Только поверх custom WASM (mode 2).

---

## Cross-cutting обязательства

- **Документация:** `docs/10.mupdf-overprint-runtime-specification.md` (Planned → Implemented по фазам), занесение ТЗ в `docs/README.md` как Historical/Input.
- **i18n:** все новые строки EN+RU, aria/keyboard.
- **CI:** `npm run test:unit && npm run build && npm run test:e2e:full` на каждом merge фазы; `git diff --check`.

---

## Риски / открытые вопросы

1. **OCG (слои) в mupdf:** публичный JS API может не отдавать layer config как pdf.js. Проверить в spike.
2. **Многопостраничность + выбор страницы:** сохранить UX поверх нового worker-протокола.
3. **Бандлинг mupdf в Vite** (ESM + wasm) — проверить в Phase 1.1.
4. **Тесты 01–12:** PDF/X-1a/X-4 и DeviceN лучше генерировать не pdf-lib, а через mupdf/mutool.
5. **Лицензия** — шлюз перед Phase 4.
