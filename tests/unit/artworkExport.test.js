import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { ArtworkModel } from '../../src/artwork/ArtworkModel.js';
import { createPdfExport, createPrepressPdfExport, createPreviewBlob } from '../../src/export/artworkExport.js';
import { getExportWarnings } from '../../src/export/exportChecks.js';
import { TechnicalCartonDocument } from '../../src/carton/TechnicalCartonDocument.js';
import { createTechnicalBoxModelAdapter } from '../../src/carton/technicalBoxModelAdapter.js';
import { BoxNetModel } from '../../src/model/BoxNetModel.js';
import { arcToCubicSegments, getDielineSegments } from '../../src/model/dieline.js';
import { runPrepressPreflight } from '../../src/prepress/prepressPreflight.js';
import { createPrepressSvg } from '../../src/export/svgExport.js';
import { createTechnicalSvgExport } from '../../src/export/technicalSvgExport.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/workflow/fixtures');
const expectedArcCounts = { rte: 19, ste: 20, tt_sl123: 21 };

function loadTechnicalFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}-workflow.v1.json`), 'utf8'));
}

async function createTechnicalModel(name) {
  const document = await TechnicalCartonDocument.create(loadTechnicalFixture(name));
  return { document, model: createTechnicalBoxModelAdapter(document) };
}

function createTechnicalArtwork(bounds, sourceBlob, overrides = {}) {
  const artwork = new ArtworkModel().load({
    id: 'technical-raster',
    fileName: overrides.fileName || 'technical.png',
    mimeType: overrides.mimeType || 'image/png',
    byteLength: sourceBlob.size,
    widthPx: 600,
    heightPx: 400,
    ...overrides,
  }, bounds);
  return { model: artwork, visible: true, originalBlob: sourceBlob, previewBlob: sourceBlob };
}

async function readPdfPageContents(bytes) {
  const document = await PDFDocument.load(bytes);
  const page = document.getPage(0);
  const contents = page.node.lookup(PDFName.of('Contents'), PDFArray);
  let text = '';
  for (let index = 0; index < contents.size(); index += 1) {
    const stream = document.context.lookup(contents.get(index));
    text += stream instanceof PDFRawStream
      ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
      : stream.getUnencodedContentsString();
  }
  return text;
}

async function inspectPdf(bytes) {
  const document = await PDFDocument.load(bytes);
  const page = document.getPage(0);
  const resources = page.node.Resources();
  const xObjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
  const objects = xObjects
    ? xObjects.entries().map(([name, ref]) => {
      const object = document.context.lookup(ref);
      const dictionary = object?.dict || object;
      const subtype = dictionary?.get?.(PDFName.of('Subtype'))?.asString?.() || null;
      const number = (key) => {
        const value = dictionary?.get?.(PDFName.of(key));
        return value instanceof PDFNumber ? value.asNumber() : null;
      };
      return {
        name: name.asString(),
        subtype,
        width: number('Width'),
        height: number('Height'),
      };
    })
    : [];
  return {
    document,
    page,
    content: await readPdfPageContents(bytes),
    objects,
  };
}

function createSourceJpeg() {
  return Uint8Array.from(Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Af/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z',
    'base64',
  ));
}

async function exportPdfBytes(boxModel, artworks) {
  const exported = await createPdfExport({ boxModel, artworks });
  return new Uint8Array(await exported.arrayBuffer());
}

function completeBox() {
  const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });
  model.addPanel('front', 'bottom');
  model.addPanel('front', 'top');
  model.addPanel('top', 'top');
  model.addPanel('front', 'left');
  model.addPanel('back', 'right');
  return model;
}

async function createSourcePdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 400]);
  page.drawRectangle({ x: 10, y: 10, width: 580, height: 380, color: rgb(1, 0, 0) });
  return document.save();
}

function createSourcePng() {
  return Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69flkwAAAABJRU5ErkJggg==',
    'base64',
  ));
}

describe('artwork export', () => {
  it('reports non-blocking resolution, coverage and overflow warnings', () => {
    const box = completeBox();
    const artwork = new ArtworkModel().load({
      id: 'raster',
      fileName: 'small.png',
      mimeType: 'image/png',
      byteLength: 100,
      widthPx: 100,
      heightPx: 100,
    }, box.getBounds());
    artwork.setScale(0.5);
    artwork.moveBy(-200, 0);

    const warnings = getExportWarnings(box, artwork);
    expect(warnings.some((warning) => warning.includes('DPI'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('not fully covered'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('outside'))).toBe(true);
  });

  it('creates a physical-size PDF with vector artwork and a Dieline OCG', async () => {
    const box = completeBox();
    const sourceBytes = await createSourcePdf();
    const sourceBlob = new Blob([sourceBytes], { type: 'application/pdf' });
    const artwork = new ArtworkModel().load({
      id: 'pdf',
      fileName: 'vector.pdf',
      mimeType: 'application/pdf',
      byteLength: sourceBlob.size,
      widthPx: 600,
      heightPx: 400,
      pageIndex: 0,
      pageCount: 1,
      vector: true,
      pdfPageRotation: 0,
    }, box.getBounds());
    artwork.applyCrop({
      x: artwork.unrotatedWidthMm * 0.2,
      y: artwork.unrotatedHeightMm * 0.15,
      width: artwork.unrotatedWidthMm * 0.6,
      height: artwork.unrotatedHeightMm * 0.7,
    });

    const exported = await createPdfExport({
      boxModel: box,
      artworks: [{ model: artwork, visible: true, originalBlob: sourceBlob }],
    });
    const bytes = new Uint8Array(await exported.arrayBuffer());
    const inspected = await inspectPdf(bytes);
    const { document, page } = inspected;
    const bounds = box.getBounds();
    const pointsPerMm = 72 / 25.4;

    expect(page.getWidth()).toBeCloseTo(bounds.width * pointsPerMm, 4);
    expect(page.getHeight()).toBeCloseTo(bounds.height * pointsPerMm, 4);
    const ocProperties = document.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    expect(ocProperties).toBeInstanceOf(PDFDict);

    const resources = page.node.Resources();
    const properties = resources.lookup(PDFName.of('Properties'), PDFDict);
    expect(properties.has(PDFName.of('Dieline'))).toBe(true);
    const colorSpaces = resources.lookup(PDFName.of('ColorSpace'), PDFDict);
    const separation = colorSpaces.lookup(PDFName.of('CutContourCS'), PDFArray);
    expect(separation.lookup(0, PDFName).asString()).toBe('/Separation');
    expect(separation.lookup(1, PDFName).asString()).toBe('/CutContour');

    expect(inspected.objects.filter((object) => object.subtype === '/Form')).toHaveLength(1);
    expect(inspected.objects.filter((object) => object.subtype === '/Image')).toHaveLength(0);
    expect(inspected.content).toContain('Do');
    expect(inspected.content.indexOf('Do')).toBeLessThan(inspected.content.indexOf('/Dieline BDC'));
    expect(artwork.toJSON()).toEqual(expect.objectContaining({ crop: expect.any(Object) }));
  });

  it('embeds PNG and JPEG sources as image XObjects with their original pixel dimensions', async () => {
    const box = completeBox();
    for (const [mimeType, bytes] of [
      ['image/png', createSourcePng()],
      ['image/jpeg', createSourceJpeg()],
    ]) {
      const sourceBlob = new Blob([bytes], { type: mimeType });
      const artwork = createTechnicalArtwork(box.getBounds(), sourceBlob, {
        mimeType,
        fileName: `source.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
        widthPx: 1,
        heightPx: 1,
      });
      const inspected = await inspectPdf(await exportPdfBytes(box, [artwork]));
      const images = inspected.objects.filter((object) => object.subtype === '/Image');
      expect(images).toHaveLength(1);
      expect(images[0]).toEqual(expect.objectContaining({ width: 1, height: 1 }));
    }
  });

  it('applies independent scale, crop, rotation and both signed flip axes without mutating the model', async () => {
    const box = completeBox();
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const artwork = createTechnicalArtwork(box.getBounds(), sourceBlob, {
      widthPx: 1,
      heightPx: 1,
    });
    artwork.model.applyCrop({
      x: artwork.model.unrotatedWidthMm * 0.15,
      y: artwork.model.unrotatedHeightMm * 0.2,
      width: artwork.model.unrotatedWidthMm * 0.55,
      height: artwork.model.unrotatedHeightMm * 0.5,
    });
    artwork.model.setScaleX(0.7);
    artwork.model.setScaleY(0.35);
    artwork.model.rotateQuarterTurns(1);
    artwork.model.flipHorizontal();
    artwork.model.flipVertical();
    const before = artwork.model.toJSON();
    const inspected = await inspectPdf(await exportPdfBytes(box, [artwork]));
    expect(inspected.objects.filter((object) => object.subtype === '/Image')).toHaveLength(1);
    expect(inspected.content).toMatch(/-\d+(?:\.\d+)? 0 0 -\d+(?:\.\d+)? 0 0 cm/);
    expect(inspected.content).toContain('Do');
    expect(artwork.model.toJSON()).toEqual(before);
  });

  it('keeps visible print layers in order, excludes hidden and finish layers, and preserves opacity', async () => {
    const box = completeBox();
    const png = new Blob([createSourcePng()], { type: 'image/png' });
    const first = createTechnicalArtwork(box.getBounds(), png, { fileName: 'first.png' });
    const second = createTechnicalArtwork(box.getBounds(), png, { fileName: 'second.png' });
    second.model.setOpacity(0.4);
    const hidden = createTechnicalArtwork(box.getBounds(), png, { fileName: 'hidden.png' });
    const finish = createTechnicalArtwork(box.getBounds(), png, { fileName: 'finish.png' });
    const inspected = await inspectPdf(await exportPdfBytes(box, [
      { ...first, outputRole: 'print' },
      { ...second, outputRole: 'print' },
      { ...hidden, visible: false, outputRole: 'print' },
      { ...finish, outputRole: 'finish' },
    ]));
    expect(inspected.objects.filter((object) => object.subtype === '/Image')).toHaveLength(2);
    expect(inspected.content.match(/Do/g)).toHaveLength(2);
    const extGState = inspected.page.node.Resources().lookup(PDFName.of('ExtGState'), PDFDict);
    const alphaValues = extGState.entries().map(([, ref]) => {
      const state = inspected.document.context.lookup(ref);
      const value = state?.get?.(PDFName.of('ca'));
      return value instanceof PDFNumber ? value.asNumber() : null;
    });
    expect(alphaValues).toContain(0.4);
    expect(inspected.content.indexOf('Do')).toBeLessThan(inspected.content.lastIndexOf('Do'));
  });

  it.each([
    ['invalid-panel-contour', (box) => {
      const getElements = box.getElements.bind(box);
      box.getElements = () => [{
        ...getElements()[0],
        contour: { segments: [{ kind: 'LINE', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }] },
      }];
    }],
    ['unsupported-artwork-source', (box, artwork) => {
      artwork.model.source.mimeType = 'image/gif';
    }],
    ['invalid-artwork-source', (box, artwork) => {
      artwork.originalBlob = new Blob(['not a valid image'], { type: 'image/png' });
    }],
    ['invalid-artwork-transform', (box, artwork) => {
      artwork.model.opacity = Number.NaN;
    }],
    ['invalid-artwork-crop', (box, artwork) => {
      artwork.model.crop = { x: -1, y: 0, width: 1, height: 1 };
    }],
  ])('rejects %s before producing a PDF', async (reason, mutate) => {
    const box = completeBox();
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const artwork = createTechnicalArtwork(box.getBounds(), sourceBlob);
    mutate(box, artwork);
    await expect(createPdfExport({ boxModel: box, artworks: [artwork] }))
      .rejects.toMatchObject({ code: 'pdfExportInvalid', parameters: { reason } });
  });

  it('keeps the artwork-required error when the only active layer has no source blob', async () => {
    const box = completeBox();
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const artwork = createTechnicalArtwork(box.getBounds(), sourceBlob);
    artwork.originalBlob = null;

    await expect(createPdfExport({ boxModel: box, artworks: [artwork] }))
      .rejects.toMatchObject({ code: 'artworkRequired' });
  });

  it('rejects a missing source blob instead of silently omitting the active layer', async () => {
    const box = completeBox();
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const valid = createTechnicalArtwork(box.getBounds(), sourceBlob, { id: 'valid-layer' });
    const missing = createTechnicalArtwork(box.getBounds(), sourceBlob, { id: 'missing-layer' });
    missing.originalBlob = null;

    await expect(createPdfExport({ boxModel: box, artworks: [valid, missing] }))
      .rejects.toMatchObject({
        code: 'pdfExportInvalid',
        parameters: { reason: 'artwork-source-missing' },
      });
  });

  it('rejects an explicitly open panel contour', async () => {
    const box = completeBox();
    const getElements = box.getElements.bind(box);
    box.getElements = () => [{
      ...getElements()[0],
      contour: { closed: false, segments: getElements()[0].polygon.map((start, index, points) => ({
        kind: 'LINE',
        start,
        end: points[(index + 1) % points.length],
      })) },
    }];
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const artwork = createTechnicalArtwork(box.getBounds(), sourceBlob);

    await expect(createPdfExport({ boxModel: box, artworks: [artwork] }))
      .rejects.toMatchObject({
        code: 'pdfExportInvalid',
        parameters: { reason: 'invalid-panel-contour' },
      });
  });

  it('rejects an empty Technical dieline before producing a PDF', async () => {
    const { model } = await createTechnicalModel('rte');
    model.getDielinePrimitives = () => [];
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const artwork = createTechnicalArtwork(model.getBounds(), sourceBlob);

    await expect(createPdfExport({ boxModel: model, artworks: [artwork] }))
      .rejects.toMatchObject({
        code: 'pdfExportInvalid',
        parameters: { reason: 'invalid-dieline' },
      });
  });

  it('rejects a Technical dieline that contains CUT but no FOLD', async () => {
    const { model } = await createTechnicalModel('rte');
    const cutOnly = model.getDielinePrimitives().filter((primitive) => (
      primitive.classification !== 'fold' && primitive.role !== 'FOLD_BOUNDARY'
    ));
    expect(cutOnly.length).toBeGreaterThan(0);
    model.getDielinePrimitives = () => cutOnly;
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const artwork = createTechnicalArtwork(model.getBounds(), sourceBlob);

    await expect(createPdfExport({ boxModel: model, artworks: [artwork] }))
      .rejects.toMatchObject({
        code: 'pdfExportInvalid',
        parameters: { reason: 'invalid-dieline' },
      });
  });

  it('rejects a Technical dieline that contains FOLD but no CUT', async () => {
    const { model } = await createTechnicalModel('rte');
    const foldOnly = model.getDielinePrimitives().filter((primitive) => (
      primitive.classification === 'fold' || primitive.role === 'FOLD_BOUNDARY'
    ));
    expect(foldOnly.length).toBeGreaterThan(0);
    model.getDielinePrimitives = () => foldOnly;
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const artwork = createTechnicalArtwork(model.getBounds(), sourceBlob);

    await expect(createPdfExport({ boxModel: model, artworks: [artwork] }))
      .rejects.toMatchObject({
        code: 'pdfExportInvalid',
        parameters: { reason: 'invalid-dieline' },
      });
  });

  it.each(['rte', 'ste', 'tt_sl123'])('preserves technical ARC and OPEN_CUT geometry in SVG and PDF for %s', async (name) => {
    const { document, model } = await createTechnicalModel(name);
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const artwork = createTechnicalArtwork(model.getBounds(), sourceBlob, {
      fileName: `technical-${name}.png`,
      mimeType: 'image/png',
      vector: false,
    });
    const dieline = getDielineSegments(model);
    const allPrimitives = [...dieline.cut, ...dieline.fold];
    const sourceArcs = document.getDielinePrimitives().filter((primitive) => primitive.kind === 'ARC').length;
    const openCuts = allPrimitives.filter((primitive) => primitive.role === 'OPEN_CUT');

    const svg = await createTechnicalSvgExport(model);
    const provenance = svg.match(/<metadata id="cartonbuilder-export-provenance"[^>]*>[\s\S]*?<\/metadata>/)?.[0];
    expect(provenance).toBeTruthy();
    expect(svg.replace(provenance, '')).toBe(loadTechnicalFixture(name).semanticSvg.markup);
    expect(sourceArcs).toBe(expectedArcCounts[name]);
    expect(openCuts.length).toBeGreaterThan(0);
    const openCutFeatures = JSON.parse(loadTechnicalFixture(name).modelJson.text).features
      .filter((feature) => feature.operation === 'OPEN_CUT');
    for (const feature of openCutFeatures) expect(svg).toContain(`data-entity-id="${feature.id}"`);

    const pdf = await createPdfExport({ boxModel: model, artworks: [artwork] });
    const contents = await readPdfPageContents(new Uint8Array(await pdf.arrayBuffer()));
    const panelArcs = model.getElements().flatMap((panel) => panel.contour.segments || [])
      .filter((segment) => segment.kind === 'ARC');
    const dielineArcs = allPrimitives.filter((segment) => segment.kind === 'ARC');
    const expectedCurveOperators = panelArcs.concat(dielineArcs)
      .reduce((count, arc) => count + arcToCubicSegments(arc).length, 0);
    expect((contents.match(/\bc\b/g) || []).length).toBe(expectedCurveOperators);
    for (const primitive of openCuts) {
      const bounds = model.getBounds();
      const startX = (primitive.start.x - bounds.minX) * (72 / 25.4);
      const startY = (bounds.maxY - primitive.start.y) * (72 / 25.4);
      const endX = (primitive.end.x - bounds.minX) * (72 / 25.4);
      const endY = (bounds.maxY - primitive.end.y) * (72 / 25.4);
      expect(contents).toContain(`${startX} ${startY} m`);
      expect(contents).toContain(`${endX} ${endY}`);
    }
    expect(allPrimitives.filter((primitive) => primitive.kind === 'ARC')).toHaveLength(expectedArcCounts[name]);
  });

  it.each(['rte', 'ste', 'tt_sl123'])('traces every technical ARC in raster export for %s', async (name) => {
    const { model } = await createTechnicalModel(name);
    const sourceBlob = new Blob(['technical-raster'], { type: 'image/png' });
    const artwork = createTechnicalArtwork(model.getBounds(), sourceBlob);
    const calls = [];
    const context = new Proxy({
      arc: (...args) => calls.push(['arc', ...args]),
      beginPath: () => {},
      clip: () => {},
      closePath: () => {},
      drawImage: () => {},
      fillRect: () => {},
      lineTo: () => {},
      moveTo: () => {},
      restore: () => {},
      save: () => {},
      scale: () => {},
      setLineDash: () => {},
      stroke: () => {},
      translate: () => {},
    }, { get(target, property) {
      if (!(property in target)) target[property] = () => {};
      return target[property];
    } });
    class FakeOffscreenCanvas {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return context;
      }

      convertToBlob() {
        return Promise.resolve(new Blob(['result'], { type: 'image/png' }));
      }
    }

    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close() {} })));
    try {
      await createPreviewBlob({
        boxModel: model,
        artworks: [artwork],
        dpi: 10,
        rasterize: async () => ({ blob: sourceBlob }),
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const panelArcs = model.getElements().flatMap((panel) => panel.contour.segments || [])
      .filter((segment) => segment.kind === 'ARC');
    const dieline = getDielineSegments(model);
    const dielineArcs = dieline.cut.concat(dieline.fold)
      .filter((segment) => segment.kind === 'ARC');
    const arcCalls = calls.filter(([type]) => type === 'arc');
    const sourceArcs = panelArcs.concat(dielineArcs);
    expect(arcCalls).toHaveLength(sourceArcs.length);
    for (const [index, arc] of sourceArcs.entries()) {
      const [, , , , startAngle, endAngle, counterclockwise] = arcCalls[index];
      expect(counterclockwise).toBe(arc.clockwise);
      expect(Math.sign(endAngle - startAngle)).toBe(arc.clockwise ? -1 : 1);
      expect(Math.abs(endAngle - startAngle)).toBeLessThanOrEqual(Math.PI);
    }
  });

  it.each(['rte', 'ste', 'tt_sl123'])('blocks exact technical prepress exports for %s', async (name) => {
    const { model } = await createTechnicalModel(name);
    const sourceBlob = new Blob([createSourcePng()], { type: 'image/png' });
    const artwork = createTechnicalArtwork(model.getBounds(), sourceBlob);
    const preflight = runPrepressPreflight({
      boxModel: model,
      artworks: [artwork],
      settings: { mode: 'production-assist' },
    });

    expect(preflight.valid).toBe(false);
    expect(preflight.blocking.map((issue) => issue.code)).toContain('technical-prepress-unavailable');
    await expect(createPrepressPdfExport({
      boxModel: model,
      artworks: [artwork],
      settings: { mode: 'production-assist' },
      preflight,
    })).rejects.toMatchObject({ code: 'technicalPrepressUnavailable' });
    await expect(createPrepressSvg({
      boxModel: model,
      artworks: [artwork],
      settings: { mode: 'production-assist' },
    })).rejects.toMatchObject({ code: 'technicalPrepressUnavailable' });
  });

  it('creates a production-assist PDF with distinct trim/bleed/media boxes and OCGs', async () => {
    const box = completeBox();
    const sourceBytes = await createSourcePdf();
    const sourceBlob = new Blob([sourceBytes], { type: 'application/pdf' });
    const artwork = new ArtworkModel().load({
      id: 'prepress-pdf',
      fileName: 'vector.pdf',
      mimeType: 'application/pdf',
      byteLength: sourceBlob.size,
      widthPx: 600,
      heightPx: 400,
      vector: true,
      pageIndex: 0,
      pageCount: 1,
    }, box.getBounds());
    const settings = {
      mode: 'production-assist',
      bleedMm: 3,
      safeMm: 3,
      slugMm: 10,
      technicalLines: {
        cutSpotName: 'Knife',
        creaseSpotName: 'FoldLine',
        overprint: true,
      },
    };
    const preflight = runPrepressPreflight({ boxModel: box, artworks: [{ model: artwork, visible: true }], settings });
    const exported = await createPrepressPdfExport({
      boxModel: box,
      artworks: [{ model: artwork, visible: true, originalBlob: sourceBlob }],
      settings,
      preflight,
    });
    const document = await PDFDocument.load(new Uint8Array(await exported.arrayBuffer()));
    const page = document.getPage(0);
    const trim = page.node.get(PDFName.of('TrimBox'));
    const bleed = page.node.get(PDFName.of('BleedBox'));
    const media = page.node.get(PDFName.of('MediaBox'));
    expect(trim).toBeInstanceOf(PDFArray);
    expect(bleed).toBeInstanceOf(PDFArray);
    expect(media).toBeInstanceOf(PDFArray);
    expect(bleed.lookup(2, PDFNumber).asNumber()).toBeGreaterThan(trim.lookup(2, PDFNumber).asNumber());
    expect(media.lookup(2, PDFNumber).asNumber()).toBeGreaterThan(bleed.lookup(2, PDFNumber).asNumber());
    const ocProperties = document.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    const ocgs = ocProperties.lookup(PDFName.of('OCGs'), PDFArray);
    expect(ocgs.size()).toBe(7);
    const properties = page.node.Resources().lookup(PDFName.of('Properties'), PDFDict);
    expect(properties.has(PDFName.of('Artwork'))).toBe(true);
    expect(properties.has(PDFName.of('Knife'))).toBe(true);
    expect(properties.has(PDFName.of('FoldLine'))).toBe(true);
    const colorSpaces = page.node.Resources().lookup(PDFName.of('ColorSpace'), PDFDict);
    expect(colorSpaces.has(PDFName.of('KnifeCS'))).toBe(true);
    expect(colorSpaces.has(PDFName.of('FoldLineCS'))).toBe(true);
    const extGState = page.node.Resources().lookup(PDFName.of('ExtGState'), PDFDict)
      .lookup(PDFName.of('GSOverprint'), PDFDict);
    expect(extGState.get(PDFName.of('OP')).toString()).toBe('true');
    expect(extGState.get(PDFName.of('op')).toString()).toBe('true');
    expect(extGState.lookup(PDFName.of('OPM'), PDFNumber).asNumber()).toBe(1);
    expect(document.getSubject()).toContain('not PDF/X certified');

    const noOverprint = await createPrepressPdfExport({
      boxModel: box,
      artworks: [{ model: artwork, visible: true, originalBlob: sourceBlob }],
      settings: { ...settings, technicalLines: { ...settings.technicalLines, overprint: false } },
      preflight,
    });
    const noOverprintDocument = await PDFDocument.load(new Uint8Array(await noOverprint.arrayBuffer()));
    const noOverprintResources = noOverprintDocument.getPage(0).node.Resources();
    expect(noOverprintResources.lookup(PDFName.of('ExtGState'), PDFDict).has(PDFName.of('GSOverprint'))).toBe(false);
  });
});
