import { describe, expect, it, vi } from 'vitest';

import { RenderSceneSource } from '../../src/render/RenderSceneSource.js';
import { TechnicalRenderSceneSource } from '../../src/render/TechnicalRenderSceneSource.js';

function createScene() {
  const children = [];
  const scene = {
    children,
    add: vi.fn((model) => {
      children.push(model);
      model.parent = scene;
    }),
    remove: vi.fn((model) => {
      const index = children.indexOf(model);
      if (index >= 0) children.splice(index, 1);
      if (model.parent === scene) model.parent = null;
    }),
  };
  return scene;
}

function createModel(id = 'technical-model') {
  const scale = {
    value: 1,
    setScalar: vi.fn((value) => { scale.value = value; }),
  };
  return {
    id,
    scale,
    updateMatrixWorld: vi.fn(),
    parent: null,
  };
}

function createRuntime(model = createModel()) {
  const folds = {
    'fold-1': {
      foldId: 'fold-1',
      parentPanelId: 'panel-root',
      childPanelId: 'panel-child',
      targetAngleDeg: 90,
    },
  };
  return {
    model,
    loadSemanticSvgText: vi.fn(() => ({
      model,
      animations: [],
      parsed: { folds, rootId: 'panel-root' },
    })),
    setFoldProgress: vi.fn(),
    setArtworkAtlas: vi.fn(),
    dispose: vi.fn(),
  };
}

function createSource({
  runtime = createRuntime(),
  scene = createScene(),
  boundsResolver = () => ({ minX: 0, minY: 0, maxX: 0.24, maxY: 0.12, width: 0.24, height: 0.12, units: 'm' }),
  ...options
} = {}) {
  const renderSurface = { scene, camera: { id: 'camera' }, renderer: { id: 'renderer' } };
  return {
    source: new TechnicalRenderSceneSource({ runtime, renderSurface, boundsResolver, ...options }),
    runtime,
    renderSurface,
    scene,
  };
}

const CANONICAL_SVG = '<svg data-canonical="true" />';
const ARTWORK_ATLAS = { id: 'atlas' };

