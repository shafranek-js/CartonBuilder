# CartonBuilder

CartonBuilder is a browser application for interactively building the six-panel
flat net of a rectangular box. It calculates panel orientation from a 3D basis,
prevents duplicate physical faces and overlapping panels, and exports a completed
net as SVG with dimensions in millimetres.

The application is a geometry and workflow prototype. It is not a production
packaging dieline tool: it does not include flaps, separate cut/fold lines,
material thickness, bleed, artwork placement, or manufacturing tolerances.

## Development

Requirements:

- Node.js 20 or newer;
- npm.

Install dependencies and start the local development server:

```bash
npm install
npm run dev
```

Create and inspect a production build:

```bash
npm run build
npm run preview
```

Run tests:

```bash
npm run test:unit
npm run test:e2e
npm run test:all
```

The Playwright browser must be installed once with:

```bash
npx playwright install chromium
```

## Architecture

- `src/model/` contains DOM-independent box geometry and state.
- `src/ui/` contains the application controller, SVG renderer, and dialog logic.
- `src/export/` contains pure SVG generation and filename formatting.
- `src/styles/` contains the application stylesheet.
- `tests/unit/` contains Vitest model and export tests.
- `tests/e2e/` contains Playwright browser workflows.
- `docs/` contains the detailed Russian functional and technical specification.
- `legacy/` preserves the original standalone prototype as a reference only.

The modular Vite application is the runtime source of truth.

## Browser integration

The compatibility facade remains available as `window.BoxNet`. The running
application is exposed as:

```js
window.boxNetApp.model
window.boxNetApp.render()
window.boxNetApp.addPanel(panelId, edge)
window.boxNetApp.deletePanel(panelId)
window.boxNetApp.reset(dimensions)
window.boxNetApp.getState()
```

The application dispatches:

- `box-net-complete` with `model.toJSON()` in `event.detail`;
- `box-net-cancelled` after a reset through the Cancel button.

## Current limitations

- state is not persisted;
- there is no undo/redo;
- only leaf panels can be deleted;
- Cancel resets the layout instead of leaving a host workflow;
- exported shared edges are duplicated and are not classified as cut or fold;
- the interface is currently English-only.
