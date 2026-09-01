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
  const pendingPatches = new Map();

  function applyPendingPatch(target, key, patch) {
    if (pendingPatches.get(key) !== patch) return;
    try {
      patch.apply(target, patch.value);
    } catch {
      // Keep the requested value queued so a later activation or setter can
      // retry it without creating an unhandled rejection.
      return;
    }
    if (pendingPatches.get(key) === patch) {
      pendingPatches.delete(key);
      if (patch.expose) delete statePatch[key];
    }
  }

  function applyPendingPatches(target) {
    for (const [key, patch] of pendingPatches) applyPendingPatch(target, key, patch);
  }

  function queuePatch(key, value, apply, { expose = true } = {}) {
    const patch = { value, apply, expose };
    pendingPatches.set(key, patch);
    if (expose) statePatch[key] = value;
    if (controller) applyPendingPatch(controller, key, patch);
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
      if (!target) return false;
      applyPendingPatches(target);
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
      if (Number.isFinite(next)) queuePatch('foldProgress', next, (target, current) => target.setFoldProgress(current));
    },
    setCameraProjection(value) {
      queuePatch('cameraProjection', value, (target, current) => target.setCameraProjection(current));
    },
    setScenePreset(value) {
      queuePatch('scenePreset', value, (target, current) => target.setScenePreset(current));
    },
    setBoardAppearance(value) {
      queuePatch('boardAppearance', value, (target, current) => target.setBoardAppearance(current), { expose: false });
    },
    setBoardCaliper(value) {
      queuePatch('boardCaliper', value, (target, current) => target.setBoardCaliper(current), { expose: false });
    },
    selectPanel(panelId) {
      queuePatch('selectedPanelId', panelId, (target, current) => target.selectPanel(current));
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
      pendingPatches.clear();
      controller?.resetForProject();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller?.dispose();
      controller = null;
      loadPromise = null;
      pendingPatches.clear();
    },
  };

  return facade;
}
