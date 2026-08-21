import * as THREE from 'three';
import { polyCentroid } from '../pbd/path-parser.js';

export const CREASE_MORPH_FACTORS = [0.25, 0.50, 0.75, 1.00, 1.25];

export function creaseMeshName(foldId) {
  return 'Crease__' + String(foldId).replace(/[^A-Za-z0-9_-]+/g, '_');
}

export function resolveCreaseProfile(metadata, dims) {
  const cp = metadata.material?.creaseProfile || {}, t = Math.max(dims.thickness, 0.01);
  const cw = Number(cp.creaseWidthMm), br = Number(cp.bendRadiusMm);
  return {
    creaseWidthMm: Number.isFinite(cw) && cw > 0 ? cw : 3.0 * t,
    bendRadiusMm: Number.isFinite(br) && br > 0 ? br : 1.5 * t,
    source: (Number.isFinite(cw) && cw > 0 && Number.isFinite(br) && br > 0) ? 'svg' : 'generic-fallback'
  };
}

function rotateAroundAxis(v, axis, angle) {
  return v.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, angle));
}

function hermitePoint(p0, p1, t0, t1, q) {
  const q2 = q * q, q3 = q2 * q;
  const h00 = 2 * q3 - 3 * q2 + 1;
  const h10 = q3 - 2 * q2 + q;
  const h01 = -2 * q3 + 3 * q2;
  const h11 = q3 - q2;
  return p0.clone().multiplyScalar(h00)
    .add(t0.clone().multiplyScalar(h10))
    .add(p1.clone().multiplyScalar(h01))
    .add(t1.clone().multiplyScalar(h11));
}

/**
 * Generates vertex positions and exact analytical normals for the finite crease ribbon.
 * Returns { positions, normals } arrays for Three.js BufferGeometry.
 */
/**
 * Computes exact miter start and end curves s0At(q) and s1At(q) along the fold ribbon.
 * - At q = 0 (parent panel boundary): insets by halfWidthMm to meet the trimmed parent panel.
 * - At q = 0.5 (crease centerline): extends to s = 0 / s = L to reach the 2D corner apex.
 * - At q = 1.0 (child panel boundary): extends to meet the child panel cut/hinge edge.
 * In 2D (unfolded 0%), this ensures 100% watertight tiling with zero notches or holes.
 */
function foldEndpointMiterProfile(fold, parsed, halfWidthMm) {
  const near = (p, q, tol = 1.5) =>
    Math.hypot((p?.[0] || 0) - (q?.[0] || 0), (p?.[1] || 0) - (q?.[1] || 0)) <= tol;
  const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];

  const u = [fold.line.axis[0], fold.line.axis[1]];
  const childC = polyCentroid(parsed.panels[fold.childPanelId].polygon);
  const mid = [(fold.line.a[0] + fold.line.b[0]) / 2, (fold.line.a[1] + fold.line.b[1]) / 2];
  let n = [-u[1], u[0]];
  if ((childC[0] - mid[0]) * n[0] + (childC[1] - mid[1]) * n[1] < 0) {
    n[0] = -n[0];
    n[1] = -n[1];
  }

  let aParentMiter = 0, aChildMiter = 0;
  let bParentMiter = 0, bChildMiter = 0;

  for (const other of Object.values(parsed.folds)) {
    if (other.foldId === fold.foldId) continue;
    const v = [other.line.axis[0], other.line.axis[1]];
    if (Math.abs(dot2(u, v)) > 0.96) continue; // Ignore collinear neighbours

    const atA = near(fold.line.a, other.line.a) || near(fold.line.a, other.line.b);
    const atB = near(fold.line.b, other.line.a) || near(fold.line.b, other.line.b);

    if (atA) {
      if (other.parentPanelId === fold.parentPanelId || other.childPanelId === fold.parentPanelId) {
        aParentMiter = Math.max(aParentMiter, halfWidthMm);
      }
      if (other.parentPanelId === fold.childPanelId || other.childPanelId === fold.childPanelId) {
        aChildMiter = Math.max(aChildMiter, halfWidthMm);
      }
    }

    if (atB) {
      if (other.parentPanelId === fold.parentPanelId || other.childPanelId === fold.parentPanelId) {
        bParentMiter = Math.max(bParentMiter, halfWidthMm);
      }
      if (other.parentPanelId === fold.childPanelId || other.childPanelId === fold.childPanelId) {
        bChildMiter = Math.max(bChildMiter, halfWidthMm);
      }
    }
  }

  return {
    s0At: (q) => (aParentMiter * Math.max(0, 1 - 2 * q) + aChildMiter * Math.max(0, 2 * q - 1)) * 0.001,
    s1At: (q) => (fold.line.length - (bParentMiter * Math.max(0, 1 - 2 * q) + bChildMiter * Math.max(0, 2 * q - 1))) * 0.001
  };
}

