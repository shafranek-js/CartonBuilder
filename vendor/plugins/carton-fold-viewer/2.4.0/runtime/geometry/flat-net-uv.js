import * as THREE from 'three';

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid flat-net UV ${label}: ${value}`);
  return number;
}

function readViewBox(source) {
  const values = Array.isArray(source)
    ? source
    : String(source || '').trim().split(/[\s,]+/).filter(Boolean);
  if (values.length !== 4) return null;
  const viewBox = values.map((value, index) => finiteNumber(value, `viewBox[${index}]`));
  if (!(viewBox[2] > 0) || !(viewBox[3] > 0)) throw new Error('Invalid flat-net UV viewBox dimensions');
  return viewBox;
}

/**
 * Build the single affine map from canonical svgXY millimetres to flat-net UV.
 * SVG viewBox Y grows down; svgXY already converts model coordinates to Y-up,
 * so the canonical Y bounds are [-(y + height), -y].
 */
export function createFlatNetUvMapper(canvasOrMetadata) {
  const canvas = canvasOrMetadata?.canvas || canvasOrMetadata || {};
  const viewBox = readViewBox(canvas.viewBox);
  if (!viewBox) throw new Error('Canonical flat-net UV requires metadata.canvas.viewBox');

  const [x, y, width, height] = viewBox;
  const canonicalBounds = {
    minX: x,
    minY: -(y + height),
    width,
    height
  };

  const mapPoint = (pointMm) => {
    const px = finiteNumber(pointMm?.[0], 'point.x');
    const py = finiteNumber(pointMm?.[1], 'point.y');
    return [
      (px - canonicalBounds.minX) / canonicalBounds.width,
      (py - canonicalBounds.minY) / canonicalBounds.height
    ];
  };

  return {
    viewBox: [...viewBox],
    canonicalBounds,
    mapPoint,
    mapPositionAttribute(position, originMm = [0, 0]) {
      if (!position?.count) return new Float32Array();
      const originX = finiteNumber(originMm[0], 'origin.x');
      const originY = finiteNumber(originMm[1], 'origin.y');
      const uv = new Float32Array(position.count * 2);
      for (let index = 0; index < position.count; index++) {
        const mapped = mapPoint([
          originX + position.getX(index) * 1000,
          originY + position.getY(index) * 1000
        ]);
        uv[index * 2] = mapped[0];
        uv[index * 2 + 1] = mapped[1];
      }
      return uv;
    }
  };
}

export function applyFlatNetUv(geometry, mapper, originMm = [0, 0]) {
  if (!geometry?.attributes?.position) throw new Error('Flat-net UV requires a position attribute');
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(mapper.mapPositionAttribute(geometry.attributes.position, originMm), 2)
  );
  return geometry;
}
