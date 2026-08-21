import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256 } from '../../src/artwork/fileValidation.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import {
  createProjectArchive,
  readProjectArchive,
} from '../../src/project/projectArchive.js';
import { DEFAULT_RENDER_SETTINGS } from '../../src/render/RenderSettings.js';
import { CURRENT_PROJECT_SCHEMA_VERSION } from '../../src/project/projectSchema.js';
import { DEFAULT_BOARD_APPEARANCE } from '../../src/render/BoardAppearance.js';
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowFixtures = path.resolve(__dirname, '../../src/workflow/fixtures');

async function createArtworkEntry(fileName) {
  const originalBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
  ], { type: 'image/png' });
  const previewBlob = new Blob([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]),
  ], { type: 'image/png' });
  const sourceHash = await sha256(originalBlob);
  return {
    artwork: {
      source: {
        id: `asset-${fileName}`,
        fileName,
        mimeType: 'image/png',
        byteLength: originalBlob.size,
        widthPx: 100,
        heightPx: 50,
        previewWidthPx: 100,
        previewHeightPx: 50,
        pageIndex: null,
        pageCount: null,
        vector: false,
        pdfPageRotation: 0,
        mediaBox: null,
        sha256: sourceHash,
      },
      centerXmm: 75,
      centerYmm: 45,
      initialWidthMm: 150,
      initialHeightMm: 75,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      quality: { preview: 'auto', render: 'auto' },
      modified: false,
    },
    originalBlob,
    previewBlob,
  };
}

async function createFixture() {
  const first = await createArtworkEntry('top.png');
  const second = await createArtworkEntry('bottom.png');
  const snapshot = {
    schemaVersion: 6,
    meta: { name: 'Unit project' },
    workflowStep: 'artwork',
    box: new BoxNetModel().toJSON(),
    artworks: [
      { artwork: first.artwork, visible: true },
      { artwork: second.artwork, visible: true },
    ],
    activeArtworkIndex: 0,
    render: {
      ...structuredClone(DEFAULT_RENDER_SETTINGS),
      aspect: 'wide',
      longEdge: 4096,
      background: { mode: 'transparent', color: '#112233' },
      lighting: { ...structuredClone(DEFAULT_RENDER_SETTINGS.lighting), environment: 'cool' },
    },
    renderAppearance: {
      ...structuredClone(DEFAULT_BOARD_APPEARANCE),
      thicknessMm: 0.8,
      edgeColor: '#aabbcc',
    },
    view: {},
    history: { undo: [], redo: [] },
  };
  return {
    snapshot,
    artworkBlobs: [
      { originalBlob: first.originalBlob, previewBlob: first.previewBlob },
      { originalBlob: second.originalBlob, previewBlob: second.previewBlob },
    ],
  };
}

function createTechnicalFixture(name = 'rte') {
  const bundle = JSON.parse(fs.readFileSync(path.join(workflowFixtures, `${name}-workflow.v1.json`), 'utf8'));
  return {
    snapshot: {
      schemaVersion: 16,
      meta: { name: `Technical ${name}` },
      workflowStep: 'artwork',
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
      artworks: [],
      activeArtworkIndex: -1,
      render: structuredClone(DEFAULT_RENDER_SETTINGS),
      renderAppearance: structuredClone(DEFAULT_BOARD_APPEARANCE),
      view: {},
      history: { undo: [], redo: [] },
    },
    technicalAssets: {
      modelBlob: new Blob([bundle.modelJson.text], { type: bundle.modelJson.mediaType }),
      svgBlob: new Blob([bundle.semanticSvg.markup], { type: bundle.semanticSvg.mediaType }),
    },
  };
}

async function replaceArchiveEntry(archive, targetPath, replacement) {
  const reader = new ZipReader(new BlobReader(archive));
  const entries = await reader.getEntries();
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  try {
    for (const entry of entries) {
      const content = entry.filename === targetPath
        ? new Blob([replacement])
        : await entry.getData(new BlobWriter());
      await writer.add(entry.filename, new BlobReader(content));
    }
    return await writer.close();
  } finally {
    await reader.close();
  }
}

