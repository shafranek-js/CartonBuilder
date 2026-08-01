import { BoxScene } from '../preview3d/BoxScene.js';
import { cloneBoardAppearance, sanitizeBoardAppearance } from './BoardAppearance.js';
import { RenderPostProcessing } from './RenderPostProcessing.js';
import { RenderQualityManager } from './RenderQualityManager.js';

export class WebGLCartonRenderer {
  constructor({
    canvas,
    container,
    boxModel,
    sceneModel = null,
    textureCanvas,
    renderSettings,
    boardAppearance,
    windowRef = window,
    onContextLost = () => {},
    onContextRestored = () => {},
    onCameraChange = () => {},
  }) {
    this.sceneModel = sceneModel;
    this.windowRef = windowRef;
    this.qualityState = 'interactive';
    this.boardAppearance = sanitizeBoardAppearance(boardAppearance);
    this.effects = structuredClone(renderSettings.effects);
    this.settleTimer = null;
    this.scene = new BoxScene({
      canvas,
      container,
      boxModel,
      textureCanvas,
      foldProgress: 1,
      cameraProjection: renderSettings.camera.projection,
      scenePreset: 'studio',
      lightAzimuth: renderSettings.lighting.azimuth,
      lightElevation: renderSettings.lighting.elevation,
      lightIntensity: renderSettings.lighting.intensity,
      shadowBlur: renderSettings.shadows.blur,
      shadowIntensity: renderSettings.shadows.intensity,
      shadowEnabled: renderSettings.shadows.enabled,
      shadowMapSize: renderSettings.shadows.mapSize,
      hemisphereIntensity: renderSettings.lighting.environmentIntensity,
      environmentPreset: renderSettings.lighting.environment,
      environmentIntensity: renderSettings.lighting.environmentIntensity,
      cameraPreset: renderSettings.camera.preset === 'custom' ? 'isometric' : renderSettings.camera.preset,
      cameraFov: renderSettings.camera.fov,
      backgroundColor: renderSettings.background.color,
      backgroundMode: renderSettings.background.mode,
      alpha: true,
      materialProfile: renderSettings.material.profile,
      geometryMode: 'solid',
      boardAppearance: this.boardAppearance,
      windowRef,
      onContextLost,
      onContextRestored,
      onCameraChange,
    });
    this.scene.setToneMapping('neutral');
    this.postProcessing = new RenderPostProcessing({
      renderer: this.scene.renderer,
      scene: this.scene.scene,
      camera: this.scene.camera,
      effects: this.effects,
      transparent: renderSettings.background.mode === 'transparent',
    });
    this.scene.setRenderCallback(() => {
      const startedAt = this.windowRef.performance?.now?.() ?? Date.now();
      this.postProcessing.render();
      const endedAt = this.windowRef.performance?.now?.() ?? Date.now();
      this.qualityManager?.recordFrame(endedAt - startedAt);
    });
    this.qualityManager = new RenderQualityManager({
      windowRef,
      profile: renderSettings.quality.interactive,
      onStateChange: (state) => {
        this.qualityState = state;
        this.postProcessing.setQualityState(state);
        this.scene.render();
      },
      onScaleChange: (scale) => this.postProcessing.setRenderScale(scale),
    });
    this.postProcessing.setRenderScale(this.qualityManager.scale);
    this.currentSettings = null;
    this.updateSettings(renderSettings, { render: false });
  }

  async initialize(sceneModel = this.sceneModel) {
    this.sceneModel = sceneModel;
    this.scene.render();
    return this;
  }

