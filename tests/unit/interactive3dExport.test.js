import { describe, expect, it } from 'vitest';
import { validateBytes } from 'gltf-validator';

import { createInteractive3dHtml } from '../../src/export/interactive3dExport.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';

if (!globalThis.FileReader) {
  class FakeFileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload?.({ target: this });
      }).catch((error) => this.onerror?.(error));
    }
  }
  globalThis.FileReader = FakeFileReader;
}

function buildCompleteBox() {
  const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

function buildParametricBox(templateId = 'ste') {
  return new BoxNetModel({ width: 150, height: 90, depth: 40 }, null, { templateId });
}

const fakeArtwork = { hasArtwork: true, quality: { render: 'auto' } };
const fakePreview = new Blob(['preview'], { type: 'image/png' });

function fakeEntries() {
  return [{ model: fakeArtwork, visible: true, previewBlob: fakePreview }];
}

function stubTextureComposer() {
  return async () => ({
    canvas: {
      toDataURL: () => 'data:image/png;base64,AAAA',
    },
  });
}

function readEmbeddedData(html) {
  const match = html.match(/<script id="embeddedViewerData"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Embedded viewer data was not found.');
  return JSON.parse(match[1]);
}

function readGlbJson(dataUrl) {
  const bytes = readGlbBytes(dataUrl);
  expect(bytes.toString('ascii', 0, 4)).toBe('glTF');
  const jsonLength = bytes.readUInt32LE(12);
  const chunkType = bytes.toString('ascii', 16, 20);
  expect(chunkType).toBe('JSON');
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trim());
}

function readGlbBytes(dataUrl) {
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

describe('createInteractive3dHtml', () => {
  it('exports opaque interior and edge appearance with separate fallback GLB materials', async () => {
    const boxModel = buildCompleteBox();
    boxModel.setBoardCaliper(0.7);
    const blob = await createInteractive3dHtml({
      boxModel,
      artworks: fakeEntries(),
      boardAppearance: {
        thicknessMm: 0.7,
        bevelRadiusMm: 0.1,
        interiorColor: '#ff00ff',
        edgeColor: '#00ffff',
      },
      composeTexture: async () => ({
        canvas: {
          toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69flkwAAAABJRU5ErkJggg==',
        },
      }),
    });
    const html = await blob.text();
    const data = readEmbeddedData(html);
    const glb = readGlbJson(data.models.glb);

    expect(data.boardAppearance).toEqual({
      thicknessMm: 0.7,
      bevelRadiusMm: 0.1,
      interiorColor: '#ff00ff',
      edgeColor: '#00ffff',
    });
    expect(html).toContain("color: DATA.boardAppearance?.interiorColor || '#f4f2ec'");
    expect(html).toContain('side: THREE.FrontSide');
    expect(html).toContain("color: DATA.boardAppearance?.edgeColor || '#c8c1b5'");
    expect(glb.materials.map((material) => material.name)).toEqual(['Artwork', 'Interior', 'Edges']);
    expect(glb.materials[1].pbrMetallicRoughness.baseColorFactor).toEqual([1, 0, 1, 1]);
    expect(glb.materials[2].pbrMetallicRoughness.baseColorFactor).toEqual([0, 1, 1, 1]);
    expect(glb.meshes.every((mesh) => (
      mesh.primitives.length === 3
      && mesh.primitives.map((primitive) => primitive.material).join(',') === '0,1,2'
      && mesh.primitives.every((primitive) => primitive.attributes.NORMAL !== undefined)
    ))).toBe(true);
    const validation = await validateBytes(new Uint8Array(readGlbBytes(data.models.glb)));
    expect(validation.issues.numErrors, JSON.stringify(validation.issues.messages)).toBe(0);
  });

  it('includes normals on every primitive of the parametric fallback GLB', async () => {
    const blob = await createInteractive3dHtml({
      boxModel: buildParametricBox('ste'),
      artworks: fakeEntries(),
      composeTexture: stubTextureComposer(),
    });
    const data = readEmbeddedData(await blob.text());
    const glb = readGlbJson(data.models.glb);

    expect(glb.meshes.length).toBe(13);
    expect(glb.meshes.every((mesh) => mesh.primitives.every((primitive) => (
      primitive.attributes.NORMAL !== undefined
    )))).toBe(true);
    expect(glb.accessors.some((accessor) => accessor.type === 'VEC3')).toBe(true);
  });

  it('embeds all parametric polygon elements and assembly phases', async () => {
    const blob = await createInteractive3dHtml({
      boxModel: buildParametricBox('rte'),
      artworks: fakeEntries(),
      composeTexture: stubTextureComposer(),
    });
    const html = await blob.text();
    expect(html).toContain('"templateId":"rte"');
    for (const id of ['top-closure', 'bottom-closure', 'top-tuck', 'bottom-tuck', 'left-top-dust', 'right-bottom-dust']) {
      expect(html).toContain(`"id":"${id}"`);
    }
    expect(html).toContain('"phase":[0.9,1]');
  });

  it('embeds the fold graph, artwork texture and inline three.js in one file', async () => {
    const blob = await createInteractive3dHtml({
      boxModel: buildCompleteBox(),
      artworks: fakeEntries(),
      composeTexture: stubTextureComposer(),
    });
    const html = await blob.text();

    expect(blob.type).toBe('text/html;charset=utf-8');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).toContain('import * as THREE from \'data:text/javascript;base64,');
    expect(html).toContain('makeRotationAxis');
    expect(html).toContain('"rootId":"front"');
    for (const id of ['front', 'bottom', 'top', 'back', 'left', 'right']) {
      expect(html).toContain(`"id":"${id}"`);
    }
    expect(html).toMatch(/<script type="module">[\s\S]*<\/script>/);
  });

  it('escapes script closing sequences inside the inlined bundle', async () => {
    const blob = await createInteractive3dHtml({
      boxModel: buildCompleteBox(),
      artworks: fakeEntries(),
      composeTexture: stubTextureComposer(),
    });
    const html = await blob.text();
    const scriptBlock = html.match(/<script type="module">([\s\S]*)<\/script>/);
    expect(scriptBlock).not.toBeNull();
    expect(scriptBlock[1]).not.toContain('</script');
  });

  it('composes the HTML texture with the selected high-quality render profile', async () => {
    let options;
    const composeTexture = async (nextOptions) => {
      options = nextOptions;
      return { canvas: { toDataURL: () => 'data:image/png;base64,QUALITY' } };
    };
    const blob = await createInteractive3dHtml({
      boxModel: buildCompleteBox(),
      artworks: [{
        model: { hasArtwork: true, quality: { render: 1200 } },
        visible: true,
        previewBlob: fakePreview,
      }],
      htmlQuality: 2400,
      composeTexture,
    });

    expect(await blob.text()).toContain('data:image/png;base64,QUALITY');
    expect(options).toMatchObject({
      purpose: 'render-export',
      targetDpi: 2400,
      useNativeSourceResolution: true,
    });
    expect(options.textureLimits).toMatchObject({ maxEdge: 8192, maxPixels: 24_000_000 });
    expect(options.getEntryTargetDpi()).toBe(2400);
  });

  it('lets Auto follow the highest per-artwork Render quality', async () => {
    let options;
    await createInteractive3dHtml({
      boxModel: buildCompleteBox(),
      artworks: [{
        model: { hasArtwork: true, quality: { render: 1200 } },
        visible: true,
        previewBlob: fakePreview,
      }],
      composeTexture: async (nextOptions) => {
        options = nextOptions;
        return { canvas: { toDataURL: () => 'data:image/png;base64,AUTO' } };
      },
    });
    expect(options.targetDpi).toBe(1200);
  });

  it('includes Open Graph tags with box dimensions in the head', async () => {
    const blob = await createInteractive3dHtml({
      boxModel: buildCompleteBox(),
      artworks: fakeEntries(),
      composeTexture: async () => ({
        canvas: { toDataURL: () => 'data:image/png;base64,OG' },
        width: 1,
        height: 1,
        pixelsPerMm: 1,
      }),
    });
    const html = await blob.text();

    expect(html).toContain('<title>Carton 150×90×40 mm</title>');
    expect(html).toContain('property="og:title" content="Carton 150×90×40 mm"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:type" content="website"');
  });

  it('rejects when no artwork preview is available', async () => {
    await expect(createInteractive3dHtml({
      boxModel: buildCompleteBox(),
      artworks: [],
      composeTexture: stubTextureComposer(),
    })).rejects.toThrow(/preview is required/i);
  });

  it('embeds every video artwork with its placement so each side animates', async () => {
    const videoBlobA = new Blob(['video-a'], { type: 'video/mp4' });
    const videoBlobB = new Blob(['video-b'], { type: 'video/mp4' });
    const entries = [
      {
        model: {
          hasArtwork: true,
          quality: { render: 'auto' },
          source: { isVideo: true, mimeType: 'video/mp4' },
          centerXmm: 10,
          centerYmm: 20,
          initialWidthMm: 100,
          initialHeightMm: 50,
          scaleX: 1.5,
          scaleY: 1.25,
          rotation: 90,
          opacity: 0.8,
          crop: { x: 1, y: 2, width: 40, height: 30 },
        },
        visible: true,
        previewBlob: fakePreview,
        originalBlob: videoBlobA,
      },
      {
        model: {
          hasArtwork: true,
          quality: { render: 'auto' },
          source: { isVideo: true, mimeType: 'video/mp4' },
          centerXmm: 5,
          centerYmm: 7,
          initialWidthMm: 80,
          initialHeightMm: 60,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          opacity: 1,
          crop: null,
        },
        visible: true,
        previewBlob: fakePreview,
        originalBlob: videoBlobB,
      },
    ];
    const composeTexture = async () => ({
      canvas: { toDataURL: () => 'data:image/png;base64,VIDEOBASE' },
      width: 1024,
      height: 768,
      pixelsPerMm: 3,
    });
    const blob = await createInteractive3dHtml({
      boxModel: buildCompleteBox(),
      artworks: entries,
      composeTexture,
    });
    const html = await blob.text();

    expect(html).toContain('"videos"');
    expect(html).toMatch(/data:video\/mp4;base64,[^"]*dmlkZW8tYQ/);
    expect(html).toMatch(/data:video\/mp4;base64,[^"]*dmlkZW8tYg/);
    expect(html).toMatch(/"rotation":90/);
    expect(html).toContain('"initialWidthMm":80');
    expect(html).toContain('"textureSize":{"width":1024,"height":768}');
    expect(html).toContain('"pixelsPerMm":3');

    expect(html).toContain('videoAudioController');
    expect(html).toContain('userData.panelId');
    expect(html).toContain('function setVideoAudioForPanel');

    expect(html).toContain('id="panelToggle"');
    expect(html).toContain('id="autoRotate"');
    expect(html).toContain('id="bottomControls"');
    expect(html).toContain('<div id="panel" hidden>');
    expect(html).toContain('let theta = 0;');
    expect(html).toContain('let phi = Math.PI / 2;');
    expect(html).toContain('autoRotateEnabled = true;');
  });

  it('embeds presentation state and an offline GLB model with template controls', async () => {
    const glb = new Blob([new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0, 0, 0])], {
      type: 'model/gltf-binary',
    });
    const blob = await createInteractive3dHtml({
      boxModel: buildCompleteBox(),
      artworks: fakeEntries(),
      glbBlob: glb,
      renderState: {
        camera: { projection: 'orthographic', cameraDistance: 3 },
        lighting: { environmentMap: { intensity: 0.8, rotation: 15 } },
      },
      previewState: { foldProgress: 0.5, lightAzimuth: 180 },
      locale: 'ru',
      composeTexture: stubTextureComposer(),
    });
    const html = await blob.text();

    expect(html).toContain('id="embeddedViewerData"');
    expect(html).toContain('"modelId":"carton"');
    expect(html).toContain('data:model/gltf-binary;base64,Z2xURgIA');
    expect(html).toContain('id="modelsPanel"');
    expect(html).toContain('id="settingsPanel"');
    expect(html).toContain('id="exportStandalone"');
    expect(html).toContain('id="toneMapping"');
    expect(html).toContain('id="keyColor"');
    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });
});
