# CartonBuilder

CartonBuilder is a local-first browser application for building a six-panel
rectangular-box net, placing one or more artwork assets on it in exact millimetre
coordinates, previewing the clipped result, and exporting proof and technically
structured files.

The current workflow is:

1. **Create Box** — enter width, height, depth and board caliper, then build a valid six-face net.
2. **Place Artwork** — load PNG, JPEG, or one page of a PDF; move, scale, rotate,
   inspect effective DPI, and control fixed system layers.
3. **Preview** — inspect the clipped 2D proof and a folded technical 3D carton.
4. **Render** — create a reproducible closed-carton presentation, apply masked
   packaging finishes, review export preflight/health diagnostics, and export
   PNG/JPG stills, turntables or a self-contained GLB.

Artwork also includes a Prepress panel for production-assist trim/bleed/safe
overlays, manual allowance review, marks, transient preflight and separate
Prepress PDF/SVG output. These files are explicitly not PDF/X certified or
contract colour proofs; 3D geometry and normal Render exports are unchanged.

All artwork processing happens in the browser. The application does not upload
assets or project data to a server.

## Development

Requirements:

- Node.js 20 or newer;
- npm;
- Chromium installed for Playwright.

```bash
npm install
npx playwright install chromium
npm run dev
```

Production build and preview:

```bash
npm run build
npm run preview
```

Tests:

```bash
npm run test:unit
npm run test:e2e
npm run test:e2e:ci
npm run test:e2e:smoke
npm run test:e2e:full
npm run test:e2e:stress
npm run test:visual
npm run test:all
```

`npm run test:all` runs the Vitest model/export/storage suite and the Playwright
end-to-end browser workflows. The E2E suite covers PNG and multipage rotated PDF
input, transforms, layer locking, undo/redo, autosave, `.carton` round-trips,
localization, responsive resizing, integration events, and all export buttons.
It also covers all reachable fold trees, net-space UV continuity, lazy 3D
loading, both camera projections, scene presets, WebGL recovery, Render
preflight, deterministic Render screenshots, Floor Reflection controls, DPR 1/2
and repeated texture replacement. `test:e2e:smoke` is the fast release gate;
`test:e2e:stress` runs the 20-cycle resource checks. The scheduled Windows
release job also runs `npm run test:e2e:edge` against Microsoft Edge.

## Code knowledge graph (Graphify)

The repository includes a project-scoped Graphify skill for Codex in
`.codex/skills/graphify/` and guidance in `AGENTS.md`. To recreate the local
graph on a new machine, install the official package and build the AST graph:

```bash
uv tool install graphifyy
graphify install --project --platform codex
graphify extract . --code-only --no-cluster
```

The generated `graphify-out/` directory is local-only and ignored by Git. Use
`graphify query "..."` for scoped architecture questions and `graphify update .`
after code changes.

## Architecture

- `src/model/` — DOM-independent box geometry, serialization, and cut/fold
  segment derivation.
- `src/artwork/` — canonical artwork transform, viewport, history, validation,
  browser file loading, and SVG editor rendering.
- `src/project/` — IndexedDB autosave and versioned `.carton` ZIP import/export.
- `src/export/` — SVG, raster preview, preflight checks, and physical-size PDF
  adapters. Heavy PDF code is loaded only when required.
- `src/prepress/` — schema-safe production dieline derivation, prepress settings,
  presets and Blocking/Warning/Manual review preflight.
- `src/preview3d/` — lazy-loaded Three.js fold graph, procedural panel geometry,
  shared artwork texture, cameras, scene presets, picking, and GPU lifecycle.
- `src/render/` — persisted presentation settings, Render scene descriptor,
  separate WebGL presentation renderer, presets, preflight/health diagnostics,
  and offscreen PNG/JPG/turntable/GLB export.
- `src/ui/` — the existing box-net controller and renderer.
- `src/i18n.js` — English/Russian runtime strings.
- `src/diagnostics.js` — bounded local event history and explicit anonymized
  diagnostics download.
- `tests/unit/` and `tests/e2e/` — Vitest and Playwright coverage.
- `legacy/` — the untouched standalone prototype, kept as a reference only.

The canonical artwork state is expressed in millimetres relative to the top-left
corner of the Front Panel. SVG, canvas, and PDF are render/export adapters; none
of them is a second source of transform state.

