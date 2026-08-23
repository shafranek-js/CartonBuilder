import { BoxScene } from '../preview3d/BoxScene.js';
import { RenderSceneSource } from './RenderSceneSource.js';

/**
 * Adapter for the existing Quick/legacy BoxScene implementation.
 *
 * Geometry construction remains entirely inside BoxScene. This adapter only
 * exposes the source contract and forwards the established scene operations.
 */
export class LegacyRenderSceneSource extends RenderSceneSource {
  constructor({ boxScene = null, ...boxSceneOptions } = {}) {
    super();
    this.boxScene = boxScene || new BoxScene(boxSceneOptions);
    this.disposed = false;
    const legacyScene = this.boxScene;
    this._renderSurface = Object.freeze({
      get scene() { return legacyScene.scene; },
      get camera() { return legacyScene.camera; },
      get renderer() { return legacyScene.renderer; },
    });
  }

  get scene() { return this.boxScene.scene; }
  get camera() { return this.boxScene.camera; }
  get renderer() { return this.boxScene.renderer; }
  get container() { return this.boxScene.container; }
  get environmentAsset() { return this.boxScene.environmentAsset; }
  get environmentMap() { return this.boxScene.environmentMap; }
  get geometryMode() { return this.boxScene.geometryMode; }
  get renderSurface() { return this._renderSurface; }

  getRenderSurface() {
    return this._renderSurface;
  }

  buildScene() {
    return this._renderSurface;
  }

  setToneMapping(...args) { return this.boxScene.setToneMapping(...args); }
  setRenderCallback(...args) { return this.boxScene.setRenderCallback(...args); }
  setFinishSummary(...args) { return this.boxScene.setFinishSummary(...args); }
  setMaterialProfile(...args) { return this.boxScene.setMaterialProfile(...args); }
  setLightDirection(...args) { return this.boxScene.setLightDirection(...args); }
  setLightIntensity(...args) { return this.boxScene.setLightIntensity(...args); }
  setHemisphereIntensity(...args) { return this.boxScene.setHemisphereIntensity(...args); }
  setEnvironmentIntensity(...args) { return this.boxScene.setEnvironmentIntensity(...args); }
  setEnvironment(...args) { return this.boxScene.setEnvironment(...args); }
  setEnvironmentMap(...args) { return this.boxScene.setEnvironmentMap(...args); }
  setShadowsEnabled(...args) { return this.boxScene.setShadowsEnabled(...args); }
  setShadowMapSize(...args) { return this.boxScene.setShadowMapSize(...args); }
  setShadowBlur(...args) { return this.boxScene.setShadowBlur(...args); }
  setShadowIntensity(...args) { return this.boxScene.setShadowIntensity(...args); }
  setBackgroundMode(...args) { return this.boxScene.setBackgroundMode(...args); }
  setBackgroundImage(...args) { return this.boxScene.setBackgroundImage(...args); }
  setFloorReflection(...args) { return this.boxScene.setFloorReflection(...args); }
  setExposure(...args) { return this.boxScene.setExposure(...args); }
  setCameraPreset(...args) { return this.boxScene.setCameraPreset(...args); }
  setCameraState(...args) { return this.boxScene.setCameraState(...args); }
  setCameraProjection(...args) { return this.boxScene.setCameraProjection(...args); }
  getCameraState(...args) { return this.boxScene.getCameraState(...args); }
  createPortableScene(...args) { return this.boxScene.createPortableScene(...args); }
  fitCameraToFrame(...args) { return this.boxScene.fitCameraToFrame(...args); }
  resetView(...args) { return this.boxScene.resetView(...args); }
  replaceArtwork(textureCanvas, materialMaps = null) {
    return this.boxScene.replaceTexture(textureCanvas, materialMaps);
  }
  setBoardAppearance(...args) { return this.boxScene.setBoardAppearance(...args); }
  setBackgroundAsset(...args) { return this.boxScene.setBackgroundAsset(...args); }
  setEnvironmentAsset(...args) { return this.boxScene.setEnvironmentAsset(...args); }
  render(...args) { return this.boxScene.render(...args); }
  renderToPixels(...args) { return this.boxScene.renderToPixels(...args); }
  resize(...args) { return this.boxScene.resize(...args); }
  getResourceInfo(...args) { return this.boxScene.getResourceInfo(...args); }
  getGeometryDiagnostics(...args) { return this.boxScene.getGeometryDiagnostics(...args); }
  getDiagnostics() { return this.getResourceInfo(); }
  getBounds() { return this.boxScene.boxModel?.getBounds?.() || null; }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    this.boxScene.dispose();
    return true;
  }
}
