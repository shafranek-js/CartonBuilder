import {
  DEFAULT_RENDER_SETTINGS,
  getRenderOutputDimensions,
  sanitizeRenderSettings,
} from '../render/RenderSettings.js';

const MM_PER_INCH = 25.4;

export const PREVIEW_EXPORT_ASPECT_LABELS = Object.freeze({
  square: '1:1',
  landscape: '4:3',
  wide: '16:9',
  portrait: '3:4',
});

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function roundDimension(value) {
  return Math.max(1, Math.round(Number(value) || 0));
}

export function getArtworkRasterExportDpi(artworks = []) {
  const entries = artworks.filter((entry) => entry?.model?.hasArtwork && entry.visible !== false);
  const selectedDpi = entries
    .map((entry) => finitePositive(entry.model?.quality?.render))
    .filter(Boolean);
  const hasAutoQuality = entries.some(
    (entry) => !finitePositive(entry.model?.quality?.render),
  );
  return Math.max(
    selectedDpi.length ? Math.max(...selectedDpi) : 150,
    hasAutoQuality ? 300 : 0,
  );
}

export function getPreviewExportViewportInfo({
  boxModel,
  artworks = [],
  renderSettings = DEFAULT_RENDER_SETTINGS,
} = {}) {
  const settings = sanitizeRenderSettings(renderSettings);
  const renderDimensions = getRenderOutputDimensions(settings);
  const renderAspect = renderDimensions.width / renderDimensions.height;
  const bounds = boxModel?.getBounds?.() || { width: 1, height: 1 };
  const rasterDpi = getArtworkRasterExportDpi(artworks);
  const rasterDimensions = {
    width: roundDimension(bounds.width * rasterDpi / MM_PER_INCH),
    height: roundDimension(bounds.height * rasterDpi / MM_PER_INCH),
  };

  return {
    render: {
      ...renderDimensions,
      aspect: renderAspect,
      aspectLabel: PREVIEW_EXPORT_ASPECT_LABELS[settings.aspect] || `${renderDimensions.width}:${renderDimensions.height}`,
      longEdge: settings.longEdge,
    },
    flat: {
      ...rasterDimensions,
      dpi: rasterDpi,
      widthMm: Number(bounds.width.toFixed(2)),
      heightMm: Number(bounds.height.toFixed(2)),
    },
    html: {
      responsive: true,
      quality: settings.quality.html,
    },
  };
}

export function getCenteredPreviewViewportRect(
  availableWidth,
  availableHeight,
  aspect,
) {
  const width = Math.max(1, Number(availableWidth) || 1);
  const height = Math.max(1, Number(availableHeight) || 1);
  const safeAspect = finitePositive(aspect) || 1;
  let frameWidth = width;
  let frameHeight = frameWidth / safeAspect;
  if (frameHeight > height) {
    frameHeight = height;
    frameWidth = frameHeight * safeAspect;
  }
  return {
    width: Math.max(1, Math.floor(frameWidth)),
    height: Math.max(1, Math.floor(frameHeight)),
    left: Math.max(0, Math.floor((width - frameWidth) / 2)),
    top: Math.max(0, Math.floor((height - frameHeight) / 2)),
  };
}
