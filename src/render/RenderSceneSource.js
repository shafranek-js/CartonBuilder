/**
 * Common scene-source boundary for the shared Render surface.
 *
 * Render owns presentation concerns (camera controls, lighting, post
 * processing and export orchestration); a source owns the carton scene and
 * its geometry/resources. Concrete sources must expose the render surface
 * and the small set of scene operations used by the shared renderer.
 */
export class RenderSceneSource {
  constructor() {
    if (new.target === RenderSceneSource) {
      throw new TypeError('RenderSceneSource is an abstract contract.');
    }
  }

  getRenderSurface() {
    throw new Error('RenderSceneSource.getRenderSurface() must be implemented.');
  }

  buildScene() {
    throw new Error('RenderSceneSource.buildScene() must be implemented.');
  }

  replaceArtwork() {
    throw new Error('RenderSceneSource.replaceArtwork() must be implemented.');
  }

  setBoardAppearance() {
    throw new Error('RenderSceneSource.setBoardAppearance() must be implemented.');
  }

  createPortableScene() {
    throw new Error('RenderSceneSource.createPortableScene() must be implemented.');
  }

  getBounds() {
    throw new Error('RenderSceneSource.getBounds() must be implemented.');
  }

  getDiagnostics() {
    throw new Error('RenderSceneSource.getDiagnostics() must be implemented.');
  }

  dispose() {
    throw new Error('RenderSceneSource.dispose() must be implemented.');
  }
}
