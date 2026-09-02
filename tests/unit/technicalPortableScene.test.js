import {
  BoxGeometry,
  DirectionalLight,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
} from 'three';
import { describe, expect, it, vi } from 'vitest';

import { createTechnicalPortableScene } from '../../src/render/technicalPortableScene.js';

function createTechnicalContext() {
  const model = new Group();
  model.name = 'TechnicalRoot';
  model.userData = { source: 'runtime', schema: 'pbd.svg.v4' };

  const sharedGeometry = new BoxGeometry(0.2, 0.1, 0.05);
  sharedGeometry.clearGroups();
  sharedGeometry.addGroup(0, 12, 0);
  sharedGeometry.addGroup(12, 24, 1);
  const sharedTexture = new Texture({ id: 'artwork-image' });
  const sharedMaterial = new MeshPhysicalMaterial({
    color: 0xe8d4b8,
    map: sharedTexture,
    normalMap: sharedTexture,
    roughness: 0.35,
    metalness: 0.1,
  });

  const panel = new Mesh(sharedGeometry, [sharedMaterial, new MeshStandardMaterial({ color: 0xffffff })]);
  panel.name = 'Panel Front__mesh';
  panel.userData = { panel_id: 'panel-front', semantic_role: 'panel' };
  const crease = new Mesh(sharedGeometry, sharedMaterial);
  crease.name = 'crease__fold-1';
  crease.userData = {
    fold_id: 'fold-1',
    semantic_role: 'finite-crease-zone',
  };
  const outline = new LineLoop(undefined, new LineBasicMaterial({ color: 0xff0000 }));
  outline.name = 'outline-helper';
  const light = new DirectionalLight(0xffffff, 1);
  model.add(panel, crease, outline, light);

  const camera = new PerspectiveCamera(45, 2, 0.01, 1000);
  camera.name = 'Technical Camera';
  camera.position.set(1, 2, 3);
  camera.scale.set(2, 3, 4);

  return {
    model,
    sharedGeometry,
    sharedMaterial,
    sharedTexture,
    panel,
    crease,
    camera,
    renderSurface: { camera },
    runtimeResult: { parsed: { sourceSchema: 'pbd.svg.v4', cartonType: 'generic' } },
    foldGraph: { 'fold-1': { foldId: 'fold-1' } },
  };
}

