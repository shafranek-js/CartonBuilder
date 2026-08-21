/**
 * TechnicalCartonDocument domain layer for carton-workflow.v1 bundles.
 */

import { CartonDocument } from './CartonDocument.js';
import { AppError } from '../errors.js';

export class TechnicalCartonDocument extends CartonDocument {
  static async create(cartonSource, technicalAssets = null, options = {}) {
    throw new AppError('documentMethodNotImplemented');
  }

  get mode() {
    return 'technical';
  }
}
