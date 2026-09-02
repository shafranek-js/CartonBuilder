import { Box3, Vector3 } from 'three';
import { createHeadlessFoldRuntime } from '../../vendor/plugins/carton-fold-viewer/2.4.0/runtime/index.js';

const REQUIRED_RUNTIME_METHODS = [
  'loadSemanticSvgText',
  'setFoldProgress',
  'setArtworkAtlas',
  'getModel',
  'dispose',
];

function assertRuntimeContract(runtime) {
  if (!runtime || typeof runtime !== 'object') {
    throw new TypeError('Technical fold runtime factory returned an invalid runtime.');
  }

  for (const methodName of REQUIRED_RUNTIME_METHODS) {
    if (typeof runtime[methodName] !== 'function') {
      throw new TypeError(`Technical fold runtime is missing ${methodName}().`);
    }
  }

  return runtime;
}

export function createTechnicalFoldRuntime(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Technical fold runtime options must be an object.');
  }

  // The dependency factory must create an empty runtime. Loading semantic SVG
  // is an explicit build step owned by the scene source.
  const runtimeOptions = { ...options };
  delete runtimeOptions.svgText;

  return assertRuntimeContract(createHeadlessFoldRuntime(runtimeOptions));
}

function assertFiniteBounds(bounds) {
  const values = [
    bounds.minX,
    bounds.minY,
    bounds.minZ,
    bounds.maxX,
    bounds.maxY,
    bounds.maxZ,
    bounds.width,
    bounds.height,
    bounds.depth,
    bounds.centerX,
    bounds.centerY,
    bounds.centerZ,
    bounds.radius,
  ];

  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new TypeError('Technical render bounds must contain finite numeric values.');
  }
}

export function resolveTechnicalRenderBounds({ model } = {}) {
  if (!model || typeof model.updateMatrixWorld !== 'function') {
    throw new TypeError('A Technical model with updateMatrixWorld() is required.');
  }

  model.updateMatrixWorld(true);

  const box = new Box3().setFromObject(model, true);
  if (box.isEmpty()) {
    throw new Error('Technical model bounds cannot be empty.');
  }

  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  const bounds = {
    minX: box.min.x,
    minY: box.min.y,
    minZ: box.min.z,
    maxX: box.max.x,
    maxY: box.max.y,
    maxZ: box.max.z,
    width: size.x,
    height: size.y,
    depth: size.z,
    centerX: center.x,
    centerY: center.y,
    centerZ: center.z,
    radius: size.length() / 2,
    units: 'm',
  };

  assertFiniteBounds(bounds);
  return bounds;
}
