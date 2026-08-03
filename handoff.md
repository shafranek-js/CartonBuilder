# CartonBuilder — Handoff для следующего разработчика

Дата handoff: 2026-08-03

Этот документ описывает фактическое состояние приложения и безопасную точку
продолжения разработки. Нормативные runtime-поведения должны сверяться с
исходниками и тестами; старые research/concept документы не являются описанием
текущего продукта.

## 1. Состояние репозитория

- Рабочая директория: `C:\Projects\CartonBuilder`.
- Текущая ветка: `codex/wave4-packaging-finishes`.
- Базовый коммит: `0ec0f0b Merge production 3D export workflow`.
- Рабочее дерево содержит незакоммиченные изменения Wave 4 и Wave 5; их нельзя
  смешивать с посторонними пользовательскими изменениями.
- Wave 5 добавляет Render preflight, health diagnostics, settled lifecycle API,
  PMREM cleanup, deterministic screenshots и CI quality workflow.

Перед началом работы проверить:

```bash
git status --short
git branch --show-current
git log -5 --oneline
```

## 2. Продуктовый workflow

Приложение имеет четыре шага:

1. **Create Box** — построение шестипанельной развёртки прямоугольной коробки.
2. **Place Artwork** — загрузка и размещение одного или нескольких artwork
   sublayers в millimetre-native координатах.
3. **Preview / Export** — технический 2D proof, интерактивный folded Preview,
   PNG/JPG/SVG/PDF и self-contained 3D HTML export. Настройки разделены на левую
   панель Scene/Export и правую панель Camera/Lighting/Model; обе панели имеют
   независимую прокрутку.
4. **Render** — отдельная presentation-сцена полностью закрытой коробки,
   masked packaging finishes, export preflight/health diagnostics и PNG/JPG,
   turntable или GLB export. Настройки разделены на левую панель Output и
   правую панель Lighting/Effects вокруг viewport.

Step 3 и Step 4 намеренно разделены. Preview остаётся техническим и быстрым;
Render владеет presentation-сценой и тяжёлыми эффектами.

## 3. Архитектура и источники истины

- `src/model/` — `BoxNetModel`, dimensions, topology, fold/cut derivation,
  serialization.
- `src/artwork/` — `ArtworkModel`, несколько artwork entries, transforms,
  crop, viewport, history, file loading, SVG editor renderer.
- `src/project/` — IndexedDB autosave, project schema, `.carton` archive,
  presets.
- `src/preview3d/` — lazy Three.js technical renderer, fold graph, texture
  composer, panel picking, Preview scene presets and lifecycle.
- `src/render/` — Render settings, solid presentation geometry, Render scene
  model, post-processing, quality states, named Render presets, preflight,
  diagnostics and still/turntable/GLB export.
- `src/export/` — raster, SVG, PDF and preflight adapters.
- `src/ui/` — box editor, menus, settings, theme and shared UI controls.
- `src/main.js` — workflow navigation, app wiring, autosave callbacks and
  Preview/Render activation lifecycle.

Canonical state is `BoxNetModel + ArtworkModel[]`. SVG, PDF, Preview and Render
are adapters and must not become alternate sources of transform or geometry
state. Render and Preview must keep separate mutable Three.js resources.

## 4. Artwork и Image Crop

### Multiple artwork

`ArtworkApp` хранит массив `artworks`. Новый обычный file drop добавляет entry;
Replace заменяет активный entry после подтверждения. Artwork sublayers поддерживают
visibility, lock, selection, rename, duplicate, delete и reorder. Архив хранит
несколько оригинальных assets и previews.

### Transform

- Все domain coordinates хранятся в mm.
- Rotation ограничен quarter turns: 0/90/180/270°.
- Width/Height показывают видимую геометрию artwork.
- Transform panel использует общую grid-разметку; chain находится между W/H.
- `Constrain proportions` включён по умолчанию, но может быть выключен. При
  выключенном состоянии pointer resize и numeric controls допускают независимые
  Scale X/Scale Y.
- Crop и обычные handles имеют постоянный экранный размер.
- Пустое место 2D canvas можно панорамировать drag правой кнопкой мыши; middle
  mouse и Space + drag также используются для pan.

### Crop

Crop неразрушающий: оригинальный asset и скрытые пиксели сохраняются.

