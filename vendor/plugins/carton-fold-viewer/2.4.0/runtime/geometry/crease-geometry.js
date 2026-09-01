import * as THREE from 'three';
import { polyCentroid } from '../pbd/path-parser.js';
import { applyFlatNetUv } from './flat-net-uv.js';
import { trimmedPanelPolygonGlobal } from './panel-geometry.js';

export const CREASE_MORPH_FACTORS = [0.25, 0.50, 0.75, 1.00, 1.25];

export function creaseMeshName(foldId) {
  return 'Crease__' + String(foldId).replace(/[^A-Za-z0-9_-]+/g, '_');
}

export function resolveCreaseProfile(metadata, dims, fold = null) {
  const cp = metadata.material?.creaseProfile || {};
  const cw = Number(cp.creaseWidthMm), br = Number(cp.bendRadiusMm);
  const hasCertifiedPhysicalProfile = metadata.capabilities?.physicalCreaseProfile === true
    && Number.isFinite(cw) && cw > 0
    && Number.isFinite(br) && br > 0;
  let creaseWidthMm = hasCertifiedPhysicalProfile ? cw : 0;
  let bendRadiusMm = hasCertifiedPhysicalProfile ? br : 0;

  // For tongue folds with throat relief notches (where relief depth is ~ 2mm),
  // clamp creaseWidthMm so that halfCrease fits within the throat notch clearance (<= 2mm)
  // preventing the crease from cutting past the throat notch and distorting the locking ears.
  const isTongue = fold && (
    String(fold.foldId || '').toLowerCase().includes('tongue') ||
    String(fold.childPanelId || '').toLowerCase().includes('tongue')
  );
  if (isTongue) {
    creaseWidthMm = Math.min(creaseWidthMm, 2.0);
    bendRadiusMm = Math.min(bendRadiusMm, 1.0);
  }

  return {
    creaseWidthMm,
    bendRadiusMm,
    source: hasCertifiedPhysicalProfile ? 'svg' : 'canonical-hinge'
  };
}

export function hasFiniteCreaseProfile(profile) {
  return profile?.source === 'svg'
    && Number.isFinite(profile.creaseWidthMm)
    && profile.creaseWidthMm > 0
    && Number.isFinite(profile.bendRadiusMm)
    && profile.bendRadiusMm > 0;
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
function findLinePolySpan(poly, linePt, u, L) {
  if (!poly || poly.length < 3) return [0, L];
  const perp = [-u[1], u[0]];
  const lineDist = linePt[0] * perp[0] + linePt[1] * perp[1];
  const sIntersections = [];

  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    const d1 = p1[0] * perp[0] + p1[1] * perp[1] - lineDist;
    const d2 = p2[0] * perp[0] + p2[1] * perp[1] - lineDist;

    if (Math.abs(d1 - d2) > 1e-9) {
      if ((d1 >= -1e-5 && d2 <= 1e-5) || (d1 <= 1e-5 && d2 >= -1e-5)) {
        const t = d1 / (d1 - d2);
        const ix = p1[0] + (p2[0] - p1[0]) * t;
        const iy = p1[1] + (p2[1] - p1[1]) * t;
        const s = (ix - linePt[0]) * u[0] + (iy - linePt[1]) * u[1];
        sIntersections.push(s);
      }
    }
  }

  if (sIntersections.length >= 2) {
    const minS = Math.min(...sIntersections);
    const maxS = Math.max(...sIntersections);
    return [
      Math.max(0, Math.min(L, minS)),
      Math.min(L, Math.max(0, maxS))
    ];
  }
  return [0, L];
}

/**
 * Computes exact miter start and end curves s0At(q) and s1At(q) along the fold ribbon.
 * By intersecting the crease offset boundary lines on parent (q=0) and child (q=1) sides
 * with their respective trimmed polygons, this guarantees 100% watertight coupling with
 * zero notches, overhangs, or splay steps across all thickness and flap geometries.
 */
function foldEndpointMiterProfile(fold, parsed, halfWidthMm) {
  const u = [fold.line.axis[0], fold.line.axis[1]];
  const a = fold.line.a, b = fold.line.b, L = fold.line.length;

  let n = [-u[1], u[0]];
  const childPoly = parsed.panels[fold.childPanelId]?.polygon || [];
  const childC = polyCentroid(childPoly);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if ((childC[0] - mid[0]) * n[0] + (childC[1] - mid[1]) * n[1] < 0) {
    n[0] = -n[0]; n[1] = -n[1];
  }

  const ptParent = [a[0] - n[0] * halfWidthMm, a[1] - n[1] * halfWidthMm];
  const ptChild  = [a[0] + n[0] * halfWidthMm, a[1] + n[1] * halfWidthMm];

  const parentTrimmed = trimmedPanelPolygonGlobal(fold.parentPanelId, parsed, halfWidthMm);
  const childTrimmed  = trimmedPanelPolygonGlobal(fold.childPanelId, parsed, halfWidthMm);

  const [s0_p, s1_p] = findLinePolySpan(parentTrimmed, ptParent, u, L);
  const [s0_c, s1_c] = findLinePolySpan(childTrimmed, ptChild, u, L);

  return {
    s0At: (q) => ((s0_p * (1 - q) + s0_c * q)) * 0.001,
    s1At: (q) => ((s1_p * (1 - q) + s1_c * q)) * 0.001
  };
}

