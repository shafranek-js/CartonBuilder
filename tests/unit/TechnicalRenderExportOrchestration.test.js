import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
} from 'three';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { describe, expect, it, vi } from 'vitest';

import { renderStill } from '../../src/render/StillRenderService.js';
import { exportGlb } from '../../src/render/GlbExportService.js';
import { exportTurntable } from '../../src/render/TurntableExportService.js';
import { createTechnicalPortableScene } from '../../src/render/technicalPortableScene.js';
import { createTechnicalRenderExportOrchestrator } from '../../src/render/TechnicalRenderExportOrchestrator.js';
import { TechnicalRenderSceneSource } from '../../src/render/TechnicalRenderSceneSource.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function makeSettings(overrides = {}) {
  return {
    aspect: 'square',
    longEdge: 2048,
    background: {
      mode: 'solid',
      color: '#d9dcde',
      ...overrides.background,
    },
    shadows: {
      enabled: true,
      includeInTransparentExport: true,
      ...overrides.shadows,
    },
    floor: {
      reflection: {
        enabled: false,
        includeInTransparentExport: false,
        ...overrides.floor?.reflection,
      },
    },
    output: {
      jpegQuality: 0.94,
      sequence: { frames: 24, longEdge: 512, format: 'png' },
      ...overrides.output,
    },
    camera: {
      projection: 'perspective',
      fov: 35,
      orthographicHeight: 4,
      ...overrides.camera,
    },
    ...overrides,
  };
}

function makeDocumentRef() {
  const contexts = [];
  const makeCanvas = () => ({
    width: 0,
    height: 0,
    getContext: vi.fn(() => {
      const context = {
        createImageData: vi.fn((width, height) => ({
          data: new Uint8ClampedArray(width * height * 4),
        })),
        putImageData: vi.fn(),
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        fillStyle: '#000000',
      };
      contexts.push(context);
      return context;
    }),
    toBlob: vi.fn((callback) => callback(new Blob(['encoded-image']))),
  });
  return {
    documentRef: { createElement: vi.fn(makeCanvas) },
    contexts,
  };
}

function makeRenderer(overrides = {}) {
  return {
    getDiagnostics: vi.fn(() => ({ maxTextureSize: 4096, maxRenderbufferSize: 4096 })),
    renderToPixels: vi.fn(async ({ width, height }) => ({
      pixels: new Uint8Array(4),
      width,
      height,
    })),
    getCameraState: vi.fn(() => ({
      preset: 'isometric',
      heading: 45,
      elevation: 35,
      cameraDistance: 4,
      target: [0, 0, 0],
      position: [1, 1, 1],
    })),
    setCameraState: vi.fn(),
    createPortableScene: vi.fn(),
    ...overrides,
  };
}

function makeFixtureMetadata(fixtureName) {
  const bundle = JSON.parse(fs.readFileSync(
    path.join(projectRoot, 'src/workflow/fixtures', fixtureName),
    'utf8',
  ));
  return {
    bundle,
    metadata: {
      source: 'technical',
      contractVersion: bundle.contractVersion,
      producer: bundle.source.producer,
      producerVersion: bundle.source.producerVersion,
      modelEngineVersion: bundle.source.modelEngineVersion,
      contractPackageVersion: bundle.source.contractPackageVersion,
      artifactVersion: bundle.source.artifactVersion,
      artifactSha256: bundle.source.artifactSha256,
      modelSchemaVersion: bundle.source.modelSchemaVersion,
      svgSchemaVersion: bundle.source.svgSchemaVersion,
      cartonType: bundle.source.cartonType,
      modelSha256: bundle.modelJson.sha256,
      svgSha256: bundle.semanticSvg.sha256,
      semanticSvgAssetId: bundle.semanticSvg.assetId,
      referenceOnly: true,
      productionCertified: false,
      sourceUnit: 'mm',
      exportUnit: 'm',
    },
  };
}

