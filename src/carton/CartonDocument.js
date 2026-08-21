/**
 * Base abstract CartonDocument contract for CartonBuilder.
 * Unifies 2D geometry, dimensions, material, and provenance across Quick and Technical workflows.
 */

import { AppError } from '../errors.js';

export class CartonDocument {
  /**
   * Workflow mode: 'quick' | 'technical'
   * @type {'quick' | 'technical'}
   */
  get mode() {
    throw new AppError('documentMethodNotImplemented');
  }

  /**
   * Whether the document geometry is complete and valid.
   * @type {boolean}
   */
  get isComplete() {
    throw new AppError('documentMethodNotImplemented');
  }

  /**
   * Dimensions { width, height, depth } in mm.
   * @type {{ width: number, height: number, depth: number }}
   */
  get dimensions() {
    throw new AppError('documentMethodNotImplemented');
  }

  /**
   * Material and board properties (caliperMm, etc.)
   * @type {{ caliperMm: number, [key: string]: unknown }}
   */
  get board() {
    throw new AppError('documentMethodNotImplemented');
  }

  /**
   * Flattened dieline bounding box.
   * @returns {{ minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }}
   */
  getBounds() {
    throw new AppError('documentMethodNotImplemented');
  }

  /**
   * Return semantic 2D surfaces (panels, flaps, tongues).
   * @returns {Array<{ id: string, role: string, kind: string, label: string, polygon: Array<{ x: number, y: number }>, contour?: { segments: Array<{ kind: string, start: { x: number, y: number }, end: { x: number, y: number }, center?: { x: number, y: number }, radius?: number, clockwise?: boolean }>, closed: boolean }, bounds: { minX: number, minY: number, maxX: number, maxY: number, width: number, height: number }, panelId: string }>}
   */
  getArtworkSurfaces() {
    throw new AppError('documentMethodNotImplemented');
  }

  /**
   * Return canonical dieline geometry primitives (LINE, ARC) classified as cut or fold.
   * @returns {Array<{ id: string, kind: 'LINE' | 'ARC', role: string, semanticRole: string, classification: 'cut' | 'fold', start: { x: number, y: number }, end: { x: number, y: number }, center?: { x: number, y: number }, radius?: number, clockwise?: boolean, owners: string[] }>}
   */
  getDielinePrimitives() {
    throw new AppError('documentMethodNotImplemented');
  }

  /**
   * Return mask paths / polygons for clipping artwork.
   * @returns {Array<{ id: string, d: string, polygon: Array<{ x: number, y: number }> }>}
   */
  getArtworkMaskPaths() {
    throw new AppError('documentMethodNotImplemented');
  }

  /**
   * Return provenance and source identity metadata.
   * @returns {Record<string, unknown>}
   */
  getSourceIdentity() {
    throw new AppError('documentMethodNotImplemented');
  }

  /**
   * Serialize document to a plain serializable JSON object.
   * @returns {Record<string, unknown>}
   */
  serialize() {
    throw new AppError('documentMethodNotImplemented');
  }
}
