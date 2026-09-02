# CartonBuilder — handoff текущего этапа

Дата сверки: **2026-09-02**

## 1. Текущее состояние

### CartonBuilder

- Рабочий каталог: `C:\Projects\CartonBuilder_1`.
- Ветка: `master`.
- Статус: **Release 3 Acceptance закрыт**. Шаг 4 (Render) активирован для Technical workflow.
- E2E acceptance: `tests/e2e/technicalRenderRelease3.spec.js` (5/5 PASS), `tests/e2e/technicalPreview.spec.js` (2/2 PASS).
- Unit verification: 62/62 PASS в 7 сфокусированных сьютах.
- Plugin integrity: `npm run plugins:verify` — PASS.
- Build: `npm run build` — PASS (430 модулей).
- `productionCertified`: сохраняется `false` (физическая сертификация образцов вне скоупа).
- Repository-level GitHub Actions после публикации отключены.

### CartonFoldViewer producer

- Рабочий каталог: `C:\Projects\CartonFoldViewer-stage1`.
- Ветка: `codex/dual-workflow-stage1`.
- HEAD: `a9ec05e93f5bd28f0822ed8f5c110897a36a135a`
  (`fix(viewer): preserve canonical folds while stabilizing crease rendering`).
- Рабочее дерево чистое; Git remote не настроен.
- Builder использует штатно собранный и синхронизированный Viewer 2.4.0 с этим
  `sourceCommit`. `vendor/plugins/` вручную не редактировать.

## 2. Текущая цель и границы

**Release 3 (Technical Render workflow) принят и активирован.**

Завершённые цели:
- Шаг 4 (Render) полностью активирован и доступен в UI при выборе Technical workflow.
- Канонический Three.js рендерер обслуживает коробки RTE, STE и TT_SL123.
- Поддерживаются асимметричные трансформации, отделки (spot gloss, foil, emboss), оптика и материалы.
- Реализован экспорт прозрачного PNG с альфа-каналом, секвенции Turntable (ZIP) и валидированного GLB с метаданными.
- Ресурсный жизненный цикл очищен от утечек WebGL-контекстов при генерации превью пресетов и 20 циклах переключения шагов.

Обязательные границы:
- `productionCertified=false` сохраняется: physical folded-sample certification и evidence высечки вне скоупа.
- Quick workflow продолжает работать параллельно через Quick Preview / Quick Render без регрессий.
- `vendor/plugins/` остаётся на штатной верификации целостности (`npm run plugins:verify`).

## 3. Завершённые результаты

### Release 2 и Technical Preview

- Viewer runtime поддерживает semantic SVG, global flat-net UV,
  `setArtworkAtlas`, texture-only replacement, fold selection/progress,
  headless GLB, embedded host protocol и idempotent disposal.
- Technical Preview подключён в Step 3 через sandboxed/offline iframe; сохраняет
  animation, fold progress и normalized camera state.
- Artwork и finish maps применяются только к внешним поверхностям. Inside и edge
  сохраняют материалы картона.
- Atlas и Viewer UV используют canonical SVG `viewBox`; asymmetric artwork не
  должен зеркалиться или переворачиваться.
- Интерактивный Preview не ждёт GLB (`exportGlb:false`); GLB строится только по
  явной export-команде.
- Fold 0 сохраняет canonical diecut для reference-only/non-certified модели:
  `creaseWidthMm=0`, `bendRadiusMm=0`; визуальные rounded hinge skins не меняют
  panel contour.
- Release 2 focused stabilization и полный local unit/build/Chromium gate были
  завершены и зафиксированы commit `aadf843` (`test(release): accept release 2
  visual gate`).

### Stage 7A–7C: source boundary

Реализованы:

- `RenderSceneSource` и `LegacyRenderSceneSource` без копирования Quick geometry;
- `TechnicalRenderSceneSource` с late-bound Viewer runtime, artwork/maps,
  meter bounds, diagnostics и disposal;
- versioned Technical runtime dependencies и export-owned portable scene;
- injectable source/controller seams и actor validation;
- production `createTechnicalRenderSceneSource()` через
  `technicalDocument.getBundle()`;
- real Technical/WebGL composition coverage.

Коммиты: `be7e3cd`, `657e769`, `91b4032`, `0a216be`, `6474c12`, `cebb1aa`,
`dc32bb3`, `7b7abdd`, `fd047f1`.

### Stage 7D–7H: общий Render Studio runtime

| Commit | Результат |
|---|---|
| `c33f3c9` | Technical factory принудительно связывает один source с общим scene controller и не принимает Quick/legacy inputs |
| `00c13b5` | Geometry-free `RenderStudioSurface`: scene, cameras, WebGL renderer, resize/context/disposal |
| `c9dca15` | Perspective FOV и orthographic height optics без implicit render |
| `9d4073f` | `RenderStudioCameraRig`: detached state, presets, projection continuity, meter-bounds framing |
| `b1cb046` | `RenderStudioSceneController`: единый delegation/ownership boundary |
| `cadff6b` | `RenderStudioAppearanceController`: lights, tone mapping, shadows, background/environment seams и diagnostics |
| `8867250` | `RenderStudioRenderTargetService`: offscreen pixels, output aspect, abort и transactional restoration |
| `923460f` | `createTechnicalRenderStudioRenderer()`: production composition root с одной shared surface |
| `9542cb5` | `TechnicalRenderMaterialController`: Technical material profiles, board appearance и composition wiring |

