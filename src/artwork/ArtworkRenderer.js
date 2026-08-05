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

export function getArtworkOrigin(artwork) {
  return {
    x: artwork.centerXmm - artwork.unrotatedWidthMm / 2,
    y: artwork.centerYmm - artwork.unrotatedHeightMm / 2,
  };
}

export function getCropRect(artwork, crop) {
  const origin = getArtworkOrigin(artwork);
  return {
    x: origin.x + (crop.x || 0),
    y: origin.y + (crop.y || 0),
    width: crop.width,
    height: crop.height,
  };
}

export function getCropCorners(artwork, crop) {
  const rect = getCropRect(artwork, crop);
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

export function getArtworkRotationTransform(artwork) {
  const sx = artwork.flipX ? -1 : 1;
  const sy = artwork.flipY ? -1 : 1;
  if (sx === 1 && sy === 1) {
    return `rotate(${artwork.rotation} ${artwork.centerXmm} ${artwork.centerYmm})`;
  }
  return `translate(${artwork.centerXmm} ${artwork.centerYmm}) scale(${sx} ${sy}) rotate(${artwork.rotation}) translate(${-artwork.centerXmm} ${-artwork.centerYmm})`;
}

function appendImage(documentRef, parent, artwork, previewUrl, opacity, clipPath, artworkIndex) {
  const origin = getArtworkOrigin(artwork);
  const imageProps = {
    class: 'artwork-image',
    href: previewUrl,
    x: origin.x,
    y: origin.y,
    width: artwork.unrotatedWidthMm,
    height: artwork.unrotatedHeightMm,
    opacity,
    preserveAspectRatio: 'none',
    transform: getArtworkRotationTransform(artwork),
  };
  if (artworkIndex != null) imageProps['data-artwork-index'] = String(artworkIndex);

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

function appendCroppedImage(documentRef, parent, artwork, previewUrl, opacity, outerClip, crop, artworkIndex) {
  const origin = getArtworkOrigin(artwork);
  const cropRect = getCropRect(artwork, crop);
  const rotateGroup = svgElement(documentRef, 'g', {
    transform: getArtworkRotationTransform(artwork),
  });
  const clipRect = svgElement(documentRef, 'rect', {
    x: cropRect.x,
    y: cropRect.y,
    width: cropRect.width,
    height: cropRect.height,
  });
  const cropId = `crop-${Math.random().toString(36).slice(2)}`;
  const clipDef = svgElement(documentRef, 'clipPath', { id: cropId });
  clipDef.appendChild(clipRect);
  const defs = parent.closest('svg')?.querySelector('defs');
  if (defs) defs.appendChild(clipDef);
  const clipGroup = svgElement(documentRef, 'g', { 'clip-path': `url(#${cropId})` });
  const imageAttrs = {
    class: 'artwork-image',
    href: previewUrl,
    x: origin.x,
    y: origin.y,
    width: artwork.unrotatedWidthMm,
    height: artwork.unrotatedHeightMm,
    opacity,
    preserveAspectRatio: 'none',
  };
  if (artworkIndex != null) imageAttrs['data-artwork-index'] = String(artworkIndex);
  const image = svgElement(documentRef, 'image', imageAttrs);
  clipGroup.appendChild(image);
  rotateGroup.appendChild(clipGroup);
  if (outerClip) {
    const outer = svgElement(documentRef, 'g', { 'clip-path': outerClip });
    outer.appendChild(rotateGroup);
    parent.appendChild(outer);
  } else {
    parent.appendChild(rotateGroup);
  }
  return image;
}

function appendCropFrame(documentRef, parent, artwork, crop, handleSize) {
  const cropRect = getCropRect(artwork, crop);
  const group = svgElement(documentRef, 'g', {
    transform: getArtworkRotationTransform(artwork),
  });
  group.appendChild(svgElement(documentRef, 'rect', {
    class: 'crop-frame',
    x: cropRect.x,
    y: cropRect.y,
    width: cropRect.width,
    height: cropRect.height,
  }));
  const halfHandle = handleSize / 2;
  const corners = getCropCorners(artwork, crop);
  const cornerKeys = ['nw', 'ne', 'se', 'sw'];
  for (let i = 0; i < corners.length; i++) {
    group.appendChild(svgElement(documentRef, 'rect', {
      class: 'crop-handle',
      x: corners[i].x - halfHandle,
      y: corners[i].y - halfHandle,
      width: handleSize,
      height: handleSize,
      'data-crop-corner': i,
      style: `cursor: ${getScreenCursor(cornerKeys[i], artwork.rotation, artwork)};`,
    }));
  }
  const sides = [
    { key: 'n', x: cropRect.x + cropRect.width / 2, y: cropRect.y },
    { key: 'e', x: cropRect.x + cropRect.width, y: cropRect.y + cropRect.height / 2 },
    { key: 's', x: cropRect.x + cropRect.width / 2, y: cropRect.y + cropRect.height },
    { key: 'w', x: cropRect.x, y: cropRect.y + cropRect.height / 2 },
  ];
  for (const side of sides) {
    group.appendChild(svgElement(documentRef, 'rect', {
      class: 'crop-handle crop-side-handle',
      x: side.x - halfHandle,
      y: side.y - halfHandle,
      width: handleSize,
      height: handleSize,
      'data-crop-edge': side.key,
      style: `cursor: ${getSideCursor(side.key, artwork.rotation, artwork)};`,
    }));
  }
  parent.appendChild(group);
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

function appendSnapGuides(documentRef, parent, guides) {
  const seen = new Set();
  for (const guide of guides || []) {
    const segment = guide?.segment;
    if (!segment || seen.has(segment.id)) continue;
    seen.add(segment.id);
    parent.appendChild(svgElement(documentRef, 'line', {
      class: `snap-guide snap-guide-${segment.kind}`,
      x1: segment.start.x,
      y1: segment.start.y,
      x2: segment.end.x,
      y2: segment.end.y,
      'data-snap-axis': segment.axis,
      'data-snap-kind': segment.kind,
      'pointer-events': 'none',
    }));
  }
}

function getScreenCursor(key, rotation, artwork) {
  const corners = ['nw', 'ne', 'se', 'sw'];
  let baseIndex = corners.indexOf(key);
  if (artwork?.flipX) {
    if (baseIndex === 0) baseIndex = 1;
    else if (baseIndex === 1) baseIndex = 0;
    else if (baseIndex === 2) baseIndex = 3;
    else if (baseIndex === 3) baseIndex = 2;
  }
  if (artwork?.flipY) {
    if (baseIndex === 0) baseIndex = 3;
    else if (baseIndex === 3) baseIndex = 0;
    else if (baseIndex === 1) baseIndex = 2;
    else if (baseIndex === 2) baseIndex = 1;
  }
  const normalizedRotation = ((Number(rotation) % 360) + 360) % 360;
  const shift = Math.round(normalizedRotation / 90) % 4;
  const screenCorner = corners[(baseIndex + shift) % 4];
  return (screenCorner === 'nw' || screenCorner === 'se') ? 'nwse-resize' : 'nesw-resize';
}

function getSideCursor(key, rotation, artwork) {
  const sides = ['n', 'e', 's', 'w'];
  let baseIndex = sides.indexOf(key);
  if (artwork?.flipX && (baseIndex === 1 || baseIndex === 3)) baseIndex = 4 - baseIndex;
  if (artwork?.flipY && (baseIndex === 0 || baseIndex === 2)) baseIndex = 2 - baseIndex;
  const normalizedRotation = ((Number(rotation) % 360) + 360) % 360;
  const shift = Math.round(normalizedRotation / 90) % 4;
  const screenSide = sides[(baseIndex + shift) % 4];
  return screenSide === 'n' || screenSide === 's' ? 'ns-resize' : 'ew-resize';
}

function appendSelection(documentRef, parent, artwork, onPointerStart, handleSize, color) {
  const group = svgElement(documentRef, 'g', {
    transform: getArtworkRotationTransform(artwork),
  });
  const rect = getCropRect(artwork, artwork.visibleLocalRectRaw);
  const { x, y, width, height } = rect;
  const frameAttrs = { class: 'selection-frame', x, y, width, height };
  if (color) frameAttrs.style = `stroke:${color};`;
  group.appendChild(svgElement(documentRef, 'rect', frameAttrs));

  const half = handleSize / 2;
  const handles = [
    { key: 'nw', x, y, sx: -1, sy: -1 },
    { key: 'ne', x: x + width, y, sx: 1, sy: -1 },
    { key: 'se', x: x + width, y: y + height, sx: 1, sy: 1 },
    { key: 'sw', x, y: y + height, sx: -1, sy: 1 },
  ];
  for (const handle of handles) {
    const cursorStyle = getScreenCursor(handle.key, artwork.rotation, artwork);
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
      corner: handle.key,
      sx: handle.sx,
      sy: handle.sy,
    }));
    group.appendChild(node);
  }

  const sideHandles = [
    { key: 'n', x: x + width / 2, y, axis: 'y' },
    { key: 'e', x: x + width, y: y + height / 2, axis: 'x' },
    { key: 's', x: x + width / 2, y: y + height, axis: 'y' },
    { key: 'w', x, y: y + height / 2, axis: 'x' },
  ];
  for (const handle of sideHandles) {
    const cursorStyle = getSideCursor(handle.key, artwork.rotation, artwork);
    const node = svgElement(documentRef, 'rect', {
      class: 'resize-handle resize-side-handle',
      x: handle.x - half,
      y: handle.y - half,
      width: handleSize,
      height: handleSize,
      'data-handle': handle.key,
      'data-resize-side': handle.key,
      style: `cursor: ${cursorStyle};${color ? ` stroke-width:2;stroke:${color};` : ''}`,
    });
    node.addEventListener('pointerdown', (event) => onPointerStart(event, {
      type: 'resize',
      side: handle.key,
      axis: handle.axis,
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
    this._cropFrame = null;
    this._drawRect = null;
    this.snapGuides = [];
  }

  get cropFrame() { return this._cropFrame; }
  set cropFrame(v) { this._cropFrame = v || null; }
  get drawRect() { return this._drawRect; }
  set drawRect(v) { this._drawRect = v || null; }

  setSnapGuides(guides) {
    this.snapGuides = Array.isArray(guides) ? guides.filter(Boolean) : [];
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
    this.entries = (entries || []).map((entry, i) => ({
      model: entry.model,
      visible: entry.visible !== false,
      outputRole: entry.outputRole || 'print',
      previewUrl: (entry.displayBlob || entry.previewBlob)
        ? URL.createObjectURL(entry.displayBlob || entry.previewBlob)
        : '',
      artworkIndex: i,
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
        if (!entry.visible || entry.outputRole === 'finish' || !entry.model.hasArtwork || !entry.previewUrl) continue;
        const ai = entry.artworkIndex;
        const crop = entry.model.crop;
        if (!preview && entry.model.bgOpacity > 0) {
          if (crop) {
            appendCroppedImage(documentRef, target, entry.model, entry.previewUrl, entry.model.opacity * entry.model.bgOpacity, `url(#${target.id}-panel-mask)`, crop, ai);
          } else {
            appendImage(documentRef, target, entry.model, entry.previewUrl, entry.model.opacity * entry.model.bgOpacity, null, ai);
          }
        }
        if (crop) {
          appendCroppedImage(documentRef, target, entry.model, entry.previewUrl, entry.model.opacity, `url(#${target.id}-panel-mask)`, crop, ai);
        } else {
          appendImage(documentRef, target, entry.model, entry.previewUrl, entry.model.opacity, `url(#${target.id}-panel-mask)`, ai);
        }
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

    if (!preview && this.snapGuides.length) appendSnapGuides(documentRef, target, this.snapGuides);

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
      if (this.drawRect && showArtwork) {
        const drawRect = getCropRect(this.artwork, this.drawRect);
        const drGroup = svgElement(documentRef, 'g', {
          transform: getArtworkRotationTransform(this.artwork),
        });
        drGroup.appendChild(svgElement(documentRef, 'rect', {
          class: 'crop-drawing-rect',
          x: drawRect.x,
          y: drawRect.y,
          width: drawRect.width || 0,
          height: drawRect.height || 0,
        }));
        target.appendChild(drGroup);
      }
      if (this.cropFrame && showArtwork) {
        appendCropFrame(
          documentRef,
          target,
          this.artwork,
          this.cropFrame,
          HANDLE_SCREEN_PX / this.viewport.zoom,
        );
      }
      for (const node of target.querySelectorAll('.artwork-image')) {
        node.addEventListener('pointerdown', (event) => this.onPointerStart(event, { type: 'move' }));
      }
    }
  }
}
