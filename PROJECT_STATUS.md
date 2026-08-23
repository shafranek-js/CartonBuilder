# CartonBuilder — handoff dual-workflow integration

> Дата сверки: 2026-08-23
>
> Рабочий каталог: `C:\Projects\CartonBuilder_1-stage1`
>
> Ветка: `codex/dual-workflow-stage1`
>
> Базовый HEAD: `bc8c3baa50daab84e5d6bc1281c375e8ead23afe`
>
> Последний commit: `bc8c3ba feat(export): complete technical flat PDF artwork`
>
> Git до обновления этого handoff: clean; после обновления ожидается только
> modified `PROJECT_STATUS.md` до отдельного commit.

Это основной документ для продолжения integration-ветки. Подробный план:
`docs/17. dual-workflow-plugin-integration-plan.md`; накопительные evidence и
история интеграции: `docs/18. integration-manifest.md`.

## 1. Текущая цель и граница

Цель — сохранить полностью совместимый Quick workflow и добавить Technical
workflow на основе Packaging Box Designer (PBD), используя общий CartonBuilder
UI для Place Artwork, Preview и Render, но разные источники геометрии.

Текущий результат:

- Этапы 0–4 и Release 1 gate закрыты в текущей reference-only integration
  границе: выбор workflow, PBD host, Technical Place Artwork, persistence,
  canonical SVG и flat PDF export приняты.
- Quick workflow остаётся рабочим и использует только Custom Net.
- Technical Preview и Technical Render намеренно заблокированы до Этапов 5–8;
  Quick Preview/Render не используются как подмена технического backend.
- Следующая активная цель — завершить Этап 5 в CartonFoldViewer runtime, после
  чего подключить его как Technical Preview в Этапе 6.
- Все technical profiles остаются `referenceOnly=true` и
  `productionCertified=false`. Текущая приёмка не является физической или
  производственной сертификацией конструкции.

Release 1 подтверждён для RTE, STE и TT_SL123/A55: guarded transition,
Technical artwork, autosave/reopen, archive round-trip, canonical SVG export и
1:1 flat PDF export. Preview и Render для Technical по-прежнему disabled.

## 2. Завершённые задачи

### 2.1. Workflow UI и Quick Layout

- Добавлен transient Step `0. Select Workflow` перед `1. Create Box`.
- Новый проект не создаёт фиктивное Quick-состояние. Bootstrap restore блокирует
  Step 0 до результата восстановления; сохранённый проект сразу открывает свой
  workflow/step, а `New Project` возвращает нейтральный Step 0.
- Quick/Technical cards являются native buttons с keyboard/focus,
  `aria-pressed` и локализованными `aria-label`; stepper адаптирован до 320 px.
- Save, Place Artwork, Export и Presets заблокированы до выбора workflow.
- PBD загружается lazy только после выбора Technical.
- Quick Layout больше не показывает Construction Library и устаревшие шаблоны:
  используется только обычный Custom Net. Параметры Custom Net сохранены.
- Quick canvas выполняет fit-to-workspace для Front panel и после каждого
  добавления/удаления панели, поэтому весь net остаётся видимым.
- Во встроенном PBD сохранены Flip Horizontal/Vertical и Rotate 90°; выбранная
  presentation transform применяется к той же геометрии в Place Artwork.

### 2.2. Контракты, плагины и PBD host

- Канонический пакет: `carton-workflow.v1` с `pbd.model.v1` и `pbd.svg.v4`.
- Standalone validators и security scan fail closed проверяют schema, размеры,
  SHA-256, XML, metadata, запрещённые элементы/атрибуты/CSS/URL, path traversal,
  symlinks и offline policy.
- `carton-host.v1` проверяет `event.source`, origin, session id, protocol
  version, payload size, bundle hashes и VALID structural/geometry/contract
  state до любой live mutation.
- Единственный guarded переход в Technical Place Artwork — обычная навигация
  Next/Step 2; отдельной PBD-кнопки `Ready` нет.
