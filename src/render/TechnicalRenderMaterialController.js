import {
  MeshPhysicalMaterial,
} from 'three';

import { sanitizeBoardAppearance } from './BoardAppearance.js';

const VALID_PROFILES = new Set(['uncoated', 'matte', 'gloss']);
const TEXTURE_KEYS = Object.freeze([
  'map',
  'alphaMap',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
]);
const MATERIAL_STATE_KEYS = Object.freeze([
  'roughness',
  'metalness',
  'clearcoat',
  'clearcoatRoughness',
  'transparent',
  'opacity',
  'alphaTest',
  'depthWrite',
  'depthTest',
  'side',
  'vertexColors',
  'flatShading',
  'polygonOffset',
  'polygonOffsetFactor',
  'polygonOffsetUnits',
]);

const PROFILE_PRESENTATION = Object.freeze({
  uncoated: Object.freeze({ roughness: 0.92, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.8 }),
  matte: Object.freeze({ roughness: 0.72, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.9 }),
  gloss: Object.freeze({ roughness: 0.26, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.18 }),
});

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function assertSourceProvider(sourceProvider) {
  if (typeof sourceProvider !== 'function') {
    throw new TypeError('TechnicalRenderMaterialController requires sourceProvider().');
  }
}

function assertProfile(profile) {
  return typeof profile === 'string' && VALID_PROFILES.has(profile);
}

function cloneValue(value) {
  if (value && typeof value.clone === 'function') return value.clone();
  if (Array.isArray(value)) return [...value];
  return value;
}

function snapshotMaterial(material) {
  const snapshot = {};
  for (const key of MATERIAL_STATE_KEYS) snapshot[key] = material[key];
  snapshot.color = cloneValue(material.color);
  return snapshot;
}

function restoreMaterial(material, snapshot) {
  for (const key of MATERIAL_STATE_KEYS) {
    if (Object.hasOwn(snapshot, key)) material[key] = snapshot[key];
  }
  if (snapshot.color !== undefined) {
    if (material.color && typeof material.color.copy === 'function'
      && snapshot.color && typeof snapshot.color === 'object') {
      material.color.copy(snapshot.color);
    } else {
      material.color = snapshot.color;
    }
  }
  material.needsUpdate = true;
}

function setMaterialColor(material, color) {
  if (material?.color && typeof material.color.set === 'function') {
    material.color.set(color);
  } else if (material && Object.hasOwn(material, 'color')) {
    material.color = color;
  } else {
    throw new TypeError('TechnicalRenderMaterialController material must provide a color.');
  }
  material.needsUpdate = true;
}

function materialsForMesh(mesh) {
  if (!mesh || mesh.isMesh !== true) return [];
  if (Array.isArray(mesh.material)) {
    return mesh.material.map((material, slot) => ({ material, slot }));
  }
  return mesh.material ? [{ material: mesh.material, slot: 0 }] : [];
}

function classifyMaterial(mesh, slot) {
  const metadata = mesh?.userData || {};
  if (metadata.artwork_surface_type === 'crease') return 'creaseArtwork';
  if (slot === 1) return 'interior';
  if (slot === 2) return 'edge';
  if (metadata.artwork_surface === true) return 'outsideArtwork';
  return 'outside';
}

function collectMaterialSlots(model) {
  if (!isObjectLike(model) || model.isObject3D !== true || typeof model.traverse !== 'function') {
    throw new TypeError(
      'TechnicalRenderMaterialController requires source.model to be a built Three.js Object3D.',
    );
  }

  const slots = [];
  model.traverse((mesh) => {
    for (const entry of materialsForMesh(mesh)) {
      if (!isObjectLike(entry.material)) {
        throw new TypeError('TechnicalRenderMaterialController encountered an invalid mesh material.');
      }
      slots.push({
        mesh,
        slot: entry.slot,
        material: entry.material,
        className: classifyMaterial(mesh, entry.slot),
      });
    }
  });
  return slots;
}

