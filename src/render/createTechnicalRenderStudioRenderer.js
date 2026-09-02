import { RenderStudioAppearanceController } from './RenderStudioAppearanceController.js';
import { RenderStudioCameraRig } from './RenderStudioCameraRig.js';
import { RenderStudioRenderTargetService } from './RenderStudioRenderTargetService.js';
import { RenderStudioSceneController } from './RenderStudioSceneController.js';
import { RenderStudioSurface } from './RenderStudioSurface.js';
import { RenderStudioBackgroundAdapter } from './RenderStudioBackgroundAdapter.js';
import { RenderStudioEnvironmentAdapter } from './RenderStudioEnvironmentAdapter.js';
import { RenderStudioReflectionAdapter } from './RenderStudioReflectionAdapter.js';
import { TechnicalRenderMaterialController } from './TechnicalRenderMaterialController.js';
import { WebGLCartonRenderer } from './WebGLCartonRenderer.js';
import { createTechnicalRenderSceneSource } from './createTechnicalRenderSceneSource.js';
import { createTechnicalWebGLRenderer } from './createTechnicalWebGLRenderer.js';
import {
  assertRenderSceneController,
  assertRenderSceneSource,
} from './renderSceneActors.js';

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function assertObject(name, value) {
  if (!isObjectLike(value)) {
    throw new TypeError(`Technical Render Studio requires ${name}.`);
  }
}

function assertFunction(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`Technical Render Studio requires ${name} to be a function.`);
  }
}

function assertOptionalFunction(name, value) {
  if (value !== undefined && value !== null) assertFunction(name, value);
}

function assertTechnicalDocument(technicalDocument) {
  assertObject('technicalDocument', technicalDocument);
  assertFunction('technicalDocument.getBundle()', technicalDocument.getBundle);
  if (technicalDocument.isComplete !== true) {
    throw new Error('Technical Render Studio requires a complete Technical document.');
  }
  const workflowMode = technicalDocument.workflowMode ?? technicalDocument.mode;
  if (workflowMode !== 'technical') {
    throw new Error('Technical Render Studio requires workflowMode "technical".');
  }
}

function assertRenderSettings(renderSettings) {
  assertObject('renderSettings', renderSettings);
  for (const path of [
    'camera',
    'lighting',
    'shadows',
    'background',
    'floor',
    'material',
    'quality',
    'effects',
  ]) {
    assertObject(`renderSettings.${path}`, renderSettings[path]);
  }
}

function assertAdapter(name, adapter, methods) {
  assertObject(name, adapter);
  for (const method of methods) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`Technical Render Studio ${name} must implement ${method}().`);
    }
  }
}

function assertMaterialProfileSetter(materialProfileSetter) {
  if (typeof materialProfileSetter === 'function') return;
  assertAdapter('materialProfileSetter', materialProfileSetter, ['setMaterialProfile']);
}

function assertRendererOptions(rendererOptions) {
  if (!isObjectLike(rendererOptions) || Array.isArray(rendererOptions)) {
    throw new TypeError('Technical Render Studio rendererOptions must be an object.');
  }
}

function assertSurface(surface) {
  assertObject('surface', surface);
  const renderSurface = surface.renderSurface;
  assertObject('surface.renderSurface', renderSurface);
  for (const key of ['scene', 'camera', 'renderer']) {
    assertObject(`surface.renderSurface.${key}`, renderSurface[key]);
  }
}

function assertSameRenderSurface(surface, controller) {
  const surfaceRenderSurface = surface.renderSurface;
  const controllerRenderSurface = controller.renderSurface;
  assertObject('sceneController.renderSurface', controllerRenderSurface);
  for (const key of ['scene', 'camera', 'renderer']) {
    if (surfaceRenderSurface[key] !== controllerRenderSurface[key]) {
      throw new Error(
        `Technical Render Studio requires sceneController.renderSurface.${key} to share the RenderStudioSurface.`,
      );
    }
  }
}

function cleanupInReverse(resources) {
  let firstError = null;
  const disposed = new Set();
  for (const resource of resources.reverse()) {
    if (!isObjectLike(resource) || disposed.has(resource)) continue;
    disposed.add(resource);
    if (typeof resource.dispose !== 'function') continue;
    try {
      resource.dispose();
    } catch (error) {
      firstError ||= error;
    }
  }
  if (firstError) throw firstError;
}

