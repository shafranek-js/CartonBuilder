import { getDielineSegments, getPanelMaskPath } from '../model/dieline.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const HANDLE_SCREEN_PX = 5;

function svgElement(documentRef, name, attributes = {}) {
  const element = documentRef.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value != null) element.setAttribute(key, String(value));
  }
  return element;
}

function appendImage(documentRef, parent, artwork, previewUrl, opacity, clipPath) {
  const imageProps = {
    class: 'artwork-image',
    href: previewUrl,
    x: artwork.centerXmm - artwork.unrotatedWidthMm / 2,
    y: artwork.centerYmm - artwork.unrotatedHeightMm / 2,
    width: artwork.unrotatedWidthMm,
    height: artwork.unrotatedHeightMm,
    opacity,
    preserveAspectRatio: 'none',
    transform: `rotate(${artwork.rotation} ${artwork.centerXmm} ${artwork.centerYmm})`,
  };

  if (clipPath) {
    const clipGroup = svgElement(documentRef, 'g', { 'clip-path': clipPath });
    const image = svgElement(documentRef, 'image', imageProps);
    clipGroup.appendChild(image);
    parent.appendChild(clipGroup);
    return image;
  }

  const image = svgElement(documentRef, 'image', imageProps);
  parent.appendChild(image);
  return image;
}

function appendDieline(documentRef, parent, model) {
  const { cut, fold } = getDielineSegments(model);
  for (const segment of cut) {
    parent.appendChild(svgElement(documentRef, 'line', {
      class: 'dieline-cut',
      x1: segment.start.x,
      y1: segment.start.y,
      x2: segment.end.x,
      y2: segment.end.y,
    }));
  }
  for (const segment of fold) {
    parent.appendChild(svgElement(documentRef, 'line', {
      class: 'dieline-fold',
      x1: segment.start.x,
      y1: segment.start.y,
      x2: segment.end.x,
      y2: segment.end.y,
    }));
  }
}

function getScreenCursor(key, rotation) {
  const corners = ['nw', 'ne', 'se', 'sw'];
  const baseIndex = corners.indexOf(key);
  const normalizedRotation = ((Number(rotation) % 360) + 360) % 360;
  const shift = Math.round(normalizedRotation / 90) % 4;
  const screenCorner = corners[(baseIndex + shift) % 4];
  return (screenCorner === 'nw' || screenCorner === 'se') ? 'nwse-resize' : 'nesw-resize';
}

function appendSelection(documentRef, parent, artwork, onPointerStart, handleSize, color) {
  const group = svgElement(documentRef, 'g', {
    transform: `rotate(${artwork.rotation} ${artwork.centerXmm} ${artwork.centerYmm})`,
  });
  const x = artwork.centerXmm - artwork.unrotatedWidthMm / 2;
  const y = artwork.centerYmm - artwork.unrotatedHeightMm / 2;
  const frameAttrs = { class: 'selection-frame', x, y, width: artwork.unrotatedWidthMm, height: artwork.unrotatedHeightMm };
  if (color) frameAttrs.style = `stroke:${color};`;
  group.appendChild(svgElement(documentRef, 'rect', frameAttrs));

  const half = handleSize / 2;
  const handles = [
    { key: 'nw', x, y, sx: -1, sy: -1 },
    { key: 'ne', x: x + artwork.unrotatedWidthMm, y, sx: 1, sy: -1 },
    { key: 'se', x: x + artwork.unrotatedWidthMm, y: y + artwork.unrotatedHeightMm, sx: 1, sy: 1 },
    { key: 'sw', x, y: y + artwork.unrotatedHeightMm, sx: -1, sy: 1 },
  ];
  for (const handle of handles) {
    const cursorStyle = getScreenCursor(handle.key, artwork.rotation);
    const node = svgElement(documentRef, 'rect', {
      class: 'resize-handle',
      x: handle.x - half,
      y: handle.y - half,
      width: handleSize,
      height: handleSize,
      'data-handle': handle.key,
      style: `cursor: ${cursorStyle};${color ? ` stroke-width:2;stroke:${color};` : ''}`,
    });
    node.addEventListener('pointerdown', (event) => onPointerStart(event, {
      type: 'resize',
      sx: handle.sx,
      sy: handle.sy,
    }));
    group.appendChild(node);
  }
  parent.appendChild(group);
}

export class ArtworkRenderer {
  constructor({
    svg,
    model,
    artwork,
    viewport,
    layers,
    onPointerStart,
  }) {
    this.svg = svg;
    this.model = model;
    this.artwork = artwork;
    this.viewport = viewport;
    this.layers = layers;
    this.onPointerStart = onPointerStart;
    this.entries = [];
    this.legacyPreviewUrl = '';
    this.selectionColor = null;
    this.selected = false;
  }

  setPreviewBlob(blob) {
    if (this.legacyPreviewUrl) URL.revokeObjectURL(this.legacyPreviewUrl);
    this.legacyPreviewUrl = blob ? URL.createObjectURL(blob) : '';
  }

