import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Texture,
} from 'three';

import { TechnicalRenderMaterialController } from '../../src/render/TechnicalRenderMaterialController.js';

function makeTechnicalScene() {
  const model = new Group();
  const panelGeometry = new BoxGeometry(1, 1, 0.1);
  const creaseGeometry = new BoxGeometry(1, 0.05, 0.02);
  const texture = new Texture();
  texture.dispose = vi.fn(texture.dispose.bind(texture));

  const outer = new MeshStandardMaterial({ color: '#cc8844', roughness: 0.61 });
  outer.name = 'front_outer_paper';
  outer.userData = { semanticMaterialSlot: 'outside-artwork' };
  outer.side = DoubleSide;
  outer.transparent = true;
  outer.opacity = 0.82;
  outer.map = texture;
  outer.alphaMap = texture;
  outer.normalMap = texture;
  outer.roughnessMap = texture;
  outer.metalnessMap = texture;
  outer.clearcoatMap = texture;
  outer.clearcoatRoughnessMap = texture;
  outer.dispose = vi.fn(outer.dispose.bind(outer));

  const inner = new MeshStandardMaterial({ color: '#eeeeee', roughness: 0.8 });
  inner.name = 'front_inner_paper';
  inner.dispose = vi.fn(inner.dispose.bind(inner));

  const edge = new MeshStandardMaterial({ color: '#dddddd', roughness: 0.9 });
  edge.name = 'front_edge';
  edge.dispose = vi.fn(edge.dispose.bind(edge));

  const panel = new Mesh(panelGeometry, [outer, inner, edge]);
  panel.name = 'panel-front';
  panel.userData = {
    panel_id: 'panel-front',
    artwork_surface: true,
    artwork_surface_type: 'panel',
  };

  const creaseMaterial = new MeshPhysicalMaterial({ color: '#bbbbbb', roughness: 0.7 });
  creaseMaterial.name = 'crease_outer_paper';
  creaseMaterial.dispose = vi.fn(creaseMaterial.dispose.bind(creaseMaterial));
  const crease = new Mesh(creaseGeometry, creaseMaterial);
  crease.name = 'crease_fold-1';
  crease.userData = {
    fold_id: 'fold-1',
    artwork_surface: true,
    artwork_surface_type: 'crease',
  };

  model.add(panel, crease);
  const foldGraph = { id: 'fold-graph' };
  const source = {
    model,
    foldGraph,
    getDiagnostics: vi.fn(() => ({ source: 'technical', built: true })),
    dispose: vi.fn(),
  };
  return {
    model,
    panel,
    crease,
    outer,
    inner,
    edge,
    creaseMaterial,
    panelGeometry,
    creaseGeometry,
    texture,
    foldGraph,
    source,
  };
}

function makeController(scene) {
  const sourceProvider = vi.fn(() => scene.source);
  return {
    controller: new TechnicalRenderMaterialController({ sourceProvider }),
    sourceProvider,
  };
}

