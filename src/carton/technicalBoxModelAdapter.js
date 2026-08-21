function clone(value) {
  return structuredClone(value);
}

function surfacePolygon(surface) {
  if (Array.isArray(surface?.polygon) && surface.polygon.length >= 3) return surface.polygon.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  return (surface?.contour?.segments || []).map((segment) => ({ x: Number(segment.start?.x), y: Number(segment.start?.y) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function boundsOf(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Compatibility facade for the existing artwork viewport while the dedicated
 * technical preview/render backends are introduced in later stages.
 */
export function createTechnicalBoxModelAdapter(document) {
  if (!document || document.mode !== 'technical') throw new Error('Technical carton document is required.');
  const surfaces = document.getArtworkSurfaces().map((surface, order) => {
    const polygon = surfacePolygon(surface);
    const bounds = surface.bounds || boundsOf(polygon);
    return {
      id: surface.id,
      faceKey: surface.id,
      faceName: surface.label || surface.id,
      role: surface.role || surface.kind || 'body',
      surfaceKey: surface.id,
      kind: surface.kind || 'PANEL',
      contour: clone(surface.contour || { segments: [], closed: true }),
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.width,
      height: bounds.height,
      polygon,
      foldAngleDeg: 0,
      phase: [0, 1],
      overlapLayer: 0,
      hinge: null,
      order,
      parentId: null,
      parentEdge: null,
      links: { top: null, right: null, bottom: null, left: null },
    };
  });
  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  const dimensions = document.dimensions;
  const board = document.board;
  return {
    get mode() { return 'technical'; },
    get isComplete() { return true; },
    get dimensions() { return clone(dimensions); },
    get board() { return clone(board); },
    get construction() { return { templateId: 'technical-pbd', templateVersion: 1, parameters: {} }; },
    get rootId() { return surfaces[0]?.id || null; },
    getBounds: () => document.getBounds(),
    getElements: () => clone(surfaces),
    getPanels: () => clone(surfaces),
    getPanel: (id) => clone(byId.get(id) || null),
    getChildren: () => [],
    getFeatures: () => [],
    getDielinePrimitives: () => document.getDielinePrimitives(),
    getArtworkSurfaces: () => document.getArtworkSurfaces(),
    getArtworkMaskPaths: () => document.getArtworkMaskPaths(),
    getCanonicalSemanticSvg: () => document.getCanonicalSemanticSvg(),
    getSourceIdentity: () => document.getSourceIdentity(),
    toJSON: () => document.serialize(),
    setBoardCaliper: () => false,
    setBoardConstruction: () => false,
    updateDimensions: () => { throw new Error('Technical carton dimensions are edited in Packaging Box Designer.'); },
  };
}