function isPhysicalMaterial(material) {
  return material?.isMeshPhysicalMaterial === true;
}

function copyMaterialIdentity(source, target) {
  if (source.color && target.color && typeof target.color.copy === 'function') {
    target.color.copy(source.color);
  }
  target.name = source.name;
  target.userData = source.userData;
  target.side = source.side;
  target.transparent = source.transparent;
  target.opacity = source.opacity;
  target.alphaTest = source.alphaTest;
  target.depthWrite = source.depthWrite;
  target.depthTest = source.depthTest;
  target.vertexColors = source.vertexColors;
  target.flatShading = source.flatShading;
  target.polygonOffset = source.polygonOffset;
  target.polygonOffsetFactor = source.polygonOffsetFactor;
  target.polygonOffsetUnits = source.polygonOffsetUnits;
  for (const key of ['normalScale', 'clearcoatNormalScale']) {
    if (source[key] && target[key] && typeof target[key].copy === 'function') {
      target[key].copy(source[key]);
    }
  }
  for (const key of TEXTURE_KEYS) target[key] = source[key] ?? null;
  target.needsUpdate = true;
  return target;
}

function materialSlotsSnapshot(slots) {
  const materials = new Map();
  for (const { material } of slots) {
    if (!materials.has(material)) materials.set(material, snapshotMaterial(material));
  }
  return materials;
}

function restoreMeshMaterials(slots, replacements) {
  const restoredMeshes = new Set();
  for (const { mesh } of slots) {
    if (restoredMeshes.has(mesh)) continue;
    restoredMeshes.add(mesh);
    const current = mesh.material;
    if (Array.isArray(current)) {
      mesh.material = current.map((material) => replacements.get(material) || material);
    }
  }
  for (const slot of slots) {
    if (Array.isArray(slot.mesh.material)) {
      slot.mesh.material[slot.slot] = slot.material;
    } else {
      slot.mesh.material = slot.material;
    }
  }
}

function installReplacements(slots, replacements) {
  const installed = new Set();
  for (const { mesh } of slots) {
    if (installed.has(mesh)) continue;
    installed.add(mesh);
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => replacements.get(material) || material);
    } else if (replacements.has(mesh.material)) {
      mesh.material = replacements.get(mesh.material);
    }
  }
}

function firstError(current, callback) {
  try {
    callback();
  } catch (error) {
    return current || error;
  }
  return current;
}

/**
 * Applies presentation-only material and board appearance changes to a
 * built Technical Viewer model. The Viewer runtime remains the owner of all
 * source textures and of the canonical geometry.
 */
export class TechnicalRenderMaterialController {
  constructor({ sourceProvider } = {}) {
    assertSourceProvider(sourceProvider);
    this.sourceProvider = sourceProvider;
    this.profile = 'matte';
    this.boardAppearance = null;
    this.disposed = false;
    this._appliedModel = null;
    this._ownedMaterials = new Set();
    this._materialClassCounts = {
      outsideArtwork: 0,
      interior: 0,
      edge: 0,
      creaseArtwork: 0,
      outside: 0,
    };
  }

  _getSourceAndSlots() {
    if (this.disposed) return null;
    const source = this.sourceProvider();
    const diagnostics = source?.getDiagnostics?.();
    if (!isObjectLike(source)
      || diagnostics?.source !== 'technical'
      || !source.model) {
      throw new Error(
        'TechnicalRenderMaterialController requires a built TechnicalRenderSceneSource.',
      );
    }
    const slots = collectMaterialSlots(source.model);
    const counts = {
      outsideArtwork: 0,
      interior: 0,
      edge: 0,
      creaseArtwork: 0,
      outside: 0,
    };
    for (const slot of slots) counts[slot.className] += 1;
    return { source, model: source.model, slots, counts };
  }