function createOwnedSceneController(sceneController, materialController) {
  let disposed = false;
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    let firstError = null;
    try {
      sceneController.dispose();
    } catch (error) {
      firstError = error;
    }
    if (materialController !== sceneController) {
      try {
        materialController.dispose();
      } catch (error) {
        firstError ||= error;
      }
    }
    if (firstError) throw firstError;
    return true;
  };

  return new Proxy(sceneController, {
    get(target, property, receiver) {
      if (property === 'dispose') return dispose;
      if (property === '__rawSceneController__') return target;
      return Reflect.get(target, property, receiver);
    },
  });
}

function defaultSurfaceFactory(options) {
  return new RenderStudioSurface(options);
}

function defaultCameraRigFactory(options) {
  return new RenderStudioCameraRig(options);
}

function defaultAppearanceControllerFactory(options) {
  return new RenderStudioAppearanceController(options);
}

function defaultRenderTargetServiceFactory(options) {
  return new RenderStudioRenderTargetService(options);
}

function defaultSceneControllerFactory(options) {
  return new RenderStudioSceneController(options);
}

function defaultMaterialControllerFactory(options) {
  return new TechnicalRenderMaterialController(options);
}

function defaultEnvironmentAdapterFactory(options) {
  return new RenderStudioEnvironmentAdapter(options);
}

function defaultBackgroundAdapterFactory(options) {
  return new RenderStudioBackgroundAdapter(options);
}

function defaultReflectionAdapterFactory(options) {
  return new RenderStudioReflectionAdapter(options);
}

function defaultRendererFactory(options) {
  return new WebGLCartonRenderer(options);
}

/**
 * Compose the headless Technical Render Studio runtime.
 *
 * This is intentionally a production composition boundary only. It does not
 * route a workflow step, change capability flags, or create Quick geometry.
 */
