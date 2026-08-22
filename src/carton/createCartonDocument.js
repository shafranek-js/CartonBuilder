/**
 * Factory for creating CartonDocument instances from serialized state or live models.
 */

import { AppError } from '../errors.js';
import { BoxNetModel } from '../model/BoxNetModel.js';
import { normalizeQuickBoxState } from '../model/quickCustomNet.js';
import { QuickCartonDocument } from './QuickCartonDocument.js';
import { TechnicalCartonDocument } from './TechnicalCartonDocument.js';

export async function createCartonDocument(cartonSource, technicalAssets = null, options = {}) {
  if (!cartonSource || typeof cartonSource !== 'object') {
    throw new AppError('invalidCartonSource');
  }

  const mode = cartonSource.mode;
  if (mode === 'quick') {
    const box = cartonSource.box;
    const normalized = normalizeQuickBoxState(box instanceof BoxNetModel ? box.toJSON() : box);
    const boxModel = BoxNetModel.fromJSON(normalized.box);
    return new QuickCartonDocument(boxModel);
  }

  if (mode === 'technical') {
    // If cartonSource is already a full bundle (has modelJson.text and semanticSvg.markup)
    let bundle = cartonSource;

    if (!cartonSource.modelJson?.text || !cartonSource.semanticSvg?.markup) {
      // Reconstitute bundle from technicalAssets if available
      let modelText = cartonSource.modelJson?.text;
      let svgMarkup = cartonSource.semanticSvg?.markup;

      if (!modelText && technicalAssets) {
        const modelBlob = technicalAssets.modelBlob || technicalAssets.modelJsonBlob;
        if (modelBlob instanceof Blob) {
          modelText = await modelBlob.text();
        } else if (typeof technicalAssets.modelText === 'string') {
          modelText = technicalAssets.modelText;
        }
      }

      if (!svgMarkup && technicalAssets) {
        const svgBlob = technicalAssets.svgBlob || technicalAssets.semanticSvgBlob;
        if (svgBlob instanceof Blob) {
          svgMarkup = await svgBlob.text();
        } else if (typeof technicalAssets.svgMarkup === 'string') {
          svgMarkup = technicalAssets.svgMarkup;
        }
      }

      bundle = {
        contractVersion: 'carton-workflow.v1',
        workflowMode: 'technical',
        source: cartonSource.source || {},
        capabilities: cartonSource.capabilities || {
          artwork2d: true,
          flatExport: true,
          foldPreview: true,
          technicalRender: false,
        },
        modelJson: {
          mediaType: cartonSource.modelJson?.mediaType || 'application/json',
          byteLength: cartonSource.modelJson?.byteLength ?? (modelText ? new Blob([modelText]).size : 0),
          sha256: cartonSource.modelSha256 || cartonSource.modelJson?.sha256,
          text: modelText,
        },
        semanticSvg: {
          assetId: cartonSource.semanticSvgAssetId || cartonSource.semanticSvg?.assetId || 'pbd.dieline',
          mediaType: cartonSource.semanticSvg?.mediaType || 'image/svg+xml',
          byteLength: cartonSource.semanticSvg?.byteLength ?? (svgMarkup ? new Blob([svgMarkup]).size : 0),
          sha256: cartonSource.svgSha256 || cartonSource.semanticSvg?.sha256,
          units: cartonSource.semanticSvg?.units || 'mm',
          markup: svgMarkup,
        },
      };
    }

    return TechnicalCartonDocument.create(bundle, options);
  }

  throw new AppError('unsupportedCartonMode', { mode });
}
