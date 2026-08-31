import * as THREE from 'three';
import { makeCreaseMorphTracks } from '../geometry/crease-geometry.js';
import { solveTuckStandardTracks } from './motion-models/tuck-standard.js';

function quatValues(axis, angleDeg, factors) {
  const a = new THREE.Vector3(...axis).normalize(), q = new THREE.Quaternion(), out = [];
  factors.forEach(f => {
    q.setFromAxisAngle(a, THREE.MathUtils.degToRad(angleDeg * f));
    out.push(q.x, q.y, q.z, q.w);
  });
  return out;
}

function makeQuatTrack(nodeName, axis, angle, times, factors) {
  return new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, times, quatValues(axis, angle, factors));
}

function makeInwardTranslationTrack(nodeName, times, factors, thicknessMm, layerOffset = 1.0) {
  const t = Math.max(thicknessMm, 0.01) * 0.001;
  const values = [];
  factors.forEach(f => {
    values.push(0, 0, 1.02 * t * layerOffset * f);
  });
  return new THREE.VectorKeyframeTrack(`${nodeName}__mesh.position`, times, values);
}

function getPanelLayerOffset(panelId, parsed) {
  const meta = parsed.panelById?.[panelId] || parsed.panels?.[panelId]?.meta || {};
  const r = String(meta.semanticRole || '').toUpperCase();
  const k = String(meta.kind || '').toUpperCase();

  if (r.includes('SNAP_LOCK.SUPPORT') || r.includes('SUPPORT_FLAP')) return 2.0; // Innermost layer #1
  if (r.includes('SNAP_LOCK.SIDE') || r.includes('SIDE_FLAP')) return 1.0; // Middle layer #2/#3
  if (k.includes('DUST') || r.includes('DUST')) return 1.0;
  return 0.0;
}

function buildSimultaneousAnimation(parsed) {
  const tracks = [];
  for (const f of Object.values(parsed.folds)) {
    const node = parsed.panels[f.childPanelId].nodeName;
    tracks.push(makeQuatTrack(node, f.line.axis, f.targetAngleDeg, [0, 1], [0, 1]));
    const layerOffset = getPanelLayerOffset(f.childPanelId, parsed);
    if (layerOffset > 0) {
      tracks.push(makeInwardTranslationTrack(node, [0, 1], [0, 1], parsed.dimensions.thickness, layerOffset));
    }
    const mt = [0, .25, .5, .75, 1];
    tracks.push(...makeCreaseMorphTracks(f, mt, mt));
  }
  for (const p of Object.values(parsed.panels)) {
    const meta = parsed.panelById?.[p.id] || p.meta || {};
    const r = String(meta.semanticRole || '').toUpperCase();
    if (r.includes('SNAP_LOCK') || r.includes('SUPPORT_FLAP') || r.includes('SIDE_FLAP') || r.includes('LOCKING_FLAP')) {
      tracks.push(new THREE.NumberKeyframeTrack(`${p.nodeName}__mesh.morphTargetInfluences[0]`, [0, 0.7, 1], [0, 0, 1]));
    }
  }
  return new THREE.AnimationClip('Fold_Simultaneous', 1, tracks);
}

const INTERACTION_SOLVERS = {
  TUCK_STANDARD({ relation, start, duration, parsed, tracks }) {
    solveTuckStandardTracks({
      relation,
      start,
      duration,
      parsed,
      tracks,
      makeQuatTrack,
      makeCreaseMorphTracks
    });
  },
  LOCK_ENGAGEMENT({ relation, start, duration, parsed, tracks }) {
    if (!relation.lockingPanelId || !parsed.panels[relation.lockingPanelId]) return;
    const pid = relation.lockingPanelId;
    const node = parsed.panels[pid].nodeName;
    const meshName = `${node}__mesh`;

    // Animate the elastic locking tongue bending through the slot into the support flap notch
    const times = [start, start + duration * 0.4, start + duration];
    const values = [0.0, 0.5, 1.0];
    tracks.push(new THREE.NumberKeyframeTrack(`${meshName}.morphTargetInfluences[0]`, times, values));
  }
};

