# CartonBuilder — handoff текущего этапа

Дата сверки: **2026-09-02**

## 1. Подтверждённое состояние репозиториев

### CartonBuilder

- Рабочий каталог: `C:\Projects\CartonBuilder_1`
- Ветка: `master`
- Локальная acceptance-база перед итоговым handoff commit: `74bf12f`
  (`fix(build): publish showcase assets`).
- `origin/master`: `8cfbf9b8444edb8b1fd3f06df1cce67f9e2ef646`; локальная ветка содержит
  проверенные, но ещё не опубликованные Release 2 commits.
- После итогового acceptance commit рабочее дерево должно быть чистым.
- GitHub Pages: `https://shafranek-js.github.io/CartonBuilder/`
- Успешная публикация HEAD: GitHub Actions run `33501418758`.
- Repository-level GitHub Actions после публикации снова отключены.

### CartonFoldViewer producer

- Рабочий каталог: `C:\Projects\CartonFoldViewer-stage1`
- Ветка: `codex/dual-workflow-stage1`
- HEAD: `a9ec05e93f5bd28f0822ed8f5c110897a36a135a`
  (`fix(viewer): preserve canonical folds while stabilizing crease rendering`)
- Рабочее дерево чистое.
- Git remote не настроен. Producer commit существует только локально, пока remote
  не будет добавлен отдельно.

## 2. Текущая цель и обязательные границы

**Release 2 visual/resource gate закрыт локально.** Следующий рабочий рубеж —
bounded **Stage 7B — `TechnicalRenderSceneSource`**.

Для Stage 7B сохраняются следующие границы:

- Quick workflow использует существующие Quick geometry, Preview и Render пути.
- Technical workflow использует canonical `pbd.model.v1`, canonical
  `pbd.svg.v4` и один CartonFoldViewer runtime.
- Для Technical остаются `referenceOnly=true`, `productionCertified=false` и
  `technicalRender=false`.
- Technical Render нельзя подменять Quick `BoxNetModel`, `Preview3D`,
  `BoxScene` или второй SVG/3D parser.
- Canonical PBD model/SVG являются источником diecut, panel IDs, fold lines,
  artwork coordinates и плоской 3D-геометрии.
- Производные 3D-эффекты не должны записываться обратно в canonical JSON/SVG.

## 3. Что завершено

### Viewer runtime и Technical Preview

- Stage 5 runtime реализован: semantic SVG parse/build, global flat-net UV,
  `setArtworkAtlas`, texture-only replacement, fold selection/progress,
  headless GLB export, embedded host protocol и idempotent disposal.
- Stage 6 Technical Preview подключён в Step 3 через sandboxed/offline iframe.
  Сохраняются animation, fold progress и normalized camera state.
- Artwork наносится только на внешние caps. Внутренние caps остаются белой
  бумагой; atlas и finish maps внутрь не проецируются.
- 2D artwork atlas и Viewer UV используют один canonical SVG `viewBox`.
  `cartonModelBridge` делегирует `getCanonicalViewBoxBounds()` и
  `getPresentationTransform()`, поэтому artwork больше не рассчитывается от
  плотного geometry bounds.
- Ориентация atlas согласована с 2D редактором; asymmetric artwork не должен
  зеркалиться или переворачиваться.
- Интерактивный Preview отправляет `exportGlb:false`. Host завершает load после
  `MODEL_LOADED`; тяжёлый GLB собирается только по явному export-сценарию.
- Finish maps создаются условно, только когда в artwork действительно есть
  отделка.
- Preview и Quick Render используют доступную высоту viewport; повторный вход в
  шаг не должен менять размер canvas или оставлять большую пустую область снизу.

### Каноническая геометрия и сгибы

- Удалены изменения panel polygons/fold lines, которые ранее сдвигали 3D diecut
  относительно canonical SVG.
- Для reference-only/non-certified carton hinge профиль остаётся каноническим:
  `creaseWidthMm=0`, `bendRadiusMm=0`. Панельные caps при Fold 0 совпадают с SVG
  с допуском `1e-4 mm` и не подрезаются на `t/2`.
- Скруглённый вид сгиба сохранён отдельными curved outer/inner hinge skins без
  изменения canonical panel contour. Endpoint rim triangles отсутствуют.
- Finite crease width/radius и связанный panel trimming допустимы только при
  явно сертифицированном physical crease profile.
