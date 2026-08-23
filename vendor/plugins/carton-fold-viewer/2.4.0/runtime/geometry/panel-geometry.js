import * as THREE from 'three';
import { polyCentroid } from '../pbd/path-parser.js';
import { applyFlatNetUv } from './flat-net-uv.js';


function lineUnitNormalIntoPolygon(poly,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
  let nx=-dy/len,ny=dx/len; const c=polyCentroid(poly);
  if((c[0]-a[0])*nx+(c[1]-a[1])*ny<0){ nx=-nx;ny=-ny; }
  return [nx,ny];
}

function clipPolygonByOffsetLine(poly, a, b, offsetMm) {
  if (!poly?.length) return [];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  if (L < 1e-6) return poly;
  const ux = dx / L, uy = dy / L;
  const [nx, ny] = lineUnitNormalIntoPolygon(poly, a, b);

  // Check if poly extends significantly beyond the fold segment [a, b]
  const sVals = poly.map(p => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy);
  const minS = Math.min(...sVals), maxS = Math.max(...sVals);

  // If the fold spans the entire polygon boundary, standard line clip is exact:
  if (minS >= -1.0 && maxS <= L + 1.0) {
    const eps = 1e-7;
    const dist = p => (p[0] - a[0]) * nx + (p[1] - a[1]) * ny - offsetMm;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length];
      const da = dist(A), db = dist(B), ina = da >= -eps, inb = db >= -eps;
      if (ina) out.push(A);
      if (ina !== inb) {
        const den = da - db, q = Math.abs(den) < 1e-12 ? 0 : da / den;
        out.push([A[0] + (B[0] - A[0]) * q, A[1] + (B[1] - A[1]) * q]);
      }
    }
    return out;
  }

  // For sub-segment folds (like tuck tongue with side ears and relief cuts),
  // clip strictly within the fold longitudinal span s in [0, L]:
  const out = [];
  const eps = 1e-6;
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i];
    const s = (P[0] - a[0]) * ux + (P[1] - a[1]) * uy;
    const dn = (P[0] - a[0]) * nx + (P[1] - a[1]) * ny;

    if (s >= -eps && s <= L + eps && dn < offsetMm - eps) {
      out.push([a[0] + ux * s + nx * offsetMm, a[1] + uy * s + ny * offsetMm]);
    } else {
      out.push(P);
    }
  }

  const cleaned = [];
  for (const p of out) {
    if (!cleaned.length || Math.hypot(p[0] - cleaned[cleaned.length - 1][0], p[1] - cleaned[cleaned.length - 1][1]) > 0.05) {
      cleaned.push(p);
    }
  }
  return cleaned;
}

function polygonAreaAbs(poly){ let a=0; for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];a+=p[0]*q[1]-q[0]*p[1];} return Math.abs(a)*0.5; }
export function trimmedPanelPolygonGlobal(panelId,parsed,halfWidthMm){
  const original=parsed.panels[panelId].polygon.map(p=>[...p]); let poly=original;
  for(const f of Object.values(parsed.folds)){
    if(f.parentPanelId!==panelId && f.childPanelId!==panelId) continue;
    const candidate=clipPolygonByOffsetLine(poly,f.line.a,f.line.b,halfWidthMm);
    // Safety fallback for exotic geometry: never destroy a panel because a
    // fold line is not actually on its boundary.
    if(candidate.length>=3 && polygonAreaAbs(candidate)>1e-4) poly=candidate;
  }
  return poly;
}

export function makePanelGeometry(pointsMm, thicknessMm, spec = null, flatNetUv = null) {
  const shape = new THREE.Shape();
  pointsMm.forEach((p, j) => {
    const x = p[0] * 0.001, y = p[1] * 0.001;
    if (j === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const depth = Math.max(thicknessMm, 0.01) * 0.001;
  const g = new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: false, curveSegments: 2 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  if (flatNetUv) applyFlatNetUv(g, flatNetUv, spec?.origin || [0, 0]);

  const r = String(spec?.semanticRole || '').toUpperCase();
  if (r.includes('SNAP_LOCK.LOCKING') || r.includes('LOCKING_FLAP')) {
    const pos = g.attributes.position;
    const morphPos = new Float32Array(pos.count * 3);
    const yVals = [];
    for (let i = 0; i < pos.count; i++) yVals.push(pos.getY(i));
    const maxDistY = Math.max(...yVals.map(Math.abs), 0.001);
    const tabStartThreshold = maxDistY * 0.35;
    const maxDeflection = Math.max(0.0160, 5.0 * depth);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const dist = Math.abs(y);
      let dz = 0;
      if (dist > tabStartThreshold) {
        const alpha = Math.min(1.0, (dist - tabStartThreshold) / (maxDistY - tabStartThreshold));
        dz = Math.pow(alpha, 0.85) * maxDeflection;
      }
      morphPos[i * 3] = x;
      morphPos[i * 3 + 1] = y;
      morphPos[i * 3 + 2] = z + dz;
    }
    g.morphAttributes.position = [new THREE.BufferAttribute(morphPos, 3)];
    g.morphTargetsRelative = false;
  } else if (r.includes('SNAP_LOCK.SIDE') || r.includes('SIDE_FLAP')) {
    const pos = g.attributes.position;
    const morphPos = new Float32Array(pos.count * 3);
    const yVals = [];
    for (let i = 0; i < pos.count; i++) yVals.push(pos.getY(i));
    const maxDistY = Math.max(...yVals.map(Math.abs), 0.001);
    const earStartThreshold = maxDistY * 0.30;
    const maxDeflection = Math.max(0.0220, 6.5 * depth);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const dist = Math.abs(y);
      let dz = 0;
      if (dist > earStartThreshold) {
        const alpha = Math.min(1.0, (dist - earStartThreshold) / (maxDistY - earStartThreshold));
        dz = Math.pow(alpha, 0.85) * maxDeflection;
      }
      morphPos[i * 3] = x;
      morphPos[i * 3 + 1] = y;
      morphPos[i * 3 + 2] = z + dz;
    }
    g.morphAttributes.position = [new THREE.BufferAttribute(morphPos, 3)];
    g.morphTargetsRelative = false;
  } else if (r.includes('SNAP_LOCK.SUPPORT') || r.includes('SUPPORT_FLAP')) {
    const pos = g.attributes.position;
    const morphPos = new Float32Array(pos.count * 3);
    const yVals = [];
    for (let i = 0; i < pos.count; i++) yVals.push(pos.getY(i));
    const maxDistY = Math.max(...yVals.map(Math.abs), 0.001);
    const wingStartThreshold = maxDistY * 0.45;
    const maxDeflection = Math.max(0.0050, 1.8 * depth);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const dist = Math.abs(y);
      let dz = 0;
      if (dist > wingStartThreshold) {
        const alpha = Math.min(1.0, (dist - wingStartThreshold) / (maxDistY - wingStartThreshold));
        dz = Math.pow(alpha, 1.1) * maxDeflection;
      }
      morphPos[i * 3] = x;
      morphPos[i * 3 + 1] = y;
      morphPos[i * 3 + 2] = z + dz;
    }
    g.morphAttributes.position = [new THREE.BufferAttribute(morphPos, 3)];
    g.morphTargetsRelative = false;
  }

  return g;
}
