/**
 * QuickCartonDocument adapter for BoxNetModel.
 * Adapts legacy BoxNetModel instances to the CartonDocument interface
 * without modifying the underlying geometry, collision logic or state.
 */

import { CartonDocument } from './CartonDocument.js';
import { getDielineSegments } from '../model/dieline.js';
import { AppError } from '../errors.js';
import { BoxNetModel } from '../model/BoxNetModel.js';

export class QuickCartonDocument extends CartonDocument {
  /**
   * @param {BoxNetModel} boxModel
   */
  constructor(boxModel) {
    super();
    if (!boxModel || !(boxModel instanceof BoxNetModel)) {
      throw new AppError('invalidBoxModel');
    }
    this._boxModel = boxModel;
  }

  get mode() {
    return 'quick';
  }

  get isComplete() {
    return Boolean(this._boxModel.isComplete);
  }

  get dimensions() {
    return { ...this._boxModel.dimensions };
  }

  get board() {
    return { ...this._boxModel.board };
  }

  get boxModel() {
    return this._boxModel;
  }

  getBoxModel() {
    return this._boxModel;
  }

  getBounds() {
    return this._boxModel.getBounds();
  }

  getArtworkSurfaces() {
    const elements = this._boxModel.getElements();
    return elements.map((element) => {
      const polygon = Array.isArray(element.polygon) && element.polygon.length >= 3
        ? element.polygon.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        : [
            { x: Number(element.x), y: Number(element.y) },
            { x: Number(element.x + element.width), y: Number(element.y) },
            { x: Number(element.x + element.width), y: Number(element.y + element.height) },
            { x: Number(element.x), y: Number(element.y + element.height) },
          ];

      const contour = {
        segments: polygon.map((start, index) => ({
          kind: 'LINE',
          start: { ...start },
          end: { ...polygon[(index + 1) % polygon.length] },
        })),
        closed: true,
      };

      const xs = polygon.map((p) => p.x);
      const ys = polygon.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      return {
        id: element.id,
        role: element.role || element.id,
        kind: element.kind || (element.role ? 'FLAP' : 'PANEL'),
        label: element.faceName || element.id,
        polygon,
        contour,
        bounds: {
          minX,
          minY,
          maxX,
          maxY,
          width: maxX - minX,
          height: maxY - minY,
        },
        panelId: element.id,
      };
    });
  }

  getDielinePrimitives() {
    const segments = getDielineSegments(this._boxModel);
    const primitives = [];
    let index = 0;

    for (const f of segments.fold) {
      primitives.push({
        id: `fold-${index++}`,
        kind: 'LINE',
        role: 'FOLD_BOUNDARY',
        semanticRole: 'FOLD',
        classification: 'fold',
        start: { x: Number(f.start.x), y: Number(f.start.y) },
        end: { x: Number(f.end.x), y: Number(f.end.y) },
        owners: Array.isArray(f.panelIds) ? f.panelIds.slice() : [],
      });
    }

    for (const c of segments.cut) {
      primitives.push({
        id: `cut-${index++}`,
        kind: 'LINE',
        role: 'FREE_BOUNDARY',
        semanticRole: 'CUT',
        classification: 'cut',
        start: { x: Number(c.start.x), y: Number(c.start.y) },
        end: { x: Number(c.end.x), y: Number(c.end.y) },
        owners: Array.isArray(c.panelIds) ? c.panelIds.slice() : [],
      });
    }

    return primitives;
  }

  getArtworkMaskPaths() {
    const surfaces = this.getArtworkSurfaces();
    return surfaces.map((surface) => {
      const d = surface.polygon
        .map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`)
        .join('') + 'Z';
      return {
        id: surface.id,
        d,
        polygon: surface.polygon.map((p) => ({ ...p })),
      };
    });
  }

  getSourceIdentity() {
    return {
      mode: 'quick',
      producer: 'carton-builder',
      modelType: 'legacy-custom-net',
    };
  }

  serialize() {
    return {
      mode: 'quick',
      box: this._boxModel.toJSON(),
    };
  }
}