describe('TechnicalRenderMaterialController', () => {
  it('requires a source provider and fails closed for non-Technical or unbuilt sources', () => {
    expect(() => new TechnicalRenderMaterialController()).toThrow('sourceProvider()');

    const quickController = new TechnicalRenderMaterialController({
      sourceProvider: () => ({
        model: new Group(),
        getDiagnostics: () => ({ source: 'quick' }),
      }),
    });
    expect(() => quickController.setMaterialProfile('matte'))
      .toThrow('built TechnicalRenderSceneSource');

    const incompleteController = new TechnicalRenderMaterialController({
      sourceProvider: () => ({
        getDiagnostics: () => ({ source: 'technical' }),
        model: null,
      }),
    });
    expect(() => incompleteController.setBoardAppearance({})).toThrow('built TechnicalRenderSceneSource');
  });

  it('applies all three profiles without rendering and preserves the Technical model structure', () => {
    const scene = makeTechnicalScene();
    const { controller, sourceProvider } = makeController(scene);
    const originalPanelMaterials = [...scene.panel.material];
    const originalChildren = [...scene.model.children];
    const originalPanelUserData = scene.panel.userData;
    const originalCreaseUserData = scene.crease.userData;
    const originalPanelGeometry = scene.panel.geometry;
    const originalFoldGraph = scene.foldGraph;

    expect(sourceProvider).not.toHaveBeenCalled();
    expect(controller.setMaterialProfile('uncoated')).toBe(true);
    expect(controller.setMaterialProfile('matte')).toBe(true);
    expect(controller.setMaterialProfile('gloss')).toBe(true);
    expect(controller.setMaterialProfile('matte')).toBe(true);
    expect(controller.setMaterialProfile('gloss')).toBe(true);

    expect(scene.panel.geometry).toBe(originalPanelGeometry);
    expect(scene.panel.material[0]).not.toBe(originalPanelMaterials[0]);
    expect(scene.panel.material[0]).toBeInstanceOf(MeshPhysicalMaterial);
    expect(scene.panel.material[0].name).toBe(originalPanelMaterials[0].name);
    expect(scene.panel.material[0].userData).toBe(originalPanelMaterials[0].userData);
    expect(scene.panel.material[0].side).toBe(originalPanelMaterials[0].side);
    expect(scene.panel.material[0].transparent).toBe(true);
    for (const key of [
      'map',
      'alphaMap',
      'normalMap',
      'roughnessMap',
      'metalnessMap',
      'clearcoatMap',
      'clearcoatRoughnessMap',
    ]) {
      expect(scene.panel.material[0][key]).toBe(scene.texture);
    }
    expect(originalPanelMaterials[0].dispose).toHaveBeenCalledTimes(1);
    expect(scene.model.children).toEqual(originalChildren);
    expect(scene.panel.userData).toBe(originalPanelUserData);
    expect(scene.crease.userData).toBe(originalCreaseUserData);
    expect(scene.foldGraph).toBe(originalFoldGraph);
    expect(sourceProvider).toHaveBeenCalledTimes(5);
    expect(controller.getDiagnostics()).toMatchObject({
      source: 'technical',
      profile: 'gloss',
    });
  });

  it('classifies outside, interior, edge and crease slots and applies board colors only to board surfaces', () => {
    const scene = makeTechnicalScene();
    const { controller } = makeController(scene);
    const outerColor = scene.outer.color.getHex();
    const creaseColor = scene.creaseMaterial.color.getHex();
    const geometry = scene.panel.geometry;

    expect(controller.setBoardAppearance({
      thicknessMm: 1.4,
      bevelRadiusMm: 0.4,
      interiorColor: '#112233',
      edgeColor: '#445566',
    })).toBe(true);

    expect(scene.inner.color.getHexString()).toBe('112233');
    expect(scene.edge.color.getHexString()).toBe('445566');
    expect(scene.outer.color.getHex()).toBe(outerColor);
    expect(scene.creaseMaterial.color.getHex()).toBe(creaseColor);
    expect(scene.panel.geometry).toBe(geometry);
    expect(controller.getDiagnostics().materialClassCounts).toMatchObject({
      outsideArtwork: 1,
      interior: 1,
      edge: 1,
      creaseArtwork: 1,
    });
  });

  it('rolls back prepared profile changes when one Technical material rejects the update', () => {
    const scene = makeTechnicalScene();
    Object.defineProperty(scene.creaseMaterial, 'roughness', {
      configurable: true,
      get: () => 0.7,
      set: () => { throw new Error('crease profile failed'); },
    });
    const { controller } = makeController(scene);
    const originalMaterials = [...scene.panel.material];

    expect(() => controller.setMaterialProfile('gloss')).toThrow('crease profile failed');
    expect(scene.panel.material).toEqual(originalMaterials);
    expect(scene.outer.dispose).not.toHaveBeenCalled();
    expect(controller.getDiagnostics().profile).toBe('matte');
  });

  it('rolls back board colors atomically when an interior/edge material rejects a color', () => {
    const scene = makeTechnicalScene();
    const originalInnerColor = scene.inner.color.clone();
    const originalSet = scene.edge.color.set.bind(scene.edge.color);
    scene.edge.color.set = () => { throw new Error('edge color failed'); };
    const { controller } = makeController(scene);

    expect(() => controller.setBoardAppearance({
      interiorColor: '#112233',
      edgeColor: '#445566',
    })).toThrow('edge color failed');
    expect(scene.inner.color.getHex()).toBe(originalInnerColor.getHex());
    scene.edge.color.set = originalSet;
  });

  it('disposes controller-owned replacement materials once without touching runtime textures or source', () => {
    const scene = makeTechnicalScene();
    const { controller } = makeController(scene);
    controller.setMaterialProfile('gloss');
    const physical = scene.panel.material[0];
    const physicalDispose = vi.spyOn(physical, 'dispose');
    const textureDispose = scene.texture.dispose;

    expect(controller.dispose()).toBe(true);
    expect(controller.dispose()).toBe(false);
    expect(physicalDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).not.toHaveBeenCalled();
    expect(scene.source.dispose).not.toHaveBeenCalled();
    expect(controller.getDiagnostics()).toMatchObject({ disposed: true, ownedMaterialCount: 0 });
  });
});