describe('TechnicalRenderSceneSource', () => {
  it('requires injected runtime and render surface dependencies', () => {
    expect(() => new TechnicalRenderSceneSource()).toThrow(/runtime/);

    const runtime = createRuntime();
    expect(() => new TechnicalRenderSceneSource({ runtime })).toThrow(/render surface/);
    expect(() => new TechnicalRenderSceneSource({ renderSurface: { scene: createScene() } })).toThrow(/runtime/);
  });

  it('loads semantic SVG, folds to 100%, preserves the runtime metre scale, and keeps the input unchanged', () => {
    const bundle = { semanticSvg: { markup: CANONICAL_SVG, units: 'mm' }, modelJson: { text: '{"canonical":true}' } };
    const before = structuredClone(bundle);
    const { source, runtime, renderSurface, scene } = createSource();

    expect(source).toBeInstanceOf(RenderSceneSource);
    expect(source.buildScene({ bundle, artworkAtlas: ARTWORK_ATLAS, maps: { alpha: { id: 'alpha' } }, name: 'rte.svg' }))
      .toBe(renderSurface);

    expect(runtime.loadSemanticSvgText).toHaveBeenCalledWith(CANONICAL_SVG, 'rte.svg');
    expect(runtime.setFoldProgress).toHaveBeenCalledWith(1);
    expect(runtime.setArtworkAtlas).toHaveBeenCalledWith(
      ARTWORK_ATLAS,
      { alpha: { id: 'alpha' } },
    );
    expect(runtime.model.scale.setScalar).not.toHaveBeenCalled();
    expect(runtime.model.scale.value).toBe(1);
    expect(scene.children).toEqual([runtime.model]);
    expect(bundle).toEqual(before);
    expect(source.getRenderSurface()).toBe(renderSurface);
    expect(source.getDiagnostics()).toMatchObject({
      source: 'technical',
      built: true,
      disposed: false,
      foldProgress: 1,
      sourceUnits: 'mm',
      renderUnits: 'm',
      unitScale: 0.001,
    });
  });

  it('replaces artwork through the runtime without rebuilding model or fold graph', () => {
    const { source, runtime } = createSource();
    source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS });
    const model = source.model;
    const foldGraph = source.foldGraph;
    runtime.loadSemanticSvgText.mockClear();
    runtime.setFoldProgress.mockClear();
    runtime.setArtworkAtlas.mockClear();

    const nextAtlas = { id: 'next-atlas' };
    expect(source.replaceArtwork(nextAtlas, { normal: { id: 'normal' } })).toBeUndefined();

    expect(runtime.setArtworkAtlas).toHaveBeenCalledTimes(1);
    expect(runtime.setArtworkAtlas).toHaveBeenCalledWith(nextAtlas, { normal: { id: 'normal' } });
    expect(runtime.loadSemanticSvgText).not.toHaveBeenCalled();
    expect(runtime.setFoldProgress).not.toHaveBeenCalled();
    expect(source.model).toBe(model);
    expect(source.foldGraph).toBe(foldGraph);
  });

  it('delegates portable scene creation and keeps the renderer contract', () => {
    const portable = { scene: { id: 'portable-scene' }, dispose: vi.fn() };
    const portableSceneFactory = vi.fn(() => portable);
    const { source, renderSurface } = createSource({ portableSceneFactory });
    source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS });

    const options = { includeCamera: true, materialMode: 'full-pbr' };
    const portableWrapper = source.createPortableScene(options);
    expect(portableWrapper).not.toBe(portable);
    expect(portableWrapper.scene).toBe(portable.scene);
    expect(portableWrapper.dispose).toBeTypeOf('function');
    expect(portableSceneFactory).toHaveBeenCalledWith(expect.objectContaining({
      model: source.model,
      foldGraph: source.foldGraph,
      renderSurface,
      options,
    }));
    expect(portable.scene).toEqual({ id: 'portable-scene' });
  });

  it('delegates board appearance or fails closed without inventing compensation', () => {
    const appearance = { thicknessMm: 0.7, bevelRadiusMm: 0.2 };
    const { source } = createSource();
    expect(() => source.setBoardAppearance(appearance)).toThrow(/without an injected implementation/);

    const boardAppearanceSetter = vi.fn(() => 'delegated');
    const delegated = createSource({ boardAppearanceSetter }).source;
    expect(delegated.setBoardAppearance(appearance)).toBe('delegated');
    expect(boardAppearanceSetter).toHaveBeenCalledWith(appearance);
  });

  it('returns bounds normalized to metres', () => {
    const boundsResolver = vi.fn(() => ({
      minX: -50,
      minY: 20,
      maxX: 250,
      maxY: 120,
      width: 300,
      height: 100,
      units: 'mm',
    }));
    const { source } = createSource({ boundsResolver });
    source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS });

    expect(boundsResolver).toHaveBeenCalledWith(expect.objectContaining({
      model: source.model,
      semanticSvg: CANONICAL_SVG,
    }));
    expect(source.getBounds()).toEqual({
      minX: -0.05,
      minY: 0.02,
      maxX: 0.25,
      maxY: 0.12,
      width: 0.3,
      height: 0.1,
    });
  });

  it('disposes model, portable resources, and runtime exactly once', () => {
    const portable = { scene: { id: 'portable-scene' }, dispose: vi.fn() };
    const portableDispose = portable.dispose;
    const portableSceneFactory = vi.fn(() => portable);
    const { source, runtime, scene } = createSource({ portableSceneFactory });
    source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS });
    source.createPortableScene();
    const model = source.model;

    expect(source.dispose()).toBe(true);
    expect(source.dispose()).toBe(false);
    expect(scene.remove).toHaveBeenCalledWith(model);
    expect(portableDispose).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    expect(source.getDiagnostics()).toMatchObject({ built: false, disposed: true, foldProgress: null });
  });

  it('regression: failed rebuild clears state and disposes old and new runtime resources', () => {
    const portableDispose = vi.fn();
    const portableSceneFactory = vi.fn(() => ({ scene: { id: 'portable' }, dispose: portableDispose }));
    const { source, runtime, scene } = createSource({ portableSceneFactory });
    source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS });
    source.createPortableScene();

    runtime.loadSemanticSvgText.mockImplementationOnce(() => {
      throw new Error('reload failed');
    });

    expect(() => source.buildScene({ semanticSvg: '<svg data=\"replacement\" />', artworkAtlas: ARTWORK_ATLAS }))
      .toThrow('reload failed');
    expect(scene.children).toEqual([]);
    expect(portableDispose).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).toHaveBeenCalledTimes(2);
    expect(source.model).toBeNull();
    expect(source.foldGraph).toBeNull();
    expect(source.getBounds()).toBeNull();
    expect(source.getDiagnostics()).toMatchObject({
      built: false,
      disposed: false,
      foldProgress: null,
    });
  });

  it('regression: successful rebuild disposes old portable scene before replacing geometry', () => {
    const firstPortableDispose = vi.fn();
    const secondPortableDispose = vi.fn();
    const portableSceneFactory = vi.fn()
      .mockReturnValueOnce({ scene: { id: 'first-portable' }, dispose: firstPortableDispose })
      .mockReturnValueOnce({ scene: { id: 'second-portable' }, dispose: secondPortableDispose });
    const secondModel = createModel('second-model');
    const secondFolds = {
      'fold-2': {
        foldId: 'fold-2',
        parentPanelId: 'second-root',
        childPanelId: 'second-child',
        targetAngleDeg: 90,
      },
    };
    const { source, runtime, scene } = createSource({ portableSceneFactory });
    source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS });
    source.createPortableScene();
    runtime.loadSemanticSvgText.mockImplementationOnce(() => ({
      model: secondModel,
      animations: [],
      parsed: { folds: secondFolds, rootId: 'second-root' },
    }));

    expect(source.buildScene({ semanticSvg: '<svg data=\"second\" />', artworkAtlas: ARTWORK_ATLAS }))
      .toBe(source.getRenderSurface());
    expect(firstPortableDispose).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    expect(scene.children).toEqual([secondModel]);
    expect(source.model).toBe(secondModel);
    expect(source.foldGraph).toBe(secondFolds);
  });

  it('regression: failed artwork or bounds phase cleans the new runtime and leaves no build state', () => {
    const runtime = createRuntime();
    runtime.setArtworkAtlas.mockImplementationOnce(() => {
      throw new Error('artwork failed');
    });
    const { source, scene } = createSource({ runtime });

    expect(() => source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS }))
      .toThrow('artwork failed');
    expect(scene.children).toEqual([]);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    expect(source.getDiagnostics()).toMatchObject({ built: false, foldProgress: null });
    expect(source.model).toBeNull();
    expect(source.foldGraph).toBeNull();
    expect(source.getBounds()).toBeNull();
  });

  it('regression: accepts the real Viewer 2.4.0 runtime result shape and resolves bounds separately', () => {
    const { source, runtime } = createSource({
      boundsResolver: vi.fn(() => ({ minX: 0, minY: 0, width: 0.24, height: 0.12, units: 'm' })),
    });
    source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS });

    const result = runtime.loadSemanticSvgText.mock.results[0].value;
    expect(Object.keys(result)).toEqual(['model', 'animations', 'parsed']);
    expect(result).not.toHaveProperty('bounds');
    expect(result.parsed).toHaveProperty('folds');
    expect(result.parsed).toHaveProperty('rootId', 'panel-root');
    expect(result.parsed).not.toHaveProperty('foldGraph');
    expect(source.foldGraph).toBe(result.parsed.folds);
    expect(source.getBounds()).toEqual({ minX: 0, minY: 0, width: 0.24, height: 0.12 });
  });

  it('regression: requires bounds resolver and explicit result units', () => {
    const runtime = createRuntime();
    const renderSurface = { scene: createScene() };
    expect(() => new TechnicalRenderSceneSource({ runtime, renderSurface }))
      .toThrow(/injected boundsResolver/);

    const { source, scene } = createSource({
      runtime,
      boundsResolver: () => ({ minX: 10, width: 100 }),
    });
    expect(() => source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS }))
      .toThrow(/must declare units/);
    expect(scene.children).toEqual([]);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    expect(source.getDiagnostics()).toMatchObject({ built: false, foldProgress: null });
  });

  it('regression: rejects portable scenes without a disposer', () => {
    const portableSceneFactory = vi.fn(() => ({ scene: { id: 'portable-without-dispose' } }));
    const { source } = createSource({ portableSceneFactory });
    source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS });

    expect(() => source.createPortableScene()).toThrow(/must return \{ scene, dispose \}/);
  });

  it('regression: wraps frozen portable scenes without mutating them or double-disposing', () => {
    const originalDispose = vi.fn();
    const foreignPortable = Object.freeze({ scene: { id: 'frozen-scene' }, dispose: originalDispose });
    const portableSceneFactory = vi.fn(() => foreignPortable);
    const { source, runtime } = createSource({ portableSceneFactory });
    source.buildScene({ semanticSvg: CANONICAL_SVG, artworkAtlas: ARTWORK_ATLAS });

    const wrapper = source.createPortableScene();
    expect(wrapper).not.toBe(foreignPortable);
    expect(wrapper.scene).toBe(foreignPortable.scene);
    expect(foreignPortable.dispose).toBe(originalDispose);
    expect(wrapper.dispose()).toBe(true);
    expect(wrapper.dispose()).toBe(false);
    expect(originalDispose).toHaveBeenCalledTimes(1);

    expect(source.dispose()).toBe(true);
    expect(originalDispose).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });
});
