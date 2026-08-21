import * as THREE from 'three';
import { parseSemanticCartonSvg } from '../pbd/semantic-svg.js';
import { buildFoldableFromSemanticSvg } from '../model/model-builder.js';
import { disposeObject } from '../utils/dispose.js';

export function createHeadlessFoldRuntime(options = {}) {
  let root = null;
  let mixer = null;
  let clips = [];
  let action = null;
  let activeClip = null;
  let progress = 0;
  let parsed = null;

  function loadSemanticSvg(svgText, name = 'carton.svg') {
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

  function dispose() {
    if (mixer) {
      mixer.stopAllAction();
      if (root) mixer.uncacheRoot(root);
    }
    if (root) {
      disposeObject(root);
      root = null;
    }
    mixer = null;
    clips = [];
    action = null;
    activeClip = null;
    progress = 0;
    parsed = null;
  }

  if (options.svgText) {
    loadSemanticSvg(options.svgText, options.name || 'carton.svg');
  }

  return {
    loadSemanticSvg,
    selectClip,
    setFoldProgress,
    getModel,
    getAnimations,
    getActiveClip,
    getFoldProgress,
    getParsedData,
    dispose,
  };
}
