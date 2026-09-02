import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { DEFAULT_BOARD_APPEARANCE } from '../../src/render/BoardAppearance.js';
import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import { canRestoreRenderStep } from '../../src/render/RenderWorkflowRouter.js';
import { createProjectArchive, readProjectArchive } from '../../src/project/projectArchive.js';

function loadFixture(name) {
  return JSON.parse(readFileSync(
    new URL(`../../src/workflow/fixtures/${name}-workflow.v1.json`, import.meta.url),
    'utf8',
  ));
}

function createRenderState() {
  const render = structuredClone(DEFAULT_RENDER_SETTINGS);
  render.aspect = 'portrait';
  render.longEdge = 4096;
  render.camera.projection = 'orthographic';
  render.camera.lens = '85';
  render.camera.fov = 16.1;
  render.camera.heading = 27;
  render.camera.elevation = 31;
  render.camera.horizontalPan = 0.12;
  render.camera.verticalPan = -0.08;
  render.camera.orthographicHeight = 0.9;
  render.output.format = 'jpg';
  render.output.kind = 'sequence';
  render.output.sequence = { frames: 36, longEdge: 1024, format: 'png' };
  render.output.glb = { textureSize: 2048, materialMode: 'full-pbr', includeCamera: true };
  render.background = { ...render.background, mode: 'transparent' };
  render.lighting = {
    ...render.lighting,
    environment: 'cool',
    exposure: 1.1,
    environmentMap: { ...render.lighting.environmentMap, source: 'builtin', presetId: 'polyhaven-abandoned-hall-01' },
  };
  render.floor = { ...render.floor, reflection: { ...render.floor.reflection, enabled: true, strength: 0.35 } };
  render.material = { ...render.material, profile: 'gloss' };
  return render;
}

function createTechnicalSnapshot(bundle) {
  return {
    schemaVersion: 18,
    meta: { name: 'Release 3 Technical persistence' },
    workflowSelection: 'technical',
    workflowStep: 'render',
    cartonSource: {
      mode: 'technical',
      source: bundle.source,
      modelJson: {
        mediaType: bundle.modelJson.mediaType,
        byteLength: bundle.modelJson.byteLength,
        sha256: bundle.modelJson.sha256,
      },
      semanticSvg: {
        assetId: bundle.semanticSvg.assetId,
        mediaType: bundle.semanticSvg.mediaType,
        byteLength: bundle.semanticSvg.byteLength,
        sha256: bundle.semanticSvg.sha256,
        units: bundle.semanticSvg.units,
      },
      modelSha256: bundle.modelJson.sha256,
      svgSha256: bundle.semanticSvg.sha256,
      semanticSvgAssetId: bundle.semanticSvg.assetId,
      capabilities: bundle.capabilities,
    },
    technicalViewer: null,
    artworks: [],
    activeArtworkIndex: -1,
    render: createRenderState(),
    renderAppearance: {
      ...DEFAULT_BOARD_APPEARANCE,
      thicknessMm: 0.46,
      interiorColor: '#eee9df',
      edgeColor: '#a79a8a',
    },
    view: {},
    history: { undo: [], redo: [] },
  };
}

function createQuickSnapshot() {
  const box = new BoxNetModel({ width: 150, height: 90, depth: 40 });
  return {
    schemaVersion: 18,
    meta: { name: 'Release 3 Quick persistence' },
    workflowSelection: 'quick',
    workflowStep: 'render',
    cartonSource: {
      mode: 'quick',
      box: box.toJSON(),
    },
    technicalViewer: null,
    artworks: [],
    activeArtworkIndex: -1,
    render: createRenderState(),
    renderAppearance: {
      ...DEFAULT_BOARD_APPEARANCE,
      thicknessMm: 0.46,
      interiorColor: '#eee9df',
      edgeColor: '#a79a8a',
    },
    view: {},
    history: { undo: [], redo: [] },
  };
}

