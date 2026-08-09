# PROJECT_STATUS.md — Состояние проекта CartonBuilder

> **Дата обновления:** 2026-08-09
> **Статус этапа:** Реализировано ядро и UI renderer+plates; выпускной Adobe reference matrix ещё не закрыт. Это не заявление о 100% корректности.

---

## 1. Текущие цели проекта

- **Оверпринт (Overprint Preview):** семантически проверенное смешивание CMYK/ICCBased CMYK и Spot для текущих PDF/PDF-compatible AI fixtures; Acrobat/Illustrator fixture matrix 00–12 остаётся release gate.
- **Стабильный 3D превью:** Отсутствие ошибок WebGL и сбоев текстур при динамической смене качества/разрешения текстур и переключении режимов оверпринта.
- **Высокая производительность:** Рендеринг векторных макетов высокого разрешения через WebAssembly в Web Worker с кешированием и авто-тайлингом.

---

## 2. Завершённые задачи на текущем этапе

1. **Устранение WebGL сбоев в 3D Preview (Three.js):**
   - Устранена критическая ошибка `WebGL: INVALID_OPERATION: texImage3D: FLIP_Y or PREMULTIPLY_ALPHA isn't allowed for uploading 3D textures`.
   - В [`src/preview3d/BoxScene.js`](file:///c:/Projects/CartonBuilder/src/preview3d/BoxScene.js) и [`src/export/interactive3dExport.js`](file:///c:/Projects/CartonBuilder/src/export/interactive3dExport.js) добавлена установка `texture.flipY = false` для объектов `CanvasTexture` и сброс состояния рендерера `renderer.state.setFlipY(false)` / `renderer.state.setPremultiplyAlpha(false)`.

2. **Минимальные ядерные исправления C-Core MuPDF для файлов `test.pdf` и `test.ai`:**
   - **`test.pdf` (операторы `k`/`K`)**:
     - В [`scratch/mupdf-src/source/fitz/draw-device.c`](file:///c:/Projects/CartonBuilder/scratch/mupdf-src/source/fitz/draw-device.c) настроено сохранение исходных значений красок в `resolve_color` при совпадении субтрактивных CMYK-пространств (`src_is_cmyk && dst_is_cmyk`).
   - **`test.ai` (пространство `/CS0` `/ICCBased` CMYK, ExtGState `/op`)**:
     - DeviceCMYK и четырёхканальный ICCBased CMYK считаются совместимыми только для OPM-решения; штатная ICC-конверсия самих цветов сохранена.
     - В [`scratch/mupdf-src/source/fitz/draw-device.c`](file:///c:/Projects/CartonBuilder/scratch/mupdf-src/source/fitz/draw-device.c):
       - `set_op_from_spaces` и `cs_has_matching_colorant` дополнены фолбэком на имена CMYK-красок (`Cyan`, `Magenta`, `Yellow`, `Black`), если у ICC-профиля отсутствуют имена красок.
       - `resolve_color` строит OPM 1 mask по исходным PDF-компонентам (`color[i] < 0.001f`), устраняя шум ICC-конверсии.
     - В [`scratch/mupdf-src/source/pdf/pdf-page.c`](file:///c:/Projects/CartonBuilder/scratch/mupdf-src/source/pdf/pdf-page.c): `pdf_extgstate_uses_overprint` обновлена для проверки как `/OP` (stroke), так и `/op` (fill).
     - Экспериментальные глобальные подмены Output Intent/DeviceCMYK и обходы transparency/group logic удалены.

3. **Единый native single/tiled путь и plates:**
   - Worker использует native MuPDF tile API с `fz_separations`, `usage="Print"`, page box, spot behaviors и process mask; JS `Pixmap + DrawDevice` overprint-путь удалён.
   - `overprintMode` 0/1/2, `processMask` C=1/M=2/Y=4/K=8 и `spotBehaviors` включены в protocol/cache key.
   - Separations dialog переключает C/M/Y/K и spot-плашки; состояние хранится в schema v15 в форме process/spots и мигрирует из flat object.

4. **Codex Review remediation (geometry, prepress and runtime):**
   - STE/RTE child hinges use the negative local center offset and are checked at open, half-fold and closed states.
   - Production-assist applies glue/tuck allowances only to derived geometry, joins CutContour into closed contours and uses all structural elements for texture masks.
   - Prepress PDF uses TrimBox/BleedBox/MediaBox from their respective bounds, embeds artwork inside the Artwork OCG, honors configured spot names and emits the technical overprint ExtGState only when enabled. Prepress SVG is asynchronous and embeds rasterized visible artwork in the bleed-clipped Artwork group.
   - Preflight exports recompute against a box/artwork/settings signature. Render clears its canvas when no artwork is visible, rebinds post-processing after camera replacement, and preserves artwork transforms/history after dimension changes. Lazy Preview setters are generation-safe and locked artwork cannot be removed through public actions.

---

## 3. Ключевые технические решения

- **Кастомный build MuPDF WASM:** MuPDF tag `1.28.0` (commit `205b8cf43551279d1215e88fe2845c5d595bade9`) и Emscripten `4.0.8` собираются POSIX-скриптом [`scripts/build-mupdf-wasm.sh`](file:///c:/Projects/CartonBuilder/scripts/build-mupdf-wasm.sh); patch series — [`patches/mupdf/0001-overprint-core-and-wasm-api.patch`](file:///c:/Projects/CartonBuilder/patches/mupdf/0001-overprint-core-and-wasm-api.patch). Исходники/build objects игнорируются, production glue/WASM — в [`src/pdf-renderer/custom/`](file:///c:/Projects/CartonBuilder/src/pdf-renderer/custom/).
- **Условие включения оверпринта:** native path создаёт destination `DeviceCMYK` и `fz_separations`; RGB-конверсия выполняется после обнуления скрытых process channels, spot channels сохраняются до штатного color resolution.
- **Three.js WebGL State Management:** Обязательный сброс WebGL параметров `flipY` и `premultiplyAlpha` перед вызовами `PMREMGenerator.fromScene()` защищает 3D-сцену от сбоев при загрузке текстур в кубические карты.

---

## 4. Изменённые и основные файлы проекта

| Файл | Описание изменений |
|---|---|
| [`src/preview3d/BoxScene.js`](file:///c:/Projects/CartonBuilder/src/preview3d/BoxScene.js) | Сброс состояния WebGL-рендерера перед отрисовкой сцены и окружения |
| [`src/export/interactive3dExport.js`](file:///c:/Projects/CartonBuilder/src/export/interactive3dExport.js) | Сброс WebGL параметров `flipY` / `premultiplyAlpha` в экспорте 3D |
| [`src/pdf-renderer/mupdf.worker.js`](file:///c:/Projects/CartonBuilder/src/pdf-renderer/mupdf.worker.js) | Единый native single/tiled renderer, process mask и spot behaviors |
| [`src/pdf-renderer/custom/mupdf.js`](file:///c:/Projects/CartonBuilder/src/pdf-renderer/custom/mupdf.js) | Generated MuPDF.js glue: native tile and RGB process-mask APIs |
| [`src/pdf-renderer/custom/mupdf-wasm.wasm`](file:///c:/Projects/CartonBuilder/src/pdf-renderer/custom/mupdf-wasm.wasm) | Собранный кастомный бинарник WASM с правками движка |
| [`scratch/mupdf-src/source/fitz/draw-device.c`](file:///c:/Projects/CartonBuilder/scratch/mupdf-src/source/fitz/draw-device.c) | Minimal colorant fallback and source-component OPM mask |
| [`scratch/mupdf-src/source/pdf/pdf-page.c`](file:///c:/Projects/CartonBuilder/scratch/mupdf-src/source/pdf/pdf-page.c) | Проверка обоих атрибутов `/OP` и `/op` в ExtGState |
| [`patches/mupdf/0001-overprint-core-and-wasm-api.patch`](file:///c:/Projects/CartonBuilder/patches/mupdf/0001-overprint-core-and-wasm-api.patch) | Reproducible tracked MuPDF core and WASM wrapper patch |

---

## 5. Результаты тестирования и проверки

- **Native/reference probes (`scripts/test-mupdf-overprint.mjs`):**
  - **`test.pdf`**:
    - Overprint OFF → штатный рендер без наложения.
    - Overprint ON → Cyan+Yellow дают **Зеленый**, Magenta+Yellow дают **Красный**, Black дает **Rich Black**.
  - **`test.ai`**:
    - Overprint OFF → штатный рендер.
    - Overprint ON → реальные RGB-пробы меняются только в overprint-группе; контрольная knockout-группа сохраняется.
  - Проверены mode 0/1/2, process mask и single/tiled parity без Blob-size assertions.
- **WebGL 3D Preview Check:**
  - 0 консольных ошибок WebGL при рендере 3D-модели и переключении качества/оверпринта.

---

## 6. Известные проблемы и ограничения

- **Adobe reference matrix:** требуется получить Acrobat Output Preview и Illustrator Overprint Preview для fixtures 00–12 и сравнить semantic regions с допуском anti-aliasing.
- **Output Intent/profile/preflight:** остаются вне этого этапа.
- **AGPL compliance:** до публикации необходимы полный соответствующий исходный код, notices и review владельца продукта/юриста.

---

## 7. Опробованные, но НЕ сработавшие подходы

1. **Принудительная подмена всех цветов на `DeviceCMYK` в `pdf_set_colorspace` без проверки на 4 канала:**
   - *Результат:* Приводило к критическим ошибкам рендера на 1-канальных (Grayscale) и 3-канальных (RGB) объектах PDF.
2. **Принудительное перенаправление всех Overprint-рендеров в `renderTiled` в `mupdf.worker.js`:**
   - *Результат:* В JS-тайлинге у `DrawDevice` параметр `dest->seps` равен `NULL`, в результате чего `overprint_possible` сбрасывался в `0` и оверпринт полностью отключался.
3. **Обнуление оверпринт-маски при любом расхождении `colorspace != dest->colorspace` в `resolve_color`:**
   - *Результат:* Полностью блокировало оверпринт для Illustrator файлов (`.ai`), оборачивающих краски в `/ICCBased` профили (`/CS0`).

---

## 8. Следующие шаги разработки

1. Закрыть Adobe reference matrix fixtures 00–12 и добавить результаты в diagnostics.
2. Прогнать полный Playwright/memory/watchdog gate на чистом custom build.
3. Выполнить AGPL/commercial licensing review перед распространением.
