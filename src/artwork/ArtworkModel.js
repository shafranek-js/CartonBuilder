const MIN_SCALE = 0.01;
const MAX_SCALE = 20;

export const ARTWORK_PREVIEW_QUALITY_OPTIONS = Object.freeze(['auto', 150, 300, 600]);
export const ARTWORK_RENDER_QUALITY_OPTIONS = Object.freeze(['auto', 150, 300, 600, 1200, 2400]);
// Keep the legacy export name available for integrations that used the shared list.
export const ARTWORK_QUALITY_OPTIONS = ARTWORK_RENDER_QUALITY_OPTIONS;
const DEFAULT_ARTWORK_QUALITY = Object.freeze({ preview: 'auto', render: 'auto' });

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return number;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return number;
}

function normalizeQuarterTurn(value) {
  const normalized = ((Number(value) % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(normalized)) {
    throw new Error('rotation must be 0, 90, 180 or 270 degrees.');
  }
  return normalized;
}

const PAGE_BOXES = ['MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox'];

function normalizePageBox(value) {
  return PAGE_BOXES.includes(value) ? value : 'CropBox';
}

function cloneSource(source) {
  return source ? { ...source } : null;
}

function normalizeArtworkQuality(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalize = (candidate, options) => {
    if (candidate === 'auto' || candidate == null) return 'auto';
    const dpi = Number(candidate);
    return options.includes(dpi) ? dpi : 'auto';
  };
  return {
    preview: normalize(source.preview, ARTWORK_PREVIEW_QUALITY_OPTIONS),
    render: normalize(source.render, ARTWORK_RENDER_QUALITY_OPTIONS),
  };
}

export const REFERENCE_POINTS = Object.freeze([
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]);

const REFERENCE_FRACTIONS = Object.freeze({
  'top-left': Object.freeze({ x: -1, y: -1 }),
  'top-center': Object.freeze({ x: 0, y: -1 }),
  'top-right': Object.freeze({ x: 1, y: -1 }),
  'middle-left': Object.freeze({ x: -1, y: 0 }),
  center: Object.freeze({ x: 0, y: 0 }),
  'middle-right': Object.freeze({ x: 1, y: 0 }),
  'bottom-left': Object.freeze({ x: -1, y: 1 }),
  'bottom-center': Object.freeze({ x: 0, y: 1 }),
  'bottom-right': Object.freeze({ x: 1, y: 1 }),
});

function rotatePoint(x, y, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: x * cosine - y * sine,
    y: x * sine + y * cosine,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeCropRect(value, width, height) {
  if (!value || typeof value !== 'object') return null;
  const rawX = Number(value.x);
  const rawY = Number(value.y);
  const rawWidth = Number(value.width);
  const rawHeight = Number(value.height);
  if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite)) return null;
  if (rawWidth <= 0 || rawHeight <= 0) return null;

  const x = clamp(rawX, 0, width);
  const y = clamp(rawY, 0, height);
  const maxX = clamp(rawX + rawWidth, 0, width);
  const maxY = clamp(rawY + rawHeight, 0, height);
  const normalizedWidth = maxX - x;
  const normalizedHeight = maxY - y;
  if (normalizedWidth <= 0 || normalizedHeight <= 0) return null;
  return { x, y, width: normalizedWidth, height: normalizedHeight };
}

export function getReferenceFraction(point) {
  return REFERENCE_FRACTIONS[point] || REFERENCE_FRACTIONS.center;
}

export class ArtworkModel {
  constructor(state = null) {
    this.clear();
    if (state) this.restore(state);
  }

  clear() {
    this.source = null;
    this.centerXmm = 0;
    this.centerYmm = 0;
    this.initialWidthMm = 1;
    this.initialHeightMm = 1;
    this.scaleX = 1;
    this.scaleY = 1;
    this.rotation = 0;
    this.flipX = false;
    this.flipY = false;
    this.opacity = 1;
    this.bgOpacity = 0.28;
    this.referencePoint = 'center';
    this.pdfLayerVisibility = null;
    this.pdfSeparationVisibility = null;
    this.quality = { ...DEFAULT_ARTWORK_QUALITY };
    this.crop = null;
    this.modified = false;
    return this;
  }

