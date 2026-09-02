import { TechnicalRenderSceneSource } from './TechnicalRenderSceneSource.js';
import { createTechnicalPortableScene } from './technicalPortableScene.js';
import {
  createTechnicalFoldRuntime,
  resolveTechnicalRenderBounds,
} from './technicalRenderDependencies.js';

function isObjectLike(value) {
  return value !== null && typeof value === 'object';
}

function assertTechnicalDocument(technicalDocument) {
  if (!isObjectLike(technicalDocument)) {
    throw new TypeError('Technical render source requires a technicalDocument.');
  }
  if (typeof technicalDocument.getBundle !== 'function') {
    throw new TypeError('Technical render source requires technicalDocument.getBundle().');
  }
  if (technicalDocument.isComplete !== true) {
    throw new Error('Technical render source requires a complete Technical document.');
  }

  const workflowMode = technicalDocument.workflowMode ?? technicalDocument.mode;
  if (workflowMode !== 'technical') {
    throw new Error('Technical render source requires workflowMode "technical".');
  }
}

function assertRenderSurface(renderSurface) {
  if (!isObjectLike(renderSurface)) {
    throw new TypeError('Technical render source requires a renderSurface.');
  }
  if (!isObjectLike(renderSurface.scene)
    || typeof renderSurface.scene.add !== 'function'
    || typeof renderSurface.scene.remove !== 'function') {
    throw new TypeError('Technical render source requires a renderSurface with a scene.');
  }
}

function assertDependency(name, dependency) {
  if (typeof dependency !== 'function') {
    throw new TypeError(`Technical render source requires ${name}().`);
  }
}

function getTechnicalRenderName(bundle) {
  const cartonType = String(bundle?.source?.cartonType || 'carton')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'carton';
  return `${cartonType}-technical-render.svg`;
}

function assertSemanticSvg(bundle) {
  if (!isObjectLike(bundle?.semanticSvg) || typeof bundle.semanticSvg.markup !== 'string'
    || bundle.semanticSvg.markup.trim().length === 0) {
    throw new Error('Technical render source requires a non-empty semanticSvg.markup.');
  }
}

function disposeRuntimeFallback(runtime) {
  if (runtime && typeof runtime.dispose === 'function') {
    runtime.dispose();
  }
}

/**
 * Create and build the Technical Render source from a validated document.
 *
 * The document remains the only source of canonical bundle data. Runtime,
 * bounds, portable-scene and source construction are injectable so this
 * boundary can be accepted headlessly before Technical Render is wired to UI.
 */
export function createTechnicalRenderSceneSource({
  technicalDocument,
  renderSurface,
  artworkAtlas,
  materialMaps = null,
  boardAppearanceSetter,
  runtimeFactory = createTechnicalFoldRuntime,
  boundsResolver = resolveTechnicalRenderBounds,
  portableSceneFactory = createTechnicalPortableScene,
  sceneSourceFactory = (sourceOptions) => new TechnicalRenderSceneSource(sourceOptions),
} = {}) {
  assertTechnicalDocument(technicalDocument);
  assertRenderSurface(renderSurface);
  assertDependency('runtimeFactory', runtimeFactory);
  assertDependency('boundsResolver', boundsResolver);
  assertDependency('portableSceneFactory', portableSceneFactory);
  assertDependency('sceneSourceFactory', sceneSourceFactory);

  const bundle = technicalDocument.getBundle();
  assertSemanticSvg(bundle);
  const name = getTechnicalRenderName(bundle);

  let runtime = null;
  let source = null;
  try {
    runtime = runtimeFactory();
    const sourceOptions = {
      runtime,
      renderSurface,
      boundsResolver,
      portableSceneFactory,
    };
    if (boardAppearanceSetter !== undefined) {
      sourceOptions.boardAppearanceSetter = boardAppearanceSetter;
    }

    source = sceneSourceFactory(sourceOptions);
    if (!source || typeof source.buildScene !== 'function') {
      throw new TypeError('Technical render source factory must return a source with buildScene().');
    }
    if (typeof source.dispose !== 'function') {
      throw new TypeError('Technical render source factory must return a source with dispose().');
    }

    source.buildScene({
      bundle,
      artworkAtlas,
      maps: materialMaps,
      name,
    });
    return source;
  } catch (error) {
    let sourceCleanupSucceeded = false;
    if (source && typeof source.dispose === 'function') {
      try {
        source.dispose();
        sourceCleanupSucceeded = true;
      } catch {
        // Preserve the original construction/build error.
      }
    }

    // Trust source ownership only after its cleanup completes successfully.
    // Missing or failed source cleanup falls back to the runtime directly.
    const sourceCleanedRuntime = sourceCleanupSucceeded && source?.runtime === runtime;
    if (!sourceCleanedRuntime) {
      try {
        disposeRuntimeFallback(runtime);
      } catch {
        // Preserve the original construction/build error.
      }
    }
    throw error;
  }
}