- `Crop` редактирует frame.
- `Draw` рисует новую прямоугольную область.
- Apply/Enter применяет preview; Escape отменяет.
- `Clear` удаляет маску, но сохраняет последующие move/scale/rotation.
- После Apply crop становится видимой геометрией artwork, Scale rebased в 100%,
  artwork остаётся выбранным.
- Frame поддерживает corner и side handles.
- Apply и Clear входят в Undo/Redo; transient overlays должны исчезать после
  Undo/Redo.

## 5. Box Dimensions

Есть две группы dimension controls:

- Create Box controls сверху страницы — изменение dimensions может сбросить
  topology и после подтверждения placement.
- Artwork-step `Box Dimensions` — изменяет box dimensions и dieline, но не
  подгоняет активный artwork; его transform должен остаться прежним.

Иконки dimensions работают как scrubbers: Width — горизонтальный drag, Height —
вертикальный, Depth — диагональный. Базовый шаг 0.1; Ctrl/Cmd — 1; Alt — 0.01.
Отдельный box-proportions chain связывает Width/Height/Depth.

## 6. Technical Preview

Preview загружает Three.js лениво после входа на шаг. Он поддерживает:

- Open/Fold/slider и текущий fold progress;
- Perspective/Orthographic projection;
- isometric/front/top/right camera views, FOV и Reset View;
- Technical/Studio/Photorealistic styles;
- environment, ambient/light, background и shadow controls;
- panel picking и inspector;
- пользовательские scene presets (Save/Apply/Delete);
- WebGL2 recovery surface без потери 2D/export workflow.

UI Preview использует три колонки: слева сцена и экспорт, в центре viewport,
справа камера, свет, тени и модель. При узком viewport панели складываются под
центральной областью и прокручиваются независимо.

Preview не должен использовать Render-only GTAO, TAA, DOF, solid presentation
geometry или path tracing.

## 7. Presentation Render

Render активен только при полной коробке и наличии artwork. Сцена всегда
создаётся с `foldProgress = 1` и не разделяет mutable state с Preview.

Текущий Render MVP/Milestone 2 включает:

- Clean Studio, Catalogue, Soft Grey, Transparent presets;
- Front, Front-right, Front-left, Top-front, Isometric, Custom cameras;
- perspective/orthographic projection;
- 1:1, 4:3, 16:9, 3:4 frame;
- 2048/4096 long edge;
- Uncoated/Matte/Gloss profiles;
- Render-only thickness, bevel, interior and edge colors;
- lighting/environment/exposure/background/shadow controls;
- GTAO, SMAA/native AA, TAA and optional DOF in Render pipeline;
- interactive → settled → export quality states;
- diagnostics drawer;
- named Render presets, где board appearance сохраняется только preset-ом;
- offscreen PNG/JPG export without `preserveDrawingBuffer: true`;
- transparent PNG with optional shadow catcher; JPG всегда opaque.

UI Render использует три колонки: слева output-настройки, в центре экспортный
viewport, справа lighting/background/shadows/effects и diagnostics. На узких
экранах viewport остаётся первым, а панели располагаются вертикально.

Feature flags:

- `VITE_ENABLE_RENDER_EFFECTS=true` — raster effects enabled by default;
- `VITE_ENABLE_RENDER_PATH_TRACING=false` — gated experimental path tracing.

Path tracing не является production pipeline и не должен включаться автоматически.
WebGPU, CMYK/ICC/Pantone/overprint и print-proof validation находятся вне scope.

## 8. Persistence и версии

- Current project schema: **v10** (`src/project/projectSchema.js`).
- v2 → v10 migrations add per-artwork quality/finish roles and Render board
  appearance while preserving artwork, box, history and view state.
- `.carton` archive manifest export version: **3**.
- Legacy manifest versions 1 and 2 поддерживаются на import.
- Current archive stores arrays of artwork assets/previews and optional Render
  background assets addressed by SHA-256 asset ID.
- IndexedDB stores: `projects`, `presets`, `scenePresets`, `renderPresets`.
- Project snapshot сохраняет canonical artwork/box state и Render settings;
  GPU handles, renderer diagnostics, progress and other transient Three.js state
  не сохраняются.

При изменении schema или archive сначала добавить migration/round-trip tests и
проверить старые v1/v2/v3/v4 snapshots.

## 9. Тестирование и проверка

Основные команды:

```bash
npm install
npm run test:unit
npm run build
npm run test:e2e
npm run test:e2e:ci
npm run test:visual
npm run test:all
npm run dev
```

Полезные тесты:

