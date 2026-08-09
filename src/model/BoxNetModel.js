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
import { cloneBoardConstruction, sanitizeBoardConstruction } from './BoardConstruction.js';
import {
  buildConstructionTemplate,
  sanitizeConstruction,
  validateConstructionElements,
} from './ConstructionTemplates.js';

export class BoxNetModel {
  constructor(dimensions = { width: 150, height: 90, depth: 40 }, board = null, construction = null) {
    this.reset(dimensions, board, construction);
  }

  reset(dimensions = this.dimensions, board = this.board, construction = this.construction) {
    this.dimensions = normalizeDimensions(dimensions);
    this.board = sanitizeBoardConstruction(board, this.dimensions);
    this.construction = sanitizeConstruction(construction, this.dimensions, this.board);
    this.panels = new Map();
    this.elements = new Map();
    this.creationSequence = 0;

    if (this.construction.templateId !== 'legacy-six-panel') {
      this._buildConstruction(this.construction.templateId, this.construction.parameters);
      return this;
    }

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

  updateDimensions(dimensions) {
    const normalized = normalizeDimensions(dimensions);
    if (this.construction?.templateId !== 'legacy-six-panel') {
      this.dimensions = normalized;
      this.board = sanitizeBoardConstruction(this.board, this.dimensions);
      this.construction = sanitizeConstruction(this.construction, this.dimensions, this.board);
      this._buildConstruction(this.construction.templateId, this.construction.parameters);
      return this;
    }
    const oldDimensions = { ...this.dimensions };
    const oldBoard = cloneBoardConstruction(this.board, oldDimensions);
    this.dimensions = normalized;
    this.board = sanitizeBoardConstruction(this.board, this.dimensions);

    const updatePanelGeometry = (panelId) => {
      const panel = this.getPanel(panelId);
      if (!panel) return;

      panel.width = getAxisDimension(panel.basis.right, this.dimensions);
      panel.height = getAxisDimension(panel.basis.up, this.dimensions);

      if (panel.parentId) {
        const parent = this.getPanel(panel.parentId);
        const rect = getPlacedRectangle(parent, panel.parentEdge, panel.width, panel.height);
        panel.x = rect.x;
        panel.y = rect.y;
      } else {
        panel.x = 0;
        panel.y = 0;
      }

      for (const child of this.getChildren(panelId)) {
        updatePanelGeometry(child.id);
      }
    };

    updatePanelGeometry(this.rootId);

    const panels = this.getPanels();
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        if (rectanglesOverlap(panels[i], panels[j])) {
          this.dimensions = oldDimensions;
          this.board = oldBoard;
          updatePanelGeometry(this.rootId);
          throw new Error('Dimensions cause net panels to overlap.');
        }
      }
    }