function creaseShapeArraysAndNormals(
  fold,
  parsed,
  parentOrigin,
  creaseWidthMm,
  bendRadiusMm,
  thicknessMm,
  factor,
  segments = 16
) {
  const u = new THREE.Vector3(...fold.line.axis).normalize();
  const childC = polyCentroid(parsed.panels[fold.childPanelId].polygon);
  const mid = [(fold.line.a[0] + fold.line.b[0]) / 2, (fold.line.a[1] + fold.line.b[1]) / 2];
  let n = new THREE.Vector3(-u.y, u.x, 0);
  if ((childC[0] - mid[0]) * n.x + (childC[1] - mid[1]) * n.y < 0) n.multiplyScalar(-1);

  const z = new THREE.Vector3(0, 0, 1);
  const half = creaseWidthMm * 0.0005;
  const thick = Math.max(thicknessMm, 0.01) * 0.001;
  const theta = THREE.MathUtils.degToRad(fold.targetAngleDeg * factor);
  const qEnd = new THREE.Quaternion().setFromAxisAngle(u, theta);

  const meta = parsed.panelById?.[fold.childPanelId] || parsed.panels?.[fold.childPanelId]?.meta || {};
  const r = String(meta.semanticRole || '').toUpperCase();
  const k = String(meta.kind || '').toUpperCase();

  let childLayerOffset = 0.0;
  if (r.includes('SNAP_LOCK.SUPPORT') || r.includes('SUPPORT_FLAP')) childLayerOffset = 2.0;
  else if (r.includes('SNAP_LOCK.SIDE') || r.includes('SIDE_FLAP')) childLayerOffset = 1.0;
  else if (k.includes('DUST') || r.includes('DUST')) childLayerOffset = 1.0;

  const childOffset = childLayerOffset > 0
    ? z.clone().applyQuaternion(qEnd).multiplyScalar(1.02 * thick * childLayerOffset * factor)
    : new THREE.Vector3();

  const p0 = n.clone().multiplyScalar(-half);
  const p1 = n.clone().multiplyScalar(half).applyQuaternion(qEnd).add(childOffset);

  // Cubic-Hermite handle length for smooth circular fillet approximation
  const handle = Math.max(0.40 * (2 * half), Math.min(1.20 * (2 * half), 1.656854249 * bendRadiusMm * 0.001));
  const t0 = n.clone().multiplyScalar(handle);
  const t1 = n.clone().applyQuaternion(qEnd).multiplyScalar(handle);

  const start = new THREE.Vector3(
    (fold.line.a[0] - parentOrigin[0]) * 0.001,
    (fold.line.a[1] - parentOrigin[1]) * 0.001,
    0
  );

  const miter = foldEndpointMiterProfile(fold, parsed, creaseWidthMm * 0.5);

  const pos = [], norm = [];
  const uRimS0 = u.clone().negate();
  const uRimS1 = u.clone();

  for (let i = 0; i <= segments; i++) {
    const q = i / segments;
    const c = hermitePoint(p0, p1, t0, t1, q);
    // Exact analytical normal along the cylindrical/curved fold surface
    const normalOut = rotateAroundAxis(z, u, theta * q).normalize();
    const normalIn = normalOut.clone().negate();

    const s0 = miter.s0At(q);
    const s1 = Math.max(s0, miter.s1At(q));

    // Base 4 vertices per slice (cylindrical outer and inner skins)
    for (const ss of [s0, s1]) {
      const base = start.clone().add(u.clone().multiplyScalar(ss)).add(c);
      const outer = base.clone().add(normalOut.clone().multiplyScalar(thick / 2));
      const inner = base.clone().add(normalOut.clone().multiplyScalar(-thick / 2));

      // outer vertex (k=0 for s0, k=2 for s1)
      pos.push(outer.x, outer.y, outer.z);
      norm.push(normalOut.x, normalOut.y, normalOut.z);

      // inner vertex (k=1 for s0, k=3 for s1)
      pos.push(inner.x, inner.y, inner.z);
      norm.push(normalIn.x, normalIn.y, normalIn.z);
    }

    // Dedicated s0 rim vertices (k=4 outer, k=5 inner) with outward normal -u
    const baseS0 = start.clone().add(u.clone().multiplyScalar(s0)).add(c);
    const outerS0 = baseS0.clone().add(normalOut.clone().multiplyScalar(thick / 2));
    const innerS0 = baseS0.clone().add(normalOut.clone().multiplyScalar(-thick / 2));
    pos.push(outerS0.x, outerS0.y, outerS0.z, innerS0.x, innerS0.y, innerS0.z);
    norm.push(uRimS0.x, uRimS0.y, uRimS0.z, uRimS0.x, uRimS0.y, uRimS0.z);

    // Dedicated s1 rim vertices (k=6 outer, k=7 inner) with outward normal +u
    const baseS1 = start.clone().add(u.clone().multiplyScalar(s1)).add(c);
    const outerS1 = baseS1.clone().add(normalOut.clone().multiplyScalar(thick / 2));
    const innerS1 = baseS1.clone().add(normalOut.clone().multiplyScalar(-thick / 2));
    pos.push(outerS1.x, outerS1.y, outerS1.z, innerS1.x, innerS1.y, innerS1.z);
    norm.push(uRimS1.x, uRimS1.y, uRimS1.z, uRimS1.x, uRimS1.y, uRimS1.z);
  }

  return { positions: pos, normals: norm };
}

