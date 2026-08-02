# CartonBuilder

CartonBuilder is a local-first browser application for building a six-panel
rectangular-box net, placing one artwork asset on it in exact millimetre
coordinates, previewing the clipped result, and exporting proof and technically
structured files.

The current workflow is:

1. **Create Box** — enter width, height and depth, then build a valid six-face net.
2. **Place Artwork** — load PNG, JPEG, or one page of a PDF; move, scale, rotate,
   inspect effective DPI, and control fixed system layers.
3. **Preview** — inspect the clipped 2D proof and a folded technical 3D carton.
4. **Render** — create a reproducible closed-carton presentation and export PNG
   or JPG stills at 2048 or 4096 pixels on the long edge.

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
npm run test:all
```

`npm run test:all` runs the Vitest model/export/storage suite and the Playwright
end-to-end browser workflows. The E2E suite covers PNG and multipage rotated PDF
input, transforms, layer locking, undo/redo, autosave, `.carton` round-trips,
localization, responsive resizing, integration events, and all export buttons.
It also covers all reachable fold trees, net-space UV continuity, lazy 3D
loading, both camera projections, scene presets, WebGL recovery, and repeated
texture replacement.

## Architecture

- `src/model/` — DOM-independent box geometry, serialization, and cut/fold
  segment derivation.
- `src/artwork/` — canonical artwork transform, viewport, history, validation,
  browser file loading, and SVG editor rendering.
- `src/project/` — IndexedDB autosave and versioned `.carton` ZIP import/export.
- `src/export/` — SVG, raster preview, preflight checks, and physical-size PDF
  adapters. Heavy PDF code is loaded only when required.
- `src/preview3d/` — lazy-loaded Three.js fold graph, procedural panel geometry,
  shared artwork texture, cameras, scene presets, picking, and GPU lifecycle.
- `src/render/` — persisted presentation settings, Render scene descriptor,
  separate WebGL presentation renderer, presets, and offscreen PNG/JPG export.
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
- One artwork asset per project. `Replace` requires confirmation; dropping files
  is disabled after an asset has loaded.
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
  `project.json`, the original artwork, and its editor preview. Asset checksums
  and bounded entry sizes are validated when opening it.

## Editor controls

- Drag artwork to move it.
- Drag a corner to scale with the opposite corner anchored.
- `Alt` + corner drag scales from the centre.
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
  Studio is the default. Technical uses unlit color for proof comparison.
- Clicking a panel shows its identity and millimetre dimensions. `Escape`
  clears the selection, and `Reset View` restores deterministic isometric
  framing.
- Artwork is shown on the exterior only. The unprinted interior is white.
- Three.js is downloaded only when 3D is first opened. WebGL 2 is required for
  3D, but not for 2D editing, project files, or export.

## Presentation Render

Render is intentionally separate from the technical Preview. It always starts
with `foldProgress = 1`, owns its own Three.js scene, and never becomes a second
source of artwork or box geometry. The artwork is composited in flat-net space,
so crop, rotation, opacity, PDF-layer visibility, and layer order remain aligned
with the 2D editor and Preview.

The first raster release provides Clean Studio, Catalogue, Soft Grey, and
Transparent presets; Front, Front-right, Front-left, Top-front, Isometric, and
Custom cameras; Uncoated, Matte, and Gloss board profiles; 1:1, 4:3, 16:9, and
3:4 frames; environment/light/shadow controls; transparent or solid backgrounds;
and PNG/JPG still export at 2048 or 4096 pixels on the long edge. Export uses a
fixed offscreen render target and does not depend on `preserveDrawingBuffer`.
The Render canvas overlays the exact export viewport and reports its pixel
dimensions whenever Aspect or Long edge changes.

Render effects are enabled with `VITE_ENABLE_RENDER_EFFECTS=true` (the default).
The optional path-tracing experiment is only exposed with
`VITE_ENABLE_RENDER_PATH_TRACING=true`; it is not part of the production raster
pipeline and requires a separately installed compatible addon.

Render settings and per-artwork quality are part of project schema version 6 and are restored by
IndexedDB autosave and `.carton` archives. GPU resources, progress, and renderer
diagnostics remain transient. WebGL 2 is required for the presentation scene;
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
current schema v6 project snapshot. Schema v6 stores per-artwork preview/render
quality and normalizes legacy cropped artwork
to the same visual-equivalent 100% transform baseline.

The existing events are unchanged:

- `box-net-complete` with `model.toJSON()` in `event.detail`;
- `box-net-cancelled` after a reset through the Cancel button.

## Current limitations

- Technical Preview and Presentation Render are derived views, not second
  artwork editors. Render output is an sRGB presentation image, not a CMYK,
  ICC, Pantone, overprint, or certified print-proof workflow.
- There are no flaps, bleed, safe area, material thickness, trapping, crop
  marks, ICC/CMYK conversion workflow, overprint validation, PDF/X output,
  production validation, collision simulation, or free-angle rotation.
- Presentation Render now provides Render-only solid board geometry with
  thickness/bevel, interior and edge materials, settled GTAO/TAA, optional DOF,
  adaptive quality diagnostics, and named presets. Preview remains flat and
  technical. WebGPU, WebP, CMYK/ICC print proof, collision simulation, and
  production path tracing remain out of scope; the path-tracing button is a
  disabled-by-default gated experiment.
- One artwork asset is supported; replacement is not part of undo history.
- Touch workflows are out of scope. The target is desktop Chrome at
  approximately 1024×720 or larger, including 4K displays. WebGL 1 and
  WebGPU-only rendering are not supported.
