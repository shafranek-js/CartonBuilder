# План реализации двух workflow и двух встроенных компонентов

## 1. Целевая архитектура

CartonBuilder остаётся единым пользовательским приложением с двумя ветками:

```text
Create Box
├─ Quick Layout
│  ├─ Legacy BoxNetModel
│  ├─ общий Place Artwork
│  ├─ текущий Preview
│  └─ текущий Render
│
└─ Technical Dieline
   ├─ Packaging Box Designer
   ├─ общий Place Artwork
   ├─ CartonFoldViewer
   └─ Technical Render Scene Source
```

Исходные проекты остаются отдельными репозиториями. CartonBuilder публикует зафиксированные runtime-артефакты обоих компонентов как часть одного GitHub Pages сайта.

Реализация выпускается поэтапно:

1. Release 1: выбор workflow, Packaging Box Designer, Technical Place Artwork, сохранение и плоский экспорт.
2. Release 2: CartonFoldViewer в Step 3 с artwork.
3. Release 3: Technical Render в Step 4 и единая публикация всех возможностей.

Незавершённые этапы скрываются capability flags, а не показываются как сломанные функции.

---

## 2. Публичные контракты

### 2.1. Workflow bundle

Packaging Box Designer должен отдавать один versioned bundle:

```js
{
  contractVersion: "carton-workflow.v1",
  workflowMode: "technical",

  source: {
    producer: "packaging-box-designer",
    engineVersion: "1.2.1",
    modelSchemaVersion: "pbd.model.v1",
    svgSchemaVersion: "pbd.svg.v4",
    artifactSha256: "...",
    cartonType: "RTE | STE | TT_SL123",
    profileIds: ["..."],
    referenceOnly: true,
    productionCertified: false
  },

  modelJson: { /* неизменённый pbd.model.v1 */ },

  semanticSvg: {
    assetId: "...",
    sha256: "...",
    units: "mm"
  },

  capabilities: {
    artwork2d: true,
    flatExport: true,
    foldPreview: true,
    technicalRender: true
  }
}
```

`pbd.model.v1` остаётся канонической семантической моделью. `pbd.svg.v4` — детерминированное производное представление той же модели для точных 2D-контуров и Fold Viewer. Их версии, engine identity и SHA-256 всегда проверяются совместно.

В host-режиме Packaging Box Designer экспортирует SVG в канонической ориентации с identity transform. Презентационные Flip/Rotate скрываются, чтобы JSON и SVG не расходились по координатам.

### 2.2. Host protocol

Оба iframe используют один протокол:

- `host:init` — session ID, locale, capabilities и разрешённый origin.
- `plugin:ready` — плагин загрузился и готов принять команды.
- `pbd:carton-ready` — проверенный workflow bundle.
- `viewer:load` — SVG, artwork atlas и finish maps.
- `viewer:model-loaded` — модель построена.
- `plugin:error` — структурированная ошибка.
- `host:cancel` — возврат без изменения проекта.

Каждое сообщение проверяет `origin`, `event.source`, `sessionId`, contract version, размер payload и SHA-256. Неизвестные сообщения и HTML/скрипты вне ожидаемого SVG-контракта отклоняются.

### 2.3. Общие runtime-интерфейсы

В CartonBuilder вводятся три границы:

```js
CartonDocument {
  mode;
  isComplete;
  dimensions;
  board;
  getBounds();
  getArtworkSurfaces();
  getDielinePrimitives();
  getArtworkMaskPaths();
  getSourceIdentity();
  serialize();
}

TechnicalSceneRuntime {
  build({ semanticSvg, artworkAtlas, materialMaps });
  setFoldProgress(value);
  replaceArtwork(artworkAtlas, materialMaps);
  createPortableScene();
  getDiagnostics();
  dispose();
}

RenderSceneSource {
  buildScene();
  replaceArtwork();
  setBoardAppearance();
  createPortableScene();
  getBounds();
  dispose();
}
```

Реализации:

- `QuickCartonDocument` → существующий `BoxNetModel`;
- `TechnicalCartonDocument` → `pbd.model.v1 + pbd.svg.v4`;
- `LegacyRenderSceneSource` → текущий `BoxScene`;
- `TechnicalRenderSceneSource` → CartonFoldViewer runtime.

---

## 3. Пошаговая реализация

### Этап 0. Зафиксировать baseline и защитить существующую работу

1. В каждом репозитории создать отдельную integration-ветку с префиксом `codex/`.
2. Не включать в коммиты существующие пользовательские изменения:
   - HDRI и UI-изменения CartonBuilder;
   - `tmp/` Packaging Box Designer;
   - незакоммиченные диагностические тесты CartonFoldViewer.
3. Зафиксировать в integration manifest:
   - CartonBuilder commit;
   - Packaging Box Designer commit и candidate `1.2.0`;
   - CartonFoldViewer commit `8b96f57`, viewer `2.3.0`;
   - версии `pbd.model.v1` и `pbd.svg.v4`.
4. Запустить baseline:
   - CartonBuilder: unit, build, smoke E2E;
   - PBD: текущие geometry/parity/readiness suites;
   - Viewer: `npm test`, ожидается 9/9.
5. После каждого последующего среза выполнять `git diff --check`; после изменений CartonBuilder запускать `graphify update .`.

Готовность этапа: все baseline-команды записаны, результаты воспроизводимы, пользовательские файлы не затронуты.

### Этап 1. Создать общий contract package и plugin packaging

1. В Packaging Box Designer выделить чистый пакет контракта:
   - envelope validator;
   - `pbd.model.v1` validator;
   - `pbd.svg.v4` metadata validator;
   - SHA-256/integrity helpers;
   - допустимые carton types и capability names.
2. Пакет не должен зависеть от UI, Three.js или Node-only API.
3. Packaging Box Designer выпускает:
   - standalone host artifact;
   - contract package tarball;
   - manifest с версией и hash.
4. CartonFoldViewer выпускает:
   - standalone iframe artifact;
   - headless fold-runtime package;
   - manifest с версией и hash.
5. CartonBuilder хранит зафиксированные артефакты внутри `vendor/plugins` и проверяет hashes при `npm ci/build`.
6. Добавить `plugins.manifest.json` с версиями, schemas, capabilities и относительными URL.
7. CI не обращается к соседним `C:\Projects\...`: обновление vendored-артефакта выполняется отдельной явной sync-командой и коммитится вместе с manifest.

Готовность этапа: CartonBuilder собирается без соседних репозиториев и без CDN.

### Этап 2. Ввести CartonDocument и новую проектную схему

1. Заменить прямые зависимости Artwork/workflow/export от `BoxNetModel` на `CartonDocument`.
2. Существующий Quick workflow обернуть адаптером без изменения поведения.
3. Реализовать `TechnicalCartonDocument`:
   - exact LINE/ARC primitives из PBD;
   - панели и маски из semantic regions;
   - fold/cut roles;
   - bounds, dimensions, caliper и provenance.
4. Повысить project schema `15 → 16`.
5. Ввести discriminated state:

```js
cartonSource:
  { mode: "quick", box: BoxNetState }
  |
  {
    mode: "technical",
    source: WorkflowSourceIdentity,
    modelJson: PbdModelV1,
    semanticSvgAssetId: string,
    modelSha256: string,
    svgSha256: string
  }
```

6. Повысить `.carton` archive `4 → 5`:
   - `project.json`;
   - `technical/model.json`;
   - `technical/dieline.svg`;
   - `technical/manifest.json`;
   - существующие artwork/render assets.
7. Миграция archive v4/schema v15 всегда создаёт `mode:"quick"`.
8. При загрузке technical project проверять оба hash и schemas до изменения live state. При несовпадении загрузка блокируется с понятной ошибкой.
9. IndexedDB autosave должен сохранять technical assets как Blob, а не дублировать SVG-текст в каждом history snapshot.

Готовность этапа: все старые `.carton` открываются без изменений, Quick regression остаётся зелёной, технический fixture проходит save/open round-trip byte-for-byte.