  get hasArtwork() {
    return Boolean(this.source);
  }

  get hasPdfLayers() {
    return Boolean(this.source?.pdfLayers?.length);
  }

  get aspectRatio() {
    if (!this.source) return 1;
    return this.source.widthPx / this.source.heightPx;
  }

  get unrotatedWidthMm() {
    return this.initialWidthMm * this.scaleX;
  }

  get unrotatedHeightMm() {
    return this.initialHeightMm * this.scaleY;
  }

  get visibleLocalRect() {
    if (!this.crop) return { x: 0, y: 0, width: this.unrotatedWidthMm, height: this.unrotatedHeightMm };
    const { x, y, width, height } = this.crop;
    return {
      x: this.flipX ? this.unrotatedWidthMm - x - width : x,
      y: this.flipY ? this.unrotatedHeightMm - y - height : y,
      width,
      height,
    };
  }

  get visibleLocalRectRaw() {
    if (!this.crop) return { x: 0, y: 0, width: this.unrotatedWidthMm, height: this.unrotatedHeightMm };
    return { ...this.crop };
  }

  get visibleUnrotatedWidthMm() {
    return this.visibleLocalRect.width;
  }

  get visibleUnrotatedHeightMm() {
    return this.visibleLocalRect.height;
  }

  get visibleCenter() {
    const rect = this.visibleLocalRect;
    const localOffset = {
      x: rect.x + rect.width / 2 - this.unrotatedWidthMm / 2,
      y: rect.y + rect.height / 2 - this.unrotatedHeightMm / 2,
    };
    const rotated = rotatePoint(localOffset.x, localOffset.y, this.rotation);
    return {
      x: this.centerXmm + rotated.x,
      y: this.centerYmm + rotated.y,
    };
  }

  get displayedWidthMm() {
    return this.rotation % 180 === 0
      ? this.visibleUnrotatedWidthMm
      : this.visibleUnrotatedHeightMm;
  }

  get displayedHeightMm() {
    return this.rotation % 180 === 0
      ? this.visibleUnrotatedHeightMm
      : this.visibleUnrotatedWidthMm;
  }

  get bounds() {
    const center = this.visibleCenter;
    return {
      minX: center.x - this.displayedWidthMm / 2,
      minY: center.y - this.displayedHeightMm / 2,
      maxX: center.x + this.displayedWidthMm / 2,
      maxY: center.y + this.displayedHeightMm / 2,
      width: this.displayedWidthMm,
      height: this.displayedHeightMm,
    };
  }

  load(source, dielineBounds) {
    const widthPx = positiveNumber(source.widthPx, 'source.widthPx');
    const heightPx = positiveNumber(source.heightPx, 'source.heightPx');
    const pdfLayers = Array.isArray(source.pdfLayers)
      ? source.pdfLayers.map((layer) => ({
        id: String(layer.id),
        name: String(layer.name || layer.id),
        group: layer.group ? String(layer.group) : null,
      }))
      : null;
    this.source = {
      id: source.id || crypto.randomUUID(),
      fileName: String(source.fileName || 'artwork'),
      mimeType: String(source.mimeType || ''),
      byteLength: Number(source.byteLength || 0),
      widthPx,
      heightPx,
      pageIndex: source.pageIndex == null ? null : Number(source.pageIndex),
      pageCount: source.pageCount == null ? null : Number(source.pageCount),
      vector: Boolean(source.vector),
      previewWidthPx: Number(source.previewWidthPx || widthPx),
      previewHeightPx: Number(source.previewHeightPx || heightPx),
      pdfPageRotation: normalizeQuarterTurn(source.pdfPageRotation || 0),
      mediaBox: source.mediaBox ? { ...source.mediaBox } : null,
      pageBox: normalizePageBox(source.pageBox),
      sha256: source.sha256 || '',
      pdfLayers,
      isVideo: Boolean(source.isVideo || source.mimeType?.startsWith('video/')),
    };
    this.pdfLayerVisibility = source.pdfLayerVisibility && typeof source.pdfLayerVisibility === 'object'
      ? { ...source.pdfLayerVisibility }
      : null;
    this.pdfSeparationVisibility = source.pdfSeparationVisibility && typeof source.pdfSeparationVisibility === 'object'
      ? { ...source.pdfSeparationVisibility }
      : null;
    this.rotation = this.source.pdfPageRotation;
    this.opacity = 1;
    this.fitDieline(dielineBounds, { setInitial: true });
    this.modified = false;
    return this;
  }