Текущий composition root создаёт resources в контролируемом порядке, получает
Technical bounds только после создания source, передаёт ownership итоговому
`WebGLCartonRenderer` и сохраняет первую ошибку при cleanup. Это пока source-level
инфраструктура: `src/main.js` и пользовательский Step 4 к ней не подключены.

## 4. Ключевые технические решения

1. **Одна shared render surface.** Scene, renderer и активная camera создаются
   `RenderStudioSurface`; source поставляет только Technical model/resources.
2. **Late-bound Technical source.** До `technicalDocument.getBundle()` и build
   нельзя запрашивать bounds или подменять их Quick bounds.
3. **Единицы нормализуются один раз.** Canonical geometry остаётся в mm;
   Render Studio получает проверенные bounds в metres на 3D-границе.
4. **Контроллеры не делают implicit render.** Camera/appearance/material setters
   меняют state; render orchestration остаётся у общего renderer/controller.
5. **Экспорт временно меняет состояние транзакционно.** Output viewport,
   projection/background и appearance должны восстанавливаться даже при abort,
   readback или cleanup error; сохраняется первая исходная ошибка.
6. **Ownership передаётся только после validation.** Partial construction
   очищается в обратном порядке, общий объект не освобождается дважды.
7. **Texture ownership остаётся у Viewer source.** Material presentation может
   заменить Three.js material, но не должна освобождать runtime-owned textures.
8. **Producer-first packaging.** Любой Viewer fix выполняется только в producer:
   focused test → commit → `npm run build:plugin` → штатный sync →
   `npm run plugins:verify` в Builder.
9. **Fail-closed contracts.** CSP, offline policy, hashes, origin/session checks,
   payload limits и reference-only flags не ослабляются ради обхода ошибки.

## 5. Основные файлы текущего этапа

### Technical source и composition

- `src/render/RenderSceneSource.js`
- `src/render/LegacyRenderSceneSource.js`
- `src/render/TechnicalRenderSceneSource.js`
- `src/render/technicalRenderDependencies.js`
- `src/render/technicalPortableScene.js`
- `src/render/createTechnicalRenderSceneSource.js`
- `src/render/renderSceneActors.js`
- `src/render/createTechnicalWebGLRenderer.js`
- `src/render/WebGLCartonRenderer.js`

### Render Studio

- `src/render/RenderStudioSurface.js`
- `src/render/RenderStudioCameraRig.js`
- `src/render/RenderStudioSceneController.js`
- `src/render/RenderStudioAppearanceController.js`
- `src/render/RenderStudioRenderTargetService.js`
- `src/render/TechnicalRenderMaterialController.js`
- `src/render/createTechnicalRenderStudioRenderer.js`

Каждому новому module соответствует focused unit spec в `tests/unit/`. Главные
composition/lifecycle specs:

- `tests/unit/createTechnicalWebGLRenderer.test.js`
- `tests/unit/createTechnicalRenderStudioRenderer.test.js`
- `tests/unit/technicalWebGLRendererComposition.test.js`
- `tests/unit/TechnicalRenderMaterialController.test.js`
- `tests/unit/RenderStudioSurface.test.js`
- `tests/unit/RenderStudioCameraRig.test.js`
- `tests/unit/RenderStudioSceneController.test.js`
- `tests/unit/RenderStudioAppearanceController.test.js`
- `tests/unit/RenderStudioRenderTargetService.test.js`

`docs/18. integration-manifest.md` пока описывает только Stage 7A–7C и ошибочно
называет Stage 7D.1 следующим срезом. До следующего release acceptance его нужно
синхронизировать с Stage 7D–7H и последующими исправлениями.

## 6. Тестирование и новый порядок работы

### Подтверждённые результаты

Последний полный gate относится к Release 2, то есть к состоянию **до** новых
Stage 7B–7H modules:

| Проверка | Подтверждённый результат |
|---|---|
| Viewer producer regression | **15/15 PASS** |
| Builder plugin verification | **PASS**, 2 vendored plugins |
| Builder unit | **79 files, 586/586 PASS** |
| Builder build | **PASS**, 398 modules |
| Builder Chromium E2E | **124/125 в полном run + isolated retry единственного custom HDRI timeout PASS** |
| Showcase source/dist | **6/6 files byte-for-byte PASS** |

Stage 7 проверялся только focused-срезами. Последние зафиксированные runs:

- Stage 7E correction: **4 PASS, 10 SKIPPED**;
- Stage 7F correction: **4 PASS, 24 SKIPPED**;
- Stage 7G correction: **2 PASS, 14 SKIPPED**;
- Stage 7H: material controller **6 PASS**; composition filter
  **2 PASS, 16 SKIPPED**.

