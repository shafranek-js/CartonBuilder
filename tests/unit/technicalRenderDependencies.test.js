import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  createTechnicalFoldRuntime,
  resolveTechnicalRenderBounds,
} from '../../src/render/technicalRenderDependencies.js';

describe('technicalRenderDependencies', () => {
  it('creates an empty vendored Viewer runtime with the required API and idempotent disposal', () => {
    const runtime = createTechnicalFoldRuntime({
      svgText: '<svg data-must-not-be-loaded="true" />',
    });

    expect(runtime.getModel()).toBeNull();
    expect(runtime).toEqual(expect.objectContaining({
      loadSemanticSvgText: expect.any(Function),
      setFoldProgress: expect.any(Function),
      setArtworkAtlas: expect.any(Function),
      getModel: expect.any(Function),
      dispose: expect.any(Function),
    }));
    expect(() => runtime.dispose()).not.toThrow();
    expect(() => runtime.dispose()).not.toThrow();
  });

  it('resolves translated Viewer runtime metre geometry without changing source transforms', () => {
    const model = new Group();
    const mesh = new Mesh(
      new BoxGeometry(0.2, 0.1, 0.05),
      new MeshBasicMaterial(),
    );
    model.add(mesh);
    model.position.set(1, 2, 3);

    const sourceScale = model.scale.clone();
    const sourcePosition = model.position.clone();
    const sourceGeometry = Array.from(mesh.geometry.attributes.position.array);

    const bounds = resolveTechnicalRenderBounds({ model });

    expect(bounds.minX).toBeCloseTo(0.9, 7);
    expect(bounds.minY).toBeCloseTo(1.95, 7);
    expect(bounds.minZ).toBeCloseTo(2.975, 7);
    expect(bounds.maxX).toBeCloseTo(1.1, 7);
    expect(bounds.maxY).toBeCloseTo(2.05, 7);
    expect(bounds.maxZ).toBeCloseTo(3.025, 7);
    expect(bounds.width).toBeCloseTo(0.2, 7);
    expect(bounds.height).toBeCloseTo(0.1, 7);
    expect(bounds.depth).toBeCloseTo(0.05, 7);
    expect(bounds.centerX).toBeCloseTo(1, 7);
    expect(bounds.centerY).toBeCloseTo(2, 7);
    expect(bounds.centerZ).toBeCloseTo(3, 7);
    expect(bounds.units).toBe('m');
    expect(bounds.radius).toBeCloseTo(Math.sqrt(0.2 ** 2 + 0.1 ** 2 + 0.05 ** 2) / 2, 7);
    expect(model.scale).toEqual(sourceScale);
    expect(model.position).toEqual(sourcePosition);
    expect(Array.from(mesh.geometry.attributes.position.array)).toEqual(sourceGeometry);
  });

  it('fails closed for missing, empty, and non-numeric bounds dependencies', () => {
    expect(() => resolveTechnicalRenderBounds()).toThrow(/model.*updateMatrixWorld/i);
    expect(() => resolveTechnicalRenderBounds({ model: {} })).toThrow(/model.*updateMatrixWorld/i);
    expect(() => resolveTechnicalRenderBounds({ model: new Group() })).toThrow(/empty/i);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([Number.NaN, 0, 0], 3));
    const model = new Mesh(geometry, new MeshBasicMaterial());
    expect(() => resolveTechnicalRenderBounds({ model })).toThrow(/finite numeric/i);
  });
});