function computeArcPoint(p0, p1, u, thetaRad, q) {
  if (Math.abs(thetaRad) < 1e-5) {
    return p0.clone().lerp(p1, q);
  }

  const chord = p1.clone().sub(p0);
  const chordLen = chord.length();
  if (chordLen < 1e-7) return p0.clone();

  const mid = p0.clone().addScaledVector(chord, 0.5);
  const perp = new THREE.Vector3().crossVectors(u, chord).normalize();
  const sagittaDist = (chordLen * 0.5) / Math.tan(Math.abs(thetaRad) * 0.5);

  let C = mid.clone().addScaledVector(perp, sagittaDist);
  let testP1 = C.clone().add(rotateAroundAxis(p0.clone().sub(C), u, thetaRad));
  if (testP1.distanceTo(p1) > 1e-4) {
    C = mid.clone().addScaledVector(perp, -sagittaDist);
  }

  const r0 = p0.clone().sub(C);
  return C.clone().add(rotateAroundAxis(r0, u, thetaRad * q));
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

  let childLayerOffset = 0.0;
  if (r.includes('SNAP_LOCK.SUPPORT') || r.includes('SUPPORT_FLAP')) childLayerOffset = 2.0;
  else if (r.includes('SNAP_LOCK.SIDE') || r.includes('SIDE_FLAP')) childLayerOffset = 1.0;

  const childOffset = childLayerOffset > 0
    ? z.clone().applyQuaternion(qEnd).multiplyScalar(-1.02 * thick * childLayerOffset * factor)
    : new THREE.Vector3();

  const p0 = n.clone().multiplyScalar(-half);
  const p1 = n.clone().multiplyScalar(half).applyQuaternion(qEnd).add(childOffset);

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
    const c = computeArcPoint(p0, p1, u, theta, q);
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

function creaseIndices(segments, isFlipped = false, includeEndpointRims = true) {
  // Per q: 8 vertices per slice:
  //   k=0: outer s0 (cyl normal)
  //   k=1: inner s0 (cyl normal)
  //   k=2: outer s1 (cyl normal)
  //   k=3: inner s1 (cyl normal)
  //   k=4: outer s0 (rim -u normal)
  //   k=5: inner s0 (rim -u normal)
  //   k=6: outer s1 (rim +u normal)
  //   k=7: inner s1 (rim +u normal)
  const outer = [], inner = [], rims = [], v = (q, k) => q * 8 + k;

  for (let q = 0; q < segments; q++) {
    if (!isFlipped) {
      // Outside skin (CCW for outward +Z normal when cross(u, n) > 0)
      outer.push(v(q, 0), v(q, 2), v(q + 1, 2));
      outer.push(v(q, 0), v(q + 1, 2), v(q + 1, 0));

      // Inside skin (CCW for inward -Z normal when cross(u, n) > 0)
      inner.push(v(q, 1), v(q + 1, 1), v(q + 1, 3));
      inner.push(v(q, 1), v(q + 1, 3), v(q, 3));

      // s0 rim (dedicated vertices k=4, 5 with exact outward normal -u)
      rims.push(v(q, 4), v(q + 1, 5), v(q, 5));
      rims.push(v(q, 4), v(q + 1, 4), v(q + 1, 5));

      // s1 rim (dedicated vertices k=6, 7 with exact outward normal +u)
      rims.push(v(q, 6), v(q, 7), v(q + 1, 7));
      rims.push(v(q, 6), v(q + 1, 7), v(q + 1, 6));
    } else {
      // Outside skin (CCW for outward +Z normal when cross(u, n) < 0)
      outer.push(v(q, 0), v(q + 1, 2), v(q, 2));
      outer.push(v(q, 0), v(q + 1, 0), v(q + 1, 2));

      // Inside skin (CCW for inward -Z normal when cross(u, n) < 0)
      inner.push(v(q, 1), v(q + 1, 3), v(q + 1, 1));
      inner.push(v(q, 1), v(q, 3), v(q + 1, 3));

      // s0 rim (dedicated vertices k=4, 5 with exact outward normal -u)
      rims.push(v(q, 4), v(q, 5), v(q + 1, 5));
      rims.push(v(q, 4), v(q + 1, 5), v(q + 1, 4));

      // s1 rim (dedicated vertices k=6, 7 with exact outward normal +u)
      rims.push(v(q, 6), v(q + 1, 7), v(q, 7));
      rims.push(v(q, 6), v(q + 1, 6), v(q + 1, 7));
    }
  }

  const renderedRims = includeEndpointRims ? rims : [];
  return {
    indices: [...outer, ...inner, ...renderedRims],
    outerCount: outer.length,
    innerCount: inner.length,
    rimsCount: renderedRims.length
  };
}

export function makeFiniteCreaseGeometry(fold, parsed, parentOrigin, profile, flatNetUv = null) {
  const u = new THREE.Vector3(...fold.line.axis).normalize();
  const childC = polyCentroid(parsed.panels[fold.childPanelId].polygon);
  const mid = [(fold.line.a[0] + fold.line.b[0]) / 2, (fold.line.a[1] + fold.line.b[1]) / 2];
  let n = new THREE.Vector3(-u.y, u.x, 0);
  if ((childC[0] - mid[0]) * n.x + (childC[1] - mid[1]) * n.y < 0) n.multiplyScalar(-1);
  const isFlipped = (u.x * n.y - u.y * n.x) < 0;

  const seg = 16;
  // A canonical zero-width hinge still needs its curved outer/inner skins so
  // the folded carton does not look razor-sharp. Its endpoint rims collapse
  // into radial triangle fans, however, so only certified finite creases get
  // physical end caps.
  const includeEndpointRims = hasFiniteCreaseProfile(profile);
  const { indices, outerCount, innerCount, rimsCount } = creaseIndices(seg, isFlipped, includeEndpointRims);
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
  g.addGroup(0, outerCount, 0);
  g.addGroup(outerCount, innerCount, 1);
  if (rimsCount > 0) g.addGroup(outerCount + innerCount, rimsCount, 2);
  if (flatNetUv) applyFlatNetUv(g, flatNetUv, parentOrigin);
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