  get previewUrl() {
    if (this.legacyPreviewUrl) return this.legacyPreviewUrl;
    return this.entries[0]?.previewUrl || '';
  }

  setArtworks(entries) {
    for (const entry of this.entries) {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    }
    this.entries = (entries || []).map((entry) => ({
      model: entry.model,
      visible: entry.visible !== false,
      previewUrl: entry.previewBlob ? URL.createObjectURL(entry.previewBlob) : '',
    }));
  }

  syncArtworkVisibility(entries) {
    for (let index = 0; index < this.entries.length; index += 1) {
      this.entries[index].visible = entries[index]?.visible !== false;
    }
  }

  dispose() {
    if (this.legacyPreviewUrl) URL.revokeObjectURL(this.legacyPreviewUrl);
    this.legacyPreviewUrl = '';
    for (const entry of this.entries) {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    }
    this.entries = [];
  }

  getSceneBounds() {
    const box = this.model.getBounds();
    const artworks = this.entries.length ? this.entries.map((entry) => entry.model) : [this.artwork];
    let minX = box.minX;
    let minY = box.minY;
    let maxX = box.maxX;
    let maxY = box.maxY;
    for (const art of artworks) {
      if (!art.hasArtwork) continue;
      const bounds = art.bounds;
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  fitToScreen() {
    const bounds = this.getSceneBounds();
    this.viewport.fit(bounds, this.svg.clientWidth || 1, this.svg.clientHeight || 1, 44);
    this.render();
  }

  clientToModel(clientX, clientY) {
    const rectangle = this.svg.getBoundingClientRect();
    return this.viewport.screenToModel(clientX - rectangle.left, clientY - rectangle.top);
  }

  render() {
    const width = Math.max(1, this.svg.clientWidth);
    const height = Math.max(1, this.svg.clientHeight);
    const x = -this.viewport.panX / this.viewport.zoom;
    const y = -this.viewport.panY / this.viewport.zoom;
    this.svg.setAttribute('viewBox', `${x} ${y} ${width / this.viewport.zoom} ${height / this.viewport.zoom}`);
    this.renderScene(this.svg, {
      preview: false,
      showDieline: this.layers.dieline,
      showNames: this.layers.names,
      showHighlights: this.layers.highlights,
      showArtwork: this.layers.artwork,
    });
  }

  renderScene(target, {
    preview,
    showDieline,
    showNames,
    showHighlights,
    showArtwork,
  }) {
    const documentRef = target.ownerDocument;
    target.replaceChildren();
    const defs = svgElement(documentRef, 'defs');
    const clip = svgElement(documentRef, 'clipPath', { id: `${target.id}-panel-mask` });
    const path = svgElement(documentRef, 'path', { d: getPanelMaskPath(this.model) });
    clip.appendChild(path);
    defs.appendChild(clip);
    target.appendChild(defs);

    if (showArtwork) {
      const entries = this.entries.length
        ? this.entries
        : this.artwork.hasArtwork && this.previewUrl
          ? [{ model: this.artwork, visible: true, previewUrl: this.previewUrl }]
          : [];
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (!entry.visible || !entry.model.hasArtwork || !entry.previewUrl) continue;
        if (!preview && entry.model.bgOpacity > 0) {
          appendImage(
            documentRef,
            target,
            entry.model,
            entry.previewUrl,
            entry.model.opacity * entry.model.bgOpacity,
            null,
          );
        }
        appendImage(
          documentRef,
          target,
          entry.model,
          entry.previewUrl,
          entry.model.opacity,
          `url(#${target.id}-panel-mask)`,
        );
      }
    }

    if (showHighlights) {
      for (const panel of this.model.getPanels()) {
        if (panel.id !== 'front' && panel.id !== 'bottom') continue;
        target.appendChild(svgElement(documentRef, 'rect', {
          class: panel.id === 'front' ? 'front-highlight' : 'base-highlight',
          x: panel.x,
          y: panel.y,
          width: panel.width,
          height: panel.height,
        }));
      }
    }

    if (showDieline) appendDieline(documentRef, target, this.model);

    if (showNames) {
      for (const panel of this.model.getPanels()) {
        const fontSize = Math.max(3.2, Math.min(6, Math.min(panel.width, panel.height) * 0.1));
        const label = svgElement(documentRef, 'text', {
          class: 'artwork-panel-label',
          x: panel.x + panel.width / 2,
          y: panel.y + panel.height / 2,
          'font-size': fontSize,
        });
        label.textContent = panel.faceName;
        target.appendChild(label);
      }
    }

    if (!preview && this.selected && showArtwork && this.artwork.hasArtwork) {
      appendSelection(
        documentRef,
        target,
        this.artwork,
        this.onPointerStart,
        HANDLE_SCREEN_PX / this.viewport.zoom,
        this.selectionColor,
      );
    }

    if (!preview) {
      for (const node of target.querySelectorAll('.artwork-image')) {
        node.addEventListener('pointerdown', (event) => this.onPointerStart(event, { type: 'move' }));
      }
    }
  }
}