function makePortableContext(metadata) {
  const model = new Group();
  model.name = `${metadata.cartonType}-TechnicalRoot`;
  model.scale.setScalar(1);
  const texture = new Texture();
  const geometry = new BoxGeometry(0.2, 0.1, 0.05);
  const material = new MeshStandardMaterial({ map: texture });
  const panel = new Mesh(geometry, material);
  panel.name = 'panel-front';
  panel.userData = { panel_id: 'panel.front' };
  model.add(panel);
  const crease = new Mesh(geometry, material);
  crease.name = 'crease-front';
  crease.userData = { fold_id: 'fold.front' };
  model.add(crease);
  return {
    model,
    geometry,
    material,
    texture,
    renderSurface: { camera: new PerspectiveCamera(35, 1, 0.01, 10) },
    metadata,
  };
}

async function withNodeFileReader(callback) {
  const hadFileReader = Object.hasOwn(globalThis, 'FileReader');
  const previousFileReader = globalThis.FileReader;
  class NodeFileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        this.onloadend?.();
      });
    }
  }
  globalThis.FileReader = NodeFileReader;
  try {
    return await callback();
  } finally {
    if (hadFileReader) globalThis.FileReader = previousFileReader;
    else delete globalThis.FileReader;
  }
}

async function readGlbJson(blob) {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Expected a binary glTF 2.0 payload.');
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('Expected the first GLB chunk to contain JSON.');
  }
  const jsonText = new TextDecoder()
    .decode(new Uint8Array(buffer, 20, jsonLength))
    .replace(/\u0000+$/u, '')
    .trimEnd();
  return JSON.parse(jsonText);
}

