import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
} from 'three';
import { sanitizeBoardAppearance } from './BoardAppearance.js';

function roundedPerimeter(width, height, radius, segments = 3) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const r = Math.max(0, Math.min(radius, halfWidth, halfHeight));
  if (!r) {
    return [
      [-halfWidth, -halfHeight],
      [halfWidth, -halfHeight],
      [halfWidth, halfHeight],
      [-halfWidth, halfHeight],
    ];
  }

  const corners = [
    [halfWidth - r, -halfHeight + r, -Math.PI / 2],
    [halfWidth - r, halfHeight - r, 0],
    [-halfWidth + r, halfHeight - r, Math.PI / 2],
    [-halfWidth + r, -halfHeight + r, Math.PI],
  ];
  const points = [];
  for (const [cx, cy, start] of corners) {
    for (let index = 0; index <= segments; index += 1) {
      const angle = start + (Math.PI / 2) * (index / segments);
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
  }
  return points;
}

function flatNetUv(point, panel, bounds) {
  const netX = panel.x + point[0] + panel.width / 2;
  // The panel's local +Y axis is the visual top of the carton in Three.js,
  // while the canonical flat-net Y axis grows downward. Keep the Render cap
  // mapping aligned with the flat Preview geometry and CanvasTexture rows.
  const netY = panel.y + panel.height / 2 - point[1];
  return [
    (netX - bounds.minX) / bounds.width,
    1 - (netY - bounds.minY) / bounds.height,
  ];
}

/**
 * Creates a render-only thin solid. The exterior cap is the only surface
 * receiving artwork UVs; the interior and side faces intentionally use
 * neutral UVs and separate material groups.
 */
export function createPanelSolidGeometry(panel, bounds, boardAppearance = null) {
  const appearance = sanitizeBoardAppearance(boardAppearance, panel);
  const perimeter = roundedPerimeter(panel.width, panel.height, appearance.bevelRadiusMm);
  const halfThickness = appearance.thicknessMm / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const groups = [];

  const addVertex = (position, normal, uv) => {
    const index = positions.length / 3;
    positions.push(...position);
    normals.push(...normal);
    uvs.push(...uv);
    return index;
  };

  const addGroup = (start, count, materialIndex) => groups.push({ start, count, materialIndex });

  const frontCenter = addVertex([0, 0, halfThickness], [0, 0, 1], flatNetUv([0, 0], panel, bounds));
  const frontRing = perimeter.map((point) => addVertex(
    [point[0], point[1], halfThickness],
    [0, 0, 1],
    flatNetUv(point, panel, bounds),
  ));
  const frontStart = indices.length;
  for (let index = 0; index < frontRing.length; index += 1) {
    indices.push(frontCenter, frontRing[index], frontRing[(index + 1) % frontRing.length]);
  }
  addGroup(frontStart, indices.length - frontStart, 0);

  const backCenter = addVertex([0, 0, -halfThickness], [0, 0, -1], [0, 0]);
  const backRing = perimeter.map((point) => addVertex(
    [point[0], point[1], -halfThickness],
    [0, 0, -1],
    [0, 0],
  ));
  const backStart = indices.length;
  for (let index = 0; index < backRing.length; index += 1) {
    indices.push(backCenter, backRing[(index + 1) % backRing.length], backRing[index]);
  }
  addGroup(backStart, indices.length - backStart, 1);

  const sideStart = indices.length;
  for (let index = 0; index < perimeter.length; index += 1) {
    const next = (index + 1) % perimeter.length;
    const current = perimeter[index];
    const following = perimeter[next];
    const edge = new Vector3(following[0] - current[0], following[1] - current[1], 0).normalize();
    const normal = [edge.y, -edge.x, 0];
    const a = addVertex([current[0], current[1], halfThickness], normal, [0, 0]);
    const b = addVertex([following[0], following[1], halfThickness], normal, [0, 0]);
    const c = addVertex([following[0], following[1], -halfThickness], normal, [0, 0]);
    const d = addVertex([current[0], current[1], -halfThickness], normal, [0, 0]);
    indices.push(a, b, c, a, c, d);
  }
  addGroup(sideStart, indices.length - sideStart, 2);

  const geometry = new BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