- Завендорены автономные `packaging-box-designer@1.2.0` и
  `carton-fold-viewer@2.4.0`; production build зависит только от vendored files.
- `vendor/plugins/` нельзя редактировать вручную. Изменения делаются в producer
  repository, затем синхронизируются `plugins:sync:pbd` или
  `plugins:sync:viewer` и проходят integrity gate.

Текущие pinned artifacts (источник истины —
`vendor/plugins/plugins.manifest.json`):

| Plugin | Source commit | Entrypoint SHA-256 | Manifest SHA-256 |
|---|---|---|---|
| Packaging Box Designer 1.2.0 | `1208f9188e662895cb66a3e3138fa2ac2fadc511` | `1047e4083f1426e43bb413047ebdcddd49388415203ec7ab1469b09c3f208904` | `16a19e1b3311c008052cf3ce6e459ccdceafbb7d5facc52b5f03c649466fad87` |
| CartonFoldViewer 2.4.0 | `ec793810ea28c456ca0e33b60fa5404408e8b778` | `420f9d54f26fcc749bef9b09d38c59d26e71321c3e68027d2c64ee059aadbdae` | `19f4555845e7fb2347b251bd281531626ccc2c11a49b0b9a5d64ac6c7856a8d6` |

### 2.3. Carton domain, persistence и безопасная замена

- `CartonDocument`, `QuickCartonDocument`, `TechnicalCartonDocument` и factory
  задают один discriminated carton source.
- Project schema — v17; `.carton` archive format — v5. Technical model и SVG
  хранятся отдельными Blob entries с hash/size validation.
- RTE, STE и TT_SL123 проходят byte-preserving model/SVG archive round-trip и
  tamper rejection; legacy projects мигрируют в Quick.
- `workflowSelection` хранит намерение пользователя, но не заменяет committed
  `cartonSource` до успешного guarded transition.
- Technical replacement выполняется как транзакция: validate → confirm →
  checkpoint → clear artwork → activate model → update technical assets → reset
  Preview → reset Render → awaited final save.
- Ошибка в любой из шести mutation phases восстанавливает project snapshot,
  blobs, technical assets, Render assets/state и workflow step. Cancel и
  invalid bundle не изменяют live project и checkpoint.

### 2.4. Technical Place Artwork — Stage 4A–4E

- Общий Artwork UI поддерживает PNG/JPEG/PDF, layers, crop, opacity, history,
  move/resize/rotate/flip для Quick и Technical.
- Technical adapter использует canonical LINE/ARC contours и semantic
  CUT/FOLD/OPEN_CUT, точные region masks и PBD presentation plane. ARC остаётся
  ARC в domain/viewport/SVG/raster; cubic Bézier pieces создаются только на PDF
  boundary.
- Исправлено направление всех ARC после Y projection/flip/rotation через
  централизованный `technicalPresentation` и преобразование clockwise.
- Stage 4A: Technical SVG экспортирует canonical `pbd.svg.v4` без DOM
  reserialization, сохраняет PBD metadata и добавляет ровно один
  deterministic provenance с source SHA-256/identity/status.
- Stage 4B: read-only `Front X`/`Front Y` вычисляются относительно точно
  спроецированного `body.front`, не меняя persisted global coordinates.
- Stage 4C: transient semantic snapping покрывает endpoints, finite
  LINE–LINE/LINE–ARC/ARC–ARC intersections, panel centers и exact LINE/ARC
  boundaries. Move, independent/proportional resize и crop используют общий
  zoom-normalized threshold, distance ranking, stable ids и hysteresis;
  Ctrl/Meta bypass сохранён. Quick использует legacy snapping.
- Stage 4D: transient printable/DPI preflight исключает glue/locking surfaces,
  проверяет exact LINE/ARC coverage и классифицирует raster/vector/unknown.
  Неизвестная или недоказуемая геометрия даёт `unknown`; report не сохраняется.
- Stage 4E: flat PDF сохраняет original vector PDF как Form XObject и original
  PNG/JPEG как Image XObject, включая crop, position, independent scale,
  rotation, flips, opacity и layer order. Dieline идёт после artwork в отдельном
  OCG с exact CUT/FOLD/OPEN_CUT paths.