  fitDieline(bounds, { setInitial = false } = {}) {
    if (!this.source) return this;
    const width = positiveNumber(bounds.width, 'bounds.width');
    const height = positiveNumber(bounds.height, 'bounds.height');
    const displayedAspect = this.rotation % 180 === 0
      ? this.aspectRatio
      : 1 / this.aspectRatio;
    let displayedWidth = width;
    let displayedHeight = displayedWidth / displayedAspect;
    if (displayedHeight > height) {
      displayedHeight = height;
      displayedWidth = displayedHeight * displayedAspect;
    }
    const targetWidth = this.rotation % 180 === 0 ? displayedWidth : displayedHeight;
    const targetHeight = this.rotation % 180 === 0 ? displayedHeight : displayedWidth;

    if (setInitial) {
      this.initialWidthMm = targetWidth;
      this.initialHeightMm = targetHeight;
      this.scaleX = 1;
      this.scaleY = 1;
      this.centerXmm = bounds.minX + width / 2;
      this.centerYmm = bounds.minY + height / 2;
    } else {
      const factor = Math.min(width / this.displayedWidthMm, height / this.displayedHeightMm);
      this.setScaleX(this.scaleX * factor);
      this.setScaleY(this.scaleY * factor);
    }
    this.modified = !setInitial;
    return this;
  }

  fillDieline(bounds) {
    if (!this.source) return this;
    const width = positiveNumber(bounds.width, 'bounds.width');
    const height = positiveNumber(bounds.height, 'bounds.height');
    const factor = Math.max(width / this.displayedWidthMm, height / this.displayedHeightMm);
    this.setScaleX(this.scaleX * factor);
    this.setScaleY(this.scaleY * factor);
    this.modified = true;
    return this;
  }

  centerOnDieline(bounds) {
    return this.setVisibleCenter(
      finiteNumber(bounds.minX, 'bounds.minX') + positiveNumber(bounds.width, 'bounds.width') / 2,
      finiteNumber(bounds.minY, 'bounds.minY') + positiveNumber(bounds.height, 'bounds.height') / 2,
    );
  }

  moveBy(deltaXmm, deltaYmm) {
    this.centerXmm += finiteNumber(deltaXmm, 'deltaXmm');
    this.centerYmm += finiteNumber(deltaYmm, 'deltaYmm');
    this.modified = true;
    return this;
  }

  setCenter(centerXmm, centerYmm) {
    this.centerXmm = finiteNumber(centerXmm, 'centerXmm');
    this.centerYmm = finiteNumber(centerYmm, 'centerYmm');
    this.modified = true;
    return this;
  }

  setVisibleCenter(centerXmm, centerYmm) {
    const current = this.visibleCenter;
    return this.moveBy(
      finiteNumber(centerXmm, 'centerXmm') - current.x,
      finiteNumber(centerYmm, 'centerYmm') - current.y,
    );
  }

  getReferenceOffset() {
    const fraction = REFERENCE_FRACTIONS[this.referencePoint] || REFERENCE_FRACTIONS.center;
    return {
      x: (this.flipX ? -fraction.x : fraction.x) * this.displayedWidthMm / 2,
      y: (this.flipY ? -fraction.y : fraction.y) * this.displayedHeightMm / 2,
    };
  }

  getReferencePosition() {
    const center = this.visibleCenter;
    const offset = this.getReferenceOffset();
    return {
      x: center.x + offset.x,
      y: center.y + offset.y,
    };
  }

  setReferencePoint(point) {
    if (!REFERENCE_POINTS.includes(point)) return this;
    this.referencePoint = point;
    return this;
  }

  flipHorizontal() {
    const reference = this.getReferencePosition();
    this.flipX = !this.flipX;
    this.centerXmm = 2 * reference.x - this.centerXmm;
    this.modified = true;
    return this;
  }

