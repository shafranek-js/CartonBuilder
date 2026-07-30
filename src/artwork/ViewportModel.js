export class ViewportModel {
  constructor({ zoom = 1, panX = 0, panY = 0 } = {}) {
    this.zoom = zoom;
    this.panX = panX;
    this.panY = panY;
  }

  fit(bounds, pixelWidth, pixelHeight, padding = 32) {
    const availableWidth = Math.max(1, pixelWidth - padding * 2);
    const availableHeight = Math.max(1, pixelHeight - padding * 2);
    this.zoom = Math.max(0.0001, Math.min(
      availableWidth / Math.max(bounds.width, 0.0001),
      availableHeight / Math.max(bounds.height, 0.0001),
    ));
    this.panX = pixelWidth / 2 - (bounds.minX + bounds.width / 2) * this.zoom;
    this.panY = pixelHeight / 2 - (bounds.minY + bounds.height / 2) * this.zoom;
    return this;
  }

  screenToModel(x, y) {
    return {
      x: (x - this.panX) / this.zoom,
      y: (y - this.panY) / this.zoom,
    };
  }

  modelToScreen(x, y) {
    return {
      x: x * this.zoom + this.panX,
      y: y * this.zoom + this.panY,
    };
  }

  zoomAt(screenX, screenY, factor) {
    const anchor = this.screenToModel(screenX, screenY);
    this.zoom = Math.min(100, Math.max(0.01, this.zoom * factor));
    this.panX = screenX - anchor.x * this.zoom;
    this.panY = screenY - anchor.y * this.zoom;
    return this;
  }

  panBy(deltaX, deltaY) {
    this.panX += deltaX;
    this.panY += deltaY;
    return this;
  }

  toJSON() {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }
}