- `tests/e2e/app.spec.js` — workflow, dimensions, multiple artwork, menus,
  autosave and project round-trip;
- `tests/e2e/artwork-crop.spec.js` — crop, side handles, non-proportional resize,
  right-button canvas pan and crop history;
- `tests/e2e/preview3d.spec.js` — Preview lifecycle, scene presets, WebGL,
  resource cleanup and HTML export;
- `tests/e2e/render.spec.js` — Render navigation, settings persistence, preflight,
  deterministic baselines, context recovery, resource stress and export;
- `tests/unit/ArtworkModel.test.js`, `ArtworkRenderer.test.js` — transform/crop
  invariants;
- `tests/unit/projectSchema.test.js`, `projectArchive.test.js` — migrations and
  archive compatibility;
- `tests/unit/Render*.test.js`, `panelSolidGeometry.test.js` — Render pipeline.

Для визуальной проверки использовать desktop Chromium/Edge примерно от
1024×720. Проверять отдельно: Crop Apply → Undo → Redo, Clear после последующих
transformations, side handles при zoom, non-proportional resize, dimensions без
fit artwork, Preview → Render isolation, Export preflight, Diagnostics health,
transparent PNG alpha и повторные 2K/4K exports.

## 10. Известное состояние документации

Статусная карта и правила поддержки находятся в
[`docs/README.md`](<C:/Projects/CartonBuilder/docs/README.md>). Канонические
runtime-документы:

- `README.md` — краткая карта продукта и запуск;
- `docs/3. artwork-placement-runtime-specification.md` — 2D/Preview runtime;
- `docs/9. render-runtime-specification.md` — Render runtime.

Перед выпуском документации нужно исправить следующие расхождения:

1. Исправить `Aspect ratio is always locked` в оставшихся historical/runtime
   формулировках.
2. Описать archive manifest v2 и multi-asset paths.
3. Разделить фиксированные системные layers и динамические artwork sublayers.
4. Добавить right-button canvas pan и side crop handles.
5. Описать различие Box Dimensions на Create Box и Artwork steps.
6. Уточнить в Implemented-документах Settings, File/Edit menus, Box Presets,
   scene presets, Render preflight и diagnostics.
7. Устранить противоречие README о material thickness.

`docs/0`, `docs/1`, `docs/2`, `docs/3` answers, `docs/5`, `docs/5a`, `docs/6`,
`docs/7` и `docs/8` содержат исходные требования, research или roadmap. Их нужно
пометить как Historical/Research/Planned либо обновить, если они должны быть
нормативными. В частности, `docs/5a` всё ещё описывает три шага и schema v1.

## 11. Рекомендуемый порядок следующей работы

1. Не начинать с новой функциональности, пока не сохранены незакоммиченные
   изменения README/runtime spec.
2. Привести README и две runtime-спецификации к фактическому состоянию,
   начиная с multi-artwork, schema/archive и transform semantics.
3. Поддерживать `docs/README.md` в том же PR, что и изменения функциональности;
   новый документ добавлять туда с одним статусом и владельцем.
4. Запустить unit, build и полный E2E; отдельно выполнить browser smoke-check.
5. После подтверждения текущего состояния выбрать следующий feature milestone.
6. Любое изменение canonical model сопровождать schema/history/archive tests и
   проверкой 2D Preview Render export parity.

## 12. Правила безопасной разработки

- Не мутировать `BoxNetModel` или `ArtworkModel` из Preview/Render adapters.
- Не смешивать mutable Three.js resources Preview и Render.
- Не сохранять GPU state, render progress или diagnostics в project snapshot.
- Сохранять оригинальный artwork отдельно от preview/composited textures.
- Для файловых изменений использовать `apply_patch`; не делать destructive
  reset/checkout без явного разрешения.
- После изменений UI проверять EN/RU strings, aria labels, keyboard handling и
  responsive layout.
- Перед commit проверить `git diff`, `git diff --check`, unit tests и build.

## Быстрый старт для следующего разработчика

```bash
cd C:\Projects\CartonBuilder
git status --short
npm run test:unit
npm run build
npm run dev
```

Сначала откройте `README.md`, затем runtime specs и этот handoff. Если задача
касается 2D artwork, начинайте с `ArtworkModel.js`, `ArtworkApp.js` и
`ArtworkRenderer.js`; если касается Render — с `RenderSettings.js`,
`RenderSceneModel.js`, `WebGLCartonRenderer.js`, `RenderPostProcessing.js` и
`StillRenderService.js`.
