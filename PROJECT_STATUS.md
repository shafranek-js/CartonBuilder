# CartonBuilder — состояние dual-workflow integration

> Дата сверки: 2026-08-21
>
> Рабочий каталог: `C:\Projects\CartonBuilder_1-stage1`
>
> Ветка: `codex/dual-workflow-stage1`
>
> Кодовый HEAD перед этим handoff: `97cd937284d53f51a738a5b8209c5136bf288c91`
>
> Статус: выбор Quick/Technical, PBD host, техническое сохранение и базовый
> Technical Place Artwork реализованы. Technical Preview и Technical Render
> ещё не подключены.

Этот файл — основной handoff по текущей integration-ветке. История и более
подробные промежуточные доказательства находятся в
`docs/18. integration-manifest.md`; план дальнейшей реализации — в
`docs/17. dual-workflow-plugin-integration-plan.md`.

## 1. Текущая цель и граница этапа

Цель интеграции — сохранить быстрый workflow `Legacy Custom Net` и добавить
технический workflow на основе Packaging Box Designer, используя общий
CartonBuilder для Place Artwork и, позднее, общий UI Preview/Render с отдельной
технической геометрией.

Текущий устойчивый маршрут:

1. Step 1 предлагает `Quick Layout — Legacy Custom Net` и
   `Technical Dieline — Packaging Box Designer`.
2. Technical открывает локально завендоренный PBD в iframe; отдельной кнопки
   `Ready` нет.
3. Обычный переход в Step 2 запрашивает bundle у PBD, повторно валидирует его и
   создаёт `TechnicalCartonDocument`.
4. Общий Artwork UI работает с технической геометрией, сохраняет проект и
   поддерживает базовые SVG/PDF/raster exports.
5. Step 3 Preview и Step 4 Render для technical source намеренно недоступны,
   пока не появятся соответствующие технические backends.

Текущий срез закрывает основной integration foundation и критические
транзакционные/геометрические блокеры. Полный Этап 4 исходного плана ещё требует
нескольких функций, перечисленных в разделе 6.

## 2. Завершённые задачи

### 2.1. Контракты и автономные плагины

- Зафиксирован workflow bundle `carton-workflow.v1` с `pbd.model.v1` и
  `pbd.svg.v4`; JSON Schema компилируется Ajv 2020 в детерминированный ESM
  standalone validator.
- SVG проходит fail-closed XML/security validation: запрещены DOCTYPE,
  processing instructions, опасные элементы/атрибуты/CSS/URL и синтаксически
  некорректный XML.
- Синхронизация contract/plugin packages проверяет manifest, SHA-256, размеры,
  path traversal, symlinks, лишние файлы и offline policy; замена выполняется
  транзакционно с rollback.
- В production tree завендорены и проверяются два автономных пакета:
  `packaging-box-designer@1.2.0` и `carton-fold-viewer@2.4.0`.
- Production build не зависит от соседних локальных репозиториев и блокируется,
  если vendored plugin integrity gate не проходит.

Текущие закреплённые артефакты:

| Плагин | Source commit | Entrypoint SHA-256 | Manifest SHA-256 |
|---|---|---|---|
| Packaging Box Designer 1.2.0 | `67444de2a0fcf65857974ad6ba35f9b699d69e59` | `d798b23784c800c625d9ad42e31878f824567f9df43c47f60fb6fa5c2d9c3715` | `b3fd595590566b6933950280cba7323e551ac9e04076cf9d42a3b99193e24ae9` |
| CartonFoldViewer 2.4.0 | `ec793810ea28c456ca0e33b60fa5404408e8b778` | `420f9d54f26fcc749bef9b09d38c59d26e71321c3e68027d2c64ee059aadbdae` | `19f4555845e7fb2347b251bd281531626ccc2c11a49b0b9a5d64ac6c7856a8d6` |

Текущие manifest-файлы являются источником истины для release hashes.
Промежуточные hashes в ранних разделах `docs/18. integration-manifest.md`
описывают исторические срезы и не должны использоваться для нового vendoring.

### 2.2. Единая модель проекта и persistence

- Добавлены `CartonDocument`, `QuickCartonDocument`,
  `TechnicalCartonDocument` и централизованный factory.
