import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  ArtworkRenderer,
  getArtworkOrigin,
  getArtworkRotationTransform,
  getCropCorners,
  getCropRect,
} from '../../src/artwork/ArtworkRenderer.js';
import { TechnicalCartonDocument } from '../../src/carton/TechnicalCartonDocument.js';
import { createTechnicalBoxModelAdapter } from '../../src/carton/technicalBoxModelAdapter.js';
import { getDielineSegments } from '../../src/model/dieline.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/workflow/fixtures');
const expectedArcCounts = { rte: 19, ste: 20, tt_sl123: 21 };

class FakeSvgNode {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.id = tagName === 'svg' ? 'test-svg' : '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  querySelectorAll() {
    return [];
  }
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function arcFlags(pathData) {
  return [...String(pathData || '').matchAll(/A\S+ \S+ 0 ([01]) ([01]) /g)]
    .map((match) => ({ largeArc: Number(match[1]), sweep: Number(match[2]) }));
}

function createArtwork(rotation = 0) {
  return {
    centerXmm: 100,
    centerYmm: 60,
    unrotatedWidthMm: 80,
    unrotatedHeightMm: 40,
    rotation,
  };
}

describe('ArtworkRenderer crop geometry', () => {
  it('maps local crop coordinates to the artwork origin in document space', () => {
    const artwork = createArtwork();
    expect(getArtworkOrigin(artwork)).toEqual({ x: 60, y: 40 });
    expect(getCropRect(artwork, { x: 10, y: 5, width: 30, height: 20 })).toEqual({
      x: 70,
      y: 45,
      width: 30,
      height: 20,
    });
  });

  it('uses one global rectangle for the frame, handles and crop mask', () => {
    const artwork = createArtwork();
    const crop = { x: 10, y: 5, width: 30, height: 20 };
    expect(getCropCorners(artwork, crop)).toEqual([
      { x: 70, y: 45 },
      { x: 100, y: 45 },
      { x: 100, y: 65 },
      { x: 70, y: 65 },
    ]);
  });

  it.each([0, 90, 180, 270])('keeps the same crop rectangle and shared rotation transform at %d degrees', (rotation) => {
    const artwork = createArtwork(rotation);
    expect(getCropRect(artwork, { x: 10, y: 5, width: 30, height: 20 })).toMatchObject({
      x: 70,
      y: 45,
      width: 30,
      height: 20,
    });
    expect(getArtworkRotationTransform(artwork)).toBe(`rotate(${rotation} 100 60)`);
  });

  for (const name of ['rte', 'ste', 'tt_sl123']) {
    it(`renders exact technical ARC paths and an ARC panel mask for ${name.toUpperCase()}`, async () => {
      const bundle = JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}-workflow.v1.json`), 'utf8'));
      const document = await TechnicalCartonDocument.create(bundle);
      const model = createTechnicalBoxModelAdapter(document);
      const documentRef = { createElementNS: (_namespace, tagName) => new FakeSvgNode(tagName, documentRef) };
      const svg = new FakeSvgNode('svg', documentRef);
      const renderer = new ArtworkRenderer({
        svg,
        model,
        artwork: { hasArtwork: false },
        viewport: { zoom: 1, panX: 0, panY: 0 },
        layers: {},
        onPointerStart() {},
      });

      renderer.renderScene(svg, {
        preview: true,
        showDieline: true,
        showNames: false,
        showHighlights: false,
        showArtwork: false,
      });

      const nodes = descendants(svg);
      const maskPath = nodes.find((node) => node.tagName === 'clipPath')?.children[0];
      const arcPaths = nodes.filter((node) => (
        node.tagName === 'path'
        && /^dieline-(?:cut|fold)$/.test(node.getAttribute('class') || '')
        && node.getAttribute('d')?.includes('A')
      ));
      const { cut, fold } = getDielineSegments(model);
      const sourceArcs = [...cut, ...fold].filter((segment) => segment.kind === 'ARC');
      const renderedFlags = arcPaths.flatMap((node) => arcFlags(node.getAttribute('d')));
      expect(renderedFlags).toEqual(sourceArcs.map((arc) => ({
        largeArc: 0,
        sweep: arc.clockwise ? 0 : 1,
      })));
      expect(arcPaths).toHaveLength(expectedArcCounts[name]);

      const maskArcs = model.getElements()
        .flatMap((panel) => panel.contour.segments || [])
        .filter((segment) => segment.kind === 'ARC');
      expect(arcFlags(maskPath?.getAttribute('d'))).toEqual(maskArcs.map((arc) => ({
        largeArc: 0,
        sweep: arc.clockwise ? 0 : 1,
      })));
    });
  }

  it('renders semantic snap markers and exact boundary guides with diagnostics', () => {
    const documentRef = { createElementNS: (_namespace, tagName) => new FakeSvgNode(tagName, documentRef) };
    const svg = new FakeSvgNode('svg', documentRef);
    const renderer = new ArtworkRenderer({
      svg,
      model: {
        getBounds: () => ({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
        getPanels: () => [],
      },
      artwork: { hasArtwork: false },
      viewport: { zoom: 2, panX: 0, panY: 0 },
      layers: { dieline: false, names: false, highlights: false, artwork: false },
      onPointerStart() {},
    });
    renderer.setSnapGuides([
      {
        id: 'intersection:cross',
        kind: 'intersection',
        point: { x: 20, y: 30 },
        sourceIds: ['a', 'b'],
      },
      {
        id: 'panel-boundary:front:0',
        kind: 'panel-boundary',
        point: { x: 50, y: 40 },
        sourceIds: ['body.front:boundary:0'],
        segment: { kind: 'LINE', start: { x: 0, y: 40 }, end: { x: 100, y: 40 } },
      },
    ]);
    renderer.renderScene(svg, {
      preview: false,
      showDieline: false,
      showNames: false,
      showHighlights: false,
      showArtwork: false,
    });

    const nodes = descendants(svg);
    const marker = nodes.find((node) => node.tagName === 'circle');
    const boundary = nodes.find((node) => node.tagName === 'line' && node.getAttribute('data-snap-kind') === 'panel-boundary');
    expect(marker?.getAttribute('data-snap-kind')).toBe('intersection');
    expect(marker?.getAttribute('data-snap-id')).toBe('intersection:cross');
    expect(marker?.getAttribute('data-snap-source-ids')).toBe('a|b');
    expect(boundary?.getAttribute('data-snap-kind')).toBe('panel-boundary');
    expect(boundary?.getAttribute('data-snap-id')).toBe('panel-boundary:front:0');
  });
});