export function createTechnicalRenderStudioRenderer({
  technicalDocument,
  canvas,
  container,
  renderSettings,
  artworkAtlas,
  materialMaps = null,
  boardAppearance,
  boardAppearanceSetter,
  environmentAdapter,
  backgroundAdapter,
  reflectionAdapter,
  materialProfileSetter,
  backgroundAsset = null,
  environmentAsset = null,
  windowRef = globalThis.window || globalThis,
  onContextLost,
  onContextRestored,
  onCameraChange,
  surfaceFactory = defaultSurfaceFactory,
  cameraRigFactory = defaultCameraRigFactory,
  materialControllerFactory = defaultMaterialControllerFactory,
  environmentAdapterFactory = defaultEnvironmentAdapterFactory,
  backgroundAdapterFactory = defaultBackgroundAdapterFactory,
  reflectionAdapterFactory = defaultReflectionAdapterFactory,
  appearanceControllerFactory = defaultAppearanceControllerFactory,
  renderTargetServiceFactory = defaultRenderTargetServiceFactory,
  sceneControllerFactory = defaultSceneControllerFactory,
  technicalSourceFactory = createTechnicalRenderSceneSource,
  rendererFactory = defaultRendererFactory,
  renderTargetFactory,
  threeFactories = {},
  environmentAdapterOptions = {},
  backgroundAdapterOptions = {},
  reflectionAdapterOptions = {},
  rendererOptions = {},
  technicalSourceOptions = {},
} = {}) {
  // Complete all input and factory validation before allocating the WebGL
  // surface. The document is deliberately not read here; only the Technical
  // source factory may read its canonical bundle.
  assertTechnicalDocument(technicalDocument);
  assertObject('canvas', canvas);
  assertObject('container', container);
  assertObject('windowRef', windowRef);
  assertRenderSettings(renderSettings);
  assertOptionalFunction('boardAppearanceSetter', boardAppearanceSetter);
  if (environmentAdapter !== undefined && environmentAdapter !== null) {
    assertAdapter('environmentAdapter', environmentAdapter, [
      'setEnvironment',
      'setEnvironmentMap',
      'setEnvironmentAsset',
      'dispose',
    ]);
  }
  if (backgroundAdapter !== undefined && backgroundAdapter !== null) {
    assertAdapter('backgroundAdapter', backgroundAdapter, [
      'setBackgroundImage',
      'setBackgroundAsset',
      'dispose',
    ]);
  }
  if (reflectionAdapter !== undefined && reflectionAdapter !== null) {
    assertAdapter('reflectionAdapter', reflectionAdapter, ['setFloorReflection', 'dispose']);
  }
  if (materialProfileSetter !== undefined && materialProfileSetter !== null) {
    assertMaterialProfileSetter(materialProfileSetter);
  }
  assertRendererOptions(rendererOptions);
  assertObject('technicalSourceOptions', technicalSourceOptions);
  assertObject('threeFactories', threeFactories);
  for (const [name, factory] of Object.entries({
    surfaceFactory,
    cameraRigFactory,
    materialControllerFactory,
    environmentAdapterFactory,
    backgroundAdapterFactory,
    reflectionAdapterFactory,
    appearanceControllerFactory,
    renderTargetServiceFactory,
    sceneControllerFactory,
    technicalSourceFactory,
    rendererFactory,
  })) {
    assertFunction(name, factory);
  }
  if (renderTargetFactory !== undefined) assertFunction('renderTargetFactory', renderTargetFactory);
  assertObject('environmentAdapterOptions', environmentAdapterOptions);
  assertObject('backgroundAdapterOptions', backgroundAdapterOptions);
  assertObject('reflectionAdapterOptions', reflectionAdapterOptions);
  assertOptionalFunction('onContextLost', onContextLost);
  assertOptionalFunction('onContextRestored', onContextRestored);
  assertOptionalFunction('onCameraChange', onCameraChange);

  let surface = null;
  let cameraRig = null;
  let materialController = null;
  let appearanceController = null;
  let renderTargetService = null;
  let sceneController = null;
  let rawSceneController = null;
  let activeEnvironmentAdapter = environmentAdapter || null;
  let activeBackgroundAdapter = backgroundAdapter || null;
  let activeReflectionAdapter = reflectionAdapter || null;
  let sceneControllerOwnsDependencies = false;
  let rendererOwnershipTransferred = false;
  let technicalSource = null;
  let technicalSourceCalls = 0;

  const dispatchContextEvent = (event, callbackName, adapterMethod) => {
    let firstError = null;
    try {
      if (callbackName === 'lost') onContextLost?.(event);
      else onContextRestored?.(event);
    } catch (error) {
      firstError = error;
    }
    for (const adapter of [
      activeEnvironmentAdapter,
      activeBackgroundAdapter,
      activeReflectionAdapter,
    ]) {
      if (typeof adapter?.[adapterMethod] !== 'function') continue;
      try {
        adapter[adapterMethod](event);
      } catch (error) {
        firstError ||= error;
      }
    }
    if (firstError) throw firstError;
  };
  const handleContextLost = (event) => dispatchContextEvent(event, 'lost', 'handleContextLost');
  const handleContextRestored = (event) => (
    dispatchContextEvent(event, 'restored', 'handleContextRestored')
  );

  const boundsProvider = () => {
    if (!technicalSource) {
      throw new Error('Technical Render Studio bounds are unavailable before the source is built.');
    }
    const bounds = technicalSource.getBounds();
    if (!bounds) {
      throw new Error('Technical Render Studio source must provide bounds after build.');
    }
    return bounds;
  };

  const composedTechnicalSourceFactory = () => {
    technicalSourceCalls += 1;
    if (technicalSourceCalls !== 1) {
      throw new Error('Technical Render Studio must create exactly one Technical source.');
    }

    const sourceOptions = {
      ...technicalSourceOptions,
      technicalDocument,
      renderSurface: sceneController.renderSurface,
      artworkAtlas,
      materialMaps,
      boardAppearanceSetter: (...args) => {
        const result = materialController.setBoardAppearance(...args);
        if (typeof boardAppearanceSetter === 'function') boardAppearanceSetter(...args);
        return result;
      },
    };
    const source = technicalSourceFactory(sourceOptions);
    technicalSource = source;
    try {
      assertRenderSceneSource(source);
    } catch (error) {
      try {
        source?.dispose?.();
      } catch {
        // Preserve the source contract error.
      }
      throw error;
    }
    return source;
  };

  // WebGLCartonRenderer still has a legacy-shaped option object for public
  // compatibility. Strip Quick-only construction inputs before passing that
  // object to it; the Technical source is supplied exclusively by the seam.
  const {
    boxModel: _boxModel,
    textureCanvas: _textureCanvas,
    sceneModel: _sceneModel,
    sceneSourceFactory: _callerSourceFactory,
    sceneController: _callerSceneController,
    source: _callerSource,
    ...safeRendererOptions
  } = rendererOptions;
  const finalRendererOptions = {
    ...safeRendererOptions,
    canvas,
    container,
    materialMaps,
    renderSettings,
    boardAppearance,
    backgroundAsset,
    environmentAsset,
    windowRef,
    onContextLost,
    onContextRestored,
    onCameraChange,
    // Keep the required Technical actors after caller options.
    sceneController,
    sceneSourceFactory: composedTechnicalSourceFactory,
  };
  if (renderTargetFactory !== undefined) finalRendererOptions.renderTargetFactory = renderTargetFactory;

  try {
    surface = surfaceFactory({
      canvas,
      container,
      windowRef,
      projection: renderSettings.camera.projection,
      alpha: true,
      onContextLost: handleContextLost,
      onContextRestored: handleContextRestored,
    });
    assertSurface(surface);

    cameraRig = cameraRigFactory({
      surface,
      boundsProvider,
      initialState: renderSettings.camera,
      onCameraChange,
    });

    materialController = materialControllerFactory({
      sourceProvider: () => technicalSource,
    });
    if (!isObjectLike(materialController)
      || typeof materialController.setMaterialProfile !== 'function'
      || typeof materialController.setBoardAppearance !== 'function'
      || typeof materialController.dispose !== 'function') {
      throw new TypeError(
        'Technical Render Studio materialControllerFactory must return a material controller.',
      );
    }

    if (!activeEnvironmentAdapter) {
      activeEnvironmentAdapter = environmentAdapterFactory({
        ...environmentAdapterOptions,
        surface,
        renderSurface: surface.renderSurface,
        boundsProvider,
        windowRef,
        environmentAsset,
        environmentMap: renderSettings.lighting.environmentMap,
        onContextLost: handleContextLost,
        onContextRestored: handleContextRestored,
      });
    }
    if (!activeBackgroundAdapter) {
      activeBackgroundAdapter = backgroundAdapterFactory({
        ...backgroundAdapterOptions,
        surface,
        renderSurface: surface.renderSurface,
        boundsProvider,
        windowRef,
        backgroundAsset,
        backgroundImage: renderSettings.background.image,
        onContextLost: handleContextLost,
        onContextRestored: handleContextRestored,
      });
    }
    if (!activeReflectionAdapter) {
      activeReflectionAdapter = reflectionAdapterFactory({
        ...reflectionAdapterOptions,
        surface,
        renderSurface: surface.renderSurface,
        boundsProvider,
        windowRef,
        onContextLost: handleContextLost,
        onContextRestored: handleContextRestored,
        transparent: renderSettings.background.mode === 'transparent',
      });
    }
    assertAdapter('environmentAdapter', activeEnvironmentAdapter, [
      'setEnvironment',
      'setEnvironmentMap',
      'setEnvironmentAsset',
      'dispose',
    ]);
    assertAdapter('backgroundAdapter', activeBackgroundAdapter, [
      'setBackgroundImage',
      'setBackgroundAsset',
      'dispose',
    ]);
    assertAdapter('reflectionAdapter', activeReflectionAdapter, ['setFloorReflection', 'dispose']);

    appearanceController = appearanceControllerFactory({
      surface,
      boundsProvider,
      materialProfileSetter: materialController,
      environmentAdapter: activeEnvironmentAdapter,
      backgroundAdapter: activeBackgroundAdapter,
      reflectionAdapter: activeReflectionAdapter,
      threeFactories,
    });

    renderTargetService = renderTargetServiceFactory({
      surface,
      appearanceController,
      ...(renderTargetFactory ? { renderTargetFactory } : {}),
    });

    rawSceneController = sceneControllerFactory({
      surface,
      cameraRig,
      appearanceController,
      renderTargetService,
    });
    assertRenderSceneController(rawSceneController);
    assertSameRenderSurface(surface, rawSceneController);
    sceneController = createOwnedSceneController(rawSceneController, materialController);
    sceneControllerOwnsDependencies = true;

    // From this call onward createTechnicalWebGLRenderer owns the controller
    // and its surface dependencies, including all failure cleanup.
    rendererOwnershipTransferred = true;
    return createTechnicalWebGLRenderer({
      technicalDocument,
      sceneController,
      artworkAtlas,
      materialMaps,
      boardAppearanceSetter,
      rendererOptions: finalRendererOptions,
      technicalSourceFactory: composedTechnicalSourceFactory,
      rendererFactory,
    });
  } catch (error) {
    if (rendererOwnershipTransferred) throw error;

    // A constructed scene controller owns its lower-level studio resources.
    // Do not dispose those resources a second time when controller ownership
    // has already begun. Before that point, clean up in reverse construction
    // order and continue after individual disposal failures.
    try {
      cleanupInReverse(sceneControllerOwnsDependencies
        ? [sceneController]
        : [
          surface,
          cameraRig,
          materialController,
          ...(appearanceController
            ? []
            : [activeEnvironmentAdapter, activeBackgroundAdapter, activeReflectionAdapter]),
          appearanceController,
          renderTargetService,
          rawSceneController,
        ]);
    } catch {
      // Preserve the original composition error.
    }
    throw error;
  }
}
