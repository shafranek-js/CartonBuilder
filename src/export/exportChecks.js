const defaultMessage = (key, parameters = {}) => ({
  artworkRequired: 'Artwork is required.',
  effectiveResolution: `Effective resolution is ${parameters.dpi} DPI.`,
  panelsUncovered: `${parameters.count} panel(s) are not fully covered.`,
  artworkOutside: 'Part of the artwork is outside the dieline.',
})[key];

export function getExportWarnings(boxModel, artwork, translate = defaultMessage) {
  if (!artwork.hasArtwork) return [translate('artworkRequired')];

  const warnings = [];
  const dpi = artwork.getEffectiveDpi();
  if (dpi != null && dpi < 300) {
    warnings.push(translate('effectiveResolution', { dpi: Math.round(dpi) }));
  }

  const artworkBounds = artwork.bounds;
  const uncoveredPanels = boxModel.getPanels().filter((panel) => (
    artworkBounds.minX > panel.x
    || artworkBounds.minY > panel.y
    || artworkBounds.maxX < panel.x + panel.width
    || artworkBounds.maxY < panel.y + panel.height
  ));
  if (uncoveredPanels.length) {
    warnings.push(translate('panelsUncovered', { count: uncoveredPanels.length }));
  }

  const dielineBounds = boxModel.getBounds();
  if (
    artworkBounds.minX < dielineBounds.minX
    || artworkBounds.minY < dielineBounds.minY
    || artworkBounds.maxX > dielineBounds.maxX
    || artworkBounds.maxY > dielineBounds.maxY
  ) {
    warnings.push(translate('artworkOutside'));
  }

  return warnings;
}