### Этап 3. Реализовать выбор workflow и host-режим PBD

1. В Step 1 показать две карточки:
   - `Quick Layout — Legacy Custom Net`;
   - `Technical Dieline — Packaging Box Designer`.
2. Выбор сохраняется сразу в проекте; карточка Technical показывает статус `Reference-calibrated`, а не `Production-certified`.
3. Quick открывает существующий конструктор без функциональных изменений.
4. Technical открывает полноэкранный same-origin iframe PBD с:
   - Back;
   - Reset;
   - Ready — Continue to Artwork;
   - текущим статусом validation.
5. Ready доступна только при:
   - `structural=VALID`;
   - `geometry=VALID`;
   - успешной проверке JSON и SVG contracts.
6. PBD одним действием строит JSON и canonical SVG из одного `currentModel`, вычисляет hashes и отправляет bundle.
7. CartonBuilder повторно валидирует bundle, создаёт `TechnicalCartonDocument`, сохраняет его и переводит пользователя в Step 2.
8. Поддержать RTE, STE и TT_SL123/A55.
9. Возврат к редактированию:
   - перед открытием PBD создаётся checkpoint текущего проекта;
   - если Ready возвращает новый model hash, показывается подтверждение;
   - после подтверждения очищаются artwork, history, finish masks, Preview и Render caches;
   - checkpoint остаётся доступен как предыдущая версия;
   - Cancel или ошибка ничего не меняют.

Готовность этапа: каждый из трёх carton types проходит путь Select → Generate → Ready → Step 2.

### Этап 4. Technical Place Artwork

1. Использовать существующий Artwork UI, модели слоёв, crop, opacity, PDF/AI processing и history.
2. Для technical branch заменить геометрический backend:
   - SVG paths отображаются без выпрямления дуг;
   - CUT/FOLD/OPEN_CUT берутся из semantic roles;
   - маски строятся из точных region contours;
   - polygon tessellation применяется только для hit-testing/GPU, не для экспорта.
3. Добавить snapping:
   - к вертикальным/горизонтальным LINE;
   - к endpoint/intersection;
   - к ближайшей точке ARC;
   - к центрам и границам семантических панелей.
4. Координаты artwork хранятся в глобальных миллиметрах canonical SVG. UI дополнительно показывает положение относительно `body.front`.
5. Coverage/DPI/preflight используют semantic panels, исключая glue/locking surfaces там, где они не являются печатными.
6. Реализовать technical flat export:
   - artwork остаётся в существующем векторном или растровом качестве;
   - CUT/FOLD/feature paths переносятся без изменения;
   - SVG сохраняет PBD metadata и provenance;
   - PDF 1:1 поддерживает LINE/ARC/Bézier paths и отдельный Dieline layer;
   - никакая prepress-компенсация не изменяет канонический PBD CartonModel.
7. Все предупреждения сохраняют `referenceOnly=true` и `productionCertified=false`.

Release 1 gate:

- Quick workflow полностью регрессионно совместим.
- Все три technical конструкции проходят Ready, artwork, autosave, reopen, SVG/PDF export.
- Technical Preview и Render скрыты flags до следующих этапов.

### Этап 5. Подготовить CartonFoldViewer как runtime

1. Выпустить Viewer `2.4.0`.
2. Перевести Three.js `0.180.0 → 0.185.1` отдельным срезом и повторить все geometry/collision regressions.
3. Удалить runtime-зависимость от jsDelivr; Three.js и addons поставляются локально.
4. Вынести parser, model builder, geometry и animation в headless runtime без UI.
5. Добавить API:
   - `loadSemanticSvgText(svgText, name)`;
   - `setArtworkAtlas(canvasOrBitmap, maps)`;
   - `setFoldProgress(value)`;
   - `exportGlb()`;
   - `dispose()`.