    return this;
  }

  setBoardConstruction(board) {
    this.board = sanitizeBoardConstruction(board, this.dimensions);
    if (this.construction?.templateId !== 'legacy-six-panel') {
      this.construction = sanitizeConstruction(this.construction, this.dimensions, this.board);
      this._buildConstruction(this.construction.templateId, this.construction.parameters);
    }
    return this;
  }

  setBoardCaliper(caliperMm) {
    return this.setBoardConstruction({ ...this.board, caliperMm });
  }

  setConstruction(templateId, parameters = {}) {
    const next = sanitizeConstruction({ templateId, parameters }, this.dimensions, this.board);
    if (next.templateId === 'legacy-six-panel') {
      this.reset(this.dimensions, this.board, next);
    } else {
      this.construction = next;
      this._buildConstruction(next.templateId, next.parameters);
    }
    return this;
  }

  _buildConstruction(templateId, parameters = {}) {
    const generated = buildConstructionTemplate(templateId, this.dimensions, this.board, parameters);
    this.construction = sanitizeConstruction(generated, this.dimensions, this.board);
    this.construction.parameters = { ...generated.parameters };
    const validation = validateConstructionElements(generated.elements);
    if (!validation.valid) throw new Error(`Invalid ${templateId} construction: ${validation.reason}.`);
    this.elements = new Map(generated.elements.map((element, order) => [
      element.id,
      { ...structuredClone(element), order },
    ]));
    this.panels = new Map(generated.elements
      .filter((element) => element.surfaceKey)
      .map((element, order) => [element.id, { ...structuredClone(element), order }]));
    this.rootId = 'front';
    this.creationSequence = generated.elements.length;
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

  getElements() {
    if (this.construction?.templateId !== 'legacy-six-panel') {
      return Array.from(this.elements.values()).sort((a, b) => a.order - b.order);
    }
    return this.getPanels().map((panel) => ({
      ...structuredClone(panel),
      role: 'body',
      surfaceKey: panel.faceKey,
      polygon: [
        { x: panel.x, y: panel.y },
        { x: panel.x + panel.width, y: panel.y },
        { x: panel.x + panel.width, y: panel.y + panel.height },
        { x: panel.x, y: panel.y + panel.height },
      ],
      foldAngleDeg: 0,
      phase: [0, 1],
      overlapLayer: 0,
      hinge: null,
    }));
  }

  getElement(elementId) {
    if (this.construction?.templateId !== 'legacy-six-panel') return this.elements.get(elementId) || null;
    return this.getElements().find((element) => element.id === elementId) || null;
  }

  getFeatures() {
    return this.getElements().filter((element) => !element.surfaceKey);
  }

  get panelCount() {
    return this.getPanels().length;
  }

  get isComplete() {
    if (this.construction?.templateId !== 'legacy-six-panel') return this.panelCount === 6;
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
    const panels = this.getElements();
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
      board: cloneBoardConstruction(this.board, this.dimensions),
      construction: structuredClone(this.construction),
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
        basis: panel.basis ? {
          normal: cloneVector(panel.basis.normal),
          up: cloneVector(panel.basis.up),
          right: cloneVector(panel.basis.right),
        } : null,
      })),
      elements: this.getElements().map((element) => structuredClone(element)),
    };
  }

  static fromJSON(state) {
    if (
      !state?.dimensions
      || !Array.isArray(state.panels)
      || state.panels.length === 0
      || state.panels.length > 6
    ) {
      throw new Error('Invalid box net state.');
    }

    const construction = sanitizeConstruction(state.construction, state.dimensions, state.board);
    if (construction.templateId !== 'legacy-six-panel') {
      const model = new BoxNetModel(state.dimensions, state.board, construction);
      if (Array.isArray(state.elements)) {
        const expected = JSON.stringify(model.getElements().map((element) => ({
          id: element.id,
          role: element.role,
          polygon: element.polygon,
          parentId: element.parentId,
          parentEdge: element.parentEdge,
          foldAngleDeg: element.foldAngleDeg,
          phase: element.phase,
          overlapLayer: element.overlapLayer,
        })));
        const actual = JSON.stringify(state.elements.map((element) => ({
          id: element.id,
          role: element.role,
          polygon: element.polygon,
          parentId: element.parentId,
          parentEdge: element.parentEdge,
          foldAngleDeg: element.foldAngleDeg,
          phase: element.phase,
          overlapLayer: element.overlapLayer,
        })));
        if (expected !== actual) throw new Error('Serialized construction does not match its template parameters.');
      }
      return model;
    }

    const model = new BoxNetModel(state.dimensions, state.board, construction);
    model.panels.clear();
    model.elements.clear();
    model.creationSequence = 0;
    model.rootId = null;
    const normalKeys = new Set();

    for (const serialized of state.panels) {
      if (!serialized?.id || model.panels.has(serialized.id)) {
        throw new Error('Invalid or duplicate panel id.');
      }
      const x = Number(serialized.x);
      const y = Number(serialized.y);
      const width = Number(serialized.width);
      const height = Number(serialized.height);
      const basisVectors = [
        serialized.basis?.normal,
        serialized.basis?.up,
        serialized.basis?.right,
      ];
      const validBasis = basisVectors.every((vector) => (
        Array.isArray(vector)
        && vector.length === 3
        && vector.every((value) => [-1, 0, 1].includes(Number(value)))
        && vector.filter((value) => Number(value) !== 0).length === 1
      )) && new Set(basisVectors.map(vectorKey)).size === 3;
      if (
        !validBasis
        || ![x, y, width, height].every(Number.isFinite)
        || width <= 0
        || height <= 0
      ) {
        throw new Error('Invalid panel geometry.');
      }

      const normalKey = vectorKey(serialized.basis.normal);
      const face = FACE_BY_NORMAL[normalKey];
      if (!face || face.key !== serialized.id || normalKeys.has(normalKey)) {
        throw new Error('Invalid or duplicate physical face.');
      }
      normalKeys.add(normalKey);
      const expectedWidth = getAxisDimension(serialized.basis.right, model.dimensions);
      const expectedHeight = getAxisDimension(serialized.basis.up, model.dimensions);
      if (Math.abs(width - expectedWidth) > 1e-7 || Math.abs(height - expectedHeight) > 1e-7) {
        throw new Error('Panel dimensions do not match the box.');
      }

      const panel = {
        id: serialized.id,
        faceKey: serialized.id,
        faceName: face.name,
        x,
        y,
        width,
        height,
        parentId: serialized.parentId,
        parentEdge: serialized.parentEdge,
        order: model.creationSequence++,
        basis: {
          normal: cloneVector(serialized.basis.normal),
          up: cloneVector(serialized.basis.up),
          right: cloneVector(serialized.basis.right),
        },
        links: {
          top: null,
          right: null,
          bottom: null,
          left: null,
        },
      };
      model.panels.set(panel.id, panel);
    }

    for (const panel of model.getPanels()) {
      if (!panel.parentId) {
        if (model.rootId || panel.id !== 'front') {
          throw new Error('Invalid box net root panel.');
        }
        model.rootId = panel.id;
        continue;
      }
      const parent = model.getPanel(panel.parentId);
      if (!parent || !EDGES.includes(panel.parentEdge)) {
        throw new Error('Invalid panel parent relationship.');
      }
      if (parent.links[panel.parentEdge]) {
        throw new Error('Duplicate panel parent edge.');
      }
      const expectedBasis = getAdjacentBasis(parent, panel.parentEdge);
      const expectedRectangle = getPlacedRectangle(
        parent,
        panel.parentEdge,
        panel.width,
        panel.height,
      );
      if (
        vectorKey(expectedBasis.normal) !== vectorKey(panel.basis.normal)
        || vectorKey(expectedBasis.up) !== vectorKey(panel.basis.up)
        || vectorKey(expectedBasis.right) !== vectorKey(panel.basis.right)
        || Math.abs(expectedRectangle.x - panel.x) > 1e-7
        || Math.abs(expectedRectangle.y - panel.y) > 1e-7
      ) {
        throw new Error('Panel placement does not match its parent edge.');
      }
      parent.links[panel.parentEdge] = panel.id;
      panel.links[OPPOSITE_EDGE[panel.parentEdge]] = parent.id;
    }

    if (!model.rootId) throw new Error('Box net root panel is missing.');
    for (const panel of model.getPanels()) {
      const visited = new Set();
      let current = panel;
      while (current.parentId) {
        if (visited.has(current.id)) throw new Error('Cyclic panel relationship.');
        visited.add(current.id);
        current = model.getPanel(current.parentId);
        if (!current) throw new Error('Invalid panel parent relationship.');
      }
      if (current.id !== model.rootId) throw new Error('Disconnected panel tree.');
    }
    const panels = model.getPanels();
    for (let index = 0; index < panels.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < panels.length; otherIndex += 1) {
        if (rectanglesOverlap(panels[index], panels[otherIndex])) {
          throw new Error('Serialized panels overlap.');
        }
      }
    }
    return model;
  }

  restore(state) {
    const restored = BoxNetModel.fromJSON(state);
    this.dimensions = restored.dimensions;
    this.board = restored.board;
    this.construction = restored.construction;
    this.panels = restored.panels;
    this.elements = restored.elements;
    this.creationSequence = restored.creationSequence;
    this.rootId = restored.rootId;
    return this;
  }
}