describe('createTechnicalPortableScene', () => {
  it('creates an export-owned hierarchy with preserved metadata, scale, groups, normals, and shared clones', () => {
    const context = createTechnicalContext();
    const portable = createTechnicalPortableScene(context);
    const portableModel = portable.scene.children.find((child) => child.name === 'TechnicalRoot');
    const portablePanel = portableModel.getObjectByName('Panel Front__mesh');
    const portableCrease = portableModel.getObjectByName('crease__fold-1');

    expect(portable.scene).toBeInstanceOf(Scene);
    expect(portable.scene).not.toBe(context.model);
    expect(portableModel).not.toBe(context.model);
    expect(context.model.scale.toArray()).toEqual([1, 1, 1]);
    expect(portableModel.scale.toArray()).toEqual([1, 1, 1]);
    expect(portablePanel.name).toBe(context.panel.name);
    expect(portablePanel.userData).toEqual(context.panel.userData);
    expect(portableCrease.name).toBe(context.crease.name);
    expect(portableCrease.userData).toEqual(context.crease.userData);
    expect(portablePanel.geometry).not.toBe(context.sharedGeometry);
    expect(portableCrease.geometry).toBe(portablePanel.geometry);
    expect(portablePanel.geometry.groups).toEqual(context.sharedGeometry.groups);
    expect(portablePanel.geometry.getAttribute('normal')).not.toBe(
      context.sharedGeometry.getAttribute('normal'),
    );
    expect(portablePanel.material[0]).not.toBe(context.sharedMaterial);
    expect(portableCrease.material).toBe(portablePanel.material[0]);
    expect(portablePanel.material[0].map).not.toBe(context.sharedTexture);
    expect(portablePanel.material[0].normalMap).toBe(portablePanel.material[0].map);
    expect(portable.scene.getObjectByName('outline-helper')).toBeUndefined();
    expect(portable.scene.userData.cartonBuilder).toEqual({
      source: 'technical',
      sourceUnit: 'mm',
      exportUnit: 'm',
      foldProgress: 1,
      static: true,
      materialMode: 'full-pbr',
    });
  });

  it('converts Physical materials for basic compatibility without touching the live model', () => {
    const context = createTechnicalContext();
    const portable = createTechnicalPortableScene({
      ...context,
      options: { materialMode: 'basic-compatibility', includeCamera: false },
    });
    const portablePanel = portable.scene.getObjectByName('Panel Front__mesh');

    expect(portablePanel.material[0]).toBeInstanceOf(MeshStandardMaterial);
    expect(portablePanel.material[0].isMeshPhysicalMaterial).not.toBe(true);
    expect(context.panel.material[0]).toBe(context.sharedMaterial);
    expect(context.panel.material[0].isMeshPhysicalMaterial).toBe(true);
    expect(portable.scene.userData.cartonBuilder.materialMode).toBe('basic-compatibility');
    expect(portable.scene.getObjectByName('Technical Camera')).toBeUndefined();
  });

  it('includes the camera without applying a second unit conversion', () => {
    const context = createTechnicalContext();
    const portable = createTechnicalPortableScene({
      ...context,
      options: { includeCamera: true },
    });
    const portableCamera = portable.scene.getObjectByName('Technical Camera');

    expect(portableCamera).toBeInstanceOf(PerspectiveCamera);
    expect(portableCamera).not.toBe(context.camera);
    expect(portableCamera.position.toArray()).toEqual(context.camera.position.toArray());
    expect(portableCamera.scale.toArray()).toEqual(context.camera.scale.toArray());
  });

  it('disposes owned resources once and leaves live resources usable', () => {
    const context = createTechnicalContext();
    const portable = createTechnicalPortableScene(context);
    const portablePanel = portable.scene.getObjectByName('Panel Front__mesh');
    const portableGeometryDispose = vi.spyOn(portablePanel.geometry, 'dispose');
    const portableMaterialDispose = vi.spyOn(portablePanel.material[0], 'dispose');
    const portableTextureDispose = vi.spyOn(portablePanel.material[0].map, 'dispose');
    const liveGeometryDispose = vi.spyOn(context.sharedGeometry, 'dispose');
    const liveMaterialDispose = vi.spyOn(context.sharedMaterial, 'dispose');
    const liveTextureDispose = vi.spyOn(context.sharedTexture, 'dispose');

    expect(portable.dispose()).toBe(true);
    expect(portable.dispose()).toBe(false);
    expect(portableGeometryDispose).toHaveBeenCalledTimes(1);
    expect(portableMaterialDispose).toHaveBeenCalledTimes(1);
    expect(portableTextureDispose).toHaveBeenCalledTimes(1);
    expect(liveGeometryDispose).not.toHaveBeenCalled();
    expect(liveMaterialDispose).not.toHaveBeenCalled();
    expect(liveTextureDispose).not.toHaveBeenCalled();
  });

  it('rejects an invalid model or factory context fail-closed', () => {
    const context = createTechnicalContext();

    expect(() => createTechnicalPortableScene()).toThrow(/Object3D model/i);
    expect(() => createTechnicalPortableScene({
      ...context,
      renderSurface: null,
    })).toThrow(/render surface context/i);
    expect(() => createTechnicalPortableScene({
      ...context,
      renderSurface: {},
    })).toThrow(/camera/i);
    expect(() => createTechnicalPortableScene({
      ...context,
      renderSurface: { camera: new Group() },
    })).toThrow(/camera/i);
  });
});