  updateSettings(settings, { render = true } = {}) {
    const previous = this.currentSettings;
    if (!previous || previous.material.profile !== settings.material.profile) {
      this.scene.setMaterialProfile(settings.material.profile);
    }
    if (!previous || previous.lighting.azimuth !== settings.lighting.azimuth || previous.lighting.elevation !== settings.lighting.elevation) {
      this.scene.setLightDirection(settings.lighting.azimuth, settings.lighting.elevation);
    }
    if (!previous || previous.lighting.intensity !== settings.lighting.intensity) {
      this.scene.setLightIntensity(settings.lighting.intensity);
    }
    if (!previous || previous.lighting.environmentIntensity !== settings.lighting.environmentIntensity) {
      this.scene.setHemisphereIntensity(settings.lighting.environmentIntensity);
      this.scene.setEnvironmentIntensity(settings.lighting.environmentIntensity);
    }
    if (!previous || previous.lighting.environment !== settings.lighting.environment) {
      this.scene.setEnvironment(settings.lighting.environment);
    }
    if (!previous || previous.shadows.enabled !== settings.shadows.enabled) this.scene.setShadowsEnabled(settings.shadows.enabled);
    if (!previous || previous.shadows.mapSize !== settings.shadows.mapSize) this.scene.setShadowMapSize(settings.shadows.mapSize);
    if (!previous || previous.shadows.blur !== settings.shadows.blur) this.scene.setShadowBlur(settings.shadows.blur);
    if (!previous || previous.shadows.intensity !== settings.shadows.intensity) this.scene.setShadowIntensity(settings.shadows.intensity);
    if (!previous || previous.background.mode !== settings.background.mode || previous.background.color !== settings.background.color) {
      this.scene.setBackgroundMode(settings.background.mode, settings.background.color, { render: false });
      this.postProcessing.setTransparent(settings.background.mode === 'transparent');
    }
    if (!previous || previous.lighting.exposure !== settings.lighting.exposure) this.scene.setExposure(settings.lighting.exposure);
    if (!previous || previous.camera.preset !== settings.camera.preset) {
      if (settings.camera.preset !== 'custom') this.scene.setCameraPreset(settings.camera.preset);
    }
    if (!previous || previous.camera.projection !== settings.camera.projection) this.scene.setCameraProjection(settings.camera.projection);
    if (!previous || previous.camera.fov !== settings.camera.fov) this.scene.setFov(settings.camera.fov);
    if (settings.camera.preset === 'custom' && (!previous || JSON.stringify(previous.camera) !== JSON.stringify(settings.camera))) {
      this.scene.setCameraState(settings.camera);
    }
    this.currentSettings = structuredClone(settings);
    if (!previous || JSON.stringify(previous.effects) !== JSON.stringify(settings.effects)) {
      this.effects = structuredClone(settings.effects);
      this.postProcessing.setEffects(this.effects);
    }
    if (!previous || previous.quality.interactive !== settings.quality.interactive) {
      this.qualityManager.setProfile(settings.quality.interactive);
    }
    if (render) this.markInteraction();
    if (render) this.scene.render();
  }

  markInteraction() {
    this.qualityManager.markInteraction();
  }

  updateCamera(camera) {
    this.scene.setCameraState(camera);
  }

  setCameraState(camera) {
    this.updateCamera(camera);
  }

  getCameraState() {
    return this.scene.getCameraState();
  }

  replaceArtwork(textureCanvas) {
    this.scene.replaceTexture(textureCanvas);
  }

  setBoardAppearance(boardAppearance) {
    this.boardAppearance = cloneBoardAppearance(boardAppearance);
    this.scene.setBoardAppearance(this.boardAppearance);
  }

  setEffects(effects) {
    this.effects = structuredClone(effects || this.effects);
    this.postProcessing.setEffects(this.effects);
    this.markInteraction();
    this.scene.render();
  }

  setQualityState(state) {
    this.qualityState = state;
    this.postProcessing.setQualityState(state);
  }

  renderSettled() {
    this.qualityState = 'settled';
    this.postProcessing.setQualityState('settled');
    this.scene.render();
  }

  renderExport(options = {}) {
    return this.renderToPixels(options);
  }

  resize(width, height, pixelRatio) {
    this.scene.resize({ width, height, pixelRatio });
    this.postProcessing.resize(
      width || this.scene.container.clientWidth || 1,
      height || this.scene.container.clientHeight || 1,
    );
  }

  render() {
    this.scene.render();
  }

  renderToPixels(options) {
    const previousQuality = this.qualityState;
    this.qualityManager.beginExport();
    return this.scene.renderToPixels({
      ...options,
      renderOverride: ({ target }) => this.postProcessing.renderToTarget(target),
    }).finally(() => {
      this.qualityManager.endExport(previousQuality === 'export' ? 'settled' : previousQuality);
    });
  }

  async exportImage(options = {}) {
    const { renderStill } = await import('./StillRenderService.js');
    return renderStill({
      renderer: this,
      settings: options.settings || this.currentSettings,
      format: options.format || 'png',
      width: options.width,
      height: options.height,
      documentRef: options.documentRef,
      signal: options.signal,
    });
  }

  getDiagnostics() {
    return {
      ...this.scene.getResourceInfo(),
      qualityState: this.qualityState,
      geometryMode: this.scene.geometryMode,
      boardAppearance: cloneBoardAppearance(this.boardAppearance),
      effects: structuredClone(this.effects),
      ...this.postProcessing.getDiagnostics(),
      quality: this.qualityManager.getDiagnostics(),
    };
  }

  dispose() {
    this.windowRef.clearTimeout(this.settleTimer);
    this.qualityManager.dispose();
    this.postProcessing.dispose();
    this.scene.setRenderCallback(null);
    this.scene.dispose();
  }
}