6. Добавить глобальные flat-net UV:
   - вычислять из canonical SVG coordinates и canvas/viewBox;
   - сохранять одинаковую ориентацию на всех панелях;
   - продолжать UV через finite crease ribbons;
   - не использовать локальные автогенерируемые UV `ExtrudeGeometry`.
7. Host UI Viewer использует тот же headless runtime, а не отдельную реализацию.
8. Добавить embedded mode:
   - не загружать default GLB;
   - скрывать Open File;
   - принимать SVG/artwork через host protocol;
   - отправлять ready/load/error/GLB-export events.
9. CAD bend compensation и snap-lock morphs остаются только производным 3D-представлением и никогда не записываются обратно в JSON/SVG.

Готовность этапа: RTE, STE и A55 строятся из актуальных PBD fixtures; artwork совпадает с плоской развёрткой и не имеет видимых швов.

### Этап 6. Подключить Technical Preview в Step 3

1. Маршрутизация Step 3:
   - Quick → текущий Preview3D;
   - Technical → встроенный CartonFoldViewer.
2. При входе передавать:
   - semantic SVG;
   - composed artwork atlas;
   - finish masks только как preview metadata;
   - locale и сохранённое fold progress.
3. Сохранять выбранную анимацию, progress и camera state в project schema.
4. Viewer должен поддерживать:
   - Fold slider;
   - Assembly/Simultaneous;
   - camera orbit/fit;
   - technical/plain mode;
   - GLB export.
5. При изменении artwork обновлять только textures, не перестраивать fold graph.
6. При смене technical geometry полностью dispose старой Three.js сцены.

Release 2 gate:

- 2D и 3D artwork совпадают на panel-ID fixtures.
- Fold graph и assembly проходят все три семейства.
- GLB повторно открывается с анимациями и текстурами.
- 20 циклов artwork replace и project reopen не дают устойчивого роста GPU/Blob ресурсов.

### Этап 7. Создать общий RenderSceneSource

1. Не дублировать `RenderApp` и панели управления.
2. Отделить от текущего `WebGLCartonRenderer` создание коробочной геометрии:
   - studio scene, camera, HDRI, background, floor, shadows, post-processing и export остаются общими;
   - геометрия поступает через `RenderSceneSource`.
3. `LegacyRenderSceneSource` оборачивает текущий `BoxScene` и должен пройти существующие тесты без изменения результатов.
4. `TechnicalRenderSceneSource` использует headless CartonFoldViewer runtime:
   - fold progress фиксируется на 100%;
   - сохраняются panel IDs, normals, caliper и finite creases;
   - единицы нормализуются в metres только на 3D-границе;
   - scene bounds и disposal реализуются через общий интерфейс.
5. Render settings остаются едиными для обоих workflow.

Готовность этапа: один Render UI переключает только source implementation.

### Этап 8. Artwork и отделки для Technical Render

1. Использовать существующий texture composer для единого flat-net atlas.
2. Передавать Technical source:
   - base color artwork;
   - alpha;
   - Spot Gloss mask;
   - Foil mask/color/roughness;
   - Emboss/Deboss normal-height mask.
3. Применять глобальные UV ко всем внешним поверхностям и crease ribbons.
4. Внутренние и торцевые поверхности получают материал картона без artwork.
5. Сохранить текущие камеры, 35/50/85 mm, HDRI, floor, shadows, reflections и post-processing.
6. Подключить общие экспорты:
   - PNG/JPG/UHD;
   - transparent background;
   - turntable ZIP;
   - GLB через `TechnicalSceneRuntime.createPortableScene()`.
7. GLB сохраняет panel IDs, carton type, source engine/schema и предупреждение о reference-only статусе.
8. Finish preflight должен одинаково работать для Quick и Technical source.

Release 3 gate:

- Technical Render поддерживает все существующие UI-настройки.
- Flat artwork, Preview и Render совпадают по orientation/scale.
- Spot Gloss/Foil/Emboss fixtures проходят visual tests.
- UHD, transparent, turntable и GLB проходят экспорт и повторное открытие.

### Этап 9. Единая сборка и GitHub Pages

1. Итоговый `dist`:

