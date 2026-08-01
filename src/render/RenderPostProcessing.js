import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

const QUALITY_STATES = new Set(['interactive', 'settled', 'export']);
const RENDER_EFFECTS_ENABLED = String(import.meta.env?.VITE_ENABLE_RENDER_EFFECTS ?? 'true').toLowerCase() !== 'false';

export function getRenderPassPlan({ state = 'interactive', effects = {}, transparent = false } = {}) {
  const aaMode = state === 'interactive'
    ? effects?.antialiasing?.interactive
    : effects?.antialiasing?.[state];
  const passes = [aaMode === 'taa' && !transparent ? 'taa' : 'render'];
  if (effects?.gtao?.enabled !== false && (state === 'settled' || state === 'export')) passes.push('gtao');
  if (effects?.dof?.enabled === true && state !== 'interactive') passes.push('dof');
  if (aaMode === 'smaa' || (transparent && aaMode === 'taa') || (state === 'interactive' && aaMode !== 'taa')) {
    passes.push('smaa');
  }
  passes.push('output');
  return passes;
}

function clone(value) {
  return structuredClone(value);
}

function passName(pass) {
  if (pass instanceof GTAOPass) return 'gtao';
  if (pass instanceof SMAAPass) return 'smaa';
  if (pass instanceof TAARenderPass) return 'taa';
  if (pass instanceof BokehPass) return 'dof';
  if (pass instanceof OutputPass) return 'output';
  if (pass instanceof RenderPass) return 'render';
  return pass?.constructor?.name || 'unknown';
}

export class RenderPostProcessing {
  constructor({ renderer, scene, camera, effects, transparent = false }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.effects = clone(effects);
    this.transparent = Boolean(transparent);
    this.effectsEnabled = RENDER_EFFECTS_ENABLED;
    this.qualityState = 'interactive';
    this.width = 1;
    this.height = 1;
    this.renderScale = 1;
    this.composer = new EffectComposer(renderer);
    this.rebuild();
  }

  setScene(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.rebuild();
  }

  setEffects(effects) {
    this.effects = clone(effects);
    this.rebuild();
  }

  setTransparent(value) {
    const next = Boolean(value);
    if (next === this.transparent) return;
    this.transparent = next;
    this.rebuild();
  }

  setQualityState(state) {
    const next = QUALITY_STATES.has(state) ? state : 'interactive';
    if (next === this.qualityState) return;
    this.qualityState = next;
    this.rebuild();
  }

  setRenderScale(scale) {
    const next = Number.isFinite(Number(scale)) ? Math.max(0.5, Math.min(2, Number(scale))) : 1;
    if (next === this.renderScale) return;
    this.renderScale = next;
    this.resize(this.width, this.height);
  }

  resize(width, height) {
    this.width = Math.max(1, Math.round(Number(width) || 1));
    this.height = Math.max(1, Math.round(Number(height) || 1));
    // Render scale is explicit; EffectComposer's device pixel ratio would
    // otherwise multiply it a second time on HiDPI displays.
    this.composer.setPixelRatio(1);
    this.composer.setSize(
      Math.max(1, Math.round(this.width * this.renderScale)),
      Math.max(1, Math.round(this.height * this.renderScale)),
    );
  }

  rebuild() {
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.passes.length = 0;
    this.renderer.setClearAlpha?.(this.transparent ? 0 : 1);
    const aaMode = !this.effectsEnabled ? 'native' : this.qualityState === 'interactive'
      ? this.effects?.antialiasing?.interactive
      : this.effects?.antialiasing?.[this.qualityState];
    const renderPass = aaMode === 'taa' && !this.transparent
      ? new TAARenderPass(this.scene, this.camera)
      : new RenderPass(this.scene, this.camera);
    if (renderPass instanceof TAARenderPass) {
      renderPass.sampleLevel = Math.max(0, Math.min(5, Math.round(Math.log2(
        Math.max(1, Number(this.effects?.antialiasing?.taaSamples) || 16),
      )) - 1));
      renderPass.unbiased = true;
    }
    this.composer.addPass(renderPass);

    const useGtao = this.effectsEnabled && this.effects?.gtao?.enabled !== false
      && (this.qualityState === 'settled' || this.qualityState === 'export');
    if (useGtao) {
      const divisor = this.qualityState === 'settled' && this.effects.gtao.resolution === 'half' ? 2 : 1;
      const gtao = new GTAOPass(
        this.scene,
        this.camera,
        Math.max(1, Math.round(this.width / divisor)),
        Math.max(1, Math.round(this.height / divisor)),
      );
      gtao.enabled = true;
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = this.effects.gtao.intensity;
      gtao.updateGtaoMaterial?.({
        radius: this.effects.gtao.radius,
        scale: Math.max(0.01, this.effects.gtao.intensity),
      });
      this.composer.addPass(gtao);
    }

    const useDof = this.effectsEnabled && this.effects?.dof?.enabled === true && this.qualityState !== 'interactive';
    if (useDof) {
      this.composer.addPass(new BokehPass(this.scene, this.camera, {
        focus: Number(this.effects.dof.focusDistance) || 1,
        aperture: Number(this.effects.dof.aperture) || 0.025,
        maxblur: Number(this.effects.dof.maxBlur) || 0.01,
      }));
    }

    if (aaMode === 'smaa' || (this.transparent && aaMode === 'taa') || (this.qualityState === 'interactive' && aaMode !== 'taa')) {
      this.composer.addPass(new SMAAPass());
    }

    this.composer.addPass(new OutputPass());
    this.resize(this.width, this.height);
  }

  render() {
    this.composer.render();
  }

  renderToTarget(target) {
    const previousRenderToScreen = this.composer.renderToScreen;
    const previousWidth = this.width;
    const previousHeight = this.height;
    const previousScale = this.renderScale;
    try {
      this.composer.renderToScreen = false;
      this.composer.setPixelRatio(1);
      this.composer.setSize(target.width, target.height);
      this.composer.render();
      // OutputPass writes to the composer read buffer when renderToScreen is false.
      const outputTarget = this.composer.readBuffer;
      return {
        target: outputTarget,
        restore: () => {
          this.composer.renderToScreen = previousRenderToScreen;
          this.width = previousWidth;
          this.height = previousHeight;
          this.renderScale = previousScale;
          this.resize(previousWidth, previousHeight);
        },
      };
    } catch (error) {
      this.composer.renderToScreen = previousRenderToScreen;
      this.width = previousWidth;
      this.height = previousHeight;
      this.renderScale = previousScale;
      this.resize(previousWidth, previousHeight);
      throw error;
    }
  }

  getDiagnostics() {
    return {
      qualityState: this.qualityState,
      renderScale: this.renderScale,
      transparent: this.transparent,
      passes: this.composer.passes.map(passName),
      taaSamples: this.qualityState === 'interactive'
        ? 0
        : Number(this.effects?.antialiasing?.taaSamples) || 16,
      gtaoEnabled: this.composer.passes.some((pass) => pass instanceof GTAOPass),
      dofEnabled: this.composer.passes.some((pass) => pass instanceof BokehPass),
      effectsEnabled: this.effectsEnabled,
    };
  }

  dispose() {
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.dispose?.();
    this.composer.passes.length = 0;
  }
}
