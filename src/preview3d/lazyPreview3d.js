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
  let requestedActive = false;
  const statePatch = {};

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
      requestedActive = true;
      // Make the loading contract observable before the dynamic import starts.
      // Otherwise a hidden-by-default busy overlay can make callers believe the
      // controller is ready while Preview3DApp is still being evaluated.
      const busy = globalThis.document?.getElementById?.('preview3dBusy');
      if (busy) busy.hidden = false;
      const target = await ensureController();
      return target?.activate() || false;
    },
    deactivate() {
      requestedActive = false;
      controller?.deactivate();
    },
    suspend() {
      controller?.suspend();
    },
    setFoldProgress(value) {
      const next = Math.max(0, Math.min(1, Number(value)));
      if (Number.isFinite(next)) statePatch.foldProgress = next;
      ensureController().then((target) => target?.setFoldProgress(value));
    },
    setCameraProjection(value) {
      statePatch.cameraProjection = value;
      ensureController().then((target) => target?.setCameraProjection(value));
    },
    setScenePreset(value) {
      statePatch.scenePreset = value;
      ensureController().then((target) => target?.setScenePreset(value));
    },
    setBoardCaliper(value) {
      ensureController().then((target) => target?.setBoardCaliper(value));
    },
    selectPanel(panelId) {
      statePatch.selectedPanelId = panelId;
      ensureController().then((target) => target?.selectPanel(panelId));
    },
    resetView() {
      controller?.resetView();
    },
    render() {
      controller?.render();
    },
    refreshArtwork() {
      if (!controller) return Promise.resolve(false);
      return controller.refreshArtwork();
    },
    resume() {
      if (controller?.getState().active) controller.activate();
    },
    getState() {
      const state = controller?.getState();
      if (state) return { ...state, ...statePatch };
      return { ...INITIAL_STATE, active: requestedActive, ...statePatch };
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
      for (const key of Object.keys(statePatch)) delete statePatch[key];
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
