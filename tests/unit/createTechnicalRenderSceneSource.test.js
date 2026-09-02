import { describe, expect, it, vi } from 'vitest';

import { createTechnicalRenderSceneSource } from '../../src/render/createTechnicalRenderSceneSource.js';

function makeBundle({ cartonType = 'RTE', markup = '<svg data="canonical" />' } = {}) {
  return {
    source: { cartonType },
    semanticSvg: { markup },
    modelJson: { text: '{"canonical":true}' },
  };
}

function makeDocument(bundle, overrides = {}) {
  return {
    mode: 'technical',
    isComplete: true,
    getBundle: vi.fn(() => bundle),
    ...overrides,
  };
}

function makeRenderSurface() {
  const children = [];
  const scene = {
    children,
    add: vi.fn((child) => {
      children.push(child);
      child.parent = scene;
    }),
    remove: vi.fn((child) => {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      if (child.parent === scene) child.parent = null;
    }),
  };
  return {
    scene,
    camera: { id: 'camera' },
    renderer: { id: 'renderer' },
  };
}

function makeDependencies({ source, runtime, renderSurface, sceneSourceFactory } = {}) {
  const resolvedRuntime = runtime || { dispose: vi.fn() };
  const resolvedSource = source || {
    buildScene: vi.fn(),
    dispose: vi.fn(),
  };
  const resolvedSurface = renderSurface || makeRenderSurface();
  return {
    runtime: resolvedRuntime,
    source: resolvedSource,
    renderSurface: resolvedSurface,
    runtimeFactory: vi.fn(() => resolvedRuntime),
    boundsResolver: vi.fn(),
    portableSceneFactory: vi.fn(),
    sceneSourceFactory: sceneSourceFactory || vi.fn(() => resolvedSource),
  };
}