describe('.carton project archive', () => {
  it('round-trips the snapshot, multiple assets and previews', async () => {
    const { snapshot, artworkBlobs } = await createFixture();
    const archive = await createProjectArchive({ snapshot, artworkBlobs });
    const restored = await readProjectArchive(archive);

    expect(restored.snapshot).toMatchObject({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      cartonSource: {
        mode: 'quick',
        box: snapshot.box,
      },
      render: {
        ...snapshot.render,
        background: {
          mode: 'transparent',
          color: '#112233',
        },
      },
    });
    expect(restored.snapshot.artworks).toHaveLength(2);
    expect(restored.artworkBlobs).toHaveLength(2);
    for (let index = 0; index < artworkBlobs.length; index += 1) {
      expect(new Uint8Array(await restored.artworkBlobs[index].originalBlob.arrayBuffer())).toEqual(
        new Uint8Array(await artworkBlobs[index].originalBlob.arrayBuffer()),
      );
      expect(new Uint8Array(await restored.artworkBlobs[index].previewBlob.arrayBuffer())).toEqual(
        new Uint8Array(await artworkBlobs[index].previewBlob.arrayBuffer()),
      );
    }
  });

  it('embeds and restores a render background asset with the project', async () => {
    const { snapshot, artworkBlobs } = await createFixture();
    const backgroundBlob = new Blob([
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]),
    ], { type: 'image/png' });
    const backgroundHash = await sha256(backgroundBlob);
    const renderAsset = {
      assetId: backgroundHash,
      sha256: backgroundHash,
      fileName: 'studio-background.png',
      mimeType: 'image/png',
      width: 1920,
      height: 1080,
      blob: backgroundBlob,
    };
    snapshot.render.background = {
      ...snapshot.render.background,
      mode: 'image',
      image: {
        ...structuredClone(DEFAULT_RENDER_SETTINGS.background.image),
        assetId: backgroundHash,
        fileName: renderAsset.fileName,
        mimeType: renderAsset.mimeType,
        width: renderAsset.width,
        height: renderAsset.height,
      },
    };

    const archive = await createProjectArchive({ snapshot, artworkBlobs, renderAssets: [renderAsset] });
    const restored = await readProjectArchive(archive);

    expect(restored.renderAssets).toHaveLength(1);
    expect(restored.snapshot.render.background.image.assetId).toBe(backgroundHash);
    expect(new Uint8Array(await restored.renderAssets[0].blob.arrayBuffer())).toEqual(
      new Uint8Array(await backgroundBlob.arrayBuffer()),
    );
  });

  it('embeds and restores a custom HDR environment as a separate render asset', async () => {
    const { snapshot, artworkBlobs } = await createFixture();
    const environmentBlob = new Blob([
      '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 4\n',
      new Uint8Array([1, 2, 3, 4]),
    ], { type: 'image/vnd.radiance' });
    const environmentHash = await sha256(environmentBlob);
    const renderAsset = {
      kind: 'environment',
      assetId: environmentHash,
      sha256: environmentHash,
      fileName: 'custom.hdr',
      mimeType: 'image/vnd.radiance',
      width: 4,
      height: 2,
      blob: environmentBlob,
    };
    snapshot.render.lighting.environmentMap = {
      ...structuredClone(DEFAULT_RENDER_SETTINGS.lighting.environmentMap),
      source: 'custom',
      assetId: environmentHash,
    };

    const archive = await createProjectArchive({ snapshot, artworkBlobs, renderAssets: [renderAsset] });
    const restored = await readProjectArchive(archive);

    expect(restored.renderAssets).toHaveLength(1);
    expect(restored.renderAssets[0].kind).toBe('environment');
    expect(restored.snapshot.render.lighting.environmentMap.assetId).toBe(environmentHash);
  });

  it.each(['rte', 'ste', 'tt_sl123'])('round-trips technical %s model and SVG bytes in archive v5', async (name) => {
    const fixture = createTechnicalFixture(name);
    const archive = await createProjectArchive(fixture);
    const restored = await readProjectArchive(archive);

    expect(restored.snapshot.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(restored.snapshot.cartonSource.mode).toBe('technical');
    expect(restored.technicalAssets.modelBlob).toBeInstanceOf(Blob);
    expect(restored.technicalAssets.svgBlob).toBeInstanceOf(Blob);
    expect(new Uint8Array(await restored.technicalAssets.modelBlob.arrayBuffer()))
      .toEqual(new Uint8Array(await fixture.technicalAssets.modelBlob.arrayBuffer()));
    expect(new Uint8Array(await restored.technicalAssets.svgBlob.arrayBuffer()))
      .toEqual(new Uint8Array(await fixture.technicalAssets.svgBlob.arrayBuffer()));
  });

  it('rejects creating a technical archive without both technical assets', async () => {
    const fixture = createTechnicalFixture('rte');
    await expect(createProjectArchive({ snapshot: fixture.snapshot, technicalAssets: null }))
      .rejects.toMatchObject({ code: 'projectTechnicalAssetMissing' });
  });

  it('rejects a technical archive when the model entry is tampered after packaging', async () => {
    const fixture = createTechnicalFixture('rte');
    const archive = await createProjectArchive(fixture);
    const tampered = await replaceArchiveEntry(archive, 'technical/model.json', `${await fixture.technicalAssets.modelBlob.text()} `);

    await expect(readProjectArchive(tampered)).rejects.toMatchObject({
      code: 'projectTechnicalModelChecksumMismatch',
    });
  });

  it('rejects non-project ZIP data', async () => {
    await expect(readProjectArchive(new Blob(['not a zip']))).rejects.toMatchObject({
      code: 'projectArchiveInvalid',
    });
  });

  it('reports byte progress and stops before creating an archive when aborted', async () => {
    const fixture = await createFixture();
    const progress = [];
    const archive = await createProjectArchive({
      ...fixture,
      onProgress: ({ fraction }) => progress.push(fraction),
    });
    expect(progress.length).toBeGreaterThan(2);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);

    const controller = new AbortController();
    controller.abort();
    await expect(createProjectArchive({ ...fixture, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