- Project schema v17 хранит discriminated `cartonSource` и независимый
  `workflowSelection`; legacy projects мигрируют в `mode: "quick"`.
- `.carton` archive v5 хранит technical model/SVG отдельными Blob entries и
  проверяет их hashes до восстановления.
- RTE, STE и TT_SL123/A55 проходят byte-preserving archive round-trip и tamper
  rejection.
- History не дублирует полный model JSON или SVG markup.

### 2.3. Workflow selector и PBD host

- В Step 1 добавлены две workflow-карточки; Quick branch не изменяет старый
  конструктор.
- Technical branch загружает vendored PBD и сохраняет общий stepper
  CartonBuilder.
- `carton-host.v1` проверяет `event.source`, origin, session ID, protocol
  version, payload size и полный workflow bundle.
- Переход Next/Step 2 централизован. Он доступен только при VALID structural,
  geometry и contract state.
- PBD строит JSON и canonical SVG из одного current model и отправляет один
  hash-protected bundle. CartonBuilder независимо повторяет validation и hash
  comparison.
- Flip Horizontal/Vertical и Rotate 90° доступны во встроенном PBD. Выбранный
  presentation transform входит в `pbd.svg.v4`, восстанавливается из autosave
  и применяется к той же technical geometry в Place Artwork.
- Поддержаны три текущих technical fixture family: RTE, STE и TT_SL123/A55.

### 2.4. Безопасная замена технической модели

- Перед мутацией новый bundle полностью валидируется; при изменении model/SVG
  hash пользователь подтверждает замену.
- Checkpoint создаётся только после validation и подтверждения. Простое открытие
  technical editor и Cancel не перезаписывают существующий checkpoint.
- Checkpoint включает project snapshot, artwork blobs, technical model/SVG,
  Render assets, Render state/appearance, workflow selection и workflow step.
- Replacement transaction последовательно выполняет artwork clear, model
  activation, technical assets update, Preview reset, Render reset и awaited
  final save.
- Ошибка в любой из шести фаз восстанавливает исходное состояние. Невалидный
  checkpoint отклоняется до первой live mutation.
- Поддержаны Quick checkpoint → Technical → restore Quick и Technical A →
  Technical B → restore A.

### 2.5. Technical Place Artwork и flat geometry

- Existing Artwork UI, layers, transforms, crop, opacity, history и импорт
  PNG/JPEG/PDF используются обоими workflow.
- Technical facade передаёт точные LINE/ARC contours, CUT/FOLD и OPEN_CUT без
  выпрямления канонической экспортной геометрии.
- Facade воспроизводит PBD SVG presentation plane, включая Y-проекцию,
  Flip/Rotate, преобразованные bounds и корректное направление ARC.
- SVG viewport и masks используют настоящие SVG arc commands; raster export
  вызывает Canvas `arc()`, PDF переводит ARC в точное число cubic Bézier pieces.
- Реализован snapping к ближайшей точке ARC с ограничением диапазоном дуги.
- Public SVG/PDF/raster paths покрыты fixture-тестами для RTE, STE и TT_SL123.
- Technical production-assist/prepress export fail-closed заблокирован, чтобы
  quick-only allowances не изменяли технический carton source.

### 2.6. CartonFoldViewer packaging foundation

- Viewer 2.4.0 собран в автономный single-file HTML с локальным Three.js
  0.185.1, без CDN и внешних network requests.
- Viewer запускается в `sandbox="allow-scripts"` при opaque origin и проходит
  WebGL/fold/unfold проверки на трёх technical fixtures.
- Завендорен базовый ESM headless runtime с parse/build/load, animation
  selection, fold progress и disposal.
- `capabilities.foldPreview=true`, но `capabilities.technicalRender=false`.
  Наличие Viewer package ещё не означает, что Technical Preview подключён к
  Step 3.

### 2.7. Stage 4A — Technical SVG metadata and provenance

- Technical SVG export теперь использует canonical `semanticSvg.markup` без DOM
  serialization: перед вставкой provenance проверяются фактическая UTF-8 длина,
  SHA-256 и content-addressed `assetId`, а также обе source-identity связи.
- Security scan и структурный XML parse требуют ровно один PBD metadata и ноль
  существующих provenance; после вставки проверяются ровно один provenance,
  schema version, JSON и полное совпадение распарсенного объекта с построенным.
