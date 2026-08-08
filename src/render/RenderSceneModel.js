import { sanitizeRenderSettings } from './RenderSettings.js';
import { sanitizeBoardAppearance } from './BoardAppearance.js';
import { sanitizeArtworkFinish } from './FinishConfig.js';

function clone(value) {
  return structuredClone(value);
}

export function buildRenderSceneModel({ boxModel, artworks, renderSettings, boardAppearance = null }) {
  if (!boxModel || typeof boxModel.getPanels !== 'function') {
    throw new Error('A valid box model is required for Render.');
  }
  const settings = sanitizeRenderSettings(renderSettings);
  const appearance = sanitizeBoardAppearance(boardAppearance, boxModel.getPanels?.()[0]);
  appearance.thicknessMm = boxModel.board?.caliperMm ?? appearance.thicknessMm;
  const visibleArtworks = (artworks || [])
    .filter((entry) => entry?.visible !== false && entry.model?.hasArtwork)
    .map((entry) => ({
      model: entry.model,
      visible: true,
      originalBlob: entry.originalBlob || null,
      previewBlob: entry.previewBlob || null,
      ...sanitizeArtworkFinish(entry),
    }));
  if (!visibleArtworks.length) {
    throw new Error('At least one visible artwork is required for Render.');
  }

  const bounds = boxModel.getBounds();
  const panels = boxModel.getPanels().map((panel) => clone(panel));
  const flatNetUvs = panels.map((panel) => ({
    panelId: panel.id,
    u0: (panel.x - bounds.minX) / bounds.width,
    v0: (panel.y - bounds.minY) / bounds.height,
    u1: (panel.x + panel.width - bounds.minX) / bounds.width,
    v1: (panel.y + panel.height - bounds.minY) / bounds.height,
  }));
  return {
    box: {
      dimensions: clone(boxModel.dimensions),
      bounds: clone(bounds),
      board: clone(boxModel.board || { caliperMm: appearance.thicknessMm }),
      panels,
    },
    panelGeometry: panels,
    geometryMode: 'solid',
    hingeOffsetMm: appearance.thicknessMm / 2,
    flatNetUvs,
    foldTransforms: panels.map((panel) => ({
      panelId: panel.id,
      parentId: panel.parentId || null,
      parentEdge: panel.parentEdge || null,
      progress: 1,
    })),
    artworks: visibleArtworks,
    foldProgress: 1,
    renderSettings: settings,
    boardAppearance: appearance,
    materials: clone(settings.material),
    camera: clone(settings.camera),
    lighting: clone(settings.lighting),
    background: clone(settings.background),
    shadows: clone(settings.shadows),
    effects: clone(settings.effects),
  };
}

export function getRenderArtworkSignature(sceneModel) {
  return JSON.stringify({
    artworks: sceneModel.artworks.map((entry) => ({
      artwork: entry.model.toJSON(),
      outputRole: entry.outputRole,
      finish: entry.finish,
    })),
  });
}