```text
dist/
├─ index.html
├─ assets/
└─ plugins/
   ├─ plugins.manifest.json
   ├─ packaging-box-designer/1.2.1/index.html
   └─ carton-fold-viewer/2.4.0/index.html
```

2. Все URL относительные, совместимые с `base:"./"` и GitHub Pages subpath.
3. Plugins загружаются лениво только при выборе Technical workflow.
4. Production build проверяет:
   - наличие артефактов;
   - hashes;
   - schemas;
   - отсутствие CDN и локальных `C:\Projects` путей;
   - отсутствие research/tmp/test assets.
5. Целевой deployment: `shafranek-js/CartonBuilder`, branch `master`, существующий `deploy-pages.yml`.
6. До повторного включения GitHub Actions:
   - убрать ежедневный schedule из дорогостоящего quality workflow либо оставить его только manual/PR;
   - выполнить локальные full regression;
   - получить явное подтверждение владельца на повторное включение Actions.
7. После разрешения:
   - включить repo Actions;
   - push integration release;
   - дождаться deploy job;
   - проверить published URL, plugin URLs, nested assets и MIME types;
   - проверить Chrome и Edge без локального cache.
8. Не публиковать private research packs, provider captures и converter evidence.

### Этап 10. Документация и handoff

1. Обновить пользовательскую документацию:
   - отличие Quick и Technical;
   - reference-calibrated статус;
   - поведение при повторном редактировании;
   - форматы экспорта.
2. Обновить developer docs:
   - workflow bundle;
   - CartonDocument;
   - host protocol;
   - RenderSceneSource;
   - plugin versioning/release procedure.
3. В каждом репозитории обновить status/changelog и записать:
   - точный commit;
   - проверки;
   - hashes артефактов;
   - известные ограничения;
   - отсутствие production certification.
4. Коммитить и выпускать в порядке:
   - Packaging Box Designer;
   - CartonFoldViewer;
   - CartonBuilder с закреплёнными hashes.
5. Не считать локальный commit доказательством push или публикации; GitHub Pages URL проверяется отдельно.

---

## 4. Обязательные тесты

- Quick workflow: полный существующий unit/E2E/visual набор без изменения baseline.
- Contract: valid/invalid schemas, unknown versions, modified hashes, oversized payload, wrong origin/session.
- Project migration: schema 15/archive 4 → Quick schema 16/archive 5.
- Technical persistence: JSON/SVG byte and hash round-trip.
- PBD: RTE, STE, A55; inner/outer dimensions; min/default/max caliper.
- Artwork: PNG/JPEG/PDF/AI-compatible PDF, crop, rotate, flip, layers, DPI, snapping to LINE/ARC.
- Edit policy: Cancel preserves state; confirmed geometry change creates checkpoint and clears artwork/history.
- Viewer: graph cycles, disconnected panels, invalid fold IDs, assembly actions, animations and GLB.
- UV: panel-edge continuity and exact 2D/3D landmarks.
- Render: cameras, HDRI, transparency, shadows, finish maps, UHD, turntable and GLB.
- Resources: 20 replace/open/close/export cycles, context loss/recovery and complete disposal.
- Deployment: offline runtime after initial site load, no CDN, relative Pages paths and verified plugin hashes.

## 5. Зафиксированные решения и ограничения

- Выпуск поэтапный: Release 1 → 2 → 3.
- Репозитории остаются отдельными; публикуется один сайт.
- Целевой hosting — GitHub Pages.
- Первый Technical workflow поддерживает RTE, STE и A55/TT_SL123.
- При изменении technical geometry artwork сбрасывается после подтверждения; перед этим создаётся checkpoint.
- `pbd.model.v1` — каноническая модель; SVG, 3D и Render являются производными.
- Technical Render использует общий UI, но отдельный geometry source.
- Промежуточный GLB не используется как основной мост между Preview и Render.
- Runtime-код плагинов будет доступен посетителям опубликованного статического сайта.
- Technical означает reference-calibrated и structurally/geometry valid, но не production-certified.