function creaseIndices(segments, isFlipped = false) {
  // Per q: 8 vertices per slice:
  //   k=0: outer s0 (cyl normal)
  //   k=1: inner s0 (cyl normal)
  //   k=2: outer s1 (cyl normal)
  //   k=3: inner s1 (cyl normal)
  //   k=4: outer s0 (rim -u normal)
  //   k=5: inner s0 (rim -u normal)
  //   k=6: outer s1 (rim +u normal)
  //   k=7: inner s1 (rim +u normal)
  const idx = [], v = (q, k) => q * 8 + k;

  for (let q = 0; q < segments; q++) {
    if (!isFlipped) {
      // Outside skin (CCW for outward +Z normal when cross(u, n) > 0)
      idx.push(v(q, 0), v(q, 2), v(q + 1, 2));
      idx.push(v(q, 0), v(q + 1, 2), v(q + 1, 0));

      // Inside skin (CCW for inward -Z normal when cross(u, n) > 0)
      idx.push(v(q, 1), v(q + 1, 1), v(q + 1, 3));
      idx.push(v(q, 1), v(q + 1, 3), v(q, 3));

      // s0 rim (dedicated vertices k=4, 5 with exact outward normal -u)
      idx.push(v(q, 4), v(q + 1, 5), v(q, 5));
      idx.push(v(q, 4), v(q + 1, 4), v(q + 1, 5));

      // s1 rim (dedicated vertices k=6, 7 with exact outward normal +u)
      idx.push(v(q, 6), v(q, 7), v(q + 1, 7));
      idx.push(v(q, 6), v(q + 1, 7), v(q + 1, 6));
    } else {
      // Outside skin (CCW for outward +Z normal when cross(u, n) < 0)
      idx.push(v(q, 0), v(q + 1, 2), v(q, 2));
      idx.push(v(q, 0), v(q + 1, 0), v(q + 1, 2));

      // Inside skin (CCW for inward -Z normal when cross(u, n) < 0)
      idx.push(v(q, 1), v(q + 1, 3), v(q + 1, 1));
      idx.push(v(q, 1), v(q, 3), v(q + 1, 3));

      // s0 rim (dedicated vertices k=4, 5 with exact outward normal -u)
      idx.push(v(q, 4), v(q, 5), v(q + 1, 5));
      idx.push(v(q, 4), v(q + 1, 5), v(q + 1, 4));

      // s1 rim (dedicated vertices k=6, 7 with exact outward normal +u)
      idx.push(v(q, 6), v(q + 1, 7), v(q, 7));
      idx.push(v(q, 6), v(q + 1, 6), v(q + 1, 7));
    }
  }

  return idx;
}

