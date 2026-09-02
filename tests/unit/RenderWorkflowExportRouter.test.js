import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { RenderWorkflowExportRouter } from '../../src/render/RenderWorkflowExportRouter.js';

function makeRenderer(name = 'renderer') {
  return { name };
}

function makeOrchestrator() {
  return {
    renderStill: vi.fn(() => Promise.resolve('technical-still')),
    exportTurntable: vi.fn(() => Promise.resolve('technical-turntable')),
    exportGlb: vi.fn(() => Promise.resolve('technical-glb')),
    abort: vi.fn(() => true),
    dispose: vi.fn(() => true),
  };
}

describe('RenderWorkflowExportRouter', () => {
  it('is the explicit export seam consumed by RenderApp for all three output kinds', () => {
    const renderAppSource = readFileSync(new URL('../../src/render/RenderApp.js', import.meta.url), 'utf8');

    expect(renderAppSource).toMatch(/workflowExportRouter = null/);
    expect(renderAppSource).toMatch(/workflowExportRouter[\s\S]*renderStill/);
    expect(renderAppSource).toMatch(/workflowExportRouter[\s\S]*exportTurntable/);
    expect(renderAppSource).toMatch(/workflowExportRouter[\s\S]*exportGlb/);
    expect(renderAppSource).toMatch(/Geometry or artwork replacement[\s\S]*workflowExportRouter\?\.abort/);
  });

  it('routes Technical image, turntable and GLB through one orchestrator', async () => {
    const orchestrator = makeOrchestrator();
    const technicalFactory = vi.fn(() => orchestrator);
    const renderer = makeRenderer('technical');
    const router = new RenderWorkflowExportRouter({
      getWorkflowOptions: () => ({
        workflowMode: 'technical',
        capabilities: { technicalRender: true },
        applicationCapabilities: { technicalRender: true },
      }),
      getRenderer: () => renderer,
      technicalOrchestratorFactory: technicalFactory,
      quickServices: {
        renderStill: vi.fn(),
        exportTurntable: vi.fn(),
        exportGlb: vi.fn(),
      },
    });

    await expect(router.renderStill({ renderer, settings: { id: 'settings' }, signal: null }))
      .resolves.toBe('technical-still');
    await expect(router.exportTurntable({ renderer, settings: { id: 'settings' }, options: { frames: 2 } }))
      .resolves.toBe('technical-turntable');
    await expect(router.exportGlb({ renderer, options: { materialMode: 'full-pbr' } }))
      .resolves.toBe('technical-glb');

    expect(technicalFactory).toHaveBeenCalledTimes(1);
    expect(orchestrator.renderStill).toHaveBeenCalledTimes(1);
    expect(orchestrator.exportTurntable).toHaveBeenCalledTimes(1);
    expect(orchestrator.exportGlb).toHaveBeenCalledTimes(1);
  });

  it('keeps Quick exports on existing services and never creates Technical orchestration', async () => {
    const quickServices = {
      renderStill: vi.fn(() => Promise.resolve('quick-still')),
      exportTurntable: vi.fn(() => Promise.resolve('quick-turntable')),
      exportGlb: vi.fn(() => Promise.resolve('quick-glb')),
    };
    const technicalFactory = vi.fn();
    const router = new RenderWorkflowExportRouter({
      getWorkflowOptions: () => ({ workflowMode: 'quick', capabilities: {} }),
      getRenderer: () => makeRenderer('quick'),
      quickServices,
      technicalOrchestratorFactory: technicalFactory,
    });

    await expect(router.renderStill({ renderer: makeRenderer('quick') })).resolves.toBe('quick-still');
    await expect(router.exportTurntable({ renderer: makeRenderer('quick') })).resolves.toBe('quick-turntable');
    await expect(router.exportGlb({ renderer: makeRenderer('quick') })).resolves.toBe('quick-glb');
    expect(technicalFactory).not.toHaveBeenCalled();
  });

  it('rejects Quick-only inputs on the Technical route before orchestration', async () => {
    const orchestrator = makeOrchestrator();
    const router = new RenderWorkflowExportRouter({
      getWorkflowOptions: () => ({
        workflowMode: 'technical',
        capabilities: { technicalRender: true },
        applicationCapabilities: { technicalRender: true },
      }),
      getRenderer: () => makeRenderer('technical'),
      technicalOrchestratorFactory: vi.fn(() => orchestrator),
    });

    expect(() => router.renderStill({
      renderer: makeRenderer('technical'),
      boxModel: { legacy: true },
    })).toThrow(/Quick-only/);
    expect(orchestrator.renderStill).not.toHaveBeenCalled();
  });

  it('cancels the previous Technical export when a new one starts', async () => {
    const first = makeOrchestrator();
    const second = makeOrchestrator();
    const renderer = makeRenderer('technical');
    const router = new RenderWorkflowExportRouter({
      getWorkflowOptions: () => ({
        workflowMode: 'technical',
        capabilities: { technicalRender: true },
        applicationCapabilities: { technicalRender: true },
      }),
      getRenderer: () => renderer,
      technicalOrchestratorFactory: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    });

    let resolveFirst;
    first.renderStill.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    const firstExport = router.renderStill({ renderer });
    const secondExport = router.renderStill({ renderer });
    expect(first.abort).toHaveBeenCalledTimes(1);
    resolveFirst('stale');
    await expect(firstExport).rejects.toMatchObject({ name: 'AbortError' });
    await expect(secondExport).resolves.toBe('technical-still');
  });

  it('releases export orchestration exactly once before its renderer is freed elsewhere', async () => {
    const orchestrator = makeOrchestrator();
    const renderer = makeRenderer('technical');
    const router = new RenderWorkflowExportRouter({
      getWorkflowOptions: () => ({
        workflowMode: 'technical',
        capabilities: { technicalRender: true },
        applicationCapabilities: { technicalRender: true },
      }),
      getRenderer: () => renderer,
      technicalOrchestratorFactory: vi.fn(() => orchestrator),
    });

    await router.renderStill({ renderer });

    expect(router.releaseRenderer(renderer)).toBe(true);
    expect(router.releaseRenderer(renderer)).toBe(false);
    router.dispose();
    router.dispose();
    expect(orchestrator.abort).toHaveBeenCalledTimes(1);
    expect(orchestrator.dispose).toHaveBeenCalledTimes(1);
    expect(router.getDiagnostics()).toMatchObject({
      technicalOrchestratorActive: false,
      counters: { orchestratorDisposals: 1 },
    });
    expect(renderer).toEqual({ name: 'technical' });
  });
});
