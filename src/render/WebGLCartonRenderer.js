import { LegacyRenderSceneSource } from './LegacyRenderSceneSource.js';
import { cloneBoardAppearance, sanitizeBoardAppearance } from './BoardAppearance.js';
import { RenderPostProcessing } from './RenderPostProcessing.js';
import { RenderQualityManager } from './RenderQualityManager.js';
import { getRenderHealth } from './renderPreflight.js';
import {
  assertRenderSceneController,
  assertRenderSceneSource,
  assertSharedRenderSurface,
} from './renderSceneActors.js';

function getFinishSummary(sceneModel) {
  return (sceneModel?.artworks || [])
    .filter((entry) => entry?.visible !== false && entry?.outputRole !== 'print' && entry?.finish)
    .map((entry, index) => ({
      index,
      type: entry.finish.type,
      outputRole: entry.outputRole,
      maskChannel: entry.finish.maskChannel,
    }));
}

export class WebGLCartonRenderer {
  constructor({
    canvas,
    container,
    boxModel,
    sceneModel = null,
    textureCanvas,
    materialMaps = null,
    renderSettings,
    boardAppearance,
    backgroundAsset = null,
    environmentAsset = null,
    windowRef = window,
    onContextLost = () => {},
    onContextRestored = () => {},
    onCameraChange = () => {},
    sceneSourceFactory = null,
    sceneController = null,
  }) {
    this.sceneModel = sceneModel;
    this.finishSummary = getFinishSummary(sceneModel);
    this.windowRef = windowRef;
    this.backgroundAsset = backgroundAsset || null;
    this.environmentAsset = environmentAsset || null;
    this.environmentAssetResolution = renderSettings.lighting.environmentMap?.resolutionCap || 2048;
    this.qualityState = 'interactive';
    this.contextState = 'ready';
    this.contextRecoveryCount = 0;
    this.lastExport = null;
    this.container = container;
    this.boardAppearance = sanitizeBoardAppearance(boardAppearance);
    this.effects = structuredClone(renderSettings.effects);
    this.settleTimer = null;
    const sourceOptions = {
      canvas,
      container,
      boxModel,
      textureCanvas,
      materialMaps,
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
      environmentMap: renderSettings.lighting.environmentMap,
      environmentAsset,
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
      finishSummary: this.finishSummary,
      windowRef,
      onContextLost: () => {
        this.contextState = 'lost';
        onContextLost();
      },
      onContextRestored: () => {
        this.contextState = 'restored';
        this.contextRecoveryCount += 1;
        onContextRestored();
      },
      onCameraChange,
    };
    if (sceneSourceFactory !== null && typeof sceneSourceFactory !== 'function') {
      throw new TypeError('sceneSourceFactory must be a function when provided.');
    }
    this.source = sceneSourceFactory
      ? sceneSourceFactory(sourceOptions)
      : new LegacyRenderSceneSource(sourceOptions);
    this.sceneController = sceneController || this.source;
    assertRenderSceneSource(this.source);
    assertRenderSceneController(this.sceneController);
    assertSharedRenderSurface(this.source, this.sceneController);
    // Keep the established internal scene handle while routing scene
    // operations through the source boundary. The public renderer API is
    // unchanged; future sources can replace this adapter without changing
    // RenderApp or its controls.
    this.scene = this.sceneController;
    this.sceneController.setToneMapping('neutral');
    this.postProcessing = new RenderPostProcessing({
      renderer: this.sceneController.renderSurface.renderer,
      scene: this.sceneController.renderSurface.scene,
      camera: this.sceneController.renderSurface.camera,
      effects: this.effects,
      transparent: renderSettings.background.mode === 'transparent',
    });
    this.sceneController.setRenderCallback(() => {
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
        this.sceneController.render();
      },
      onScaleChange: (scale) => this.postProcessing.setRenderScale(scale),
    });
    this.postProcessing.setRenderScale(this.qualityManager.scale);
    this.currentSettings = null;
    this.updateSettings(renderSettings, { render: false });
  }

  async initialize(sceneModel = this.sceneModel) {
    this.sceneModel = sceneModel;
    this.finishSummary = getFinishSummary(sceneModel);
    this.source.setFinishSummary?.(this.finishSummary);
    this.sceneController.render();
    return this;
  }

  updateSettings(settings, { render = true } = {}) {
    const previous = this.currentSettings;
    const previousCameraObject = this.sceneController.renderSurface.camera;
    if (!previous || previous.material.profile !== settings.material.profile) {
      this.sceneController.setMaterialProfile(settings.material.profile);
    }
    if (!previous || previous.lighting.azimuth !== settings.lighting.azimuth || previous.lighting.elevation !== settings.lighting.elevation) {
      this.sceneController.setLightDirection(settings.lighting.azimuth, settings.lighting.elevation);
    }
    if (!previous || previous.lighting.intensity !== settings.lighting.intensity) {
      this.sceneController.setLightIntensity(settings.lighting.intensity);
    }
    if (!previous || previous.lighting.environmentIntensity !== settings.lighting.environmentIntensity) {
      this.sceneController.setHemisphereIntensity(settings.lighting.environmentIntensity);
      this.sceneController.setEnvironmentIntensity(settings.lighting.environmentIntensity);
    }
    if (!previous || previous.lighting.environment !== settings.lighting.environment) {
      this.sceneController.setEnvironment(settings.lighting.environment);
    }
    if (!previous || JSON.stringify(previous.lighting.environmentMap) !== JSON.stringify(settings.lighting.environmentMap)) {
      this.sceneController.setEnvironmentMap?.(settings.lighting.environmentMap, { render: false });
    }
    if (!previous || previous.shadows.enabled !== settings.shadows.enabled) this.sceneController.setShadowsEnabled(settings.shadows.enabled);
    if (!previous || previous.shadows.mapSize !== settings.shadows.mapSize) this.sceneController.setShadowMapSize(settings.shadows.mapSize);
    if (!previous || previous.shadows.blur !== settings.shadows.blur) this.sceneController.setShadowBlur(settings.shadows.blur);
    if (!previous || previous.shadows.intensity !== settings.shadows.intensity) this.sceneController.setShadowIntensity(settings.shadows.intensity);
    if (!previous || previous.background.mode !== settings.background.mode || previous.background.color !== settings.background.color) {
      this.sceneController.setBackgroundMode(settings.background.mode, settings.background.color, { render: false });
      this.postProcessing.setTransparent(settings.background.mode === 'transparent');
    }
    if (!previous || JSON.stringify(previous.background.image) !== JSON.stringify(settings.background.image)) {
      this.sceneController.setBackgroundImage(settings.background.image);
    }
    if (!previous || JSON.stringify(previous.floor.reflection) !== JSON.stringify(settings.floor.reflection)) {
      this.sceneController.setFloorReflection(settings.floor.reflection, { render: false });
    }
    if (!previous || previous.lighting.exposure !== settings.lighting.exposure) this.sceneController.setExposure(settings.lighting.exposure);
    const cameraChanged = !previous || JSON.stringify(previous.camera) !== JSON.stringify(settings.camera);
    if (cameraChanged) {
      const presetChanged = settings.camera.preset !== 'custom' && settings.camera.preset !== previous?.camera?.preset;
      if (presetChanged) {
        this.sceneController.setCameraPreset(settings.camera.preset);
      }
      this.sceneController.setCameraState(presetChanged
        ? { ...settings.camera, position: undefined, target: undefined }
        : settings.camera);
      if (this.sceneController.renderSurface.camera !== previousCameraObject) {
        // BoxScene swaps between its perspective and orthographic camera
        // objects. Every post-processing pass keeps its own camera reference,
        // so rebuild the composer when that identity changes.
        this.postProcessing.setScene(
          this.sceneController.renderSurface.scene,
          this.sceneController.renderSurface.camera,
        );
      }
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
    if (render) this.sceneController.render();
  }

  markInteraction() {
    this.qualityManager.markInteraction();
  }

  updateCamera(camera) {
    const previousCameraObject = this.sceneController.renderSurface.camera;
    this.sceneController.setCameraState(camera);
    if (this.sceneController.renderSurface.camera !== previousCameraObject) {
      this.postProcessing.setScene(
        this.sceneController.renderSurface.scene,
        this.sceneController.renderSurface.camera,
      );
    }
  }

  setCameraState(camera) {
    this.updateCamera(camera);
  }

  getCameraState() {
    return this.sceneController.getCameraState();
  }

  createPortableScene(options = {}) {
    return this.source.createPortableScene(options);
  }

  fitCameraToFrame(options = {}) {
    return this.sceneController.fitCameraToFrame(options);
  }

  resetView(options = {}) {
    return this.sceneController.resetView(options);
  }

  replaceArtwork(textureCanvas, materialMaps = null, sceneModel = null) {
    if (sceneModel) {
      this.sceneModel = sceneModel;
      this.finishSummary = getFinishSummary(sceneModel);
      this.source.setFinishSummary?.(this.finishSummary);
    }
    this.source.replaceArtwork(textureCanvas, materialMaps);
  }

  setBoardAppearance(boardAppearance) {
    this.boardAppearance = cloneBoardAppearance(boardAppearance);
    this.source.setBoardAppearance(this.boardAppearance);
  }

  getBounds() {
    return this.source.getBounds();
  }

  setBackgroundAsset(asset) {
    const nextAsset = asset || null;
    const previousId = this.backgroundAsset?.assetId || '';
    const nextId = nextAsset?.assetId || '';
    if (previousId === nextId) return Promise.resolve(Boolean(nextAsset));
    this.backgroundAsset = nextAsset;
    return this.sceneController.setBackgroundAsset(nextAsset, { render: true });
  }

  setEnvironmentAsset(asset) {
    this.environmentAsset = asset || null;
    const previous = this.sceneController.environmentAsset || null;
    const previousKey = previous
      ? `${previous.source || 'custom'}:${previous.assetId || previous.presetId || ''}`
      : '';
    const nextKey = asset
      ? `${asset.source || 'custom'}:${asset.assetId || asset.presetId || ''}`
      : '';
    const nextResolution = this.sceneController.environmentMap?.resolutionCap || 2048;
    if (previousKey === nextKey && this.environmentAssetResolution === nextResolution) {
      return Promise.resolve(Boolean(asset));
    }
    this.environmentAssetResolution = nextResolution;
    return this.sceneController.setEnvironmentAsset?.(asset, { render: true });
  }

  setEffects(effects) {
    this.effects = structuredClone(effects || this.effects);
    this.postProcessing.setEffects(this.effects);
    this.markInteraction();
    this.sceneController.render();
  }

  setQualityState(state) {
    this.qualityState = state;
    this.postProcessing.setQualityState(state);
  }

  renderSettled() {
    this.qualityState = 'settled';
    this.postProcessing.setQualityState('settled');
    this.sceneController.render();
  }

  renderExport(options = {}) {
    return this.renderToPixels(options);
  }

  resize(width, height, pixelRatio) {
    const nextWidth = Number(width) > 0 ? Number(width) : Number(this.container.clientWidth);
    const nextHeight = Number(height) > 0 ? Number(height) : Number(this.container.clientHeight);
    if (!(nextWidth > 0) || !(nextHeight > 0)) return false;
    if (this.sceneController.resize({ width: nextWidth, height: nextHeight, pixelRatio }) === false) return false;
    this.postProcessing.resize(nextWidth, nextHeight);
    return true;
  }

  render() {
    this.sceneController.render();
  }

  renderToPixels(options) {
    const previousQuality = this.qualityState;
    const startedAt = this.windowRef.performance?.now?.() ?? Date.now();
    this.qualityManager.beginExport();
    const exportOptions = {
      ...options,
      renderOverride: ({ target }) => this.postProcessing.renderToTarget(target),
    };
    return this.sceneController.renderToPixels(exportOptions)
      .then(async (result) => {
        // Some WebGL implementations leave EffectComposer's offscreen buffer
        // transparent black even though the on-screen composer is rendered.
        // If readback contains no pixels at all, fall back to the same scene
        // without post-processing so PNG/JPG export remains usable.
        const output = result.pixels.some((value) => value !== 0)
          ? result
          : await this.sceneController.renderToPixels({ ...options, renderOverride: null });
        const endedAt = this.windowRef.performance?.now?.() ?? Date.now();
        this.lastExport = {
          width: output.width,
          height: output.height,
          durationMs: Math.max(0, Math.round(endedAt - startedAt)),
        };
        return output;
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
    const diagnostics = {
      backend: 'WebGL2',
      contextState: this.contextState,
      contextRecoveryCount: this.contextRecoveryCount,
      lastExport: this.lastExport ? { ...this.lastExport } : null,
      ...this.source.getDiagnostics(),
      qualityState: this.qualityState,
      geometryMode: this.source.geometryMode || null,
      boardAppearance: cloneBoardAppearance(this.boardAppearance),
      effects: structuredClone(this.effects),
      ...this.postProcessing.getDiagnostics(),
      quality: this.qualityManager.getDiagnostics(),
    };
    diagnostics.health = getRenderHealth(diagnostics);
    return diagnostics;
  }

  dispose() {
    this.windowRef.clearTimeout(this.settleTimer);
    this.qualityManager.dispose();
    this.postProcessing.dispose();
    this.sceneController.setRenderCallback(null);
    let disposalError = null;
    try {
      this.source.dispose();
    } catch (error) {
      disposalError = error;
    }
    if (this.sceneController !== this.source) {
      try {
        this.sceneController.dispose();
      } catch (error) {
        disposalError ||= error;
      }
    }
    if (disposalError) throw disposalError;
  }
}
