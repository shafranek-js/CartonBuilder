/**
 * Pure SVG annotation helpers for the incremental M4 source extraction.
 * Sequence and label geometry remain derived from the semantic model; this
 * module does not create or inspect DOM nodes.
 */

export function sequenceMap(model) {
  const map = new Map();
  if (model.bottomClosure.closureFamily === "SNAP_LOCK_123") {
    for (const stage of model.bottomClosure.sequence.stages)
      for (const action of stage.actions) {
        map.set(action.entityId, stage.stage);
        if (action.targetId)
          map.set(action.targetId, stage.stage);
      }
  }
  return map;
}

export function regionCenter(region) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of region.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
