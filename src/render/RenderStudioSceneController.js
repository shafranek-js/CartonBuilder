import { assertRenderSceneController } from './renderSceneActors.js';

const CAMERA_METHODS = Object.freeze([
  'setCameraPreset',
  'setCameraState',
  'getCameraState',
  'fitCameraToFrame',
  'resetView',
  'dispose',
]);

const APPEARANCE_METHODS = Object.freeze([
  'setToneMapping',
  'setMaterialProfile',
  'setLightDirection',
  'setLightIntensity',
  'setHemisphereIntensity',
  'setEnvironmentIntensity',
  'setEnvironment',
  'setEnvironmentMap',
  'setShadowsEnabled',
  'setShadowMapSize',
  'setShadowBlur',
  'setShadowIntensity',
  'setBackgroundMode',
  'setBackgroundImage',
  'setBackgroundAsset',
  'setEnvironmentAsset',
  'setFloorReflection',
  'setExposure',
  'dispose',
]);

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function assertDependency(name, value) {
  if (!isObjectLike(value)) {
    throw new TypeError(`RenderStudioSceneController requires ${name}.`);
  }
}
function assertMethods(name, value, methods) {
  for (const method of methods) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`RenderStudioSceneController ${name} must implement ${method}().`);
    }
  }
}

function assertSurface(surface) {
  assertDependency('surface', surface);
  assertMethods('surface', surface, ['setRenderCallback', 'render', 'resize', 'dispose']);

  const renderSurface = surface.renderSurface;
  if (!isObjectLike(renderSurface)) {
    throw new TypeError('RenderStudioSceneController surface must provide renderSurface.');
  }
  for (const key of ['scene', 'camera', 'renderer']) {
    if (!isObjectLike(renderSurface[key])) {
      throw new TypeError(`RenderStudioSceneController surface renderSurface must provide ${key}.`);
    }
  }
}

function assertCameraRig(cameraRig) {
  assertDependency('cameraRig', cameraRig);
  assertMethods('cameraRig', cameraRig, CAMERA_METHODS);
}

function assertAppearanceController(appearanceController) {
  assertDependency('appearanceController', appearanceController);
  assertMethods('appearanceController', appearanceController, APPEARANCE_METHODS);
}

function assertRenderTargetService(renderTargetService) {
  assertDependency('renderTargetService', renderTargetService);
  assertMethods('renderTargetService', renderTargetService, ['renderToPixels', 'dispose']);
}

/**
 * Composition owner for the geometry-free Render studio runtime.
 *
 * Surface, camera, appearance and render-target ownership intentionally meet
 * here, while their implementation remains independently injectable. The
 * controller does not create lights, backgrounds, export targets or geometry.
 */
export class RenderStudioSceneController {
  constructor({
    surface,
    cameraRig,
    appearanceController,
    renderTargetService,
  } = {}) {
    // Validate every dependency before reading or invoking an operational API.
    assertSurface(surface);
    assertCameraRig(cameraRig);
    assertAppearanceController(appearanceController);
    assertRenderTargetService(renderTargetService);

    this.surface = surface;
    this.cameraRig = cameraRig;
    this.appearanceController = appearanceController;
    this.renderTargetService = renderTargetService;
    this.disposed = false;

    const owner = this;
    this._renderSurface = Object.freeze({
      get scene() {
        return owner.surface.renderSurface.scene;
      },
      get camera() {
        return owner.surface.renderSurface.camera;
      },
      get renderer() {
        return owner.surface.renderSurface.renderer;
      },
    });

    assertRenderSceneController(this);
  }

  get renderSurface() {
    return this._renderSurface;
  }

  setCameraPreset(...args) {
    if (this.disposed) return false;
    return this.cameraRig.setCameraPreset(...args);
  }

  setCameraState(...args) {
    if (this.disposed) return false;
    return this.cameraRig.setCameraState(...args);
  }

  getCameraState(...args) {
    if (this.disposed) return false;
    return this.cameraRig.getCameraState(...args);
  }

  fitCameraToFrame(...args) {
    if (this.disposed) return false;
    return this.cameraRig.fitCameraToFrame(...args);
  }

  resetView(...args) {
    if (this.disposed) return false;
    return this.cameraRig.resetView(...args);
  }

  setRenderCallback(...args) {
    if (this.disposed) return false;
    return this.surface.setRenderCallback(...args);
  }

  render(...args) {
    if (this.disposed) return false;
    return this.surface.render(...args);
  }

  resize(...args) {
    if (this.disposed) return false;
    return this.surface.resize(...args);
  }

  setToneMapping(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setToneMapping(...args);
  }

  setMaterialProfile(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setMaterialProfile(...args);
  }

  setLightDirection(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setLightDirection(...args);
  }

  setLightIntensity(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setLightIntensity(...args);
  }

  setHemisphereIntensity(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setHemisphereIntensity(...args);
  }

  setEnvironmentIntensity(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setEnvironmentIntensity(...args);
  }

  setEnvironment(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setEnvironment(...args);
  }

  setEnvironmentMap(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setEnvironmentMap(...args);
  }

  setShadowsEnabled(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setShadowsEnabled(...args);
  }

  setShadowMapSize(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setShadowMapSize(...args);
  }

  setShadowBlur(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setShadowBlur(...args);
  }

  setShadowIntensity(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setShadowIntensity(...args);
  }

  setBackgroundMode(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setBackgroundMode(...args);
  }

  setBackgroundImage(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setBackgroundImage(...args);
  }

  setBackgroundAsset(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setBackgroundAsset(...args);
  }

  setEnvironmentAsset(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setEnvironmentAsset(...args);
  }

  setFloorReflection(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setFloorReflection(...args);
  }

  setExposure(...args) {
    if (this.disposed) return false;
    return this.appearanceController.setExposure(...args);
  }

  renderToPixels(...args) {
    if (this.disposed) return false;
    return this.renderTargetService.renderToPixels(...args);
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;

    let firstError = null;
    const owners = [
      this.renderTargetService,
      this.appearanceController,
      this.cameraRig,
      this.surface,
    ];
    const disposedOwners = new Set();

    for (const owner of owners) {
      if (disposedOwners.has(owner)) continue;
      disposedOwners.add(owner);
      try {
        owner.dispose();
      } catch (error) {
        if (!firstError) firstError = error;
      }
    }

    if (firstError) throw firstError;
    return true;
  }
}
