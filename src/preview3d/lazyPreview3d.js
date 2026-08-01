const INITIAL_STATE = Object.freeze({
  active: false,
  foldProgress: 1,
  selectedPanelId: null,
  cameraProjection: 'perspective',
  cameraPreset: 'isometric',
  scenePreset: 'studio',
});

export function createLazyPreview3DFacade({
  getOptions,
}) {
  let controller = null;
  let loadPromise = null;
  let disposed = false;

  async function ensureController() {
    if (disposed) return null;
    if (controller) return controller;
    if (!loadPromise) {
      loadPromise = import('./Preview3DApp.js')
        .then(({ createPreview3DApp }) => {
          if (disposed) return null;
          controller = createPreview3DApp(getOptions());
          return controller;
        })
        .catch((error) => {
          loadPromise = null;
          throw error;
        });
    }
    return loadPromise;
  }

  const facade = {
    async activate() {
      const target = await ensureController();
      return target?.activate() || false;
    },
    deactivate() {
      controller?.deactivate();
    },
    suspend() {
      controller?.suspend();
    },
    setFoldProgress(value) {
      ensureController().then((target) => target?.setFoldProgress(value));
    },
    setCameraProjection(value) {
      ensureController().then((target) => target?.setCameraProjection(value));
    },
    setScenePreset(value) {
      ensureController().then((target) => target?.setScenePreset(value));
    },
    selectPanel(panelId) {
      ensureController().then((target) => target?.selectPanel(panelId));
    },
    resetView() {
      controller?.resetView();
    },
    render() {
      controller?.render();
    },
    resume() {
      if (controller?.getState().active) controller.activate();
    },
    getState() {
      return controller?.getState() || { ...INITIAL_STATE };
    },
    getResourceInfo() {
      return controller?.getResourceInfo() || {
        panels: 0,
        geometries: 0,
        textures: 0,
        calls: 0,
      };
    },
    resetForProject() {
      controller?.resetForProject();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller?.dispose();
      controller = null;
      loadPromise = null;
    },
  };

  return facade;
}
