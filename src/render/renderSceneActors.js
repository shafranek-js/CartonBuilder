const REQUIRED_SOURCE_METHODS = Object.freeze([
  'replaceArtwork',
  'setBoardAppearance',
  'createPortableScene',
  'getBounds',
  'getDiagnostics',
  'dispose',
]);

const REQUIRED_CONTROLLER_METHODS = Object.freeze([
  'setToneMapping',
  'setRenderCallback',
  'setMaterialProfile',
  'setLightDirection',
  'setLightIntensity',
  'setHemisphereIntensity',
  'setEnvironmentIntensity',
  'setEnvironment',
  'setShadowsEnabled',
  'setShadowMapSize',
  'setShadowBlur',
  'setShadowIntensity',
  'setBackgroundMode',
  'setBackgroundImage',
  'setFloorReflection',
  'setExposure',
  'setCameraPreset',
  'setCameraState',
  'getCameraState',
  'fitCameraToFrame',
  'resetView',
  'setBackgroundAsset',
  'render',
  'resize',
  'renderToPixels',
  'dispose',
]);

function isObjectLike(value) {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function assertActorObject(actor, label) {
  if (!isObjectLike(actor)) {
    throw new TypeError(`${label} must be an object.`);
  }
  if (!isObjectLike(actor.renderSurface)) {
    throw new TypeError(`${label} must provide renderSurface.`);
  }
}

function assertRenderSurface(actor, label) {
  assertActorObject(actor, label);
  for (const key of ['scene', 'camera', 'renderer']) {
    if (!isObjectLike(actor.renderSurface[key])) {
      throw new TypeError(`${label} renderSurface must provide ${key}.`);
    }
  }
  return actor.renderSurface;
}

function assertMethods(actor, label, methods) {
  for (const method of methods) {
    if (typeof actor[method] !== 'function') {
      throw new TypeError(`${label} must implement ${method}().`);
    }
  }
}

export function assertRenderSceneSource(source) {
  assertActorObject(source, 'Render scene source');
  assertMethods(source, 'Render scene source', REQUIRED_SOURCE_METHODS);
  return source;
}

export function assertRenderSceneController(controller) {
  assertActorObject(controller, 'Render scene controller');
  assertMethods(controller, 'Render scene controller', REQUIRED_CONTROLLER_METHODS);
  return controller;
}

export function assertSharedRenderSurface(source, controller) {
  const sourceSurface = assertRenderSurface(source, 'Render scene source');
  const controllerSurface = assertRenderSurface(controller, 'Render scene controller');
  for (const key of ['scene', 'camera', 'renderer']) {
    if (sourceSurface[key] !== controllerSurface[key]) {
      throw new Error(`Render source and scene controller must share renderSurface.${key}.`);
    }
  }
  return true;
}