export function makeFiniteCreaseGeometry(fold, parsed, parentOrigin, profile) {
  const u = new THREE.Vector3(...fold.line.axis).normalize();
  const childC = polyCentroid(parsed.panels[fold.childPanelId].polygon);
  const mid = [(fold.line.a[0] + fold.line.b[0]) / 2, (fold.line.a[1] + fold.line.b[1]) / 2];
  let n = new THREE.Vector3(-u.y, u.x, 0);
  if ((childC[0] - mid[0]) * n.x + (childC[1] - mid[1]) * n.y < 0) n.multiplyScalar(-1);
  const isFlipped = (u.x * n.y - u.y * n.x) < 0;

  const seg = 16;
  const indices = creaseIndices(seg, isFlipped);
  const base = creaseShapeArraysAndNormals(
    fold,
    parsed,
    parentOrigin,
    profile.creaseWidthMm,
    profile.bendRadiusMm,
    parsed.dimensions.thickness,
    0,
    seg
  );

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(base.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(base.normals, 3));
  g.setIndex(indices);
  g.morphTargetsRelative = true;

  const mp = [], mn = [];
  for (const factor of CREASE_MORPH_FACTORS) {
    const target = creaseShapeArraysAndNormals(
      fold,
      parsed,
      parentOrigin,
      profile.creaseWidthMm,
      profile.bendRadiusMm,
      parsed.dimensions.thickness,
      factor,
      seg
    );

    const posDeltas = target.positions.map((x, i) => x - base.positions[i]);
    const normDeltas = target.normals.map((x, i) => x - base.normals[i]);

    mp.push(new THREE.Float32BufferAttribute(posDeltas, 3));
    mn.push(new THREE.Float32BufferAttribute(normDeltas, 3));
  }

  g.morphAttributes.position = mp;
  g.morphAttributes.normal = mn;
  return g;
}

export function morphWeightsForFactor(f) {
  const keys = [0, ...CREASE_MORPH_FACTORS];
  const x = THREE.MathUtils.clamp(f, 0, keys.at(-1));
  const w = new Array(CREASE_MORPH_FACTORS.length).fill(0);
  if (x <= 0) return w;
  let hi = 1;
  while (hi < keys.length && x > keys[hi]) hi++;
  hi = Math.min(hi, keys.length - 1);
  const lo = hi - 1, den = keys[hi] - keys[lo] || 1;
  const a = (x - keys[lo]) / den;
  if (lo === 0) w[0] = a;
  else {
    w[lo - 1] = 1 - a;
    w[hi - 1] = a;
  }
  return w;
}

export function makeCreaseMorphTracks(fold, times, factors) {
  const name = creaseMeshName(fold.foldId), tracks = [];
  for (let j = 0; j < CREASE_MORPH_FACTORS.length; j++) {
    tracks.push(
      new THREE.NumberKeyframeTrack(
        `${name}.morphTargetInfluences[${j}]`,
        times,
        factors.map(f => morphWeightsForFactor(f)[j])
      )
    );
  }
  return tracks;
}
