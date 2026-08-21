/**
 * Factory for creating CartonDocument instances from serialized state or live models.
 */

import { AppError } from '../errors.js';
import { BoxNetModel } from '../model/BoxNetModel.js';
import { QuickCartonDocument } from './QuickCartonDocument.js';
import { TechnicalCartonDocument } from './TechnicalCartonDocument.js';

export async function createCartonDocument(cartonSource, technicalAssets = null, options = {}) {
  if (!cartonSource || typeof cartonSource !== 'object') {
    throw new AppError('invalidCartonSource');
  }

  const mode = cartonSource.mode;
  if (mode === 'quick') {
    const box = cartonSource.box;
    const boxModel = box instanceof BoxNetModel ? box : BoxNetModel.fromJSON(box);
    return new QuickCartonDocument(boxModel);
  }

  if (mode === 'technical') {
    return TechnicalCartonDocument.create(cartonSource, technicalAssets, options);
  }

  throw new AppError('unsupportedCartonMode', { mode });
}