describe('Technical export orchestration', () => {
  it('renders transparent Technical PNG with independent shadow/reflection flags', async () => {
    const { documentRef } = makeDocumentRef();
    const renderer = makeRenderer();
    const settings = makeSettings({
      background: { mode: 'transparent' },
      shadows: { enabled: true, includeInTransparentExport: false },
      floor: { reflection: { enabled: true, includeInTransparentExport: true } },
    });

    const blob = await renderStill({
      renderer,
      settings,
      format: 'png',
      width: 2048,
      height: 1152,
      documentRef,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(renderer.renderToPixels).toHaveBeenCalledWith(expect.objectContaining({
      width: 2048,
      height: 1152,
      backgroundMode: 'transparent',
      includeShadow: false,
      includeReflection: true,
    }));
  });

  it('keeps exact UHD dimensions, forces JPEG opaque, and rejects a GPU limit before rendering', async () => {
    const { documentRef } = makeDocumentRef();
    const renderer = makeRenderer();
    const settings = makeSettings();

    await renderStill({
      renderer,
      settings,
      format: 'jpg',
      width: 4096,
      height: 2048,
      documentRef,
    });
    expect(renderer.renderToPixels).toHaveBeenCalledWith(expect.objectContaining({
      width: 4096,
      height: 2048,
      backgroundMode: 'solid',
    }));

    const limitedRenderer = makeRenderer({
      getDiagnostics: () => ({ maxTextureSize: 2048, maxRenderbufferSize: 2048 }),
    });
    await expect(renderStill({
      renderer: limitedRenderer,
      settings,
      format: 'png',
      width: 4096,
      height: 2048,
      documentRef,
    })).rejects.toThrow(/GPU limit/);
    expect(limitedRenderer.renderToPixels).not.toHaveBeenCalled();
  });

  it('rejects an image aborted while asynchronous canvas encoding is pending', async () => {
    const { documentRef } = makeDocumentRef();
    const createCanvas = documentRef.createElement;
    let canvasCount = 0;
    let finishEncoding = null;
    documentRef.createElement = vi.fn(() => {
      const canvas = createCanvas();
      canvasCount += 1;
      if (canvasCount === 2) {
        canvas.toBlob = vi.fn((callback) => {
          finishEncoding = callback;
        });
      }
      return canvas;
    });
    const abortController = new AbortController();
    const pending = renderStill({
      renderer: makeRenderer(),
      settings: makeSettings(),
      format: 'png',
      width: 1,
      height: 1,
      documentRef,
      signal: abortController.signal,
    });

    await vi.waitFor(() => expect(finishEncoding).toBeTypeOf('function'));
    abortController.abort();
    finishEncoding(new Blob(['stale-image'], { type: 'image/png' }));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not publish a still after abort and supports latest-wins operations', async () => {
    let firstResolve;
    const firstService = vi.fn(({ signal }) => new Promise((resolve, reject) => {
      firstResolve = resolve;
      if (signal.aborted) {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
      }
      signal.addEventListener('abort', () => reject(Object.assign(
        new Error('aborted'),
        { name: 'AbortError' },
      )), { once: true });
    }));
    const secondService = vi.fn(async () => new Blob(['second']));
    const renderer = makeRenderer();
    const orchestrator = createTechnicalRenderExportOrchestrator({
      renderer,
      settings: makeSettings(),
      renderStillFn: firstService,
    });

    const first = orchestrator.renderStill();
    const second = orchestrator.renderStill({ service: secondService });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toBeInstanceOf(Blob);
    expect(firstService).toHaveBeenCalledTimes(1);
    expect(secondService).toHaveBeenCalledTimes(1);
    firstResolve?.(new Blob(['stale']));
    orchestrator.dispose();
    expect(orchestrator.dispose()).toBe(false);
  });

  it('routes turntable and GLB requests through the injectable common services', async () => {
    const turntableService = vi.fn(async () => new Blob(['zip']));
    const glbService = vi.fn(async () => new Blob(['glb']));
    const renderer = makeRenderer();
    const settings = makeSettings();
    const orchestrator = createTechnicalRenderExportOrchestrator({
      renderer,
      settings,
      exportTurntableFn: turntableService,
      exportGlbFn: glbService,
    });

    await expect(orchestrator.exportTurntable({
      options: { frames: 24, longEdge: 512, format: 'png' },
    })).resolves.toBeInstanceOf(Blob);
    await expect(orchestrator.exportGlb({
      options: { materialMode: 'basic-compatibility', includeCamera: false },
    })).resolves.toBeInstanceOf(Blob);
    expect(turntableService).toHaveBeenCalledWith(expect.objectContaining({
      renderer,
      settings,
      options: { frames: 24, longEdge: 512, format: 'png' },
    }));
    expect(glbService).toHaveBeenCalledWith(expect.objectContaining({
      renderer,
      options: { materialMode: 'basic-compatibility', includeCamera: false },
    }));
  });

  it('restores the full camera state and writes the expected turntable frame names', async () => {
    const originalCamera = {
      preset: 'custom',
      heading: 7,
      elevation: 22,
      cameraDistance: 3,
      target: [0.1, 0.2, 0.3],
      position: [1, 2, 3],
    };
    let camera = structuredClone(originalCamera);
    const renderer = makeRenderer({
      getCameraState: vi.fn(() => structuredClone(camera)),
      setCameraState: vi.fn((next) => { camera = structuredClone(next); }),
    });
    const progress = [];
    const result = await exportTurntable({
      renderer,
      settings: makeSettings(),
      options: { frames: 24, longEdge: 512, format: 'png' },
      renderStillFn: vi.fn(async () => new Blob(['frame'])),
      onProgress: (value) => progress.push(value),
    });
    const entries = await new ZipReader(new BlobReader(result)).getEntries();
    const names = entries.map((entry) => entry.filename);
    expect(names).toContain('frame-001.png');
    expect(names).toContain('frame-024.png');
    expect(names).not.toContain('frame-025.png');
    expect(progress.at(-1)).toBe(1);
    expect(camera).toEqual(originalCamera);
  });

  it('does not publish a stale turntable after abort and preserves the original frame error', async () => {
    const abortController = new AbortController();
    const originalCamera = { preset: 'isometric', heading: 45, elevation: 35, cameraDistance: 4, target: [0, 0, 0], position: [1, 1, 1] };
    const renderer = makeRenderer({
      getCameraState: () => structuredClone(originalCamera),
      setCameraState: vi.fn(),
    });
    const error = new Error('frame render failed');
    await expect(exportTurntable({
      renderer,
      settings: makeSettings(),
      options: { frames: 24, longEdge: 512, format: 'png' },
      signal: abortController.signal,
      renderStillFn: vi.fn(async () => {
        abortController.abort();
        return new Blob(['stale']);
      }),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(renderer.setCameraState).toHaveBeenLastCalledWith(originalCamera);

    let cameraMutationCount = 0;
    const errorRenderer = makeRenderer({
      getCameraState: () => structuredClone(originalCamera),
      setCameraState: vi.fn(() => {
        cameraMutationCount += 1;
        if (cameraMutationCount === 2) throw new Error('camera cleanup failed');
      }),
    });
    await expect(exportTurntable({
      renderer: errorRenderer,
      settings: makeSettings(),
      options: { frames: 24, longEdge: 512, format: 'png' },
      renderStillFn: vi.fn(async () => { throw error; }),
    })).rejects.toBe(error);
    expect(errorRenderer.setCameraState).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['rte-workflow.v1.json', 'RTE'],
    ['ste-workflow.v1.json', 'STE'],
    ['tt_sl123-workflow.v1.json', 'TT_SL123'],
  ])('keeps detached %s Technical GLB metadata and export-owned identity', (fixtureName, cartonType) => {
    const { metadata } = makeFixtureMetadata(fixtureName);
    const context = makePortableContext(metadata);
    const portable = createTechnicalPortableScene(context);
    const portableModel = portable.scene.children[0];

    expect(portableModel).not.toBe(context.model);
    expect(portableModel.getObjectByName('panel-front').userData.panel_id).toBe('panel.front');
    expect(portableModel.getObjectByName('crease-front').userData.fold_id).toBe('fold.front');
    expect(portable.scene.userData.cartonBuilder).toMatchObject({
      source: 'technical',
      cartonType,
      producer: 'packaging-box-designer',
      contractVersion: 'carton-workflow.v1',
      referenceOnly: true,
      productionCertified: false,
      sourceUnit: 'mm',
      exportUnit: 'm',
    });
    expect(portable.scene.userData.cartonBuilder).not.toBe(metadata);
    portable.dispose();
  });

  it('forces reference-only certification metadata at the final portable-scene boundary', () => {
    const { metadata } = makeFixtureMetadata('rte-workflow.v1.json');
    const context = makePortableContext({
      ...metadata,
      source: 'quick',
      sourceUnit: 'in',
      exportUnit: 'ft',
      referenceOnly: false,
      productionCertified: true,
    });
    const portable = createTechnicalPortableScene(context);

    expect(portable.scene.userData.cartonBuilder).toMatchObject({
      source: 'technical',
      sourceUnit: 'mm',
      exportUnit: 'm',
      referenceOnly: true,
      productionCertified: false,
    });
    portable.dispose();
  });

  it('propagates detached bundle metadata through Technical source into GLB JSON extras', async () => {
    const { bundle } = makeFixtureMetadata('rte-workflow.v1.json');
    const originalProducer = bundle.source.producer;
    const context = makePortableContext({});
    context.material.map = null;
    const liveScene = new Scene();
    const renderSurface = {
      scene: liveScene,
      camera: new PerspectiveCamera(35, 1, 0.01, 10),
    };
    const runtime = {
      loadSemanticSvgText: vi.fn(() => ({
        model: context.model,
        parsed: { folds: { 'fold.front': { foldId: 'fold.front' } } },
      })),
      setFoldProgress: vi.fn(),
      setArtworkAtlas: vi.fn(),
      getModel: vi.fn(() => context.model),
      dispose: vi.fn(),
    };
    const source = new TechnicalRenderSceneSource({
      runtime,
      renderSurface,
      boundsResolver: () => ({
        minX: -0.1,
        minY: -0.05,
        minZ: -0.025,
        maxX: 0.1,
        maxY: 0.05,
        maxZ: 0.025,
        width: 0.2,
        height: 0.1,
        depth: 0.05,
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        radius: 0.12,
        units: 'm',
      }),
      portableSceneFactory: createTechnicalPortableScene,
    });

    try {
      source.buildScene({ bundle, artworkAtlas: null, maps: {}, name: 'rte-technical.svg' });
      bundle.source.producer = 'mutated-after-build';
      const blob = await withNodeFileReader(() => exportGlb({
        renderer: { createPortableScene: (options) => source.createPortableScene(options) },
        options: { includeCamera: false },
      }));
      const gltf = await readGlbJson(blob);
      const metadata = gltf.scenes[0].extras.cartonBuilder;
      const nodeExtras = gltf.nodes.map((node) => node.extras || {});

      expect(metadata).toMatchObject({
        source: 'technical',
        producer: originalProducer,
        cartonType: 'RTE',
        modelSchemaVersion: 'pbd.model.v1',
        svgSchemaVersion: 'pbd.svg.v4',
        modelSha256: bundle.modelJson.sha256,
        svgSha256: bundle.semanticSvg.sha256,
        semanticSvgAssetId: bundle.semanticSvg.assetId,
        referenceOnly: true,
        productionCertified: false,
      });
      expect(nodeExtras.some((extras) => extras.panel_id === 'panel.front')).toBe(true);
      expect(nodeExtras.some((extras) => extras.fold_id === 'fold.front')).toBe(true);
    } finally {
      source.dispose();
    }
    expect(runtime.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes only export-owned GLB resources and leaves live Technical resources intact', () => {
    const context = makePortableContext(makeFixtureMetadata('rte-workflow.v1.json').metadata);
    const portable = createTechnicalPortableScene(context);
    const portableModel = portable.scene.children[0];
    const portableGeometryDispose = vi.spyOn(portableModel.children[0].geometry, 'dispose');
    const portableMaterialDispose = vi.spyOn(portableModel.children[0].material, 'dispose');
    const portableTextureDispose = vi.spyOn(portableModel.children[0].material.map, 'dispose');
    const liveGeometryDispose = vi.spyOn(context.geometry, 'dispose');
    const liveMaterialDispose = vi.spyOn(context.material, 'dispose');
    const liveTextureDispose = vi.spyOn(context.texture, 'dispose');

    expect(portable.dispose()).toBe(true);
    expect(portable.dispose()).toBe(false);
    expect(portableGeometryDispose).toHaveBeenCalledTimes(1);
    expect(portableMaterialDispose).toHaveBeenCalledTimes(1);
    expect(portableTextureDispose).toHaveBeenCalledTimes(1);
    expect(liveGeometryDispose).not.toHaveBeenCalled();
    expect(liveMaterialDispose).not.toHaveBeenCalled();
    expect(liveTextureDispose).not.toHaveBeenCalled();
  });

  it('uses the common GLB service and disposes its portable scene on success, error, and abort', async () => {
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(0.2, 0.1, 0.05), new MeshStandardMaterial()));
    const portableDispose = vi.fn();
    const renderer = makeRenderer({
      createPortableScene: vi.fn(() => ({ scene, dispose: portableDispose })),
    });

    const blob = await withNodeFileReader(() => exportGlb({
      renderer,
      options: { includeCamera: false },
    }));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('model/gltf-binary');
    expect(portableDispose).toHaveBeenCalledTimes(1);

    const errorDispose = vi.fn(() => { throw new Error('portable cleanup failed'); });
    let originalError = null;
    try {
      await exportGlb({
      renderer: makeRenderer({ createPortableScene: () => ({ scene: null, dispose: errorDispose }) }),
      });
    } catch (error) {
      originalError = error;
    }
    expect(originalError).toBeInstanceOf(Error);
    expect(originalError.message).not.toMatch(/portable cleanup failed/);
    expect(errorDispose).toHaveBeenCalledTimes(1);

    const abortController = new AbortController();
    const abortedDispose = vi.fn();
    await expect(exportGlb({
      signal: abortController.signal,
      renderer: makeRenderer({
        createPortableScene: vi.fn(() => {
          const result = { scene, dispose: abortedDispose };
          abortController.abort();
          return result;
        }),
      }),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(abortedDispose).toHaveBeenCalledTimes(1);
  });

  it('aborts and disposes without accessing Quick geometry', async () => {
    const renderer = makeRenderer();
    Object.defineProperty(renderer, 'boxModel', {
      configurable: true,
      get() { throw new Error('Quick geometry must not be accessed.'); },
    });
    const renderStillFn = vi.fn(async ({ signal }) => {
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return new Blob(['ok']);
    });
    const orchestrator = createTechnicalRenderExportOrchestrator({
      renderer,
      settings: makeSettings(),
      renderStillFn,
    });
    await expect(orchestrator.renderStill()).resolves.toBeInstanceOf(Blob);
    expect(orchestrator.abort()).toBe(false);
    expect(orchestrator.dispose()).toBe(true);
  });
});
