import {
  BufferGeometry,
  Float32BufferAttribute,
} from 'three';

export function getPanelVertexData(panel, bounds) {
  const x0 = panel.x;
  const y0 = panel.y;
  const x1 = panel.x + panel.width;
  const y1 = panel.y + panel.height;
  const u0 = (x0 - bounds.minX) / bounds.width;
  const u1 = (x1 - bounds.minX) / bounds.width;
  const v0 = 1 - (y0 - bounds.minY) / bounds.height;
  const v1 = 1 - (y1 - bounds.minY) / bounds.height;
  const halfWidth = panel.width / 2;
  const halfHeight = panel.height / 2;

  return {
    positions: [
      -halfWidth, -halfHeight, 0,
      halfWidth, -halfHeight, 0,
      halfWidth, halfHeight, 0,
      -halfWidth, halfHeight, 0,
    ],
    normals: [
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ],
    uvs: [
      u0, v1,
      u1, v1,
      u1, v0,
      u0, v0,
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

export function createPanelGeometry(panel, bounds) {
  const data = getPanelVertexData(panel, bounds);
  const geometry = new BufferGeometry();
  geometry.setIndex(data.indices);
  geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

export function getPanelOutlinePoints(panel, zOffset = 0.12) {
  const halfWidth = panel.width / 2;
  const halfHeight = panel.height / 2;
  return [
    -halfWidth, -halfHeight, zOffset,
    halfWidth, -halfHeight, zOffset,
    halfWidth, halfHeight, zOffset,
    -halfWidth, halfHeight, zOffset,
  ];
}