- PDF export fail closed отклоняет invalid/open contours, invalid bounds,
  пустой/CUT-only/FOLD-only Technical dieline, unsupported/corrupt/missing mixed
  artwork sources и invalid transforms. Hidden/finish layers не входят в flat
  PDF.
- Download-level acceptance строит expected geometry через production pipeline
  `TechnicalCartonDocument → technicalBoxModelAdapter → getDielineSegments` и
  сверяет exact CUT/FOLD stroke counts, все ARC cubic-piece counts и каждый
  OPEN_CUT start/end для трёх fixtures.
- Technical production-assist/prepress остаётся fail closed и не изменяет
  canonical PBD model.

### 2.5. CartonFoldViewer foundation

- Viewer 2.4.0 — автономный offline single-file UI с локальным Three.js 0.185.1
  и sandbox `allow-scripts`; внешние network requests запрещены CSP.
- RTE, STE и A55/TT_SL123 строятся, складываются и раскладываются в vendored
  Viewer.
- ESM headless foundation уже предоставляет semantic SVG parse/build,
  `loadSemanticSvg`, animation selection, `setFoldProgress`, getters и
  `dispose`.
- `foldPreview=true`, но `technicalRender=false`. Наличие Viewer package само
  по себе не подключает Technical Preview в Step 3.

## 3. Ключевые технические решения

- `pbd.model.v1` — единственный canonical Technical CartonModel. SVG, artwork
  facade, validation, metrics и будущий 3D runtime не создают конкурирующую
  геометрию.
- PBD SVG presentation transform — ориентация отображения, а не изменение
  canonical model. Все consumers используют общую projection boundary.
- Polygon/tessellation допустимы для hit-testing/GPU, но не вместо LINE/ARC в
  canonical exports.
- Technical SVG берётся из проверенных canonical bytes; generic geometry SVG
  exporter используется только Quick branch.
- Technical replacement имеет один awaited commit boundary. Autosave без await
  не считается успешным завершением транзакции.
- Preview/Render маршрутизируются по carton source. Technical нельзя временно
  показывать через Quick `BoxNetModel`, `Preview3D` или `BoxScene`.
- Diagnostic DPI/coverage не означает разрешение production prepress.
- Plugin catalog и hashes обновляются только транзакционными sync scripts.

## 4. Основные файлы текущей интеграции

| Область | Основные файлы |
|---|---|
| Handoff/plan/evidence | `PROJECT_STATUS.md`, `docs/17. dual-workflow-plugin-integration-plan.md`, `docs/18. integration-manifest.md` |
| Workflow UI/bootstrap | `index.html`, `src/main.js`, `src/styles/main.css`, `src/workflow/workflowSelectionState.js`, `src/ui/FileMenu.js` |
| Technical host/contracts | `src/host/pbdHostProtocol.js`, `src/workflow/`, `schemas/`, `vendor/plugins/plugins.manifest.json` |
| Carton domain/projection | `src/carton/TechnicalCartonDocument.js`, `src/carton/technicalBoxModelAdapter.js`, `src/carton/technicalPresentation.js`, `src/carton/frontRelativeCoordinates.js` |
| Quick Custom Net | `src/carton/QuickCartonDocument.js`, `src/model/quickCustomNet.js`, `src/model/ConstructionTemplates.js` |
| Artwork/geometry | `src/artwork/ArtworkApp.js`, `ArtworkRenderer.js`, `snap.js`, `technicalArtworkPreflight.js`, `src/model/dieline.js` |
| Export | `src/export/technicalSvgExport.js`, `svgExport.js`, `artworkExport.js` |
| Persistence | `src/project/projectSchema.js`, `projectArchive.js`, `ProjectCheckpoint.js`, `PresetStore.js` |
| Acceptance | `tests/e2e/app.spec.js`, `artwork-crop.spec.js`, `tests/unit/artworkExport.test.js`, `technicalArtworkPreflight.test.js`, `tests/unit/carton/`, `tests/unit/snap.test.js` |

