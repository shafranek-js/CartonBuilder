import { describe, expect, it } from 'vitest';

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

describe('createInteractive3dHtml', () => {
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
