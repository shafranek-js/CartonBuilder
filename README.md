# CartonBuilder

CartonBuilder is a local-first browser application for building a six-panel
rectangular-box net, placing one artwork asset on it in exact millimetre
coordinates, previewing the clipped result, and exporting production-oriented
files.

The current workflow is:

1. **Create Box** — enter width, height and depth, then build a valid six-face net.
2. **Place Artwork** — load PNG, JPEG, or one page of a PDF; move, scale, rotate,
   inspect effective DPI, and control fixed system layers.
3. **Preview / Export** — inspect the panel-union clipping and export PNG, JPG,
   SVG dieline, or a physical-size PDF.

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

## Architecture

- `src/model/` — DOM-independent box geometry, serialization, and cut/fold
  segment derivation.
- `src/artwork/` — canonical artwork transform, viewport, history, validation,
  browser file loading, and SVG editor rendering.
- `src/project/` — IndexedDB autosave and versioned `.carton` ZIP import/export.
- `src/export/` — SVG, raster preview, preflight checks, and physical-size PDF
  adapters. Heavy PDF code is loaded only when required.
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
[`docs/6. artwork-placement-runtime-specification.md`](docs/6.%20artwork-placement-runtime-specification.md).

## Artwork and projects

- Supported artwork: PNG, JPG/JPEG, PDF; maximum 100 MB.
- One artwork asset per project. `Replace` requires confirmation; dropping files
  is disabled after an asset has loaded.
- Multipage PDFs use an explicit page picker. Page `/Rotate` and `MediaBox` are
  preserved; the original PDF remains available for vector-preserving export.
- The initial placement uses Fit + Center over the complete dieline bounds.
- Effective raster DPI is calculated from source pixels and actual millimetres.
  Values below 300 DPI warn but do not block export.
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

The fixed Layers panel exposes visibility and lock state for Artwork, Dieline,
Panel names, and Front/Base highlighting. Panel labels are visible in Edit and
off in Preview by default.

## Export

- PNG: 300 DPI, transparent outside the panel union.
- JPG: 300 DPI with a white background.
- SVG: the existing millimetre-based box-net contract.
- PDF: exact 1:1 page dimensions; original PDF pages remain vector where
  possible; the dieline is a separate `Dieline` optional-content group; cut
  lines use the `CutContour` spot color and fold lines are dashed.

Preflight warns about low effective DPI, artwork outside the dieline, and panels
that are not fully covered. Only missing or unreadable artwork blocks the normal
export flow; browser canvas safety limits can still reject an impractically
large 300-DPI raster.

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

The existing events are unchanged:

- `box-net-complete` with `model.toJSON()` in `event.detail`;
- `box-net-cancelled` after a reset through the Cancel button.

## Current limitations

- This is a 2D artwork-placement release; it intentionally has no 3D preview.
- There are no flaps, bleed, safe area, material thickness, trapping, crop
  marks, CMYK conversion workflow, or free-angle rotation.
- One artwork asset is supported; replacement is not part of undo history.
- Touch workflows are out of scope. The target is desktop Chrome at
  approximately 1024×720 or larger, including 4K displays.
