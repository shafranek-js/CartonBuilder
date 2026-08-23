# CartonBuilder — dual-workflow integration handoff

## Текущее состояние

Дата сверки: 2026-08-23
Рабочий каталог: `C:\Projects\CartonBuilder_1-stage1`
Ветка: `codex/dual-workflow-stage1`
HEAD: `61604bf fix(security): reject cross-platform traversal separators`

Этапы 0–4 и Release 1 reference-only boundary завершены. Quick workflow
сохранён отдельно от Technical workflow. Stage 6A Technical Preview, Stage 6B
viewer state/artwork integration и Stage 7A `RenderSceneSource` foundation
реализованы в исходниках. Technical Render и Release 2 broader visual/resource
acceptance остаются открытыми.

Рабочее дерево после этого обновления намеренно не будет чистым:

- существующие UI-изменения удаления reference-only warning:
  `index.html`, `src/i18n.js`, `src/styles/main.css`,
  `tests/e2e/technicalPreview.spec.js`;
- generated vendor/catalog changes from the approved viewer sync;
- этот handoff-файл.

`vendor/plugins/` обновлён только штатным `plugins:sync:viewer`, вручную не
редактировался.

## 1. Текущие цели и границы

- Сохранить Quick workflow на существующем Custom Net/Preview3D/Render пути.
- Поддерживать Technical workflow через canonical PBD model, canonical
  `pbd.svg.v4` bytes и sandboxed CartonFoldViewer iframe.
- Передавать artwork atlas, state и GLB по versioned host contracts без
  дублирования geometry/model pipeline.
- Подготовить общий Render source boundary, но не включать Technical Render до
  отдельного visual/export/resource acceptance.
- Все Technical profiles остаются `referenceOnly=true` и
  `productionCertified=false`; `technicalRender=false`.

## 2. Завершённые задачи

- Workflow selection, guarded Technical transition, Quick compatibility,
  persistence/archive round-trip и Technical Place Artwork.
- Canonical Technical SVG export and provenance, semantic LINE/ARC snapping,
  printable/DPI preflight и Stage 4E technical flat PDF/artwork export.
- Stage 6A: Technical Preview iframe with sandbox `allow-scripts`, CSP/offline
  policy, Quick/Technical routing, lifecycle cancel/dispose and host protocol.
- Stage 6B: persisted animation/progress/normalized-camera `technicalViewer`
  state, state acknowledgements, generation guards and texture-only artwork
  updates.
- Stage 7A: `src/render/RenderSceneSource.js` boundary with
  `LegacyRenderSceneSource`; `WebGLCartonRenderer` delegates render surface,
  artwork replacement, camera operations, export, diagnostics and disposal.
- Viewer artifact `carton-fold-viewer@2.4.0` rebuilt from producer commit
  `685e039` and transactionally synchronized.
- Latest viewer correction: artwork atlas is applied to panel outside caps only;
  inner caps are white paper without atlas/finish maps, and crease backfaces are
  hidden. Canonical geometry, UVs and fold graph are unchanged.

## 3. Pinned plugin artifacts

Source of truth: `vendor/plugins/plugins.manifest.json`.

| Plugin | Source commit | Entrypoint SHA-256 | Manifest SHA-256 |
|---|---|---|---|
| Packaging Box Designer 1.2.0 | `1208f9188e662895cb66a3e3138fa2ac2fadc511` | `1047e4083f1426e43bb413047ebdcddd49388415203ec7ab1469b09c3f208904` | `16a19e1b3311c008052cf3ce6e459ccdceafbb7d5facc52b5f03c649466fad87` |
| CartonFoldViewer 2.4.0 | `685e039328f8ae3ba34faaad93d4e6c299663557` | `054dd11c2dd7d6f0f145e75fc6111e7a127b5e0ad2fcd30e2670bded63c2d480` | `fe4ff2408abc06472a8341cec6df66e0cb9b6288fb48a1e2c9402f680241a2c5` |

Viewer artifact entrypoint byte length: `1,096,292`. Contracts remain
`carton-workflow.v1`, `pbd.model.v1` and `pbd.svg.v4`; capabilities remain
`foldPreview=true`, `technicalRender=false`, `referenceOnly=true` and
`productionCertified=false`.

## 4. Основные файлы integration

- `src/host/pbdHostProtocol.js` and `src/host/viewerHostProtocol.js` — source,
  origin, session, integrity and viewer state/artwork contracts.
- `src/carton/TechnicalCartonDocument.js`,
  `src/carton/technicalBoxModelAdapter.js` and
  `src/carton/technicalPresentation.js` — canonical Technical model boundary.
- `src/project/projectSchema.js`, `src/project/projectArchive.js` and
  `ProjectCheckpoint.js` — schema/archive/state persistence.
- `src/render/RenderSceneSource.js` and `src/render/WebGLCartonRenderer.js` —
  Stage 7A render source boundary.
- `src/main.js`, `index.html`, `src/styles/main.css`, `src/i18n.js` — workflow,
  preview and current UI boundary.
- `vendor/plugins/carton-fold-viewer/2.4.0/` and
  `vendor/plugins/plugins.manifest.json` — generated synchronized artifact;
  update only via producer build plus `plugins:sync:viewer`.