- Последовательность сборки восстановлена: glue flap сначала выполняет свой
  90-degree fold, затем участвует в складывании корпуса; tuck tongue остаётся
  дочерним сгибом major flap.
- Визуальные артефакты стыков подавляются без изменения diecut:
  polygon offset применяется только к внешней поверхности crease,
  `logarithmicDepthBuffer` включён, anisotropy берётся из renderer capability и
  ограничивается максимумом 16.

### Render foundation, sync и публикация

- Stage 7A завершён: `RenderSceneSource` и `LegacyRenderSceneSource` отделяют
  источник геометрии от общего Render UI/scene/camera/export/disposal.
- Built-in HDRI заменены с 4K на 1K варианты; runtime manifest и тесты обновлены.
- Viewer `a9ec05e` собран с provenance gate и синхронизирован штатной командой.
- Windows sync теперь имеет recoverable fallback для `EPERM`/`EACCES`, когда
  dev server/file watcher блокирует rename plugin directory. При ошибке более
  поздней активации предыдущий artifact восстанавливается.
- Builder `8cfbf9b` опубликован на GitHub Pages; публичный plugin catalog содержит
  ожидаемый Viewer source commit и artifact hash.
- Release 2 focused stabilization закрыта отдельными локальными срезами:
  lazy Preview activation, texture-composition timeout, Basic GLB warning,
  Render autosave, HDRI source-resolution baseline и Showcase publication.
- Showcase снова входит в production `dist` при сохранённом `publicDir: 'vendor'`;
  source и build содержат одинаковые `index.html`, `viewer.html` и assets.
- Release 2 полный unit/build/browser gate выполнен на свежем `dist`; единственный
  custom HDRI timeout из полного browser run был вызван приостановкой host и
  прошёл при изолированном повторе без изменений кода.

## 4. Ключевые технические решения

1. **Один источник геометрии.** PBD создаёт JSON и semantic SVG из одного
   `currentModel`; Viewer строит модель только из этого semantic SVG.
2. **Flat state равен diecut.** При Fold 0 вершины panel caps и fold endpoints
   должны совпадать с canonical SVG. Толщина материала не даёт права менять
   контур reference-only развёртки.
3. **Один coordinate frame для artwork.** Artwork хранится в canonical SVG mm;
   texture composer и global UV используют canonical `viewBox`, включая его
   `minX/minY` и технологические поля.
4. **Стороны материала разделены.** Outside получает artwork/finish; inside —
   белую бумагу; edge и crease имеют отдельные материалы.
5. **Preview не ждёт GLB.** Интерактивная модель становится доступной после
   Three.js build; GLB export остаётся отдельной операцией.
6. **Producer-first packaging.** Viewer изменяется и коммитится в producer,
   затем `npm run build:plugin`, затем штатный `plugins:sync:viewer` в Builder.
   Ручные изменения `vendor/plugins/` запрещены.
7. **Fail-closed security.** Plugin hashes, CSP/offline policy, origin/session
   checks и payload limits не ослабляются ради обхода ошибки.
8. **Focused browser verification.** После исправления одного browser test
   сначала запускается только его spec/test title. Полный browser suite нужен
   только для соответствующего release gate; build и Playwright не запускаются
   одновременно против общего `dist`.

## 5. Основные изменённые файлы

### CartonBuilder

- `src/main.js` — canonical bounds/presentation bridge, conditional finish maps,
  non-blocking Technical Preview payload.
- `src/host/viewerHostProtocol.js` — `exportGlb:false` load completion и
  versioned viewer state/artwork contracts.
- `src/carton/TechnicalCartonDocument.js` и
  `src/carton/technicalBoxModelAdapter.js` — canonical `viewBox` boundary.
- `src/preview3d/textureComposer.js` — canonical atlas bounds and orientation.
- `src/preview3d/BoxScene.js`, `src/render/WebGLCartonRenderer.js` и
  `src/styles/main.css` — stable Preview/Render viewport sizing.
- `src/render/environmentAssets.js` и
  `public/render-environments/polyhaven/` — 1K built-in HDRI set.
- `vite.config.js` и `tests/e2e/showcase.spec.js` — byte-for-byte publication
  Showcase при сохранённом vendored plugin public root.
- `scripts/lib/atomicManifestSync.mjs` — Windows locked-directory activation and
  rollback.
