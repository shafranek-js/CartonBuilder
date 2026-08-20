/**
 * Pure SVG bounds point collection for the incremental M4 source extraction.
 * Sampling and closure-family decisions are injected explicitly so this
 * helper remains independent from the DOM and from a global engine namespace.
 */

export function allPoints(model, sampleSegment, featureSegments, isSnapLock123) {
  const featurePoints = model.features.flatMap((feature) => featureSegments(feature).flatMap((segment) => sampleSegment(segment)));
  const anchorPoints = isSnapLock123(model.bottomClosure) ? model.bottomClosure.namedAnchors.map((anchor) => anchor.point) : [];
  return model.regions.flatMap((region) => region.points).concat(model.edges.flatMap((edge) => sampleSegment(edge.geometry)), featurePoints, anchorPoints);
}