- Technical SVG download route асинхронный, Quick `createExportSvg()` остаётся
  синхронным и поведенчески неизменным. Stage 4A закрыт только в этой границе;
  весь Этап 4 и Release 1 gate остаются открытыми.

### 2.8. Stage 4B — Technical front-relative artwork coordinates

- Technical Place Artwork показывает read-only `Front X`/`Front Y` в mm для
  reference point макета относительно top-left origin точно спроецированного
  semantic surface `body.front`. Global X/Y остаются редактируемыми и
  persisted без изменений.
- Frame предоставляется technical adapter как cloned read-only facade API;
  missing/invalid `body.front` даёт `—` без fallback. Relative coordinates
  вычисляются только в UI и не попадают в `ArtworkModel`, project schema,
  archive или exporter.
- Покрыты identity, H/V flip и CW/CCW rotation, RTE/STE/TT_SL123, reference
  point changes, global moves, autosave/reload и скрытие панели в Quick.
  Stage 4B закрыт только в этой UI-coordinate границе; весь Этап 4 и Release
  1 gate остаются открытыми.

## 3. Ключевые технические решения

- `pbd.model.v1` — канонический technical source. SVG, artwork view, Preview и
  будущий Render являются consumers, а не отдельными источниками геометрии.
- `workflowSelection` описывает намерение пользователя и не заменяет
  committed `cartonSource` до успешного protected transition.
- Отдельная PBD-кнопка `Ready` не используется; стандартный step navigation
  остаётся единственным guarded transition.
- Parent host bridge расположен в `src/host/pbdHostProtocol.js`, а не в
  replaceable `src/workflow/`, чтобы plugin sync не мог удалить runtime host
  code.
- Technical replacement — транзакция. Fire-and-forget autosave не считается
  commit boundary; финальное сохранение должно быть awaitable.
- ARC остаётся ARC в domain model, viewport и SVG/raster paths. PDF использует
  вычисленное ARC-to-cubic представление только на границе PDF.
- Polygon/tessellation допустимы для hit-testing/GPU, но не как каноническая
  экспортная геометрия.
- Technical Preview и Render нельзя подменять quick geometry renderer.
  Будущий Render сохраняет общий UI, но получает отдельный
  `TechnicalRenderSceneSource`.
- Все текущие technical profiles остаются `referenceOnly=true` и
  `productionCertified=false`.

## 4. Основные изменённые файлы

Список ниже намеренно не включает generated/vendor files поштучно.

| Область | Основные файлы | Назначение |
|---|---|---|
| Workflow UI и transaction | `index.html`, `src/main.js`, `src/styles/main.css`, `src/i18n.js` | Выбор Quick/Technical, PBD iframe, guarded transition, checkpoint/rollback и feature gating |
| Host protocol | `src/host/pbdHostProtocol.js` | `carton-host.v1`, validation и request/response lifecycle |
| Carton domain | `src/carton/CartonDocument.js`, `QuickCartonDocument.js`, `TechnicalCartonDocument.js`, `technicalBoxModelAdapter.js` | Общий document API и адаптация technical geometry для Artwork |
| Persistence | `src/project/projectSchema.js`, `projectArchive.js`, `ProjectStore.js`, `ProjectCheckpoint.js` | Schema v17, archive v5, Blob assets и transactional checkpoints |
| Technical 2D/export | `src/model/dieline.js`, `src/artwork/ArtworkRenderer.js`, `src/artwork/snap.js`, `src/export/artworkExport.js`, `src/export/svgExport.js` | LINE/ARC/OPEN_CUT, masks, snapping и exports |
| Prepress guard | `src/prepress/prepressPreflight.js`, `src/prepress/productionDieline.js` | Fail-closed блокировка неподдержанного technical production-assist |
| Plugin infrastructure | `scripts/lib/atomicManifestSync.mjs`, `offlinePolicy.mjs`, `pluginPackageVerification.mjs`, `scripts/sync-*.mjs`, `scripts/verify-vendored-plugins.mjs` | Детерминированный vendoring, integrity/offline/security gates |
| Contracts/plugins | `src/workflow/`, `schemas/`, `vendor/plugins/` | Версионированные contracts, fixtures и автономные plugin artifacts |
| Acceptance tests | `tests/e2e/app.spec.js`, `tests/e2e/plugins.spec.js`, `tests/unit/carton/`, `tests/unit/project/`, `tests/unit/workflow/`, `tests/unit/artworkExport.test.js`, `tests/unit/ArtworkRenderer.test.js` | Dual workflow, rollback, archive, security и exact geometry coverage |