- `tests/unit/plugins/pluginsVerification.test.js`,
  `tests/unit/preview3dTexture.test.js`,
  `tests/unit/carton/technicalBoxModelAdapter.test.js`,
  `tests/e2e/technicalPreview.spec.js`, `tests/e2e/preview3d.spec.js` и
  `tests/e2e/render.spec.js` — relevant regression coverage.
- `vendor/plugins/carton-fold-viewer/2.4.0/` и
  `vendor/plugins/plugins.manifest.json` — generated synchronized output.

### CartonFoldViewer producer

- `src/pbd/semantic-svg.js` — canonical parse without panel/fold mutation.
- `src/geometry/crease-geometry.js` — certified finite crease versus canonical
  zero-width hinge, curved hinge skins and endpoint handling.
- `src/geometry/materials.js` — outside/inside/edge/crease material policy and
  outer-crease-only depth bias.
- `src/model/model-builder.js` — canonical panel/hinge hierarchy.
- `src/animation/fold-animations.js` и
  `src/animation/motion-models/tuck-standard.js` — glue flap/tuck sequence.
- `src/runtime/FoldRuntime.js` — artwork maps, texture-only updates, renderer
  anisotropy cap and disposal.
- `src/viewer/ViewerApp.js` — logarithmic depth buffer and capability handoff.
- `tests/test_canonical_flat_geometry.mjs`,
  `tests/test_canonical_hinge_runtime.mjs`, `tests/test_global_uv.mjs`,
  `tests/test_artwork_atlas.mjs`, `tests/test_asymmetric_atlas.mjs` и
  `tests/test_host_protocol.mjs` — canonical/runtime acceptance.

## 6. Pinned plugin artifacts

Source of truth: `vendor/plugins/plugins.manifest.json`.

| Plugin | Source commit | Entrypoint bytes | Entrypoint SHA-256 | Manifest SHA-256 |
|---|---|---:|---|---|
| CartonFoldViewer 2.4.0 | `a9ec05e93f5bd28f0822ed8f5c110897a36a135a` | 1,096,653 | `32777906a7dcee477732b3248e3afce844b5e618c3a71b65bfcb816d12456e7b` | `477b56a2fb77defea89b2726db423785b358be97859fe04990ac0180ef3d4969` |
| Packaging Box Designer 1.2.0 | `1208f9188e662895cb66a3e3138fa2ac2fadc511` | 598,887 | `1047e4083f1426e43bb413047ebdcddd49388415203ec7ab1469b09c3f208904` | `16a19e1b3311c008052cf3ce6e459ccdceafbb7d5facc52b5f03c649466fad87` |

Оба manifest сохраняют `referenceOnly=true`, `productionCertified=false`,
`technicalRender=false`, sandbox `allow-scripts`, CSP и no-external-network
policy.

## 7. Тестирование и проверки

Актуальные проверки от 2026-09-02:

| Проверка | Результат |
|---|---|
| Producer `python tests/run_regression.py` | **PASS: 15/15**, 0 failed, 11.88 s |
| Producer `npm run build:plugin` для commit `a9ec05e` | **PASS**, provenance gate; artifact values совпадают с таблицей выше |
| Builder `npm run plugins:verify` | **PASS**, 2 plugins, hashes/manifests/CSP/offline static policy |
| Builder local `npm run test:unit` | **PASS: 79 files, 586/586 tests**, 12.15 s |
| Builder local `npm run build` | **PASS: 398 modules**, plugin integrity PASS, Vite build 9.61 s |
| Builder full Chromium E2E | **ACCEPTED: 124/125 in full run + isolated custom HDRI retry PASS**, всего 125 сценариев подтверждены |
| Showcase source/dist | **PASS: 6/6 files byte-for-byte**, published HTML/viewer/MP3 present |
| GitHub Pages deploy run `33501418758` | **PASS**, HEAD `8cfbf9b`, completed 2026-09-01 |
| Public `plugins/plugins.manifest.json` | **HTTP 200**, Viewer commit/hash/bytes совпадают с local catalog |
| `git diff --check` до обновления handoff | **PASS** в обоих repositories |

Полный browser gate выполнялся последовательно после production build. Его
показатель `9.7h` не является performance evidence: во время custom HDRI test
host был приостановлен, trace содержит скачок часов на уже удовлетворённом
`renderRecovery` assertion. Изолированный повтор этого единственного test прошёл
за 1.0 min; остальные 124 проходящих browser tests повторно не запускались.

