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
    backgroundAsset = null,
    windowRef = window,
    onContextLost = () => {},
    onContextRestored = () => {},
    onCameraChange = () => {},
  }) {
    this.sceneModel = sceneModel;
    this.windowRef = windowRef;
    this.backgroundAsset = backgroundAsset || null;
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
      cameraFocalLength: renderSettings.camera.focalLength,
      cameraHeading: renderSettings.camera.heading,
      cameraElevation: renderSettings.camera.elevation,
      cameraHorizontalPan: renderSettings.camera.horizontalPan,
      cameraVerticalPan: renderSettings.camera.verticalPan,
      orthographicHeight: renderSettings.camera.orthographicHeight,
      verticalCorrection: renderSettings.camera.verticalCorrection,
      backgroundColor: renderSettings.background.color,
      backgroundMode: renderSettings.background.mode,
      backgroundImage: renderSettings.background.image,
      floorReflection: renderSettings.floor.reflection,
      backgroundAsset,
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
    if (!previous || JSON.stringify(previous.background.image) !== JSON.stringify(settings.background.image)) {
      this.scene.setBackgroundImage(settings.background.image);
    }
    if (!previous || JSON.stringify(previous.floor.reflection) !== JSON.stringify(settings.floor.reflection)) {
      this.scene.setFloorReflection(settings.floor.reflection, { render: false });
    }
    if (!previous || previous.lighting.exposure !== settings.lighting.exposure) this.scene.setExposure(settings.lighting.exposure);
    const cameraChanged = !previous || JSON.stringify(previous.camera) !== JSON.stringify(settings.camera);
    if (cameraChanged) {
      const presetChanged = settings.camera.preset !== 'custom' && settings.camera.preset !== previous?.camera?.preset;
      if (presetChanged) {
        this.scene.setCameraPreset(settings.camera.preset);
      }
      this.scene.setCameraState(presetChanged
        ? { ...settings.camera, position: undefined, target: undefined }
        : settings.camera);
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

  createPortableScene(options = {}) {
    return this.scene.createPortableScene(options);
  }

  fitCameraToFrame(options = {}) {
    return this.scene.fitCameraToFrame(options);
  }

  resetView(options = {}) {
    return this.scene.resetView(options);
  }

  replaceArtwork(textureCanvas) {
    this.scene.replaceTexture(textureCanvas);
  }

  setBoardAppearance(boardAppearance) {
    this.boardAppearance = cloneBoardAppearance(boardAppearance);
    this.scene.setBoardAppearance(this.boardAppearance);
  }

  setBackgroundAsset(asset) {
    const nextAsset = asset || null;
    const previousId = this.backgroundAsset?.assetId || '';
    const nextId = nextAsset?.assetId || '';
    if (previousId === nextId) return Promise.resolve(Boolean(nextAsset));
    this.backgroundAsset = nextAsset;
    return this.scene.setBackgroundAsset(nextAsset, { render: true });
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
    const exportOptions = {
      ...options,
      renderOverride: ({ target }) => this.postProcessing.renderToTarget(target),
    };
    return this.scene.renderToPixels(exportOptions)
      .then(async (result) => {
        // Some WebGL implementations leave EffectComposer's offscreen buffer
        // transparent black even though the on-screen composer is rendered.
        // If readback contains no pixels at all, fall back to the same scene
        // without post-processing so PNG/JPG export remains usable.
        if (result.pixels.some((value) => value !== 0)) return result;
        return this.scene.renderToPixels({ ...options, renderOverride: null });
      })
      .finally(() => {
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
