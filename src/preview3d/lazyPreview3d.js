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
  const patchTokens = new Map();

  function queueStatePatch(key, value, apply) {
    const token = Symbol(key);
    statePatch[key] = value;
    patchTokens.set(key, token);
    ensureController()
      .then((target) => {
        if (!target) return;
        apply(target);
        if (patchTokens.get(key) === token) {
          delete statePatch[key];
          patchTokens.delete(key);
        }
      })
      .catch(() => {
        // Keep the requested value visible through getState(); a later
        // activation/retry will apply it to the controller.
      });
  }

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
      if (Number.isFinite(next)) queueStatePatch('foldProgress', next, (target) => target.setFoldProgress(next));
    },
    setCameraProjection(value) {
      queueStatePatch('cameraProjection', value, (target) => target.setCameraProjection(value));
    },
    setScenePreset(value) {
      queueStatePatch('scenePreset', value, (target) => target.setScenePreset(value));
    },
    setBoardAppearance(value) {
      ensureController().then((target) => target?.setBoardAppearance(value));
    },
    setBoardCaliper(value) {
      ensureController().then((target) => target?.setBoardCaliper(value));
    },
    selectPanel(panelId) {
      queueStatePatch('selectedPanelId', panelId, (target) => target.selectPanel(panelId));
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
      patchTokens.clear();
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