The detailed runtime contract is in
[`docs/3. artwork-placement-runtime-specification.md`](docs/3.%20artwork-placement-runtime-specification.md).
The presentation Render contract is in
[`docs/9. render-runtime-specification.md`](docs/9.%20render-runtime-specification.md).
The status-aware index for all project documentation is in
[`docs/README.md`](docs/README.md).

## Artwork and projects

- Supported artwork: PNG, JPG/JPEG, PDF; maximum 100 MB.
- One or more artwork assets per project. A normal file drop adds an artwork
  entry; `Replace` requires confirmation and replaces the active entry. Each load
  operation accepts one file.
- Multipage PDFs use an explicit page picker. Page `/Rotate` and `MediaBox` are
  preserved; the original PDF remains available for vector-preserving export.
- The initial placement uses Fit + Center over the complete dieline bounds.
- Effective raster DPI is calculated from source pixels and actual millimetres.
  Raster artwork is never AI-upscaled: the imported source pixels are the quality
  ceiling. Vector/PDF artwork has independent `Preview quality` (`Auto`, 150,
  300, or 600 DPI) and `Render quality` (`Auto`, 150, 300, 600, 1200, or 2400
  DPI). Interactive Render is capped at 600 DPI; 1200/2400 DPI are used for
  final raster exports.
- Autosave stores the project and original asset in IndexedDB.
- A `.carton` file is a versioned ZIP containing `manifest.json`,
  `project.json`, the original assets, and their editor previews. Asset checksums
  and bounded entry sizes are validated when opening it.

## Editor controls

- Drag artwork to move it.
- Drag a corner to scale with the opposite corner anchored.
- `Alt` + corner drag scales from the centre.
- Artwork resize handles snap to every CutContour and Fold dieline line;
  constrained and unconstrained corner/side resizing both support snapping.
- Hold `Ctrl`/`Cmd` while resizing to bypass snapping. The active dieline
  target is highlighted while the pointer is captured; the highlight clears on
  release. Crop frame corner and side handles use the same snapping behavior.
- Mouse wheel zooms the canvas; `Ctrl` + wheel scales the artwork.
- Middle-mouse drag or `Space` + drag pans the canvas.
- Arrow keys move by 0.1 mm; `Shift` changes the step to 1 mm; `Ctrl` changes it
  to 10 mm.
- `Ctrl+Z`, `Ctrl+Shift+Z`, and `Ctrl+Y` control the 100-entry history.
- `0` fits the viewport, `Escape` clears the selection, and `Delete` removes
  unlocked artwork after confirmation.

The Transform panel uses one shared coordinate grid. The first two rows expose
`X`/`Y` position and `W`/`H` size with fixed `mm` unit columns; the Scale row
shows one group label followed by `X` and `Y` percentages in the same numeric
columns. All six numeric fields share the same dimensions and right-aligned
number formatting. The proportions chain is a compact control centered beside
the `W`/`H` rows and controls both pointer and numeric resizing.

Image Crop is non-destructive. `Crop` edits a frame and `Draw` creates one;
`Apply` or `Enter` commits it, while `Escape` cancels the preview. After Apply,
the visible crop becomes the selected artwork geometry and the new 100% scale
baseline for Width/Height, reference points, snapping, move, resize, Fit/Fill,
rotation, and Reset. `Clear` reveals the original source without undoing later
transforms or moving the previously visible content.

The fixed Layers panel exposes visibility and lock state for Artwork, Dieline,
Panel names, and Front/Base highlighting. Panel labels are visible in Edit and
off in Preview by default.

## 3D preview

- `3D Preview` is an inspection surface; artwork remains editable only in 2D.
- `Open`, `Fold`, and the slider control fold progress without changing the
  project model.
- Perspective and orthographic cameras are available; Perspective is the
  default. Mouse drag orbits, the wheel zooms, right-drag pans, and arrow keys
  pan while the 3D canvas is focused.
- `Technical`, `Studio`, and `Photorealistic` scene presets are available;
  Studio is the default. Technical preserves flat exact geometry; Studio and
  Photorealistic use thickness-aware solids.
- Clicking a panel shows its identity and millimetre dimensions. `Escape`
  clears the selection, and `Reset View` restores deterministic isometric
  framing.
- Artwork is shown on the exterior only. The unprinted interior is white.
- Three.js is downloaded only when 3D is first opened. WebGL 2 is required for
  3D, but not for 2D editing, project files, or export.

