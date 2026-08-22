import { buildProductionDieline } from './productionDieline.js';
import { sanitizePrepressSettings } from './prepressState.js';

function issue(severity, code, message, details = {}) {
  return { severity, code, message, ...details };
}

function effectiveDpi(entry) {
  const model = entry?.model;
  const source = model?.source;
  if (!source || source.vector || source.mimeType === 'application/pdf') return null;
  const width = Number(model.unrotatedWidthMm);
  const height = Number(model.unrotatedHeightMm);
  const pixelWidth = Number(source.pixelWidth || source.width || 0);
  const pixelHeight = Number(source.pixelHeight || source.height || 0);
  if (!width || !height || !pixelWidth || !pixelHeight) return null;
  return Math.min(pixelWidth / (width / 25.4), pixelHeight / (height / 25.4));
}

export function runPrepressPreflight({ boxModel, artworks = [], settings = null, pageBox = 'trim' } = {}) {
  const prepress = sanitizePrepressSettings(settings);
  if (boxModel?.mode === 'technical') {
    return {
      valid: false,
      blocking: [issue('Blocking', 'technical-prepress-unavailable', 'Technical production-assist export is unavailable until exact curved-contour allowance support is implemented.')],
      warnings: [],
      manualReview: [],
      pageBox,
      settings: prepress,
      diagnostics: {
        valid: false,
        templateId: 'technical-pbd',
        elementCount: boxModel.getElements?.().length || 0,
      },
    };
  }
  const production = buildProductionDieline(boxModel, prepress);
  const blocking = [];
  const warnings = [];
  const manualReview = [];
  const visibleArtworks = artworks.filter((entry) => entry?.visible !== false && entry?.outputRole !== 'finish');
  if (!visibleArtworks.some((entry) => entry?.model?.hasArtwork)) {
    blocking.push(issue('Blocking', 'artwork-missing', 'At least one artwork layer is required.'));
  }
  if (!production.diagnostics.valid) {
    blocking.push(issue('Blocking', 'production-contour-invalid', 'Production contour is invalid or self-intersecting.', {
      elementId: production.diagnostics.invalidElement,
    }));
  }
  if (!['trim', 'bleed', 'media'].includes(pageBox)) {
    blocking.push(issue('Blocking', 'page-box-invalid', 'Selected PDF page box is not supported.', { pageBox }));
  }
  for (const entry of visibleArtworks) {
    if (!entry?.model?.hasArtwork) continue;
    const dpi = effectiveDpi(entry);
    if (dpi == null) continue;
    if (dpi < 150) blocking.push(issue('Blocking', 'dpi-too-low', `${entry.model.source?.fileName || 'Artwork'} is below 150 DPI.`, { dpi }));
    else if (dpi < prepress.requiredDpi) warnings.push(issue('Warning', 'dpi-below-required', `${entry.model.source?.fileName || 'Artwork'} is below the requested ${prepress.requiredDpi} DPI.`, { dpi }));
    if (prepress.bleedMm > 0 && entry.model.bgOpacity === 0) {
      warnings.push(issue('Warning', 'bleed-alpha-coverage', `${entry.model.source?.fileName || 'Artwork'} may not cover the bleed contour.`));
    }
  }
  const legacy = boxModel.construction?.templateId === 'legacy-six-panel';
  if (legacy && prepress.mode === 'production-assist') warnings.push(issue('Warning', 'legacy-manual-allowances', 'Custom Net requires manual production allowance review.'));
  manualReview.push(issue('Manual review', 'safe-area-content', 'Verify text, barcodes and critical content stay inside the safe area.', { safeMm: prepress.safeMm }));
  manualReview.push(issue('Manual review', 'color-proof', 'Output preserves source color spaces and is not a contract color proof.'));
  manualReview.push(issue('Manual review', 'separations-overprint', 'Verify CMYK/spot separations, ICC metadata and overprint flags in the source artwork.'));
  manualReview.push(issue('Manual review', 'page-box', 'Verify TrimBox, BleedBox and MediaBox against the printer specification.', { pageBox }));
  manualReview.push(issue('Manual review', 'bleed-coverage', 'Verify artwork reaches the bleed contour where required.', { bleedMm: prepress.bleedMm }));
  return {
    valid: blocking.length === 0,
    blocking,
    warnings,
    manualReview,
    pageBox,
    settings: prepress,
    diagnostics: production.diagnostics,
  };
}

export function createPreflightReportBlob(report) {
  return new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
}
