import { beforeEach, describe, expect, it, vi } from 'vitest';

const controller = {
  state: { active: false, foldProgress: 1, cameraProjection: 'perspective', scenePreset: 'studio', selectedPanelId: null },
  activate: vi.fn(async () => { controller.state.active = true; return true; }),
  setFoldProgress: vi.fn((value) => { controller.state.foldProgress = value; }),
  setCameraProjection: vi.fn((value) => { controller.state.cameraProjection = value; }),
  setScenePreset: vi.fn((value) => { controller.state.scenePreset = value; }),
  setBoardAppearance: vi.fn(),
  setBoardCaliper: vi.fn(),
  selectPanel: vi.fn((value) => { controller.state.selectedPanelId = value; }),
  getState: vi.fn(() => ({ ...controller.state })),
  resetForProject: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('../../src/preview3d/Preview3DApp.js', () => ({
  createPreview3DApp: vi.fn(() => controller),
}));

const { createPreview3DApp } = await import('../../src/preview3d/Preview3DApp.js');
const { createLazyPreview3DFacade } = await import('../../src/preview3d/lazyPreview3d.js');

describe('lazy Preview 3D facade', () => {
  beforeEach(() => {
    controller.state = { active: false, foldProgress: 1, cameraProjection: 'perspective', scenePreset: 'studio', selectedPanelId: null };
    controller.activate.mockClear();
    controller.setFoldProgress.mockClear();
    controller.setCameraProjection.mockClear();
    controller.setScenePreset.mockClear();
    controller.setBoardAppearance.mockClear();
    controller.setBoardCaliper.mockClear();
    controller.selectPanel.mockClear();
    createPreview3DApp.mockClear();
  });

  it('keeps the newest deferred setter when requests race during lazy load', async () => {
    const facade = createLazyPreview3DFacade({ getOptions: () => ({}) });
    facade.setFoldProgress(0.2);
    facade.setFoldProgress(0.8);
    facade.setCameraProjection('orthographic');
    facade.setCameraProjection('perspective');
    facade.setScenePreset('technical');
    facade.selectPanel('front');

    await facade.activate();

    expect(controller.setFoldProgress).toHaveBeenCalledWith(0.8);
    expect(controller.setFoldProgress).toHaveBeenCalledTimes(1);
    expect(controller.setCameraProjection).toHaveBeenCalledWith('perspective');
    expect(controller.setScenePreset).toHaveBeenCalledWith('technical');
    expect(controller.selectPanel).toHaveBeenCalledWith('front');
    expect(facade.getState()).toMatchObject({
      foldProgress: 0.8,
      cameraProjection: 'perspective',
      scenePreset: 'technical',
      selectedPanelId: 'front',
    });
    facade.dispose();
  });

  it('defers every setter until activation and applies only the latest pending values', async () => {
    const facade = createLazyPreview3DFacade({ getOptions: () => ({}) });
    const firstAppearance = { thicknessMm: 0.35, interiorColor: '#111111' };
    const latestAppearance = { thicknessMm: 0.8, interiorColor: '#222222' };

    facade.setFoldProgress(0.2);
    facade.setFoldProgress(0.8);
    facade.setCameraProjection('orthographic');
    facade.setCameraProjection('perspective');
    facade.setScenePreset('technical');
    facade.selectPanel('front');
    facade.setBoardAppearance(firstAppearance);
    facade.setBoardAppearance(latestAppearance);
    facade.setBoardCaliper(0.35);
    facade.setBoardCaliper(0.8);

    expect(createPreview3DApp).not.toHaveBeenCalled();
    expect(facade.getState()).toMatchObject({
      foldProgress: 0.8,
      cameraProjection: 'perspective',
      scenePreset: 'technical',
      selectedPanelId: 'front',
    });

    await facade.activate();

    expect(createPreview3DApp).toHaveBeenCalledTimes(1);
    expect(controller.setFoldProgress).toHaveBeenCalledTimes(1);
    expect(controller.setFoldProgress).toHaveBeenCalledWith(0.8);
    expect(controller.setCameraProjection).toHaveBeenCalledWith('perspective');
    expect(controller.setScenePreset).toHaveBeenCalledWith('technical');
    expect(controller.selectPanel).toHaveBeenCalledWith('front');
    expect(controller.setBoardAppearance).toHaveBeenCalledWith(latestAppearance);
    expect(controller.setBoardCaliper).toHaveBeenCalledWith(0.8);
    facade.dispose();
  });
});
