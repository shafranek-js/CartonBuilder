import { describe, expect, it, vi } from 'vitest';

import { LegacyRenderSceneSource } from '../../src/render/LegacyRenderSceneSource.js';
import { RenderSceneSource } from '../../src/render/RenderSceneSource.js';

function fakeBoxScene() {
  const scene = { id: 'scene' };
  const camera = { id: 'perspective-camera' };
  const renderer = { id: 'webgl-renderer' };
  const geometry = { id: 'box-geometry' };
  const replaceTexture = vi.fn();
  const dispose = vi.fn();
  return {
    scene,
    camera,
    renderer,
    container: { id: 'render-panel' },
    geometryMode: 'solid',
    environmentAsset: null,
    environmentMap: { presetId: 'studio' },
    boxModel: { getBounds: () => ({ minX: 0, minY: 0, width: 100, height: 80 }) },
    replaceTexture,
    dispose,
    setToneMapping: vi.fn(),
    getResourceInfo: vi.fn(() => ({ panels: 6, geometries: 6, textures: 1 })),
    createPortableScene: vi.fn(() => ({ scene: { id: 'portable' }, dispose: vi.fn() })),
    geometry,
  };
}

describe('RenderSceneSource', () => {
  it('is an abstract contract and exposes the required method names', () => {
    expect(() => new RenderSceneSource()).toThrow('abstract contract');
    expect(RenderSceneSource.prototype.getRenderSurface).toBeTypeOf('function');
    expect(RenderSceneSource.prototype.buildScene).toBeTypeOf('function');
    expect(RenderSceneSource.prototype.replaceArtwork).toBeTypeOf('function');
    expect(RenderSceneSource.prototype.createPortableScene).toBeTypeOf('function');
    expect(RenderSceneSource.prototype.getDiagnostics).toBeTypeOf('function');
    expect(RenderSceneSource.prototype.dispose).toBeTypeOf('function');
  });

  it('adapts the existing BoxScene surface and preserves resource identity', () => {
    const boxScene = fakeBoxScene();
    const source = new LegacyRenderSceneSource({ boxScene });
    const surface = source.getRenderSurface();

    expect(source.buildScene()).toBe(surface);
    expect(surface.scene).toBe(boxScene.scene);
    expect(surface.camera).toBe(boxScene.camera);
    expect(surface.renderer).toBe(boxScene.renderer);
    expect(source.geometryMode).toBe('solid');
    expect(source.getBounds()).toEqual({ minX: 0, minY: 0, width: 100, height: 80 });

    source.replaceArtwork('atlas-canvas', { normal: 'normal-map' });
    expect(boxScene.replaceTexture).toHaveBeenCalledWith('atlas-canvas', { normal: 'normal-map' });
    expect(source.getDiagnostics()).toEqual({ panels: 6, geometries: 6, textures: 1 });
    expect(source.createPortableScene()).toEqual({ scene: { id: 'portable' }, dispose: expect.any(Function) });

    boxScene.camera = { id: 'orthographic-camera' };
    expect(surface.camera).toBe(boxScene.camera);
    expect(surface.scene).toBe(boxScene.scene);

    expect(source.dispose()).toBe(true);
    expect(source.dispose()).toBe(false);
    expect(boxScene.dispose).toHaveBeenCalledTimes(1);
  });
});