Коммиты текущего завершённого среза после прежней handoff-точки `e83ac06`:

- `c34e6aa` — canonical Technical SVG provenance;
- `3e23548` — Step 0, workflow/Quick/PBD UI refinement и persistence gates;
- `460e5e0` — Quick Custom Net fit-to-workspace;
- `c0bd44f` — Technical semantic snapping;
- `12bc388` — printable coverage/DPI preflight;
- `bc8c3ba` — Technical flat PDF/artwork и Stage 4E acceptance.

## 5. Подтверждённые проверки

Повторно запущено на HEAD `bc8c3ba` 2026-08-23:

| Проверка | Результат |
|---|---|
| `npm run plugins:verify` | PASS; 2 vendored plugins, schemas/hashes/CSP/offline scan |
| `npm run test:unit` | 77/77 files, 571/571 tests PASS |
| `npm run build` | PASS; Vite 394 modules |

Полный post-review acceptance, выполненный на содержимом commit `bc8c3ba` до
его фиксации:

| Проверка | Результат |
|---|---|
| `tests/e2e/app.spec.js --workers=1` | 56/56 PASS |
| `tests/e2e/artwork-crop.spec.js --workers=1` | 10/10 PASS |
| `npm run test:e2e:smoke` | 7/7 PASS |
| Technical flat PDF focused E2E | 4/4 PASS |
| `tests/unit/artworkExport.test.js` | 26/26 PASS |
| `graphify update .` | PASS; graph current for committed code |
| `git diff --check` | PASS; CRLF conversion warnings only |

Fixture expectations: RTE 19 ARC, STE 20 ARC, TT_SL123 21 ARC. SVG provenance,
PDF CUT/FOLD/OPEN_CUT, autosave/reopen and archive integrity проверяются
независимо от визуального smoke.

Неблокирующие diagnostics production build:

- Vite externalizes Node builtins из MuPDF browser modules;
- `ProjectStore.js` импортируется статически и динамически, поэтому не выделяется
  в отдельный chunk;
- несколько production chunks превышают 500 kB.

## 6. Известные проблемы и открытые границы

### 6.1. Этап 5 Viewer runtime ещё не завершён

Headless foundation не предоставляет полный утверждённый API/поведение:

- нет global flat-net UV из canonical SVG coordinates и continuity через crease
  ribbons;
- нет `setArtworkAtlas(canvasOrBitmap, maps)` и texture-only update path;
- нет headless `exportGlb()`;
- нет embedded host protocol с ready/load/error/GLB events;
- нет полного resource/disposal acceptance для artwork/geometry replacement.

`loadSemanticSvg` существует, но при реализации публичного Stage 5 API нужно
согласовать утверждённое имя `loadSemanticSvgText(svgText, name)` без создания
второго parser/model path.

### 6.2. Technical Preview, Render и production

- Step 3 и Step 4 disabled для Technical в `src/main.js`; это ожидаемое
  fail-closed состояние до Этапов 6–8.
- Project schema пока не хранит Technical Viewer animation/progress/camera
  state; изменение потребует versioned migration и archive tests.
- Technical Render ждёт общего `RenderSceneSource`, global UV/artwork atlas и
  отдельного visual/export acceptance. `technicalRender=false` сохраняется.
- Production-assist/prepress для Technical не разрешён. Physical dieline,
  converter/material profiles и folded samples не сертифицированы.

### 6.3. Worktree boundary

- Продолжать только в `C:\Projects\CartonBuilder_1-stage1` на
  `codex/dual-workflow-stage1`.
- `C:\Projects\CartonBuilder_1` — отдельный workspace с несвязанными HDRI/UI
  изменениями. Не reset/merge/stage его файлы автоматически.
- Не редактировать `vendor/plugins/` вручную и не копировать файлы из producer
  repositories без sync/integrity flow.

## 7. Опробованные и отвергнутые подходы

- Generic SVG export из geometry facade терял canonical `pbd.svg.v4` metadata и
  provenance. Technical SVG теперь восстанавливается из проверенных source
  bytes и получает узкий provenance block.
