import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TechnicalCartonDocument } from '../../src/carton/TechnicalCartonDocument.js';
import { analyzeTechnicalArtworkPreflight } from '../../src/artwork/technicalArtworkPreflight.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/workflow/fixtures');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}-workflow.v1.json`), 'utf8'));
}

function line(start, end) {
  return { kind: 'LINE', start, end };
}

function rectangleSurface({ id = 'body.front', role = 'BODY.FRONT', x = 0, y = 0, width = 10, height = 10 } = {}) {
  const topLeft = { x, y };
  const topRight = { x: x + width, y };
  const bottomRight = { x: x + width, y: y + height };
  const bottomLeft = { x, y: y + height };
  return {
    id,
    role,
    kind: 'PANEL',
    contour: {
      closed: true,
      segments: [
        line(topLeft, topRight),
        line(topRight, bottomRight),
        line(bottomRight, bottomLeft),
        line(bottomLeft, topLeft),
      ],
    },
  };
}

function artwork(id, {
  x = 0,
  y = 0,
  width = 10,
  height = 10,
  widthPx = 1000,
  heightPx = 1000,
  mimeType = 'image/png',
  vector = false,
  rotation = 0,
  flipX = false,
  flipY = false,
  initialWidthMm = width,
  initialHeightMm = height,
  scaleX = 1,
  scaleY = 1,
  crop,
  visible = true,
  outputRole = 'print',
} = {}) {
  return {
    visible,
    outputRole,
    model: {
      source: { id, fileName: `${id}.png`, mimeType, vector, widthPx, heightPx },
      centerXmm: x + width / 2,
      centerYmm: y + height / 2,
      initialWidthMm,
      initialHeightMm,
      scaleX,
      scaleY,
      rotation,
      flipX,
      flipY,
      ...(crop ? { crop } : {}),
    },
  };
}

function carton(...surfaces) {
  return { getArtworkSurfaces: () => structuredClone(surfaces) };
}

function statuses(report) {
  return Object.fromEntries(report.printableSurfaces.map((surface) => [surface.id, surface.status]));
}

describe('Technical artwork printable-region preflight', () => {
  it('classifies RTE and STE glue flaps as excluded without using labels', async () => {
    for (const name of ['rte', 'ste']) {
      const document = await TechnicalCartonDocument.create(loadFixture(name));
      const report = analyzeTechnicalArtworkPreflight({ carton: document, artworks: [] });
      expect(report.excludedSurfaces).toContainEqual(expect.objectContaining({
        id: 'body.glueFlap',
        reason: 'glue-surface',
      }));
      expect(report.printableSurfaces.map((surface) => surface.id)).toContain('body.front');
      expect(report.printableSurfaces.map((surface) => surface.id)).not.toContain('body.glueFlap');
    }
  });

  it('excludes TT_SL123 glue and all SNAP_LOCK surfaces while keeping printable flaps', async () => {
    const document = await TechnicalCartonDocument.create(loadFixture('tt_sl123'));
    const report = analyzeTechnicalArtworkPreflight({ carton: document, artworks: [] });
    expect(report.excludedSurfaces.map((surface) => surface.id)).toEqual([
      'body.glueFlap',
      'closure.bottom.snap.locking',
      'closure.bottom.snap.sideA',
      'closure.bottom.snap.sideB',
      'closure.bottom.snap.support',
    ]);
    expect(report.printableSurfaces.map((surface) => surface.id)).toEqual(expect.arrayContaining([
      'body.front',
      'closure.top.major',
      'closure.top.tongue',
    ]));
    expect(report.summary.uncovered).toBe(report.printableSurfaces.length);
  });

  it('detects complete and incomplete coverage from exact LINE contours', () => {
    const surface = rectangleSurface();
    const full = analyzeTechnicalArtworkPreflight({
      carton: carton(surface),
      artworks: [artwork('full', { width: 10, height: 10 })],
    });
    const partial = analyzeTechnicalArtworkPreflight({
      carton: carton(surface),
      artworks: [artwork('partial', { width: 9, height: 10 })],
    });
    expect(statuses(full)).toEqual({ 'body.front': 'covered' });
    expect(statuses(partial)).toEqual({ 'body.front': 'uncovered' });
    expect(partial.issues).toContainEqual(expect.objectContaining({
      code: 'uncovered-printable-surface',
      surfaceId: 'body.front',
    }));
  });

  it('rejects an ARC whose endpoints are covered but whose bulge is outside the artwork', () => {
    const surface = {
      id: 'body.front',
      role: 'BODY.FRONT',
      kind: 'PANEL',
      contour: {
        closed: true,
        segments: [
          {
            kind: 'ARC',
            start: { x: 0, y: 0 },
            end: { x: 10, y: 0 },
            center: { x: 5, y: 0 },
            radius: 5,
            clockwise: true,
          },
          line({ x: 10, y: 0 }, { x: 10, y: -1 }),
          line({ x: 10, y: -1 }, { x: 0, y: -1 }),
          line({ x: 0, y: -1 }, { x: 0, y: 0 }),
        ],
      },
    };
    const report = analyzeTechnicalArtworkPreflight({
      carton: carton(surface),
      artworks: [artwork('arc-endpoints-only', { x: 0, y: -1, width: 10, height: 2 })],
    });
    expect(statuses(report)).toEqual({ 'body.front': 'uncovered' });
  });

  it('detects an internal gap and accepts two layers that jointly cover it', () => {
    const surface = rectangleSurface({ width: 20, height: 10 });
    const gap = analyzeTechnicalArtworkPreflight({
      carton: carton(surface),
      artworks: [
        artwork('left', { width: 9, height: 10 }),
        artwork('right', { x: 11, width: 9, height: 10 }),
      ],
    });
    const joined = analyzeTechnicalArtworkPreflight({
      carton: carton(surface),
      artworks: [
        artwork('left', { width: 10, height: 10 }),
        artwork('right', { x: 10, width: 10, height: 10 }),
      ],
    });
    expect(statuses(gap)).toEqual({ 'body.front': 'uncovered' });
    expect(statuses(joined)).toEqual({ 'body.front': 'covered' });
  });

  it('ignores hidden and finish layers and handles crop, rotation, flip and independent scale', () => {
    const surface = rectangleSurface({ width: 20, height: 10 });
    const report = analyzeTechnicalArtworkPreflight({
      carton: carton(surface),
      artworks: [
        artwork('hidden', { x: 100, visible: false }),
        artwork('finish', { x: 100, outputRole: 'finish' }),
        artwork('cropped-rotated-flipped', {
          initialWidthMm: 12,
          initialHeightMm: 20,
          scaleX: 1.2,
          scaleY: 1,
          rotation: 90,
          flipX: true,
          crop: { x: 2.2, y: 0, width: 10, height: 20 },
          x: 0,
          y: 0,
          width: 20,
          height: 10,
        }),
      ],
    });
    expect(statuses(report)).toEqual({ 'body.front': 'covered' });
    expect(report.artworkQuality.map((entry) => entry.artworkId)).toEqual(['cropped-rotated-flipped']);
  });

  it('reports raster 299/300 DPI, vector PDF without a false DPI warning, and unknown dimensions', () => {
    const surface = rectangleSurface({ width: 25.4, height: 25.4 });
    const report = analyzeTechnicalArtworkPreflight({
      carton: carton(surface),
      artworks: [
        artwork('raster-299', { width: 25.4, height: 25.4, widthPx: 299, heightPx: 299 }),
        artwork('raster-300', { width: 25.4, height: 25.4, widthPx: 300, heightPx: 300 }),
        artwork('vector-pdf', { width: 25.4, height: 25.4, mimeType: 'application/pdf', vector: true }),
        artwork('unknown-dpi', { width: 25.4, height: 25.4, widthPx: 0, heightPx: 0 }),
      ],
    });
    expect(report.artworkQuality).toEqual(expect.arrayContaining([
      expect.objectContaining({ artworkId: 'raster-299', quality: 'warning', dpi: 299, issues: ['dpi-below-recommended'] }),
      expect.objectContaining({ artworkId: 'raster-300', quality: 'pass', dpi: 300, issues: [] }),
      expect.objectContaining({ artworkId: 'vector-pdf', quality: 'vector', dpi: null, issues: [] }),
      expect.objectContaining({ artworkId: 'unknown-dpi', quality: 'unknown', dpi: null, issues: ['dpi-unknown'] }),
    ]));
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'dpi-below-recommended', artworkId: 'raster-299', dpi: 299 }));
    expect(report.issues).not.toContainEqual(expect.objectContaining({ code: 'dpi-below-recommended', artworkId: 'vector-pdf' }));
  });

  it('fails closed for unknown roles and damaged contours, with deterministic output and no mutation', () => {
    const surfaces = [
      rectangleSurface({ id: 'body.front', role: 'BODY.FRONT' }),
      rectangleSurface({ id: 'custom.surface', role: 'USER_LABEL_GLUE' }),
      {
        ...rectangleSurface({ id: 'body.back', role: 'BODY.BACK' }),
        contour: { closed: true, segments: [line({ x: 0, y: 0 }, { x: 10, y: 0 })] },
      },
    ];
    const entries = [artwork('deterministic', { width: 10, height: 10 })];
    const before = structuredClone({ surfaces, entries });
    const first = analyzeTechnicalArtworkPreflight({ carton: carton(...surfaces), artworks: entries });
    const second = analyzeTechnicalArtworkPreflight({ carton: carton(...surfaces), artworks: entries });
    expect(first).toEqual(second);
    expect(first.unknownSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom.surface', reason: 'unknown-semantic-surface' }),
    ]));
    expect(first.printableSurfaces).toContainEqual(expect.objectContaining({
      id: 'body.back',
      status: 'unknown',
      reason: 'invalid-surface-contour',
    }));
    expect({ surfaces, entries }).toEqual(before);
  });

  it('fails closed when an ARC endpoint is inconsistent with its declared radius', () => {
    const damagedArc = {
      ...rectangleSurface({ id: 'body.front', role: 'BODY.FRONT' }),
      contour: {
        closed: true,
        segments: [
          {
            kind: 'ARC',
            start: { x: 0, y: 0 },
            end: { x: 10, y: 0 },
            center: { x: 5, y: 0 },
            radius: 4,
            clockwise: false,
          },
          line({ x: 10, y: 0 }, { x: 10, y: 10 }),
          line({ x: 10, y: 10 }, { x: 0, y: 10 }),
          line({ x: 0, y: 10 }, { x: 0, y: 0 }),
        ],
      },
    };
    const report = analyzeTechnicalArtworkPreflight({
      carton: carton(damagedArc),
      artworks: [artwork('damaged-arc', { width: 20, height: 20 })],
    });
    expect(report.printableSurfaces).toContainEqual(expect.objectContaining({
      id: 'body.front',
      status: 'unknown',
      reason: 'invalid-surface-contour',
    }));
  });

  it('does not treat a sampled ARC chord as proof when the true arc exceeds the artwork', () => {
    const endAngle = 100 * Math.PI / 180;
    const arcSurface = {
      id: 'body.front',
      role: 'BODY.FRONT',
      kind: 'PANEL',
      contour: {
        closed: true,
        segments: [
          {
            kind: 'ARC',
            start: { x: 1000, y: 0 },
            end: { x: 1000 * Math.cos(endAngle), y: 1000 * Math.sin(endAngle) },
            center: { x: 0, y: 0 },
            radius: 1000,
            clockwise: false,
          },
          line({ x: 1000 * Math.cos(endAngle), y: 1000 * Math.sin(endAngle) }, { x: -200, y: 0 }),
          line({ x: -200, y: 0 }, { x: 1000, y: 0 }),
        ],
      },
    };
    const report = analyzeTechnicalArtworkPreflight({
      carton: carton(arcSurface),
      artworks: [artwork('sampled-chord-only', { x: -200, y: 0, width: 1200, height: 999.95 })],
    });
    expect(statuses(report)).toEqual({ 'body.front': 'uncovered' });
  });

  it('fails closed for a missing or invalid Technical carton facade', () => {
    for (const invalidCarton of [{}, { getArtworkSurfaces: () => null }, { getArtworkSurfaces: () => ({}) }]) {
      const report = analyzeTechnicalArtworkPreflight({ carton: invalidCarton, artworks: [] });
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'technical-carton-invalid' }));
      expect(report.unknownSurfaces).toContainEqual(expect.objectContaining({
        id: 'technical-carton',
        status: 'unknown',
        reason: 'technical-carton-invalid',
      }));
      expect(report.summary).toEqual({ covered: 0, uncovered: 0, unknown: 1 });
    }
  });

  it('treats nullish, zero and NaN effective DPI as unknown', () => {
    for (const value of [null, undefined, 0, NaN]) {
      const entry = artwork(`invalid-dpi-${String(value)}`, { width: 25.4, height: 25.4 });
      entry.model.getEffectiveDpi = () => value;
      const report = analyzeTechnicalArtworkPreflight({
        carton: carton(rectangleSurface({ width: 25.4, height: 25.4 })),
        artworks: [entry],
      });
      expect(report.artworkQuality).toEqual([
        expect.objectContaining({ quality: 'unknown', dpi: null, issues: ['dpi-unknown'] }),
      ]);
    }
  });

  it('does not expose non-contributing artwork IDs in a covered surface report', () => {
    const report = analyzeTechnicalArtworkPreflight({
      carton: carton(rectangleSurface()),
      artworks: [
        artwork('contributor', { width: 10, height: 10 }),
        artwork('far-away', { x: 100, y: 100, width: 10, height: 10 }),
      ],
    });
    expect(report.printableSurfaces[0]).not.toHaveProperty('artworkIds');
    expect(report.printableSurfaces[0].status).toBe('covered');
  });
});
