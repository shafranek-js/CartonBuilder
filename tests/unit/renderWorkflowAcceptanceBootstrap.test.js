import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createRenderWorkflowBootstrap } from '../../src/render/createRenderWorkflowBootstrap.js';

function makeRenderer() {
  return { dispose: vi.fn(() => true) };
}

const sourceEnabled = { technicalRender: true };

describe('Render workflow acceptance bootstrap', () => {
  it('enables the production application capability while still requiring the source gate', () => {
    const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
    const technicalFactory = vi.fn(() => makeRenderer());
    const bootstrap = createRenderWorkflowBootstrap({
      applicationCapabilities: { technicalRender: true },
      technicalFactory,
      quickFactory: vi.fn(() => makeRenderer()),
    });

    expect(mainSource).toMatch(/RENDER_APPLICATION_CAPABILITIES[\s\S]*technicalRender:\s*true/);
    expect(bootstrap.applicationCapabilities).toEqual({ technicalRender: true });
    expect(bootstrap.router.create({
      workflowMode: 'technical',
      capabilities: sourceEnabled,
    })).toEqual(expect.objectContaining({ dispose: expect.any(Function) }));
    expect(technicalFactory).toHaveBeenCalledTimes(1);
  });

  it('enables Technical only through explicit acceptance dependency injection and a true source capability', () => {
    const renderer = makeRenderer();
    const technicalFactory = vi.fn(() => renderer);
    const bootstrap = createRenderWorkflowBootstrap({
      applicationCapabilities: { technicalRender: true },
      technicalFactory,
      quickFactory: vi.fn(() => makeRenderer()),
    });

    expect(bootstrap.router.create({
      workflowMode: 'technical',
      capabilities: sourceEnabled,
    })).toBe(renderer);
    expect(technicalFactory).toHaveBeenCalledTimes(1);
  });

  it('keeps acceptance Technical disabled when the source capability is false', () => {
    const technicalFactory = vi.fn(() => makeRenderer());
    const bootstrap = createRenderWorkflowBootstrap({
      applicationCapabilities: { technicalRender: true },
      technicalFactory,
      quickFactory: vi.fn(() => makeRenderer()),
    });

    expect(bootstrap.router.create({
      workflowMode: 'technical',
      capabilities: { technicalRender: false },
    })).toBe(false);
    expect(technicalFactory).not.toHaveBeenCalled();
  });

  it('keeps Quick available independently of Technical capability', () => {
    const quickRenderer = makeRenderer();
    const quickFactory = vi.fn(() => quickRenderer);
    const bootstrap = createRenderWorkflowBootstrap({
      quickFactory,
      technicalFactory: vi.fn(() => makeRenderer()),
    });

    expect(bootstrap.router.create({ workflowMode: 'quick' })).toBe(quickRenderer);
    expect(quickFactory).toHaveBeenCalledTimes(1);
  });

  it('has no user-facing runtime mechanism for changing the production gate', () => {
    const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
    const bootstrapSource = readFileSync(
      new URL('../../src/render/createRenderWorkflowBootstrap.js', import.meta.url),
      'utf8',
    );

    expect(mainSource).toMatch(/RENDER_APPLICATION_CAPABILITIES[\s\S]*technicalRender:\s*true/);
    expect(bootstrapSource).not.toMatch(/URLSearchParams|location\.hash|localStorage|sessionStorage|document\.cookie|import\.meta\.env/);
  });
});
