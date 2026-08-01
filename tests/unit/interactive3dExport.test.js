import { describe, expect, it } from 'vitest';

import { createInteractive3dHtml } from '../../src/export/interactive3dExport.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';

function buildCompleteBox() {
  const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

const fakeArtwork = { hasArtwork: true };
const fakePreview = new Blob(['preview'], { type: 'image/png' });

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
      artwork: fakeArtwork,
      previewBlob: fakePreview,
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
      artwork: fakeArtwork,
      previewBlob: fakePreview,
      composeTexture: stubTextureComposer(),
    });
    const html = await blob.text();
    const scriptBlock = html.match(/<script type="module">([\s\S]*)<\/script>/);
    expect(scriptBlock).not.toBeNull();
    expect(scriptBlock[1]).not.toContain('</script');
  });

  it('rejects when no artwork preview is available', async () => {
    await expect(createInteractive3dHtml({
      boxModel: buildCompleteBox(),
      artwork: { hasArtwork: false },
      previewBlob: null,
      composeTexture: stubTextureComposer(),
    })).rejects.toThrow(/preview is required/i);
  });
});