describe('createTechnicalRenderSceneSource', () => {
  it('reads the canonical bundle once and builds one injected Technical source', () => {
    const bundle = makeBundle();
    const before = structuredClone(bundle);
    const technicalDocument = makeDocument(bundle);
    const renderSurface = makeRenderSurface();
    const boardAppearanceSetter = vi.fn();
    const dependencies = makeDependencies({ renderSurface });

    const source = createTechnicalRenderSceneSource({
      technicalDocument,
      renderSurface,
      artworkAtlas: { id: 'artwork-atlas' },
      materialMaps: null,
      boardAppearanceSetter,
      runtimeFactory: dependencies.runtimeFactory,
      boundsResolver: dependencies.boundsResolver,
      portableSceneFactory: dependencies.portableSceneFactory,
      sceneSourceFactory: dependencies.sceneSourceFactory,
    });

    expect(source).toBe(dependencies.source);
    expect(technicalDocument.getBundle).toHaveBeenCalledTimes(1);
    expect(dependencies.runtimeFactory).toHaveBeenCalledTimes(1);
    expect(dependencies.sceneSourceFactory).toHaveBeenCalledTimes(1);
    expect(dependencies.sceneSourceFactory).toHaveBeenCalledWith({
      runtime: dependencies.runtime,
      renderSurface,
      boundsResolver: dependencies.boundsResolver,
      portableSceneFactory: dependencies.portableSceneFactory,
      boardAppearanceSetter,
    });
    expect(dependencies.source.buildScene).toHaveBeenCalledTimes(1);
    expect(dependencies.source.buildScene).toHaveBeenCalledWith({
      bundle,
      artworkAtlas: { id: 'artwork-atlas' },
      maps: null,
      name: 'rte-technical-render.svg',
    });
    expect(bundle).toEqual(before);
  });

  it('rejects incomplete, non-Technical, malformed, and missing documents before runtime creation', () => {
    const runtimeFactory = vi.fn();
    const renderSurface = makeRenderSurface();

    expect(() => createTechnicalRenderSceneSource({
      technicalDocument: { mode: 'technical', isComplete: true },
      renderSurface,
      runtimeFactory,
    })).toThrow('technicalDocument.getBundle()');

    const incomplete = makeDocument(makeBundle(), { isComplete: false });
    expect(() => createTechnicalRenderSceneSource({
      technicalDocument: incomplete,
      renderSurface,
      runtimeFactory,
    })).toThrow('complete Technical document');

    const nonTechnical = makeDocument(makeBundle(), { mode: 'quick' });
    expect(() => createTechnicalRenderSceneSource({
      technicalDocument: nonTechnical,
      renderSurface,
      runtimeFactory,
    })).toThrow('workflowMode "technical"');

    const emptySvg = makeDocument(makeBundle({ markup: '   ' }));
    expect(() => createTechnicalRenderSceneSource({
      technicalDocument: emptySvg,
      renderSurface,
      runtimeFactory,
    })).toThrow('semanticSvg.markup');

    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('rejects a missing render surface and invalid injectable dependencies before runtime creation', () => {
    const technicalDocument = makeDocument(makeBundle());
    const runtimeFactory = vi.fn();

    expect(() => createTechnicalRenderSceneSource({
      technicalDocument,
      renderSurface: null,
      runtimeFactory,
    })).toThrow('renderSurface');
    expect(runtimeFactory).not.toHaveBeenCalled();

    expect(() => createTechnicalRenderSceneSource({
      technicalDocument,
      renderSurface: makeRenderSurface(),
      runtimeFactory: null,
    })).toThrow('runtimeFactory');
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('cleans source and runtime after a build failure while preserving the build error', () => {
    const bundle = makeBundle();
    const technicalDocument = makeDocument(bundle);
    const renderSurface = makeRenderSurface();
    const model = { id: 'partial-model' };
    const buildError = new Error('canonical build failed');
    const runtime = { dispose: vi.fn() };
    const source = {
      buildScene: vi.fn(() => {
        renderSurface.scene.add(model);
        throw buildError;
      }),
      dispose: vi.fn(() => {
        renderSurface.scene.remove(model);
      }),
    };
    const dependencies = makeDependencies({ source, runtime, renderSurface });

    expect(() => createTechnicalRenderSceneSource({
      technicalDocument,
      renderSurface,
      artworkAtlas: { id: 'atlas' },
      runtimeFactory: dependencies.runtimeFactory,
      boundsResolver: dependencies.boundsResolver,
      portableSceneFactory: dependencies.portableSceneFactory,
      sceneSourceFactory: dependencies.sceneSourceFactory,
    })).toThrow(buildError);

    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
    expect(renderSurface.scene.children).toEqual([]);
  });

  it('does not replace the initial build error when source and runtime cleanup also fail', () => {
    const technicalDocument = makeDocument(makeBundle());
    const renderSurface = makeRenderSurface();
    const buildError = new Error('initial build error');
    const cleanupError = new Error('cleanup error');
    const runtimeCleanupError = new Error('runtime cleanup error');
    const runtime = {
      dispose: vi.fn(() => {
        throw runtimeCleanupError;
      }),
    };
    const source = {
      runtime,
      buildScene: vi.fn(() => {
        throw buildError;
      }),
      dispose: vi.fn(() => {
        throw cleanupError;
      }),
    };
    const dependencies = makeDependencies({ source, runtime, renderSurface });

    expect(() => createTechnicalRenderSceneSource({
      technicalDocument,
      renderSurface,
      runtimeFactory: dependencies.runtimeFactory,
      boundsResolver: dependencies.boundsResolver,
      portableSceneFactory: dependencies.portableSceneFactory,
      sceneSourceFactory: dependencies.sceneSourceFactory,
    })).toThrow(buildError);
    expect(source.dispose).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects a source without disposal and falls back to runtime cleanup', () => {
    const technicalDocument = makeDocument(makeBundle());
    const runtime = { dispose: vi.fn() };
    const source = {
      runtime,
      buildScene: vi.fn(),
    };
    const dependencies = makeDependencies({ source, runtime });

    expect(() => createTechnicalRenderSceneSource({
      technicalDocument,
      renderSurface: dependencies.renderSurface,
      runtimeFactory: dependencies.runtimeFactory,
      boundsResolver: dependencies.boundsResolver,
      portableSceneFactory: dependencies.portableSceneFactory,
      sceneSourceFactory: dependencies.sceneSourceFactory,
    })).toThrow('source with dispose()');
    expect(source.buildScene).not.toHaveBeenCalled();
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it('cleans a runtime when source construction fails before a source exists', () => {
    const technicalDocument = makeDocument(makeBundle());
    const runtime = { dispose: vi.fn() };
    const dependencies = makeDependencies({ runtime });
    const constructionError = new Error('source construction failed');
    dependencies.sceneSourceFactory.mockImplementation(() => {
      throw constructionError;
    });

    expect(() => createTechnicalRenderSceneSource({
      technicalDocument,
      renderSurface: dependencies.renderSurface,
      runtimeFactory: dependencies.runtimeFactory,
      boundsResolver: dependencies.boundsResolver,
      portableSceneFactory: dependencies.portableSceneFactory,
      sceneSourceFactory: dependencies.sceneSourceFactory,
    })).toThrow(constructionError);
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });
});