Preview also shows an `Export frame` overlay driven by the current Render
Aspect and Long edge. The frame and the sidebar summaries make the export
contract explicit: presentation PNG/JPG use the framed pixel dimensions,
2D PNG/JPG use the dieline bounds and effective artwork DPI, SVG/PDF preserve
the physical dieline size, and HTML is a responsive interactive viewer. HTML
texture quality can be set to Auto, 600, 1200, or 2400 DPI; Auto follows the
highest artwork Render quality while raster sources remain capped by native
pixels. The exported HTML is a self-contained offline viewer: it includes the
procedural carton, a compact embedded GLB model, model replacement for local
`.glb` files, fold/camera controls, HDRI/light/shadow/exposure/tone-mapping
settings, video audio, optional music, EN/RU language controls, persistent
settings, JSON settings import/export, and re-export of the current standalone
viewer. No CDN or remote HDRI is required. The procedural carton remains the
canonical model for fold/open; arbitrary replacement GLBs are static models.

Preview settings are split into two independently scrollable panels around the
viewport: the left panel contains scene presets, export quality, style and
environment controls; the right panel contains camera, lighting, shadows and
model controls. On narrow screens the panels stack below the viewport.

## Presentation Render

Render is intentionally separate from the technical Preview. It always starts
with `foldProgress = 1`, owns its own Three.js scene, and never becomes a second
source of artwork or box geometry. The artwork is composited in flat-net space,
so crop, rotation, opacity, PDF-layer visibility, and layer order remain aligned
with the 2D editor and Preview.

The current raster release provides Clean Studio, Catalogue, Soft Grey,
Transparent, Glossy Product, and Warm Retail Render presets. Built-in camera
views include Front, Back, Left, Right, Top, Bottom, Front-left, Front-right,
Top-front, and Isometric. Fit/Reset, 35/50/85 mm lens presets, derived FOV,
orthographic framing, and perspective vertical correction are available in the
Camera section. Global View Presets can be saved, duplicated, applied, and
deleted independently of full Render Presets. Artwork quality is intentionally
excluded from both preset types.

Render also provides Uncoated, Matte, and Gloss board profiles; a canonical
board caliper shared with Create Box (0.01–2.00 mm, dynamically limited by the
smallest panel); 1:1, 4:3,
16:9, and 3:4 frames; environment/light/shadow controls; embedded image,
solid or transparent backgrounds; optional floor reflection/shadow controls;
and PNG/JPG still export at preset, custom pixel, or print sizes (cm/in + PPI).
HDRI/EXR environment maps are supported as linear-light IBL assets with
procedural Neutral Softbox fallback, independent lighting/background usage,
rotation, intensity and blur controls. Bundled and custom maps use a 1K/2K/4K
runtime resolution cap (2K by default), with automatic device fallback and a
bounded two-entry PMREM cache; the Render diagnostics show requested/effective
resolution and fallback status. Custom maps are hashed and embedded as
separate render assets in project archive v4; GLB export warns that viewers do
not receive the HDRI or backplate.
Packaging finish layers can be marked as Print, Finish, or Print + Finish. Spot
gloss, metallic foil, emboss and deboss masks are derived from the same artwork
layers and use alpha/luminance mask selection, intensity, foil color/roughness,
and relief strength controls. Finish-only layers stay out of technical SVG/PDF
output. Render builds corresponding PBR maps in flat-net UV space.
The unified Render export dialog also creates a closed, self-contained binary
glTF (`.glb`) with embedded artwork and finish textures and either Full PBR or Basic
Compatibility materials, plus a bounded 24/36/72-frame turntable ZIP at
512/1024/2048 px. GLB export is static and intentionally excludes floor,
background, shadow catcher, environment and post-processing effects; turntable
frames preserve the active Render settings and restore the live camera.
Basic Compatibility shows a warning when finishes are active because it
simplifies clearcoat, foil and relief for limited PBR viewers.
Export uses a fixed offscreen render target and does not depend on
`preserveDrawingBuffer`. The Render canvas overlays the exact export viewport
and reports its pixel dimensions for the selected output size.

Render uses the same three-column layout: output settings (Render/View preset
galleries, artwork quality, camera, frame, material and board appearance) are
on the left, while
lighting, background, shadows, effects and diagnostics are on the right. Both
panels scroll independently and stack responsively on narrow screens.

Render effects are enabled with `VITE_ENABLE_RENDER_EFFECTS=true` (the default).
The optional path-tracing experiment is only exposed with
`VITE_ENABLE_RENDER_PATH_TRACING=true`; it is not part of the production raster
pipeline and requires a separately installed compatible addon.