describe('Release 3 Render workflow persistence', () => {
  it('round-trips Technical render presentation without changing canonical source identity', async () => {
    const bundle = loadFixture('rte');
    const identityBefore = {
      source: structuredClone(bundle.source),
      modelSha256: bundle.modelJson.sha256,
      svgSha256: bundle.semanticSvg.sha256,
      markup: bundle.semanticSvg.markup,
    };
    const snapshot = createTechnicalSnapshot(bundle);
    const archive = await createProjectArchive({
      snapshot,
      artworkBlobs: [],
      technicalAssets: {
        modelBlob: new Blob([bundle.modelJson.text], { type: bundle.modelJson.mediaType }),
        svgBlob: new Blob([bundle.semanticSvg.markup], { type: bundle.semanticSvg.mediaType }),
      },
    });
    const restored = await readProjectArchive(archive);

    expect(restored.snapshot.workflowSelection).toBe('technical');
    expect(restored.snapshot.workflowStep).toBe('render');
    expect(restored.snapshot.render).toEqual(snapshot.render);
    expect(restored.snapshot.renderAppearance).toEqual(snapshot.renderAppearance);
    expect(restored.snapshot.cartonSource.modelSha256).toBe(identityBefore.modelSha256);
    expect(restored.snapshot.cartonSource.svgSha256).toBe(identityBefore.svgSha256);
    expect(restored.snapshot.cartonSource.capabilities.technicalRender).toBe(true);
    expect(restored.snapshot.cartonSource.source.referenceOnly).toBe(true);
    expect(restored.snapshot.cartonSource.source.productionCertified).toBe(false);
    expect(restored.technicalAssets.modelBlob.size).toBeGreaterThan(0);
    expect(restored.technicalAssets.svgBlob.size).toBeGreaterThan(0);
    expect(bundle.source).toEqual(identityBefore.source);
    expect(bundle.semanticSvg.markup).toBe(identityBefore.markup);
  });

  it('round-trips Quick Render presentation through the same schema without Technical state', async () => {
    const snapshot = createQuickSnapshot();
    const archive = await createProjectArchive({
      snapshot,
      artworkBlobs: [],
    });
    const restored = await readProjectArchive(archive);

    expect(restored.snapshot.workflowSelection).toBe('quick');
    expect(restored.snapshot.workflowStep).toBe('render');
    expect(restored.snapshot.render).toEqual(snapshot.render);
    expect(restored.snapshot.renderAppearance).toEqual(snapshot.renderAppearance);
    expect(restored.snapshot.technicalViewer).toBeNull();
  });

  it.each(['rte', 'ste', 'tt_sl123'])('keeps %s canonical Technical fixture identity and gates', (name) => {
    const bundle = loadFixture(name);

    expect(bundle.source.cartonType).toBe(name === 'tt_sl123' ? 'TT_SL123' : name.toUpperCase());
    expect(bundle.source.modelSchemaVersion).toBe('pbd.model.v1');
    expect(bundle.source.svgSchemaVersion).toBe('pbd.svg.v4');
    expect(bundle.source.referenceOnly).toBe(true);
    expect(bundle.source.productionCertified).toBe(false);
    expect(bundle.capabilities.technicalRender).toBe(true);
    expect(bundle.semanticSvg.markup).toEqual(expect.any(String));
    expect(bundle.semanticSvg.markup.length).toBeGreaterThan(0);
    expect(bundle.modelJson.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.semanticSvg.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('applies both capability gates to restored Render without changing the saved settings', () => {
    const render = createRenderState();
    const base = {
      workflowMode: 'technical',
      workflowStep: 'render',
      hasArtwork: true,
      documentComplete: true,
      capabilities: { technicalRender: true },
    };

    expect(canRestoreRenderStep({ ...base, applicationCapabilities: { technicalRender: false } })).toBe(false);
    expect(canRestoreRenderStep({ ...base, applicationCapabilities: { technicalRender: true } })).toBe(true);
    expect(render.output.kind).toBe('sequence');
    expect(render.output.glb.materialMode).toBe('full-pbr');
    expect(render.background.mode).toBe('transparent');
  });
});
