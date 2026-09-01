import * as THREE from 'three';
import { buildFoldableFromSemanticSvg } from './model/model-builder.js';
import { disposeObject } from './utils/dispose.js';
import { ARTWORK_MAP_KEYS, getArtworkSurfaceMaterials } from './geometry/materials.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

class HeadlessFileReader {
  constructor() {
    this.result = null;
    this.error = null;
    this.onload = null;
    this.onloadend = null;
    this.onerror = null;
  }

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }).catch((error) => {
      this.error = error;
      this.onerror?.({ target: this, error });
      this.onloadend?.({ target: this });
    });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      const bytes = new Uint8Array(result);
      let base64;
      if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(bytes).toString('base64');
      } else {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        base64 = btoa(binary);
      }
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }).catch((error) => {
      this.error = error;
      this.onerror?.({ target: this, error });
      this.onloadend?.({ target: this });
    });
  }
}

async function withFileReader(callback) {
  const previous = globalThis.FileReader;
  if (typeof previous !== 'function') globalThis.FileReader = HeadlessFileReader;
  try {
    return await callback();
  } finally {
    if (typeof previous === 'undefined') delete globalThis.FileReader;
    else globalThis.FileReader = previous;
  }
}

export function createHeadlessFoldRuntime(options = {}) {
  let root = null;
  let mixer = null;
  let clips = [];
  let action = null;
  let activeClip = null;
  let progress = 0;
  let parsed = null;
  let artworkTextures = new Set();
  const artworkMaterialStates = new WeakMap();

  function textureFromSource(source, label) {
    if (source?.isTexture === true) {
      return source;
    }
    if (!source || typeof source !== 'object') {
      throw new Error(`Invalid artwork atlas ${label}: expected a canvas, bitmap, image data, or THREE.Texture.`);
    }
    const texture = new THREE.Texture(source);
    texture.name = `ArtworkAtlas_${label}`;
    texture.anisotropy = 16;
    texture.needsUpdate = true;
    return texture;
  }

  function rememberArtworkMaterial(material) {
    if (artworkMaterialStates.has(material)) return artworkMaterialStates.get(material);
    const state = {
      map: material.map,
      alphaMap: material.alphaMap,
      normalMap: material.normalMap,
      roughnessMap: material.roughnessMap,
      metalnessMap: material.metalnessMap,
      transparent: material.transparent,
      color: material.color?.clone?.() || null
    };
    artworkMaterialStates.set(material, state);
    return state;
  }

  function restoreArtworkMaterial(material) {
    const state = artworkMaterialStates.get(material);
    if (!state) return;
    material.map = state.map;
    material.alphaMap = state.alphaMap;
    material.normalMap = state.normalMap;
    material.roughnessMap = state.roughnessMap;
    material.metalnessMap = state.metalnessMap;
    material.transparent = state.transparent;
    if (state.color && material.color) material.color.copy(state.color);
    material.needsUpdate = true;
  }

  function restoreArtworkMaterials() {
    getArtworkSurfaceMaterials(root).forEach(restoreArtworkMaterial);
  }

  function disposeArtworkTexturesExcept(nextTextures) {
    for (const texture of artworkTextures) {
      if (!nextTextures.has(texture)) texture.dispose?.();
    }
  }

  function setArtworkAtlas(canvasOrBitmap, maps = {}) {
    if (!root) throw new Error('Cannot set artwork atlas: no semantic SVG is loaded.');
    if (!maps || typeof maps !== 'object' || Array.isArray(maps)) {
      throw new Error('Invalid artwork atlas maps: expected an object.');
    }
    for (const key of Object.keys(maps)) {
      if (!ARTWORK_MAP_KEYS.includes(key)) {
        throw new Error(`Unsupported artwork atlas map: ${key}`);
      }
    }

    const sources = {
      baseColor: canvasOrBitmap,
      ...maps
    };
    const nextMaps = {};
    const nextTextures = new Set();
    try {
      nextMaps.baseColor = textureFromSource(sources.baseColor, 'base-color');
      nextTextures.add(nextMaps.baseColor);
      for (const key of ARTWORK_MAP_KEYS) {
        if (sources[key] == null) continue;
        nextMaps[key] = textureFromSource(sources[key], key);
        nextTextures.add(nextMaps[key]);
      }

      nextMaps.baseColor.colorSpace = THREE.SRGBColorSpace;
      nextMaps.baseColor.needsUpdate = true;

      const materials = getArtworkSurfaceMaterials(root);
      for (const material of materials) {
        const original = rememberArtworkMaterial(material);
        material.map = nextMaps.baseColor;
        material.alphaMap = nextMaps.alpha ?? original.alphaMap;
        material.normalMap = nextMaps.normal ?? original.normalMap;
        material.roughnessMap = nextMaps.roughness ?? original.roughnessMap;
        material.metalnessMap = nextMaps.metalness ?? original.metalnessMap;
        material.transparent = nextMaps.alpha ? true : original.transparent;
        if (material.color) material.color.set(0xffffff);
        material.needsUpdate = true;
      }
    } catch (error) {
      nextTextures.forEach((texture) => {
        if (!artworkTextures.has(texture)) texture.dispose?.();
      });
      throw error;
    }

    disposeArtworkTexturesExcept(nextTextures);
    artworkTextures = nextTextures;
  }

  function loadSemanticSvgText(svgText, name = 'carton.svg') {
    dispose();
    const result = buildFoldableFromSemanticSvg(svgText, name);
    root = result.model;
    clips = result.animations || [];
    parsed = result.parsed;
    mixer = new THREE.AnimationMixer(root);
    if (clips.length > 0) {
      let preferred = clips.findIndex((c) => /assembly/i.test(c.name));
      if (preferred < 0) preferred = clips.findIndex((c) => /simultaneous/i.test(c.name));
      if (preferred < 0) preferred = 0;
      selectClip(preferred);
    }
    return { model: root, animations: clips, parsed };
  }

  function loadSemanticSvg(svgText, name = 'carton.svg') {
    return loadSemanticSvgText(svgText, name);
  }

  function selectClip(index) {
    if (!mixer || !clips.length) return;
    mixer.stopAllAction();
    activeClip = clips[index] || clips[0];
    action = mixer.clipAction(activeClip);
    action.reset();
    action.enabled = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    setFoldProgress(progress);
  }

  function setFoldProgress(value) {
    progress = THREE.MathUtils.clamp(value, 0, 1);
    if (!mixer || !activeClip || !action) return;
    action.paused = false;
    action.enabled = true;
    action.play();
    mixer.setTime(progress * activeClip.duration);
    mixer.update(0);
    if (root) root.updateMatrixWorld(true);
    action.paused = true;
  }

  function getModel() {
    return root;
  }

  function getAnimations() {
    return clips;
  }

  function getActiveClip() {
    return activeClip;
  }

  function getFoldProgress() {
    return progress;
  }

  function getParsedData() {
    return parsed;
  }

  async function exportGlb() {
    if (!root) throw new Error('Cannot export GLB: no semantic SVG is loaded.');
    root.updateMatrixWorld(true);
    const exporter = new GLTFExporter();
    return withFileReader(() => exporter.parseAsync(root, {
      binary: true,
      trs: true,
      onlyVisible: false,
      animations: clips
    }));
  }

  function dispose() {
    if (mixer) {
      mixer.stopAllAction();
      if (root) {
        for (const clip of clips) mixer.uncacheAction(clip, root);
        mixer.uncacheRoot(root);
      }
    }
    if (root) {
      restoreArtworkMaterials();
      root.removeFromParent?.();
      disposeObject(root);
    }
    artworkTextures.forEach((texture) => texture.dispose?.());
    artworkTextures.clear();
    root = null;
    mixer = null;
    clips = [];
    action = null;
    activeClip = null;
    progress = 0;
    parsed = null;
  }

  if (options.svgText !== undefined && options.svgText !== null) {
    loadSemanticSvgText(options.svgText, options.name || 'carton.svg');
  }

  return {
    loadSemanticSvgText,
    loadSemanticSvg,
    selectClip,
    setFoldProgress,
    getModel,
    getAnimations,
    getActiveClip,
    getFoldProgress,
    getParsedData,
    setArtworkAtlas,
    exportGlb,
    dispose,
  };
}
