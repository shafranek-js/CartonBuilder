import { WebGLCartonRenderer } from './WebGLCartonRenderer.js';
import { createTechnicalRenderSceneSource } from './createTechnicalRenderSceneSource.js';
import { assertRenderSceneController } from './renderSceneActors.js';

function assertFunction(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`Technical WebGL renderer requires ${name} to be a function.`);
  }
}

function disposeBestEffort(resource) {
  if (resource && typeof resource.dispose === 'function') {
    try {
      resource.dispose();
    } catch {
      // The original composition error must remain observable.
    }
  }
}

/**
 * Compose the production Technical geometry source with an existing Render
 * scene controller. The shared Render UI is deliberately not involved here;
 * this is the headless composition boundary for a future Technical workflow.
 */
export function createTechnicalWebGLRenderer({
  technicalDocument,
  sceneController,
  artworkAtlas,
  materialMaps,
  boardAppearanceSetter,
  rendererOptions = {},
  technicalSourceFactory = createTechnicalRenderSceneSource,
  rendererFactory = (options) => new WebGLCartonRenderer(options),
} = {}) {
  assertRenderSceneController(sceneController);
  assertFunction('technicalSourceFactory', technicalSourceFactory);
  assertFunction('rendererFactory', rendererFactory);

  if (rendererOptions === null || typeof rendererOptions !== 'object' || Array.isArray(rendererOptions)) {
    throw new TypeError('Technical WebGL renderer requires rendererOptions to be an object.');
  }

  const renderSurface = sceneController.renderSurface;
  let createdSource = null;
  let sourceFactoryCalled = false;

  const sceneSourceFactory = () => {
    if (sourceFactoryCalled) {
      throw new Error('Technical WebGL renderer source factory may only be called once.');
    }
    sourceFactoryCalled = true;
    const source = technicalSourceFactory({
      technicalDocument,
      renderSurface,
      artworkAtlas,
      materialMaps,
      boardAppearanceSetter,
    });
    createdSource = source;
    return source;
  };

  try {
    const renderer = rendererFactory({
      ...rendererOptions,
      sceneController,
      sceneSourceFactory,
    });
    if (!sourceFactoryCalled) {
      throw new Error('Technical WebGL renderer factory must create exactly one Technical source.');
    }
    return renderer;
  } catch (error) {
    disposeBestEffort(createdSource);
    if (createdSource !== sceneController) {
      disposeBestEffort(sceneController);
    }
    throw error;
  }
}