  _trackOwnedMaterial(material) {
    const originalDispose = typeof material.dispose === 'function'
      ? material.dispose.bind(material)
      : null;
    let disposed = false;
    const release = (...args) => {
      if (disposed) return false;
      disposed = true;
      this._ownedMaterials.delete(material);
      return originalDispose ? originalDispose(...args) : true;
    };
    material.dispose = release;
    this._ownedMaterials.add(material);
  }

  _applyMaterialProfile(profile, context = null) {
    const resolvedContext = context || this._getSourceAndSlots();
    if (!resolvedContext) return false;
    const { model, slots, counts } = resolvedContext;
    const presentation = PROFILE_PRESENTATION[profile];
    const replacements = new Map();
    const prepared = [];
    const snapshots = materialSlotsSnapshot(slots);
    let committed = false;

    try {
      for (const { material } of slots) {
        if (replacements.has(material)) continue;
        if (presentation.clearcoat > 0 && !isPhysicalMaterial(material)) {
          const replacement = copyMaterialIdentity(material, new MeshPhysicalMaterial());
          replacements.set(material, replacement);
          prepared.push(replacement);
        }
      }

      installReplacements(slots, replacements);
      const targets = new Set(slots.map(({ material }) => replacements.get(material) || material));
      for (const material of targets) {
        material.roughness = presentation.roughness;
        material.metalness = presentation.metalness;
        if (isPhysicalMaterial(material)) {
          material.clearcoat = presentation.clearcoat;
          material.clearcoatRoughness = presentation.clearcoatRoughness;
        }
        material.needsUpdate = true;
      }

      for (const material of prepared) this._trackOwnedMaterial(material);
      this.profile = profile;
      this._appliedModel = model;
      this._materialClassCounts = counts;
      committed = true;

      let disposalError = null;
      for (const [oldMaterial] of replacements) {
        if (typeof oldMaterial.dispose === 'function') {
          disposalError = firstError(disposalError, () => oldMaterial.dispose());
        }
      }
      if (disposalError) throw disposalError;
      return true;
    } catch (error) {
      if (committed) throw error;
      restoreMeshMaterials(slots, replacements);
      // The snapshots contain only the source materials. Any in-place
      // presentation mutation is restored before the prepared replacements
      // are released.
      for (const [material, snapshot] of snapshots) {
        restoreMaterial(material, snapshot);
      }
      for (const material of prepared) {
        try {
          material.dispose?.();
        } catch {
          // Preserve the original profile error.
        }
      }
      throw error;
    }
  }

  setMaterialProfile(profile) {
    if (this.disposed || !assertProfile(profile)) return false;
    const context = this._getSourceAndSlots();
    if (profile === this.profile && context.model === this._appliedModel) return false;
    return this._applyMaterialProfile(profile, context);
  }

  setBoardAppearance(boardAppearance) {
    if (this.disposed) return false;
    const context = this._getSourceAndSlots();
    if (!context) return false;
    const next = sanitizeBoardAppearance(boardAppearance);
    const snapshots = materialSlotsSnapshot(context.slots);
    try {
      for (const { material, className } of context.slots) {
        if (className === 'interior') setMaterialColor(material, next.interiorColor);
        if (className === 'edge') setMaterialColor(material, next.edgeColor);
      }
      this.boardAppearance = next;
      this._materialClassCounts = context.counts;
      return true;
    } catch (error) {
      for (const [material, snapshot] of snapshots) restoreMaterial(material, snapshot);
      throw error;
    }
  }

  getDiagnostics() {
    return {
      source: 'technical',
      disposed: this.disposed,
      profile: this.profile,
      boardAppearance: this.boardAppearance ? { ...this.boardAppearance } : null,
      materialClassCounts: { ...this._materialClassCounts },
      ownedMaterialCount: this._ownedMaterials.size,
    };
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    let firstDisposalError = null;
    for (const material of [...this._ownedMaterials]) {
      firstDisposalError = firstError(firstDisposalError, () => material.dispose?.());
    }
    this._ownedMaterials.clear();
    if (firstDisposalError) throw firstDisposalError;
    return true;
  }
}