  flipVertical() {
    const reference = this.getReferencePosition();
    this.flipY = !this.flipY;
    this.centerYmm = 2 * reference.y - this.centerYmm;
    this.modified = true;
    return this;
  }

  setReferencePosition(x, y) {
    const current = this.getReferencePosition();
    return this.moveBy(
      finiteNumber(x, 'x') - current.x,
      finiteNumber(y, 'y') - current.y,
    );
  }

  setScale(scale) {
    return this.setScaleX(scale).setScaleY(scale);
  }

  setScaleX(scale) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, positiveNumber(scale, 'scale')));
    const reference = this.getReferencePosition();
    const ratio = next / this.scaleX;
    this.scaleX = next;
    if (this.crop) {
      this.crop.x *= ratio;
      this.crop.width *= ratio;
    }
    this.setReferencePosition(reference.x, reference.y);
    this.modified = true;
    return this;
  }

  setScaleY(scale) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, positiveNumber(scale, 'scale')));
    const reference = this.getReferencePosition();
    const ratio = next / this.scaleY;
    this.scaleY = next;
    if (this.crop) {
      this.crop.y *= ratio;
      this.crop.height *= ratio;
    }
    this.setReferencePosition(reference.x, reference.y);
    this.modified = true;
    return this;
  }

  setDisplayedWidth(widthMm) {
    const factor = positiveNumber(widthMm, 'widthMm') / this.displayedWidthMm;
    return this.rotation % 180 === 0
      ? this.setScaleX(this.scaleX * factor)
      : this.setScaleY(this.scaleY * factor);
  }

  setDisplayedHeight(heightMm) {
    const factor = positiveNumber(heightMm, 'heightMm') / this.displayedHeightMm;
    return this.rotation % 180 === 0
      ? this.setScaleY(this.scaleY * factor)
      : this.setScaleX(this.scaleX * factor);
  }

  setOpacity(opacity) {
    this.opacity = Math.min(1, Math.max(0, finiteNumber(opacity, 'opacity')));
    this.modified = true;
    return this;
  }

  setBgOpacity(bgOpacity) {
    this.bgOpacity = Math.min(1, Math.max(0, finiteNumber(bgOpacity, 'bgOpacity')));
    this.modified = true;
    return this;
  }

  setPreviewQuality(value) {
    this.quality.preview = normalizeArtworkQuality({ preview: value }).preview;
    return this;
  }

  setRenderQuality(value) {
    this.quality.render = normalizeArtworkQuality({ render: value }).render;
    return this;
  }

  setQuality(value) {
    this.quality = normalizeArtworkQuality(value);
    return this;
  }

  rotateQuarterTurns(turns) {
    const reference = this.getReferencePosition();
    this.rotation = normalizeQuarterTurn(this.rotation + Number(turns) * 90);
    this.setReferencePosition(reference.x, reference.y);
    this.modified = true;
    return this;
  }

  applyCrop(value) {
    const crop = normalizeCropRect(value, this.unrotatedWidthMm, this.unrotatedHeightMm);
    if (!crop) throw new Error('crop must define a non-empty rectangle inside the artwork.');
    this.crop = crop;
    this.initialWidthMm = this.unrotatedWidthMm;
    this.initialHeightMm = this.unrotatedHeightMm;
    this.scaleX = 1;
    this.scaleY = 1;
    this.modified = true;
    return this;
  }

  clearCrop() {
    if (!this.crop) return this;
    // Keep the fragment the user was looking at in the same place while the
    // hidden source area is revealed around it.  The source center is an
    // internal render anchor; the visible center is the user-facing geometry.
    const visibleCenter = this.visibleCenter;
    this.crop = null;
    this.setVisibleCenter(visibleCenter.x, visibleCenter.y);
    this.modified = true;
    return this;
  }

  resetTransform() {
    this.setScaleX(1);
    this.setScaleY(1);
    const reference = this.getReferencePosition();
    this.rotation = this.source?.pdfPageRotation || 0;
    this.flipX = false;
    this.flipY = false;
    this.setReferencePosition(reference.x, reference.y);
    this.opacity = 1;
    this.bgOpacity = 0.28;
    this.modified = false;
    return this;
  }

  getEffectiveDpi() {
    if (!this.source || this.source.vector) return null;
    const rect = this.visibleLocalRect;
    const visiblePixelsX = this.source.widthPx * (rect.width / this.unrotatedWidthMm);
    const visiblePixelsY = this.source.heightPx * (rect.height / this.unrotatedHeightMm);
    const dpiX = visiblePixelsX / (rect.width / 25.4);
    const dpiY = visiblePixelsY / (rect.height / 25.4);
    return Math.min(dpiX, dpiY);
  }

  toJSON() {
    return {
      source: cloneSource(this.source),
      centerXmm: this.centerXmm,
      centerYmm: this.centerYmm,
      initialWidthMm: this.initialWidthMm,
      initialHeightMm: this.initialHeightMm,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      scale: this.scaleX === this.scaleY ? this.scaleX : undefined,
      rotation: this.rotation,
      flipX: this.flipX,
      flipY: this.flipY,
      opacity: this.opacity,
      bgOpacity: this.bgOpacity,
      referencePoint: this.referencePoint,
      pdfLayerVisibility: this.pdfLayerVisibility ? { ...this.pdfLayerVisibility } : null,
      pdfSeparationVisibility: this.pdfSeparationVisibility ? { ...this.pdfSeparationVisibility } : null,
      quality: { ...this.quality },
      crop: this.crop ? { ...this.crop } : null,
      modified: this.modified,
    };
  }

  restore(state) {
    if (!state?.source) return this.clear();
    this.source = cloneSource(state.source);
    if (this.source) {
      this.source.isVideo = Boolean(this.source.isVideo || this.source.mimeType?.startsWith('video/'));
    }
    this.centerXmm = finiteNumber(state.centerXmm, 'centerXmm');
    this.centerYmm = finiteNumber(state.centerYmm, 'centerYmm');
    this.initialWidthMm = positiveNumber(state.initialWidthMm, 'initialWidthMm');
    this.initialHeightMm = positiveNumber(state.initialHeightMm, 'initialHeightMm');
    const clampScale = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, positiveNumber(v, 'scale')));
    if (state.scaleX != null || state.scaleY != null) {
      this.scaleX = clampScale(state.scaleX ?? state.scale ?? 1);
      this.scaleY = clampScale(state.scaleY ?? state.scale ?? 1);
    } else {
      this.scaleX = clampScale(state.scale ?? 1);
      this.scaleY = this.scaleX;
    }
    this.rotation = normalizeQuarterTurn(state.rotation);
    this.flipX = Boolean(state.flipX);
    this.flipY = Boolean(state.flipY);
    this.opacity = Math.min(1, Math.max(0, finiteNumber(state.opacity, 'opacity')));
    this.bgOpacity = state.bgOpacity != null
      ? Math.min(1, Math.max(0, finiteNumber(state.bgOpacity, 'bgOpacity')))
      : 0.28;
    this.referencePoint = REFERENCE_POINTS.includes(state.referencePoint)
      ? state.referencePoint
      : 'center';
    if (state.pdfLayerVisibility && typeof state.pdfLayerVisibility === 'object') {
      this.pdfLayerVisibility = {};
      for (const [id, visible] of Object.entries(state.pdfLayerVisibility)) {
        this.pdfLayerVisibility[id] = visible !== false;
      }
    } else {
      this.pdfLayerVisibility = null;
    }
    if (state.pdfSeparationVisibility && typeof state.pdfSeparationVisibility === 'object') {
      this.pdfSeparationVisibility = {};
      for (const [id, visible] of Object.entries(state.pdfSeparationVisibility)) {
        this.pdfSeparationVisibility[id] = visible !== false;
      }
    } else {
      this.pdfSeparationVisibility = null;
    }
    this.quality = normalizeArtworkQuality(state.quality);
    this.modified = Boolean(state.modified);
    this.crop = normalizeCropRect(state.crop, this.unrotatedWidthMm, this.unrotatedHeightMm);
    return this;
  }
}

export const ARTWORK_SCALE_LIMITS = Object.freeze({
  min: MIN_SCALE,
  max: MAX_SCALE,
});

export const DEFAULT_ARTWORK_QUALITY_SETTINGS = DEFAULT_ARTWORK_QUALITY;