- `tests/unit/viewerHostProtocol.test.js`,
  `tests/e2e/technicalPreview.spec.js`, `tests/e2e/preview3d.spec.js`,
  `tests/e2e/app.spec.js` — relevant acceptance coverage.

Plan and evidence sources:

- `docs/17. dual-workflow-plugin-integration-plan.md`
- `docs/18. integration-manifest.md`

## 5. Подтверждённые проверки текущего среза

| Проверка | Результат |
|---|---|
| Producer `npm run build:plugin` | **PASS**, provenance gate and 13/13 regression suites |
| Producer artwork/UV/headless/host focused tests | **PASS**: 4 focused suites |
| `npm run plugins:sync:viewer -- --source C:\Projects\CartonFoldViewer-stage1\dist\plugins\carton-fold-viewer\2.4.0` | **PASS**, transactional sync |
| `npm run plugins:verify` | **PASS**, 2 plugins, manifest/hash/CSP/offline checks |
| `git diff --check` | **PASS**; only CRLF conversion warnings on existing UI files |

Previous acceptance evidence remains useful but was not rerun after this final
vendor artifact sync: CartonBuilder unit baseline 573/573, build baseline 396
Vite modules, Stage 6A focused Technical Preview 2/2, smoke 7/7 and the
earlier Stage 4E export gates. Do not report those as a fresh post-sync browser
run without rerunning the affected specs.

## 6. Известные проблемы и открытые границы

- Release 2 broader visual/resource gate is open. It must cover 2D↔3D panel
  mapping, outer-only artwork, GLB/resource round-trip, texture replacement and
  repeated dispose/reload behavior.
- Technical Render remains disabled. Do not route Technical through Quick
  `BoxNetModel`, `Preview3D` or `BoxScene`.
- Technical production-assist/prepress, material/converter profiles, Spot
  Gloss/Foil/Emboss/Deboss and physical folded-sample certification are not
  implemented or certified.
- Host payload limits are fail-closed. `payload-too-large`/`maxGlbBytes` must be
  handled as an explicit contract error, not bypassed by relaxing validation.
- The integration tree is intentionally dirty. Do not reset or overwrite the
  four existing UI files, generated vendor changes or this status update.
- Do not run Playwright against shared `dist` concurrently with `npm run build`;
  this previously caused transient empty DOM and false timeouts. Run browser
  suites after build and sequentially, focusing on the affected spec.
- GitHub Actions and deployment automation remain disabled unless explicitly
  re-authorized.

## 7. Опробованные и отвергнутые подходы

- Manual edits in `vendor/plugins/`: rejected; producer commit → provenance
  build → transactional sync is the only supported artifact flow.
- A second parser, SVG-only/alternative 3D model or Quick geometry reuse for
  Technical: rejected; canonical PBD model and one semantic runtime remain the
  source of truth.
- Generic Technical SVG export: rejected because it loses canonical metadata,
  provenance and exact LINE/ARC semantics.
- `DoubleSide` on the panel artwork material: rejected because the atlas then
  appears on inner caps; the synchronized viewer now uses explicit outside,
  inside-paper and edge material groups.
- Splitting crease meshes into multiple material groups: rejected because it
  changes GLB primitive identity and breaks fold/UV checks; the crease remains a
  single `FrontSide` material.
- Parallel Playwright and build against shared `dist`: rejected because it
  produces transient empty DOM/timeouts.
- Relaxing payload limits for oversized GLB: rejected; the host contract must
  remain fail-closed.

## 8. Следующие шаги

1. Review the exact integration diff and decide whether the existing UI cleanup,
   generated plugin sync and this handoff should be committed together or as
   separate reviewed commits.
2. Run sequential CartonBuilder verification on the synchronized artifact:
   `npm run plugins:verify`, `npm run test:unit`, `npm run build`, then the
   affected Technical Preview/Render browser specs with `--workers=1`.
3. Close the Release 2 visual/resource gate; keep `technicalRender=false` and
   both certification flags unchanged until evidence is complete.
4. Continue Stage 7B — TechnicalRenderSceneSource — only through the existing
   `RenderSceneSource` boundary and without duplicating Quick geometry.
5. Only after local acceptance, handle publication/deployment as a separate
   explicitly authorized operation.

## 9. Безопасный порядок продолжения

1. Read this file, `docs/17. dual-workflow-plugin-integration-plan.md` and the
   relevant sections of `docs/18. integration-manifest.md`.
2. Check `git status --short` and `git log -10 --oneline --decorate` in
   `C:\Projects\CartonBuilder_1-stage1`.
3. Preserve the dirty UI/vendor boundary; never use reset/checkout to discard it.
4. Run focused checks first, then unit/build, then affected browser specs
   sequentially. Finish with `plugins:verify`, `git diff --check` and exact Git
   status.
5. Use the producer repository for any future viewer change; after its commit,
   run `npm run build:plugin` there and then sync with:

   ```powershell
   Set-Location "C:\Projects\CartonBuilder_1-stage1"
   npm run plugins:sync:viewer -- --source "C:\Projects\CartonFoldViewer-stage1\dist\plugins\carton-fold-viewer\2.4.0"
   npm run plugins:verify
   ```