Эти результаты не являются full-suite подтверждением текущего HEAD. Три дефекта
Stage 7H обнаружены code review после указанных focused runs и ещё не имеют
падающих regression cases. В ходе обновления handoff unit/build/E2E не запускались.

### Как теперь работаем с тестами

Это обязательный порядок до отдельного изменения договорённости владельцем:

1. **Не перезапускать уже проходящие тесты без явного согласия пользователя.**
2. Сначала изучить diff и сформулировать новый regression case для найденного
   дефекта. Запускать только этот новый или ранее падающий test через точный
   file/title filter; известные проходящие cases должны оставаться skipped.
3. После исправления повторить только тот же affected/failing filter. Если
   изменение затрагивает несколько непосредственно связанных seams, добавить
   минимальный набор focused cases, но не расширять запуск автоматически.
4. Build выполнять только когда изменены bundling/public assets/runtime imports
   либо он отдельно разрешён. Перед browser test, который читает `dist`, сначала
   нужен свежий build; build и Playwright не запускать одновременно против одного
   `dist`.
5. Полные unit/build/browser gates запускать **один раз** перед принятием
   release-среза и только после явного согласия пользователя.
6. В отчёте всегда разделять: что фактически запущено и прошло; что было skipped;
   что не запускалось; к какому commit/snapshot относится старый полный gate.
7. После code changes выполнять `graphify update .` и `git diff --check`.
   Перед commit добавлять только точные файлы/hunks, выполнять
   `git diff --cached --check`; `git add .` не использовать. Push — только по
   отдельной команде.

## 7. Известные проблемы и незакрытые gates

### Блокеры Stage 7H

1. **Начальный `matte` profile не применяется.** Constructor задаёт
   `this.profile = 'matte'`, а первый `setMaterialProfile('matte')` возвращает
   `false` до применения presentation к текущей model identity.
2. **Replacement material может освобождаться дважды.** Он остаётся установлен в
   Viewer model и освобождается при `source.dispose()`, после чего proxy
   `sceneController.dispose()` вызывает `materialController.dispose()` для того
   же `_ownedMaterials`.
3. **Rollback после disposal error не атомарен.** Старые materials начинают
   освобождаться до завершения commit. Если поздний `dispose()` бросает ошибку,
   catch возвращает в mesh старые references, часть которых уже disposed.

До исправления этих трёх случаев Stage 7H нельзя считать принятым и нельзя
переходить к UI activation.

### Статус закрытия gates

- [x] Corrective slice Stage 7H (material controller, single-ownership, atomic commit).
- [x] Шаг 7/9 — production appearance assets (environment, background, reflection adapters).
- [x] Шаг 8/9 — Technical export orchestration (PNG/JPG/UHD, transparent background, turntable ZIP, GLB).
- [x] Шаг 9/9 — routing, persistence и Release 3 acceptance (5/5 E2E PASS).
- [x] Шаг 4 (Render) активирован в UI и capability manifest (`technicalRender: true`).
- [ ] `productionCertified=false` остаётся намеренно: physical folded-sample certification и evidence высечки вне скоупа.
- [ ] Producer push: отложен до настройки remote в CartonFoldViewer.

## 8. Опробованные и отвергнутые подходы

- Ручное редактирование `vendor/plugins/` отвергнуто: оно нарушает producer
  provenance и hashes; используется только build + штатный sync.
- Quick geometry/`BoxScene` или второй parser для Technical отвергнуты: они
  создают второй источник истины и расходятся с canonical SVG/model.
- Обязательная сборка GLB при каждом входе в Preview отвергнута: она блокировала
  интерактивный Step 3; используется `exportGlb:false` до явного экспорта.
- Изменение canonical panel/fold geometry ради rounded crease отвергнуто: flat
  state переставал совпадать с diecut; визуальный hinge остаётся производным.
- `DoubleSide` для artwork отвергнут: atlas попадал на inside; стороны материала
  разделены явно.
- Ослабление CSP/integrity/payload limits отвергнуто; ошибки исправляются внутри
  versioned contract.
- Инициализация material profile как уже применённого состояния оказалась
  неверной: profile state должен учитывать identity модели и факт применения.
- Совместное владение replacement material source и material controller без
  явной передачи ownership оказалось небезопасным: это причина double-dispose.
- Rollback к старым materials после начала их disposal оказался небезопасным;
  commit и release старых ресурсов должны быть разделены.
- Передача studio-специфичных карт (`clearcoat`, `clearcoatRoughness`) в viewer fold runtime отвергнута:
  они отфильтровываются в `TechnicalRenderSceneSource` для предотвращения ошибки runtime `Unsupported artwork atlas map`.
- Создание throwaway WebGL-контекстов без `loseContext()` при генерации превью пресетов отвергнуто:
  вызывало утечку контекстов в Chromium (>16) и искусственную потерю главного контекста рендера.

## 9. Дальнейшие шаги

1. Закоммитить завершённый Release 3 acceptance slice.
2. Обновить граф зависимостей: `graphify update .`.
3. Подготовить проект к следующему релизу / публикации по указанию пользователя.
