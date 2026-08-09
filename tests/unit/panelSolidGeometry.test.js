import { describe, expect, it } from 'vitest';
import {
  BackSide,
  FrontSide,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Vector3,
} from 'three';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { createPanelSolidGeometry } from '../../src/render/panelSolidGeometry.js';
import { getInteriorMaterialSide } from '../../src/preview3d/BoxScene.js';
import { getPanelVertexData } from '../../src/preview3d/panelGeometry.js';

describe('panelSolidGeometry', () => {
  it('creates exterior, interior and edge groups with thickness', () => {
    const model = new BoxNetModel();
    model.addPanel('front', 'bottom');
    const panel = model.getPanels()[0];
    const geometry = createPanelSolidGeometry(panel, { widthMm: 120, heightMm: 80 }, {
      thicknessMm: 0.4,
      bevelRadiusMm: 0.1,
    });
    expect(geometry.getAttribute('position').count).toBeGreaterThan(8);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2]);
    expect(geometry.getAttribute('uv').count).toBe(geometry.getAttribute('position').count);
    expect(geometry.boundingBox.min.z).toBeCloseTo(-0.2);
    expect(geometry.boundingBox.max.z).toBeCloseTo(0.2);
    geometry.dispose();
  });

  it('keeps exterior UV orientation aligned with the flat Preview panel', () => {
    const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
    const panel = model.getPanel('front');
    const bounds = model.getBounds();
    const geometry = createPanelSolidGeometry(panel, bounds, { thicknessMm: 0.4, bevelRadiusMm: 0 });
    const previewData = getPanelVertexData(panel, bounds);
    const uv = geometry.getAttribute('uv');

    for (let index = 0; index < 4; index += 1) {
      expect(uv.getX(index + 1)).toBeCloseTo(previewData.uvs[index * 2], 8);
      expect(uv.getY(index + 1)).toBeCloseTo(previewData.uvs[index * 2 + 1], 8);
    }
    geometry.dispose();
  });

  it('caps bevel at 45 percent of caliper for thickness-safe edges', () => {
    const model = new BoxNetModel({ width: 20, height: 20, depth: 20 });
    const geometry = createPanelSolidGeometry(model.getPanel('front'), model.getBounds(), {
      thicknessMm: 0.4,
      bevelRadiusMm: 4,
    });
    expect(geometry.boundingBox.max.x).toBeCloseTo(10, 5);
    expect(geometry.boundingBox.min.x).toBeCloseTo(-10, 5);
    expect(geometry.getAttribute('position').count).toBeGreaterThan(8);
    geometry.dispose();
  });

  it('renders the reversed solid interior cap from the interior side', () => {
    const model = new BoxNetModel({ width: 100, height: 60, depth: 30 });
    const geometry = createPanelSolidGeometry(model.getPanel('front'), model.getBounds(), {
      thicknessMm: 1,
      bevelRadiusMm: 0,
    });
    const materials = [
      new MeshStandardMaterial({ side: FrontSide }),
      new MeshStandardMaterial({ side: getInteriorMaterialSide('solid') }),
      new MeshStandardMaterial({ side: FrontSide }),
    ];
    const mesh = new Mesh(geometry, materials);
    mesh.updateMatrixWorld(true);

    const interiorHits = new Raycaster(
      new Vector3(0, 0, -10),
      new Vector3(0, 0, 1),
    ).intersectObject(mesh, false);
    const exteriorHits = new Raycaster(
      new Vector3(0, 0, 10),
      new Vector3(0, 0, -1),
    ).intersectObject(mesh, false);

    expect(getInteriorMaterialSide('flat')).toBe(BackSide);
    expect(getInteriorMaterialSide('solid')).toBe(FrontSide);
    expect(interiorHits.some((hit) => hit.face.materialIndex === 1)).toBe(true);
    expect(exteriorHits.some((hit) => hit.face.materialIndex === 0)).toBe(true);

    materials.forEach((material) => material.dispose());
    geometry.dispose();
  });

  it('keeps every solid triangle non-degenerate with cap normals facing outward', () => {
    const model = new BoxNetModel({ width: 100, height: 60, depth: 30 });
    const geometry = createPanelSolidGeometry(model.getPanel('front'), model.getBounds(), {
      thicknessMm: 0.8,
      bevelRadiusMm: 0.1,
    });
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const index = geometry.getIndex();

    for (let offset = 0; offset < index.count; offset += 3) {
      const a = new Vector3().fromBufferAttribute(position, index.getX(offset));
      const b = new Vector3().fromBufferAttribute(position, index.getX(offset + 1));
      const c = new Vector3().fromBufferAttribute(position, index.getX(offset + 2));
      expect(new Vector3().crossVectors(b.sub(a), c.sub(a)).lengthSq()).toBeGreaterThan(1e-10);
    }
    expect(normal.getZ(0)).toBe(1);
    const interiorStart = geometry.groups.find((group) => group.materialIndex === 1).start;
    expect(normal.getZ(index.getX(interiorStart))).toBe(-1);
    geometry.dispose();
  });
});
