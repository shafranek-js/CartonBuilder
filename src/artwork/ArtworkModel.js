const MIN_SCALE = 0.01;
const MAX_SCALE = 20;

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

function cloneSource(source) {
  return source ? { ...source } : null;
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
    this.scale = 1;
    this.rotation = 0;
    this.opacity = 1;
    this.bgOpacity = 0.28;
    this.referencePoint = 'center';
    this.modified = false;
    return this;
  }

  get hasArtwork() {
    return Boolean(this.source);
  }

  get aspectRatio() {
    if (!this.source) return 1;
    return this.source.widthPx / this.source.heightPx;
  }

  get unrotatedWidthMm() {
    return this.initialWidthMm * this.scale;
  }

  get unrotatedHeightMm() {
    return this.initialHeightMm * this.scale;
  }

  get displayedWidthMm() {
    return this.rotation % 180 === 0 ? this.unrotatedWidthMm : this.unrotatedHeightMm;
  }

  get displayedHeightMm() {
    return this.rotation % 180 === 0 ? this.unrotatedHeightMm : this.unrotatedWidthMm;
  }

  get bounds() {
    return {
      minX: this.centerXmm - this.displayedWidthMm / 2,
      minY: this.centerYmm - this.displayedHeightMm / 2,
      maxX: this.centerXmm + this.displayedWidthMm / 2,
      maxY: this.centerYmm + this.displayedHeightMm / 2,
      width: this.displayedWidthMm,
      height: this.displayedHeightMm,
    };
  }

  load(source, dielineBounds) {
    const widthPx = positiveNumber(source.widthPx, 'source.widthPx');
    const heightPx = positiveNumber(source.heightPx, 'source.heightPx');
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
      sha256: source.sha256 || '',
    };
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
      this.scale = 1;
      this.centerXmm = bounds.minX + width / 2;
      this.centerYmm = bounds.minY + height / 2;
    } else {
      this.setScale(targetWidth / this.initialWidthMm);
    }
    this.modified = !setInitial;
    return this;
  }

  fillDieline(bounds) {
    if (!this.source) return this;
    const width = positiveNumber(bounds.width, 'bounds.width');
    const height = positiveNumber(bounds.height, 'bounds.height');
    const baseDisplayedWidth = this.rotation % 180 === 0
      ? this.initialWidthMm
      : this.initialHeightMm;
    const baseDisplayedHeight = this.rotation % 180 === 0
      ? this.initialHeightMm
      : this.initialWidthMm;
    const widthScale = width / baseDisplayedWidth;
    const heightScale = height / baseDisplayedHeight;
    this.setScale(Math.max(widthScale, heightScale));
    this.modified = true;
    return this;
  }

  centerOnDieline(bounds) {
    this.centerXmm = finiteNumber(bounds.minX, 'bounds.minX') + positiveNumber(bounds.width, 'bounds.width') / 2;
    this.centerYmm = finiteNumber(bounds.minY, 'bounds.minY') + positiveNumber(bounds.height, 'bounds.height') / 2;
    this.modified = true;
    return this;
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

  getReferenceOffset() {
    const fraction = REFERENCE_FRACTIONS[this.referencePoint] || REFERENCE_FRACTIONS.center;
    return {
      x: fraction.x * this.displayedWidthMm / 2,
      y: fraction.y * this.displayedHeightMm / 2,
    };
  }

  getReferencePosition() {
    const offset = this.getReferenceOffset();
    return {
      x: this.centerXmm + offset.x,
      y: this.centerYmm + offset.y,
    };
  }

  setReferencePoint(point) {
    if (!REFERENCE_POINTS.includes(point)) return this;
    this.referencePoint = point;
    return this;
  }

  setReferencePosition(x, y) {
    const offset = this.getReferenceOffset();
    this.centerXmm = finiteNumber(x, 'x') - offset.x;
    this.centerYmm = finiteNumber(y, 'y') - offset.y;
    this.modified = true;
    return this;
  }

  setScale(scale) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, positiveNumber(scale, 'scale')));
    const reference = this.getReferencePosition();
    this.scale = next;
    const offset = this.getReferenceOffset();
    this.centerXmm = reference.x - offset.x;
    this.centerYmm = reference.y - offset.y;
    this.modified = true;
    return this;
  }

  setDisplayedWidth(widthMm) {
    const base = this.rotation % 180 === 0 ? this.initialWidthMm : this.initialHeightMm;
    return this.setScale(positiveNumber(widthMm, 'widthMm') / base);
  }

  setDisplayedHeight(heightMm) {
    const base = this.rotation % 180 === 0 ? this.initialHeightMm : this.initialWidthMm;
    return this.setScale(positiveNumber(heightMm, 'heightMm') / base);
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

  rotateQuarterTurns(turns) {
    const reference = this.getReferencePosition();
    this.rotation = normalizeQuarterTurn(this.rotation + Number(turns) * 90);
    const offset = this.getReferenceOffset();
    this.centerXmm = reference.x - offset.x;
    this.centerYmm = reference.y - offset.y;
    this.modified = true;
    return this;
  }

  resetTransform() {
    this.scale = 1;
    this.rotation = this.source?.pdfPageRotation || 0;
    this.opacity = 1;
    this.bgOpacity = 0.28;
    this.modified = false;
    return this;
  }

  getEffectiveDpi() {
    if (!this.source || this.source.vector) return null;
    const dpiX = this.source.widthPx / (this.unrotatedWidthMm / 25.4);
    const dpiY = this.source.heightPx / (this.unrotatedHeightMm / 25.4);
    return Math.min(dpiX, dpiY);
  }

  toJSON() {
    return {
      source: cloneSource(this.source),
      centerXmm: this.centerXmm,
      centerYmm: this.centerYmm,
      initialWidthMm: this.initialWidthMm,
      initialHeightMm: this.initialHeightMm,
      scale: this.scale,
      rotation: this.rotation,
      opacity: this.opacity,
      bgOpacity: this.bgOpacity,
      referencePoint: this.referencePoint,
      modified: this.modified,
    };
  }

  restore(state) {
    if (!state?.source) return this.clear();
    this.source = cloneSource(state.source);
    this.centerXmm = finiteNumber(state.centerXmm, 'centerXmm');
    this.centerYmm = finiteNumber(state.centerYmm, 'centerYmm');
    this.initialWidthMm = positiveNumber(state.initialWidthMm, 'initialWidthMm');
    this.initialHeightMm = positiveNumber(state.initialHeightMm, 'initialHeightMm');
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, positiveNumber(state.scale, 'scale')));
    this.rotation = normalizeQuarterTurn(state.rotation);
    this.opacity = Math.min(1, Math.max(0, finiteNumber(state.opacity, 'opacity')));
    this.bgOpacity = state.bgOpacity != null
      ? Math.min(1, Math.max(0, finiteNumber(state.bgOpacity, 'bgOpacity')))
      : 0.28;
    this.referencePoint = REFERENCE_POINTS.includes(state.referencePoint)
      ? state.referencePoint
      : 'center';
    this.modified = Boolean(state.modified);
    return this;
  }
}

export const ARTWORK_SCALE_LIMITS = Object.freeze({
  min: MIN_SCALE,
  max: MAX_SCALE,
});
