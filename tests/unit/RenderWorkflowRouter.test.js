import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  RenderWorkflowLifecycle,
  RenderWorkflowRouter,
  canRestoreRenderStep,
  canUseRenderWorkflow,
} from '../../src/render/RenderWorkflowRouter.js';

function makeRenderer(name) {
  return {
    name,
    replaceArtwork: vi.fn(() => true),
    dispose: vi.fn(() => true),
  };
}

function makeRouter() {
  const quickRenderer = makeRenderer('quick');
  const technicalRenderer = makeRenderer('technical');
  const quickFactory = vi.fn(() => quickRenderer);
  const technicalFactory = vi.fn(() => technicalRenderer);
  return {
    quickRenderer,
    technicalRenderer,
    quickFactory,
    technicalFactory,
    router: new RenderWorkflowRouter({ quickFactory, technicalFactory }),
  };
}

describe('RenderWorkflowRouter', () => {
  it('requires both application and source capabilities before enabling Technical Render', () => {
    const sourceCapabilities = { technicalRender: true };

    expect(canUseRenderWorkflow({
      workflowMode: 'technical',
      capabilities: sourceCapabilities,
      applicationCapabilities: { technicalRender: false },
    })).toBe(false);
    expect(canUseRenderWorkflow({
      workflowMode: 'technical',
      capabilities: sourceCapabilities,
      applicationCapabilities: { technicalRender: true },
    })).toBe(true);
  });

  it('wires the shared Render app through the workflow lifecycle and Technical factory', () => {
    const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');

    expect(mainSource).toMatch(/new RenderWorkflowLifecycle\s*\(/);
    expect(mainSource).toMatch(/createTechnicalRenderStudioRenderer/);
    expect(mainSource).toMatch(/rendererLifecycle:\s*renderWorkflowLifecycle/);
  });

  it('selects Quick by workflow and fails closed for the disabled Technical capability', () => {
    const { router, quickFactory, technicalFactory, quickRenderer } = makeRouter();

    expect(router.create({
      workflowMode: 'quick',
      capabilities: { technicalRender: false },
      token: 'quick-input',
    })).toBe(quickRenderer);
    expect(quickFactory).toHaveBeenCalledWith(expect.objectContaining({
      workflowMode: 'quick',
      token: 'quick-input',
    }));
    expect(router.create({
      workflowMode: 'technical',
      capabilities: { technicalRender: false },
      token: 'blocked-input',
    })).toBe(false);
    expect(technicalFactory).not.toHaveBeenCalled();
  });

  it('uses Technical only with an explicit capability and never falls back to Quick geometry', () => {
    const { router, quickFactory, technicalFactory, technicalRenderer } = makeRouter();
    const technicalDocument = { mode: 'technical' };
    const canonicalInputs = {
      workflowMode: 'technical',
      capabilities: { technicalRender: true },
      applicationCapabilities: { technicalRender: true },
      technicalDocument,
      rendererOptions: { source: 'technical-only' },
      boxModel: { legacy: true },
      textureCanvas: 'quick-texture-canvas',
      preview3d: { legacy: true },
    };

    expect(router.create(canonicalInputs)).toBe(technicalRenderer);
    expect(technicalFactory).toHaveBeenCalledTimes(1);
    expect(technicalFactory).toHaveBeenCalledWith(expect.objectContaining({
      workflowMode: 'technical',
      capabilities: { technicalRender: true },
      technicalDocument,
      rendererOptions: { source: 'technical-only' },
    }));
    const technicalFactoryOptions = technicalFactory.mock.calls[0][0];
    expect(technicalFactoryOptions).not.toHaveProperty('boxModel');
    expect(technicalFactoryOptions).not.toHaveProperty('textureCanvas');
    expect(technicalFactoryOptions).not.toHaveProperty('preview3d');
    expect(quickFactory).not.toHaveBeenCalled();
  });

  it('keeps the Technical route disabled when capability data is missing or malformed', () => {
    const { router, technicalFactory } = makeRouter();

    expect(canUseRenderWorkflow({ workflowMode: 'technical', capabilities: {} })).toBe(false);
    expect(canUseRenderWorkflow({ workflowMode: 'technical', capabilities: { technicalRender: 1 } })).toBe(false);
    expect(router.create({ workflowMode: 'technical', capabilities: null })).toBe(false);
    expect(technicalFactory).not.toHaveBeenCalled();
  });

  it('restores Render only when workflow, artwork, completeness, and capability gates all pass', () => {
    const base = {
      workflowStep: 'render',
      hasArtwork: true,
      documentComplete: true,
    };
    expect(canRestoreRenderStep({ ...base, workflowMode: 'quick', capabilities: {} })).toBe(true);
    expect(canRestoreRenderStep({ ...base, workflowMode: 'technical', capabilities: { technicalRender: false } })).toBe(false);
    const technicalCapabilities = {
      capabilities: { technicalRender: true },
      applicationCapabilities: { technicalRender: true },
    };
    expect(canRestoreRenderStep({ ...base, workflowMode: 'technical', ...technicalCapabilities })).toBe(true);
    expect(canRestoreRenderStep({ ...base, hasArtwork: false, ...technicalCapabilities })).toBe(false);
    expect(canRestoreRenderStep({ ...base, documentComplete: false, ...technicalCapabilities })).toBe(false);
  });
});

describe('RenderWorkflowLifecycle', () => {
  it('removes the Quick renderer when Technical activation fails', async () => {
    const quickRenderer = makeRenderer('quick');
    const technicalError = new Error('technical factory failed');
    const router = new RenderWorkflowRouter({
      quickFactory: vi.fn(() => quickRenderer),
      technicalFactory: vi.fn(() => {
        throw technicalError;
      }),
    });
    const lifecycle = new RenderWorkflowLifecycle({ router });

    await lifecycle.activate({ workflowMode: 'quick' });
    await expect(lifecycle.activate({
      workflowMode: 'technical',
      capabilities: { technicalRender: true },
      applicationCapabilities: { technicalRender: true },
    })).rejects.toBe(technicalError);

    expect(lifecycle.getRenderer()).toBeNull();
    expect(quickRenderer.dispose).toHaveBeenCalledTimes(1);
    expect(lifecycle.getDiagnostics()).toMatchObject({
      source: 'technical',
      rendererActive: false,
    });
  });

  it('disposes the old generation only after the new renderer is acquired', async () => {
    const { router, quickRenderer, technicalRenderer } = makeRouter();
    const lifecycle = new RenderWorkflowLifecycle({ router });

    await expect(lifecycle.activate({ workflowMode: 'quick', capabilities: {} })).resolves.toBe(quickRenderer);
    await expect(lifecycle.activate({
      workflowMode: 'technical',
      capabilities: { technicalRender: false },
    })).resolves.toBe(false);
    expect(quickRenderer.dispose).toHaveBeenCalledTimes(1);
    expect(technicalRenderer.dispose).not.toHaveBeenCalled();
  });

  it('does not let a stale renderer generation dispose or replace the current one', async () => {
    const first = makeRenderer('first');
    const second = makeRenderer('second');
    let resolveFirst;
    const router = new RenderWorkflowRouter({
      quickFactory: vi.fn(() => new Promise((resolve) => { resolveFirst = () => resolve(first); })),
      technicalFactory: vi.fn(() => second),
    });
    const lifecycle = new RenderWorkflowLifecycle({ router });
    const pending = lifecycle.activate({ workflowMode: 'quick', capabilities: {} });
    const current = lifecycle.activate({
      workflowMode: 'technical',
      capabilities: { technicalRender: true },
      applicationCapabilities: { technicalRender: true },
    });

    await expect(current).resolves.toBe(second);
    resolveFirst();
    await expect(pending).resolves.toBe(false);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(lifecycle.getRenderer()).toBe(second);
  });

  it('aborts stale operations, rejects their results, and disposes resources once', async () => {
    const { router, quickRenderer } = makeRouter();
    const lifecycle = new RenderWorkflowLifecycle({ router });
    await lifecycle.activate({ workflowMode: 'quick', capabilities: {} });

    let rejectOperation;
    const operation = lifecycle.run(({ signal }) => new Promise((resolve, reject) => {
      rejectOperation = reject;
      if (signal.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }));
    expect(lifecycle.abort()).toBe(true);
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    rejectOperation?.(new Error('stale result'));

    expect(lifecycle.dispose()).toBe(true);
    expect(lifecycle.dispose()).toBe(false);
    expect(quickRenderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('replaces artwork on the active renderer without selecting another source', async () => {
    const { router, quickRenderer, technicalFactory } = makeRouter();
    const lifecycle = new RenderWorkflowLifecycle({ router });
    await lifecycle.activate({ workflowMode: 'quick', capabilities: {} });

    expect(lifecycle.replaceArtwork('atlas', { normal: 'map' })).toBe(true);
    expect(quickRenderer.replaceArtwork).toHaveBeenCalledWith('atlas', { normal: 'map' });
    expect(technicalFactory).not.toHaveBeenCalled();
  });

  it('keeps renderer resource counters bounded across repeated generations', async () => {
    const renderers = [];
    const router = new RenderWorkflowRouter({
      quickFactory: vi.fn(() => {
        const renderer = makeRenderer(`quick-${renderers.length}`);
        renderers.push(renderer);
        return renderer;
      }),
    });
    const lifecycle = new RenderWorkflowLifecycle({ router });

    for (let index = 0; index < 20; index += 1) {
      await expect(lifecycle.activate({ workflowMode: 'quick' })).resolves.toBe(renderers[index]);
    }

    expect(renderers).toHaveLength(20);
    expect(renderers.slice(0, -1).every((renderer) => renderer.dispose.mock.calls.length === 1)).toBe(true);
    expect(renderers[19].dispose).not.toHaveBeenCalled();
    expect(lifecycle.getDiagnostics().resourceCounters).toMatchObject({
      rendererAcquisitions: 20,
      rendererDisposals: 19,
    });

    expect(lifecycle.dispose()).toBe(true);
    expect(renderers[19].dispose).toHaveBeenCalledTimes(1);
    expect(lifecycle.getDiagnostics().resourceCounters.rendererDisposals).toBe(20);
  });
});