All Render controls, including Board appearance, output sizing, background and
environment-map settings, are saved immediately in browser storage and included
in the current project snapshot. Embedded background images and HDR/EXR maps are
packed into `.carton` archives as separate render assets
and restored without external file links. They are restored after a page reload,
IndexedDB autosave restore, or `.carton` import. GPU resources, progress, and
renderer diagnostics remain transient. WebGL 2 is required for the presentation scene;
when unavailable, the 2D editor, technical exports, and project files remain
usable.

## Export

- PNG: uses the selected vector Render quality (Auto targets 300 DPI; 1200 and
  2400 DPI are available for final export), transparent outside the panel union.
- JPG: uses the selected vector Render quality (Auto targets 300 DPI; 1200 and
  2400 DPI are available for final export), with a white background.
- SVG: the existing millimetre-based box-net contract.
- PDF: exact 1:1 page dimensions; original PDF pages remain vector where
  possible; the dieline is a separate `Dieline` optional-content group; cut
  lines use the `CutContour` spot color and fold lines are dashed.
- Binary glTF: a static closed carton in Y-up metres with embedded lossless
  artwork textures, current camera metadata, and a selectable PBR compatibility
  profile. Turntable ZIP exports use `frame-001` naming without a duplicated
  final frame and are protected by a 160-megapixel browser budget.

The PDF is a technical proof, not a certified production PDF/X deliverable.
It must be checked with the intended printer before production. CartonBuilder
does not currently provide an ICC workflow, overprint or trapping validation,
bleed, or complete print-production validation.

Preflight warns about low effective DPI, artwork outside the dieline, and panels
that are not fully covered. Only missing or unreadable artwork blocks the normal
export flow; browser canvas safety limits can still reject an impractically
large high-DPI raster.

## Browser integration

The compatibility facade remains available as `window.BoxNet`. The original
application API remains available as:

```js
window.boxNetApp.model
window.boxNetApp.render()
window.boxNetApp.addPanel(panelId, edge)
window.boxNetApp.deletePanel(panelId)
window.boxNetApp.reset(dimensions)
window.boxNetApp.getState()
```

Additive APIs include `window.boxNetApp.loadState()`,
`window.boxNetApp.exportSvg()`, and `window.cartonBuilderApp`.

The transient 3D facade is available as
`window.cartonBuilderApp.preview3d`. It exposes activation, fold progress,
camera projection, scene preset, panel selection, reset/render, state,
resource diagnostics, and disposal. Its state is deliberately excluded from
autosave and `.carton`. Presentation state is available as
`window.cartonBuilderApp.render`; its serializable settings are included in the
current schema v14 project snapshot. Schema v14 adds canonical board
construction plus STE/RTE polygon construction elements while retaining the unified output kind, turntable options and GLB
options, camera framing, vertical correction, global View Preset references and per-artwork preview/render
quality. It also persists per-layer finish roles and finish parameters. Legacy
cropped artwork is normalized to the same visual-equivalent
100% transform baseline.

The existing events are unchanged:

- `box-net-complete` with `model.toJSON()` in `event.detail`;
- `box-net-cancelled` after a reset through the Cancel button.

## Current limitations

- Technical Preview and Presentation Render are derived views, not second
  artwork editors. Render output is an sRGB presentation image, not a CMYK,
  ICC, Pantone, overprint, certified print-proof, or production finish
  separation workflow.
- STE/RTE flaps and staged structural assembly are supported, but production
  bleed, safe area, trapping, crop marks, ICC/CMYK conversion, PDF/X output,
  ECMA/FEFCO certification and manufacturing allowances remain Wave 9.
- Presentation Render and Studio/Photorealistic Preview share thickness-aware
  solid board geometry with surface-aware hinges, bounded bevel, interior and
  edge materials, settled GTAO/TAA, optional DOF, adaptive quality diagnostics,
  and named presets. Technical Preview remains flat and exact. WebGPU, WebP,
  CMYK/ICC print proof, collision simulation, and
  production path tracing remain out of scope; the path-tracing button is a
  disabled-by-default gated experiment.
- Artwork replacement is not part of undo history; artwork entries can be added,
  reordered, renamed, hidden, locked and removed independently.
- Touch workflows are out of scope. The target is desktop Chrome at
  approximately 1024×720 or larger, including 4K displays. WebGL 1 and
  WebGPU-only rendering are not supported.