## 5. Подтверждённые проверки

Последняя полная проверка выполнялась на кодовом HEAD `97cd937` в чистом
integration worktree:

| Проверка | Результат |
|---|---|
| `npm run test:unit` — три последовательных запуска | `72/72` files, `456/456` tests PASS в каждом запуске |
| Focused checkpoint/transaction Playwright | `12/12` PASS |
| `technical workflow` Playwright selection | `4/4` PASS |
| `npm run plugins:verify` | `2/2` vendored plugins PASS |
| `npm run build` | PASS, 388 modules transformed |
| `npm run test:e2e:smoke` | `7/7` PASS |
| PBD official `npm run build:plugin` | PASS; hashes совпадают с vendored artifact |
| `git diff --check` | PASS |
| Graphify | Обновлён: 3,851 nodes, 7,027 edges, 244 communities |

Exact ARC fixture expectations зафиксированы независимо от fixture parser:
RTE — 19 ARC, STE — 20 ARC, TT_SL123 — 21 ARC. OPEN_CUT segments и endpoints
проверяются для каждого fixture.

Неблокирующие build diagnostics, существовавшие до этого handoff:

- Vite предупреждает об externalization Node builtins в MuPDF;
- `ProjectStore` импортируется одновременно статически и динамически;
- отдельные production chunks превышают 500 kB;
- Graphify сообщает о 14 source-файлах без nodes, главным образом JSON/presets.

## 6. Известные проблемы и незавершённые требования

### 6.1. Остаток Technical Place Artwork перед следующим release gate

- Stage 4A metadata/provenance в technical SVG export завершён: exporter
  проверяет фактические canonical SVG bytes, вставляет один deterministic
  provenance block и проходит SVG v4/security validation. Это не закрывает весь
  Этап 4 и не является Release 1 gate.
- Artwork UI хранит global millimetre coordinates и дополнительно показывает
  read-only положение reference point относительно semantic panel `body.front`;
  relative values не persisted.
- ARC nearest-point snapping реализован. Отдельные semantic endpoint,
  line/arc intersection, panel-centre и panel-boundary targets не имеют полного
  подтверждённого набора implementation/acceptance tests.
- DPI/coverage остаются общими Artwork checks; исключение glue/locking
  surfaces из semantic printable coverage не подтверждено отдельным technical
  preflight implementation/test.
- Technical SVG download-level E2E для RTE, STE и TT_SL123 подтверждает один PBD
  metadata и один provenance; оставшиеся flat PDF/artwork requirements и их
  acceptance остаются открытыми до Release 1.

### 6.2. Preview, Render и production boundaries

- Technical Preview в Step 3 не подключён. Vendored Viewer подтверждает
  package/runtime foundation, но его headless API ещё не реализует весь Этап 5:
  global flat-net UV/artwork atlas, embedded host events и headless GLB export
  остаются следующей работой.
- Technical Render отсутствует. `technicalRender=false` должен сохраняться до
  реализации `TechnicalRenderSceneSource` и полного visual/export gate.
- Technical production-assist/prepress export намеренно заблокирован до
  поддержки точных curved-contour allowances. Обычный structural mockup export
  не является production-ready dieline.
- Нет converter/material/physical sample evidence. Не изменять
  `productionCertified=false` и `referenceOnly=true` без отдельной физической
  сертификации.

### 6.3. Отдельные известные reference/baseline failures PBD

Последний `scripts/current-regression.mjs` в PBD имел следующие известные
непродуктовые failures, которые не следует скрывать или объявлять исправленными:

- `BASELINE_BRANCH_MAIN`, потому что проверка выполняется на
  `codex/dual-workflow-stage1`;
- четыре исторических KutuModeli source-hash checks;
- Smilepack physical snapshot bytes/hash;
- Smilepack PrintQ A2420 page-snapshot hash.