function getActionSortKey(a, parsed) {
  let order = Number.isFinite(+a.order) ? +a.order : 0;
  if (a.type === 'fold' && a.foldId) {
    const f = parsed.folds[a.foldId];
    if (f) {
      const childMeta = parsed.panelById?.[f.childPanelId] || parsed.panels?.[f.childPanelId]?.meta || {};
      const k = String(childMeta.kind || '').toUpperCase(), l = String(childMeta.layerClass || '').toLowerCase();
      if (l === 'glue' || k === 'GLUE_FLAP') order -= 1000;
    }
  }
  return order;
}

function scheduleAssembly(parsed) {
  const stages = [...parsed.assembly.stages].sort((a, b) => (+a.order || 0) - (+b.order || 0));
  const actions = parsed.assembly.actions.map((a, index) => ({ ...a, __sourceIndex: index }));
  const scheduled = [];
  let cursor = 0;
  const stageGap = .08, ordinaryDuration = .48, interactionDuration = .88;

  for (const stage of stages) {
    const aa = actions.filter(a => a.stage === stage.id).sort((a, b) => getActionSortKey(a, parsed) - getActionSortKey(b, parsed) || a.__sourceIndex - b.__sourceIndex);
    const orders = [...new Set(aa.map(a => getActionSortKey(a, parsed)))].sort((a, b) => a - b);
    for (const ord of orders) {
      const sameOrder = aa.filter(a => getActionSortKey(a, parsed) === ord);
      const units = [], byParallel = new Map();
      for (const a of sameOrder) {
        if (a.parallelGroup) {
          if (!byParallel.has(a.parallelGroup)) { const unit = []; byParallel.set(a.parallelGroup, unit); units.push(unit); }
          byParallel.get(a.parallelGroup).push(a);
        } else units.push([a]);
      }
      for (const unit of units) {
        const dur = Math.max(...unit.map(a => a.type === 'interaction' ? interactionDuration : ordinaryDuration), ordinaryDuration);
        for (const a of unit) scheduled.push({ ...a, start: cursor, duration: a.type === 'interaction' ? interactionDuration : ordinaryDuration });
        cursor += dur;
      }
    }
    cursor += stageGap;
  }
  return { scheduled, duration: Math.max(cursor - stageGap, .1) };
}

function buildAssemblyAnimation(parsed) {
  const tracks = [], { scheduled, duration } = scheduleAssembly(parsed);
  for (const a of scheduled) {
    if (a.type === 'fold') {
      const f = parsed.folds[a.foldId], node = parsed.panels[f.childPanelId].nodeName;
      tracks.push(makeQuatTrack(node, f.line.axis, f.targetAngleDeg, [a.start, a.start + a.duration], [0, 1]));
      const layerOffset = getPanelLayerOffset(f.childPanelId, parsed);
      if (layerOffset > 0) {
        tracks.push(makeInwardTranslationTrack(node, [a.start, a.start + a.duration], [0, 1], parsed.dimensions.thickness, layerOffset));
      }
      const childMeta = parsed.panelById?.[f.childPanelId] || parsed.panels?.[f.childPanelId]?.meta || {};
      const r = String(childMeta.semanticRole || '').toUpperCase();
      if (r.includes('SNAP_LOCK.SIDE') || r.includes('SIDE_FLAP') || r.includes('SNAP_LOCK.SUPPORT') || r.includes('SUPPORT_FLAP')) {
        tracks.push(new THREE.NumberKeyframeTrack(`${node}__mesh.morphTargetInfluences[0]`, [a.start, a.start + a.duration * 0.5, a.start + a.duration], [0, 0.5, 1]));
      }
      const mt = [0, .25, .5, .75, 1].map(q => a.start + a.duration * q);
      tracks.push(...makeCreaseMorphTracks(f, mt, [0, .25, .5, .75, 1]));
    } else if (a.type === 'interaction' || a.type === 'engage') {
      const r = parsed.interactions[a.relationId];
      if (r) {
        const model = String(r.motionModel || (r.type === 'lock-engagement' ? 'LOCK_ENGAGEMENT' : '')).toUpperCase();
        const solver = INTERACTION_SOLVERS[model];
        if (solver) {
          solver({ relation: r, start: a.start, duration: a.duration, parsed, tracks });
        }
      }
    }
  }
  return new THREE.AnimationClip('Fold_Assembly', duration, tracks);
}

export function buildGenericAnimations(parsed) {
  return [buildSimultaneousAnimation(parsed), buildAssemblyAnimation(parsed)];
}
