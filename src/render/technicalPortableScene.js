import {
  MeshStandardMaterial,
  Object3D,
  Scene,
} from 'three';

import { sanitizeGlbExportOptions } from './glbOptions.js';

function isObject3D(value) {
  return value instanceof Object3D;
}

function isCamera(value) {
  return isObject3D(value) && value.isCamera === true;
}

function cloneUserData(userData) {
  try {
    return structuredClone(userData || {});
  } catch (error) {
    throw new TypeError('Technical portable scene requires cloneable Object3D userData.', { cause: error });
  }
}

function createResourceMaps() {
  return {
    geometries: new Map(),
    materials: new Map(),
    textures: new Map(),
  };
}

function cloneTexture(texture, resources) {
  if (!texture?.isTexture) return texture;

  const existing = resources.textures.get(texture);
  if (existing) return existing;
  if (typeof texture.clone !== 'function') {
    throw new TypeError('Technical portable scene encountered a texture without clone().');
  }

  const clone = texture.clone();
  clone.needsUpdate = true;
  resources.textures.set(texture, clone);
  return clone;
}

function replaceTextures(value, resources, visited = new Set()) {
  if (!value || typeof value !== 'object') return value;
  if (value.isTexture) return cloneTexture(value, resources);
  if (visited.has(value)) return value;
  visited.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = replaceTextures(value[index], resources, visited);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    const current = value[key];
    const replacement = replaceTextures(current, resources, visited);
    if (replacement !== current) value[key] = replacement;
  }
  return value;
}

function cloneMaterial(material, materialMode, resources) {
  if (!material) return material;

  const existing = resources.materials.get(material);
  if (existing) return existing;

  let clone;
  if (materialMode === 'basic-compatibility' && material.isMeshPhysicalMaterial) {
    // MeshStandardMaterial.copy() retains the compatible PBR fields and maps,
    // while intentionally dropping Physical-only extensions.
    clone = new MeshStandardMaterial().copy(material);
  } else {
    if (typeof material.clone !== 'function') {
      throw new TypeError('Technical portable scene encountered a material without clone().');
    }
    clone = material.clone();
  }

  if (!clone || clone === material || typeof clone.dispose !== 'function') {
    throw new TypeError('Technical portable scene could not create an owned material clone.');
  }

  resources.materials.set(material, clone);
  replaceTextures(clone, resources);
  return clone;
}

function cloneGeometry(geometry, resources) {
  if (!geometry) return geometry;

  const existing = resources.geometries.get(geometry);
  if (existing) return existing;
  if (typeof geometry.clone !== 'function') {
    throw new TypeError('Technical portable scene encountered geometry without clone().');
  }

  const clone = geometry.clone();
  if (!clone || clone === geometry || typeof clone.dispose !== 'function') {
    throw new TypeError('Technical portable scene could not create an owned geometry clone.');
  }
  resources.geometries.set(geometry, clone);
  return clone;
}

function isExcludedPresentationObject(object) {
  return object.isLight
    || object.isCamera
    || object.isLine
    || object.isLineLoop
    || object.userData?.presentationOnly === true;
}

function cloneObject3DWithoutScenePresentation(source) {
  if (source.isScene) {
    return Object3D.prototype.copy.call(new Scene(), source, false);
  }
  return source.clone(false);
}

function clonePortableNode(source, materialMode, resources) {
  if (isExcludedPresentationObject(source)) return null;
  if (typeof source.clone !== 'function') {
    throw new TypeError('Technical portable scene encountered an Object3D without clone().');
  }

  const clone = cloneObject3DWithoutScenePresentation(source);
  clone.name = source.name;
  clone.userData = cloneUserData(source.userData);

  if (clone.isScene) {
    // A runtime model should not bring scene-level presentation state into GLB.
    clone.background = null;
    clone.environment = null;
    clone.fog = null;
  }

  if (source.geometry) clone.geometry = cloneGeometry(source.geometry, resources);
  if (Array.isArray(source.material)) {
    clone.material = source.material.map((material) => (
      cloneMaterial(material, materialMode, resources)
    ));
  } else if (source.material) {
    clone.material = cloneMaterial(source.material, materialMode, resources);
  }

  for (const child of source.children) {
    const childClone = clonePortableNode(child, materialMode, resources);
    if (childClone) clone.add(childClone);
  }

  return clone;
}

function disposeResources(resources) {
  let firstError = null;
  for (const resource of resources.geometries.values()) {
    try {
      resource.dispose();
    } catch (error) {
      firstError ||= error;
    }
  }
  for (const resource of resources.materials.values()) {
    try {
      resource.dispose();
    } catch (error) {
      firstError ||= error;
    }
  }
  for (const resource of resources.textures.values()) {
    try {
      resource.dispose();
    } catch (error) {
      firstError ||= error;
    }
  }

  resources.geometries.clear();
  resources.materials.clear();
  resources.textures.clear();
  if (firstError) throw firstError;
}

export function createTechnicalPortableScene({
  model,
  foldGraph,
  renderSurface,
  runtimeResult,
  options = {},
} = {}) {
  if (!isObject3D(model)) {
    throw new TypeError('Technical portable scene requires a valid Three.js Object3D model.');
  }
  if (!renderSurface || typeof renderSurface !== 'object') {
    throw new TypeError('Technical portable scene requires a render surface context.');
  }

  const normalized = sanitizeGlbExportOptions(options);
  if (normalized.includeCamera && !isCamera(renderSurface.camera)) {
    throw new TypeError('Technical portable scene requires a Three.js camera when includeCamera is true.');
  }

  const resources = createResourceMaps();
  const scene = new Scene();
  scene.name = 'CartonBuilder Technical GLB';
  scene.userData.cartonBuilder = {
    source: 'technical',
    sourceUnit: 'mm',
    exportUnit: 'm',
    foldProgress: 1,
    static: true,
    materialMode: normalized.materialMode,
  };

  let disposed = false;
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    scene.clear();
    disposeResources(resources);
    return true;
  };

  try {
    const portableModel = clonePortableNode(model, normalized.materialMode, resources);
    if (!portableModel) {
      throw new TypeError('Technical portable scene model has no exportable Object3D root.');
    }
    scene.add(portableModel);

    if (normalized.includeCamera) {
      const portableCamera = renderSurface.camera.clone(false);
      portableCamera.userData = cloneUserData(renderSurface.camera.userData);
      scene.add(portableCamera);
    }

    scene.updateMatrixWorld(true);
    return { scene, dispose };
  } catch (error) {
    try {
      dispose();
    } catch {
      // Preserve the factory error while still attempting all owned cleanup.
    }
    throw error;
  }
}