Остальные gates того запуска прошли. Эти reference fixture расхождения нужно
разбирать отдельно от CartonBuilder integration acceptance.

### 6.4. Worktree boundary

- Вся dual-workflow разработка находится в `*-stage1` worktrees.
- `C:\Projects\CartonBuilder_1` содержит отдельные пользовательские HDRI/UI
  изменения. Не reset, не переносить и не смешивать их автоматически с
  integration branch.
- На момент подготовки этого handoff worktrees
  `Packaging Box Designer-stage1` и `CartonFoldViewer-stage1` были чистыми.
- Коммиты локальные. Push, merge в release branch и GitHub Pages publication не
  выполнялись и этим документом не подтверждаются.

## 7. Опробованные, но отвергнутые подходы

- Создание checkpoint при простом входе в technical editor перезаписывало
  предыдущую безопасную версию до подтверждения. Теперь checkpoint создаётся
  только после validation и confirmation.
- Fire-and-forget `scheduleSave()` не позволял rollback при ошибке final save.
  Transaction использует awaitable commit.
- Fault injection только на artwork clear не доказывал атомарность всей замены.
  Acceptance matrix расширена до всех шести mutation phases.
- Динамическое получение ожидаемого ARC count из тех же fixtures могло скрыть
  совместный regression fixture и exporter. Ожидания заменены на явные
  `19/20/21`.
- Ожидание одного PDF `c` operator на один ARC оказалось неверным: большая дуга
  может разбиваться на несколько cubic pieces. Проверяется точное число pieces,
  возвращаемое `arcToCubicSegments()`.
- Тестирование только helper `arcPathData()` не доказывало работу реального UI
  и exports. Добавлены проверки `ArtworkRenderer` и public SVG/PDF/raster APIs.
- Использование quick Preview/Render или quick production allowances для
  technical source отвергнуто: визуально похожий результат не подтверждает
  техническую корректность.

## 8. Последовательность следующих шагов

1. **Закрыть остаток Этапа 4 / Release 1 (Stages 4A и 4B завершены отдельно):**
   - endpoint/intersection/panel semantic snapping;
   - technical printable-region coverage/DPI;
   - оставшиеся flat PDF/artwork requirements и download-level acceptance;
   - повторить Quick full regression, technical autosave/reopen и archive
     round-trip.
2. **Завершить Этап 5 CartonFoldViewer runtime:** добавить global flat-net UV,
   `setArtworkAtlas`, embedded host protocol, headless GLB export и resource
   disposal/stress tests. Не менять canonical JSON/SVG из 3D runtime.
3. **Этап 6 — Technical Preview:** маршрутизировать Step 3 по carton source,
   передавать canonical SVG/artwork atlas, сохранять fold/camera state и закрыть
   RTE/STE/A55 visual, GLB и 20-cycle resource gates.
4. **Этапы 7–8 — Technical Render:** выделить общий `RenderSceneSource`, оставить
   текущий Render UI и studio pipeline, затем подключить technical geometry,
   global UV, artwork и finish maps. Только после acceptance включить
   `technicalRender=true`.
5. **Этап 9 — единая release-сборка и публикация:** проверить relative URLs,
   lazy plugin loading, hashes, offline policy, GitHub Pages subpath и браузеры.
   GitHub Actions включать только после отдельного разрешения владельца.
6. **Этап 10 — финальная документация:** синхронизировать user/developer docs,
   status/changelog каждого репозитория, release hashes и ограничения; затем
   коммитить в порядке PBD → Viewer → CartonBuilder.

## 9. Безопасное продолжение работы

Перед новым кодовым срезом:

```powershell
Set-Location "C:\Projects\CartonBuilder_1-stage1"
git status --short
git log -5 --oneline --decorate
npm run plugins:verify
npm run test:unit
```

После изменения CartonBuilder:

```powershell
npm run test:unit
npm run build
npm run test:e2e:smoke
graphify update .
git diff --check
git status --short
```

Если меняется PBD или Viewer, сначала собрать и проверить producer package в
соответствующем clean `*-stage1` worktree, затем синхронизировать его штатным
`plugins:sync:*`, повторно выполнить `plugins:verify` и сравнить SHA-256 с
producer artifact. Не редактировать содержимое `vendor/plugins/` вручную.