## 8. Известные проблемы и незакрытые gates

- Известных падающих Release 2 focused/browser tests после acceptance gate нет.
- Release 2 закрыт как reference-only integration gate; это не меняет
  `productionCertified=false` и не является physical folded-sample certification.
- Technical Render не реализован: Stage 7B
  `TechnicalRenderSceneSource` остаётся следующим архитектурным срезом.
- Production-assist/prepress profiles, converter/material evidence, physical
  folded-sample certification и полноценные finish gates не завершены.
- Producer repository нельзя push до настройки remote.
- GitHub Actions намеренно отключены после последней публикации. Для следующего
  deploy их нужно временно включить по явному разрешению и снова отключить после
  подтверждённой публикации.
- Payload limits остаются fail-closed. `payload-too-large` нельзя исправлять
  увеличением лимита без отдельного contract/risk review.

## 9. Опробованные и отвергнутые подходы

- **Ручное редактирование vendored Viewer.** Приводит к расхождению
  sourceCommit/hash и producer source; заменено producer build + official sync.
- **Fallback crease width = thickness и radius = thickness/2.** Подрезал panel
  caps на `t/2`, поэтому 3D diecut расходился с technical dieline; отменён.
- **In-place CAD compensation в semantic parser.** Сдвигала panel polygons и
  folds относительно SVG; удалена.
- **Polygon offset на panel inside и жёсткий anisotropy=16.** Маскировали
  симптомы и зависели от GPU; заменены outer-crease-only bias и renderer cap.
- **`DoubleSide` для artwork.** Печатал atlas на внутренней стороне; заменён
  явными outside/inside material groups.
- **Разбиение crease на дополнительные material primitives.** Меняло GLB
  primitive identity и ломало fold/UV assumptions; не используется.
- **Второй parser/model или Quick geometry для Technical.** Нарушает единый
  canonical source; запрещено архитектурой.
- **Обязательный GLB export при каждом входе в Preview.** Блокировал Step 3;
  заменён `exportGlb:false` для интерактивного load.
- **Ослабление payload/CSP/integrity checks.** Отклонено; ошибки должны
  обрабатываться в рамках versioned contract.
- **Directory rename без fallback на Windows.** Dev watcher вызывал
  `EPERM`/`EACCES`; добавлена entry-by-entry activation с rollback.
- **Полный Playwright rerun после каждого локального исправления.** Избыточен;
  сначала запускается только падающий test/spec, а полный gate — один раз перед
  release acceptance.

## 10. Безопасная последовательность продолжения

1. Прочитать этот файл, `docs/17. dual-workflow-plugin-integration-plan.md` и
   разделы Stage 6B/7A в `docs/18. integration-manifest.md`.
2. Проверить оба worktree:

   ```powershell
   Set-Location "C:\Projects\CartonBuilder_1"
   git status --short
   git log -5 --oneline --decorate

   Set-Location "C:\Projects\CartonFoldViewer-stage1"
   git status --short
   git log -5 --oneline --decorate
   ```

3. Release 2 acceptance уже закрыт. Не перезапускать полный gate после каждого
   изменения; сначала использовать только affected unit/spec tests. Build и
   Playwright не запускать одновременно против общего `dist`.
4. Если требуется Viewer fix, менять только producer. Запустить релевантный
   focused test, затем `python tests/run_regression.py`, commit и
   `npm run build:plugin`.
5. Синхронизировать только штатно:

   ```powershell
   Set-Location "C:\Projects\CartonBuilder_1"
   npm run plugins:sync:viewer -- --source "C:\Projects\CartonFoldViewer-stage1\dist\plugins\carton-fold-viewer\2.4.0"
   npm run plugins:verify
   ```

6. В Builder сначала запускать affected unit/spec tests. Полный unit/build/browser
   gate повторять только перед следующим release acceptance по отдельному
   согласованию.
7. Начать bounded Stage 7B через существующий `RenderSceneSource`: сначала
   `TechnicalRenderSceneSource` contract/source adapter и focused unit tests.
   Не включать `technicalRender`, Render UI routing, exports или certification
   flags до отдельного acceptance.
8. Перед совместной работой с producer настроить его remote. Публикацию Builder
   выполнять только по явной команде: enable Actions → push/deploy → проверить
   Pages и public manifest → disable Actions.