- Прямое повторение Cartesian clockwise в Y-down presentation выворачивало ARC
  в обратную сторону. Направление теперь меняется только общей projection
  boundary с determinant-aware transform.
- Замена ARC chord/polyline или декоративным SVG path скрывала бы ошибку и
  расходилась с export geometry; этот подход запрещён.
- Создание checkpoint при входе в PBD перезаписывало безопасное состояние до
  подтверждения. Checkpoint создаётся только после validation и confirm.
- Fire-and-forget final autosave не позволял доказать commit/rollback.
  Transaction использует awaited final save и fault injection всех шести фаз.
- Bounding-box/endpoints-only coverage маскировал gaps и ARC bulges. Diagnostic
  preflight использует analytic LINE/ARC boundary/scanline checks и fail-closed
  `unknown`.
- Проверка PDF только по `cubicCount >= arcCount` и только OPEN_CUT не доказывала
  сохранение всей геометрии. Acceptance теперь сравнивает exact CUT/FOLD cubic
  pieces с production box-model.
- Параллельный запуск full Playwright и `npm run build` против общего `dist`
  давал transient empty DOM/timeouts. Browser suites запускать после build и
  последовательно; изолированные повторы прошли полностью.

## 8. Следующие шаги

1. **Этап 5 — завершить CartonFoldViewer runtime в producer repository.**
   - Зафиксировать один public headless API: `loadSemanticSvgText`,
     `setArtworkAtlas`, `setFoldProgress`, `exportGlb`, `dispose`.
   - Добавить global flat-net UV и crease-ribbon continuity из canonical SVG.
   - Добавить artwork atlas/finish maps с texture-only updates.
   - Реализовать embedded mode и versioned host events.
   - Закрыть RTE/STE/A55 seams, animation, GLB reopen и resource disposal tests.
   - Собрать Viewer, выполнить `plugins:sync:viewer`, затем
     `plugins:verify`, unit/build/smoke. Не патчить vendored artifact вручную.
2. **Этап 6 — Technical Preview.**
   - Маршрутизировать Step 3: Quick → existing Preview3D, Technical → Viewer.
   - Передавать canonical SVG, composed artwork atlas, finish metadata и locale.
   - Versioned-сохранение animation/progress/camera state в project schema.
   - Artwork change обновляет только textures; geometry change полностью
     dispose/rebuild Viewer scene.
   - Закрыть 2D↔3D panel-ID visual gate, GLB gate и 20-cycle resource gate;
     только затем разблокировать Technical Preview.
3. **Этапы 7–8 — Technical Render.**
   - Выделить общий `RenderSceneSource`, сохранив существующий Render UI/studio.
   - Подключить Technical geometry, global UV, artwork и finish maps.
   - Включать `technicalRender=true` только после visual/export acceptance.
4. **Этап 9 — unified release/deployment.**
   - Проверить relative URLs, lazy plugin loading, hashes, offline policy,
     GitHub Pages subpath и браузеры. Не включать GitHub Actions без отдельного
     разрешения владельца.

## 9. Порядок безопасного продолжения

1. Прочитать этот файл полностью.
2. Прочитать `docs/17. dual-workflow-plugin-integration-plan.md`, особенно
   Этапы 5–6, затем релевантный раздел `docs/18. integration-manifest.md`.
3. Проверить Git:

   ```powershell
   Set-Location "C:\Projects\CartonBuilder_1-stage1"
   git status --short
   git log -10 --oneline --decorate
   ```

4. Перед изменениями подтвердить baseline:

   ```powershell
   npm run plugins:verify
   npm run test:unit
   npm run build
   ```

5. Для локальной UI-проверки без предварительной пересборки:

   ```powershell
   npm run dev -- --host 127.0.0.1
   ```

6. После каждого bounded slice выполнить focused tests, полный unit gate,
   relevant Playwright последовательно после build, `plugins:verify`,
   `graphify update .`, `git diff --check` и проверить exact Git status.
