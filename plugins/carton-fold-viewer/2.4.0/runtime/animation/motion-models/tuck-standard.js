/**
 * Authoritative Single Source of Truth for TUCK_STANDARD Motion Model
 *
 * Defines the calibrated kinematic trajectory for standard tuck-in closure flaps.
 * Evaluator is used by fold animation synthesizer, GLB exporter, and regression test suites.
 */

export const TUCK_STANDARD_CURVE = {
  name: 'TUCK_STANDARD',
  description: 'Calibrated piecewise kinematic envelope for tuck closures',
  k: [0.0, 0.25, 0.50, 0.75, 1.0],
  closureFactors: [0.0, 0.25, 0.50, 0.75, 1.0],
  tongueFactors:  [0.0, 0.55, 1.05, 1.20, 1.0]
};

/**
 * Evaluates closure and tongue factors at normalized time t in [0, 1]
 * @param {number} t Normalized interaction time [0, 1]
 * @returns {{ closureFactor: number, tongueFactor: number }}
 */
export function evaluateTuckStandard(t) {
  const { k, closureFactors, tongueFactors } = TUCK_STANDARD_CURVE;
  const clamped = Math.max(0, Math.min(1, t));

  let idx = 0;
  while (idx < k.length - 1 && clamped > k[idx + 1]) {
    idx++;
  }

  const lo = k[idx], hi = k[idx + 1];
  const alpha = hi > lo ? (clamped - lo) / (hi - lo) : 0;

  const closureFactor = closureFactors[idx] + (closureFactors[idx + 1] - closureFactors[idx]) * alpha;
  const tongueFactor  = tongueFactors[idx]  + (tongueFactors[idx + 1]  - tongueFactors[idx])  * alpha;

  return { closureFactor, tongueFactor };
}

/**
 * Generates Three.js quaternion and morph animation tracks for a tuck relation
 */
export function solveTuckStandardTracks({ relation, start, duration, parsed, tracks, makeQuatTrack, makeCreaseMorphTracks }) {
  const cf = parsed.folds[relation.closureFoldId], tf = parsed.folds[relation.tongueFoldId];
  if (!cf || !tf) throw new Error(`TUCK_STANDARD ${relation.relationId} is missing closure/tongue folds`);
  if (!parsed.openings[relation.receivingOpeningId]) throw new Error(`TUCK_STANDARD ${relation.relationId} is missing receiving opening`);

  const { k, closureFactors, tongueFactors } = TUCK_STANDARD_CURVE;
  const times = k.map(v => start + duration * v);
  const cfNode = parsed.panels[cf.childPanelId].nodeName;
  const tfNode = parsed.panels[tf.childPanelId].nodeName;

  tracks.push(makeQuatTrack(cfNode, cf.line.axis, cf.targetAngleDeg, times, closureFactors));
  tracks.push(makeQuatTrack(tfNode, tf.line.axis, tf.targetAngleDeg, times, tongueFactors));
  tracks.push(...makeCreaseMorphTracks(cf, times, closureFactors));
  tracks.push(...makeCreaseMorphTracks(tf, times, tongueFactors));
}
