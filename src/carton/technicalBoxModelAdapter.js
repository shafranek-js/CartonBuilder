import { contourPathData } from '../model/dieline.js';
import { createTechnicalPresentationProjection } from './technicalPresentation.js';

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

function createArtworkReferenceFrame(surfaces) {
  const front = surfaces.find((surface) => surface.id === 'body.front');
  const bounds = front?.bounds;
  const values = [
    bounds?.minX,
    bounds?.minY,
    bounds?.maxX,
    bounds?.maxY,
    bounds?.width,
    bounds?.height,
  ];
  if (!front || values.some((value) => !Number.isFinite(value))
    || bounds.maxX < bounds.minX || bounds.maxY < bounds.minY
    || bounds.width < 0 || bounds.height < 0) {
    return null;
  }
  return {
    surfaceId: 'body.front',
    units: 'mm',
    origin: { x: bounds.minX, y: bounds.minY },
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

/**
 * Compatibility facade for the existing artwork viewport while the dedicated
 * technical preview/render backends are introduced in later stages.
 */
export function createTechnicalBoxModelAdapter(document) {
  if (!document || document.mode !== 'technical') throw new Error('Technical carton document is required.');
  const sourceBounds = document.getBounds();
  const sourceModel = document.getModel();
  const presentation = createTechnicalPresentationProjection({
    bounds: sourceBounds,
    input: sourceModel?.input,
    transform: document.getPresentationTransform(),
  });
  const transformSegment = (segment) => ({
    ...segment,
    start: presentation.projectPoint(segment.start),
    end: presentation.projectPoint(segment.end),
    ...(segment.kind === 'ARC' ? {
      center: presentation.projectPoint(segment.center),
      radius: Number(segment.radius),
      clockwise: presentation.transformClockwise(segment.clockwise),
    } : {}),
  });
  const transformSurface = (surface) => {
    const polygon = surfacePolygon(surface).map(presentation.projectPoint);
    const contour = {
      ...(surface.contour || {}),
      segments: (surface.contour?.segments || []).map(transformSegment),
      closed: surface.contour?.closed !== false,
    };
    return { ...surface, polygon, contour, bounds: boundsOf(polygon) };
  };
  const transformedSurfaces = document.getArtworkSurfaces().map(transformSurface);
  const artworkReferenceFrame = createArtworkReferenceFrame(transformedSurfaces);
  const transformedPrimitives = document.getDielinePrimitives().map(transformSegment);
  const transformedMasks = transformedSurfaces.map((surface) => ({
    id: surface.id,
    d: contourPathData(surface.contour.segments),
    polygon: clone(surface.polygon),
  }));
  const surfaces = transformedSurfaces.map((surface, order) => {
    const polygon = surface.polygon;
    const bounds = surface.bounds;
    return {
      id: surface.id,
      faceKey: surface.id,
      faceName: surface.label || surface.id,
      role: surface.role || surface.kind || 'body',
      surfaceKey: surface.id,
      kind: surface.kind || 'PANEL',
      contour: clone(surface.contour),
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
    getBounds: () => clone(presentation.geometryBounds),
    getCanonicalViewBoxBounds: () => document.getCanonicalViewBoxBounds(),
    getElements: () => clone(surfaces),
    getPanels: () => clone(surfaces),
    getPanel: (id) => clone(byId.get(id) || null),
    getChildren: () => [],
    getFeatures: () => [],
    getDielinePrimitives: () => clone(transformedPrimitives),
    getArtworkSurfaces: () => clone(transformedSurfaces),
    getArtworkReferenceFrame: () => clone(artworkReferenceFrame),
    getArtworkMaskPaths: () => clone(transformedMasks),
    getPresentationTransform: () => clone(presentation.transform),
    getCanonicalSemanticSvg: () => document.getCanonicalSemanticSvg(),
    getSourceIdentity: () => document.getSourceIdentity(),
    toJSON: () => document.serialize(),
    setBoardCaliper: () => false,
    setBoardConstruction: () => false,
    updateDimensions: () => { throw new Error('Technical carton dimensions are edited in Packaging Box Designer.'); },
  };
}
