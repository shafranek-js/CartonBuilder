import {
  EDGES,
  FACE_BY_NORMAL,
  OPPOSITE_EDGE,
  cloneVector,
  getAdjacentBasis,
  getAxisDimension,
  getPlacedRectangle,
  normalizeDimensions,
  rectanglesOverlap,
  vectorKey,
} from './geometry.js';

export class BoxNetModel {
  constructor(dimensions = { width: 150, height: 90, depth: 40 }) {
    this.reset(dimensions);
  }

  reset(dimensions = this.dimensions) {
    this.dimensions = normalizeDimensions(dimensions);
    this.panels = new Map();
    this.creationSequence = 0;

    const front = this._createPanel({
      faceKey: 'front',
      faceName: 'Front Panel',
      basis: {
        normal: [0, 0, 1],
        up: [0, 1, 0],
        right: [1, 0, 0],
      },
      x: 0,
      y: 0,
      parentId: null,
      parentEdge: null,
    });

    this.rootId = front.id;
    return this;
  }

  _createPanel({ faceKey, faceName, basis, x, y, parentId, parentEdge }) {
    const width = getAxisDimension(basis.right, this.dimensions);
    const height = getAxisDimension(basis.up, this.dimensions);
    const panel = {
      id: faceKey,
      faceKey,
      faceName,
      basis: {
        normal: cloneVector(basis.normal),
        up: cloneVector(basis.up),
        right: cloneVector(basis.right),
      },
      x,
      y,
      width,
      height,
      parentId,
      parentEdge,
      order: this.creationSequence++,
      links: {
        top: null,
        right: null,
        bottom: null,
        left: null,
      },
    };

    this.panels.set(panel.id, panel);
    return panel;
  }

  getPanel(panelId) {
    return this.panels.get(panelId) || null;
  }

  getPanels() {
    return Array.from(this.panels.values()).sort((a, b) => a.order - b.order);
  }

  get panelCount() {
    return this.panels.size;
  }

  get isComplete() {
    return this.panelCount === 6;
  }

  getChildren(panelId) {
    return this.getPanels().filter((panel) => panel.parentId === panelId);
  }

  canDelete(panelId) {
    if (panelId === this.rootId) return false;
    return this.getChildren(panelId).length === 0;
  }

  getPotential(panelId, edge) {
    if (!EDGES.includes(edge)) return null;
    const panel = this.getPanel(panelId);
    if (!panel || panel.links[edge]) return null;

    const basis = getAdjacentBasis(panel, edge);
    const face = FACE_BY_NORMAL[vectorKey(basis.normal)];
    if (!face || this.panels.has(face.key)) return null;

    const width = getAxisDimension(basis.right, this.dimensions);
    const height = getAxisDimension(basis.up, this.dimensions);
    const rectangle = getPlacedRectangle(panel, edge, width, height);
    const collides = this.getPanels().some((existing) => rectanglesOverlap(rectangle, existing));

    if (collides) return null;

    return {
      faceKey: face.key,
      faceName: face.name,
      basis,
      ...rectangle,
    };
  }

  getEligibleEdges(panelId) {
    return EDGES.filter((edge) => Boolean(this.getPotential(panelId, edge)));
  }

  addPanel(panelId, edge) {
    const parent = this.getPanel(panelId);
    const potential = this.getPotential(panelId, edge);
    if (!parent || !potential) return null;

    const child = this._createPanel({
      faceKey: potential.faceKey,
      faceName: potential.faceName,
      basis: potential.basis,
      x: potential.x,
      y: potential.y,
      parentId: parent.id,
      parentEdge: edge,
    });

    parent.links[edge] = child.id;
    child.links[OPPOSITE_EDGE[edge]] = parent.id;
    return child;
  }

  deletePanel(panelId) {
    const panel = this.getPanel(panelId);
    if (!panel || !this.canDelete(panelId)) return false;

    const parent = this.getPanel(panel.parentId);
    if (parent && panel.parentEdge) {
      parent.links[panel.parentEdge] = null;
    }

    this.panels.delete(panelId);
    return true;
  }

  getBounds() {
    const panels = this.getPanels();
    if (panels.length === 0) {
      return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
    }

    const minX = Math.min(...panels.map((panel) => panel.x));
    const minY = Math.min(...panels.map((panel) => panel.y));
    const maxX = Math.max(...panels.map((panel) => panel.x + panel.width));
    const maxY = Math.max(...panels.map((panel) => panel.y + panel.height));

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  toJSON() {
    return {
      dimensions: { ...this.dimensions },
      complete: this.isComplete,
      panels: this.getPanels().map((panel) => ({
        id: panel.id,
        name: panel.faceName,
        x: panel.x,
        y: panel.y,
        width: panel.width,
        height: panel.height,
        parentId: panel.parentId,
        parentEdge: panel.parentEdge,
        basis: {
          normal: cloneVector(panel.basis.normal),
          up: cloneVector(panel.basis.up),
          right: cloneVector(panel.basis.right),
        },
      })),
    };
  }
}
