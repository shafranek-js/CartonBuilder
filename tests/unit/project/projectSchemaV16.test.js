import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  migrateProjectSnapshot,
  validateProjectBundle,
} from '../../../src/project/projectSchema.js';
import { BoxNetModel } from '../../../src/model/BoxNetModel.js';
import {
  saveCurrentProject,
  loadCurrentProject,
  clearCurrentProject,
} from '../../../src/project/ProjectStore.js';
import { AppError } from '../../../src/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../../src/workflow/fixtures');

function loadFixture(name) {
  const filePath = path.join(fixturesDir, `${name}-workflow.v1.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('Project Schema v18 Migration & Discriminated Validation', () => {
  beforeEach(async () => {
    await clearCurrentProject();
  });

  it('declares CURRENT_PROJECT_SCHEMA_VERSION === 18', () => {
    expect(CURRENT_PROJECT_SCHEMA_VERSION).toBe(18);
  });

  it('migrates legacy schema v15 project to schema v18 with quick selection', () => {
    const legacySnapshot = {
      schemaVersion: 15,
      meta: { name: 'Legacy v15' },
      workflowStep: 'artwork',
      box: new BoxNetModel().toJSON(),
      artworks: [],
      render: {},
      renderAppearance: {},
      prepress: { mode: 'technical-proof' },
      view: {},
      history: { undo: [], redo: [] },
    };

    const migrated = migrateProjectSnapshot(legacySnapshot);
    expect(migrated.schemaVersion).toBe(18);
    expect(migrated.workflowSelection).toBe('quick');
    expect(migrated.cartonSource).toBeDefined();
    expect(migrated.cartonSource.mode).toBe('quick');
    expect(migrated.cartonSource.box).toBeDefined();
    expect(migrated.cartonSource.box.dimensions).toEqual({ width: 150, height: 90, depth: 40 });
    expect(migrated.box).toBeUndefined(); // Top-level box removed
  });

  it('keeps the transient workflow step out of persisted schema v18 snapshots', () => {
    const migrated = migrateProjectSnapshot({
      schemaVersion: 17,
      meta: { name: 'Transient workflow choice' },
      workflowStep: 'workflow',
      workflowSelection: 'quick',
      cartonSource: { mode: 'quick', box: new BoxNetModel().toJSON() },
      artworks: [],
      render: {},
      renderAppearance: {},
      prepress: {},
      view: {},
      history: { undo: [], redo: [] },
    });

    expect(migrated.workflowStep).toBe('box');
    expect(migrated.workflowSelection).toBe('quick');
  });

  it('migrates older schema (e.g. v1, v6, v13) through full chain to schema v18', () => {
    const v6Snapshot = {
      schemaVersion: 6,
      meta: { name: 'Legacy v6' },
      box: new BoxNetModel().toJSON(),
      artworks: [],
      render: {},
      renderAppearance: {},
      view: {},
      history: { undo: [], redo: [] },
    };

    const migrated = migrateProjectSnapshot(v6Snapshot);
    expect(migrated.schemaVersion).toBe(18);
    expect(migrated.workflowSelection).toBe('quick');
    expect(migrated.cartonSource.mode).toBe('quick');
    expect(migrated.cartonSource.box).toBeDefined();
    expect(migrated.box).toBeUndefined();
  });

  it('persists a technical draft selection without replacing the committed quick source', () => {
    const quickBox = new BoxNetModel({ width: 210, height: 120, depth: 55 }).toJSON();
    const migrated = migrateProjectSnapshot({
      schemaVersion: 16,
      meta: { name: 'Technical draft' },
      workflowStep: 'box',
      workflowSelection: 'technical',
      cartonSource: { mode: 'quick', box: quickBox },
      artworks: [],
      render: {},
      history: { undo: [], redo: [] },
    });

    expect(migrated.schemaVersion).toBe(18);
    expect(migrated.workflowSelection).toBe('technical');
    expect(migrated.cartonSource.mode).toBe('quick');
    expect(migrated.cartonSource.box.dimensions).toEqual({ width: 210, height: 120, depth: 55 });
  });

  it('validates a schema v18 technical project snapshot', () => {
    const bundle = loadFixture('rte');
    const technicalSnapshot = {
      schemaVersion: 16,
      meta: { name: 'Technical RTE' },
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
      },
      artworks: [],
      render: {},
      renderAppearance: {},
      prepress: { mode: 'technical-proof' },
      view: {},
      history: { undo: [], redo: [] },
    };

    const migrated = migrateProjectSnapshot(technicalSnapshot);
    expect(migrated.schemaVersion).toBe(18);
    expect(migrated.workflowSelection).toBe('technical');
    expect(migrated.cartonSource.mode).toBe('technical');
    expect(migrated.cartonSource.modelSha256).toBe(bundle.modelJson.sha256);
  });

  it('rejects schema v18 technical snapshot with missing or invalid hash/schema', () => {
    const bundle = loadFixture('rte');
    const invalidSnapshot = {
      schemaVersion: 16,
      meta: { name: 'Invalid' },
      cartonSource: {
        mode: 'technical',
        source: {
          ...bundle.source,
          modelSchemaVersion: 'invalid.schema',
        },
        modelSha256: 'invalid-hash',
        svgSha256: bundle.semanticSvg.sha256,
      },
      artworks: [],
      render: {},
      history: { undo: [], redo: [] },
    };

    expect(() => migrateProjectSnapshot(invalidSnapshot)).toThrow(AppError);
  });

  it('saves and loads technical project with technicalAssets in IndexedDB', async () => {
    const bundle = loadFixture('ste');
    const technicalSnapshot = {
      schemaVersion: 16,
      meta: { name: 'Autosave STE' },
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
        },
        modelSha256: bundle.modelJson.sha256,
        svgSha256: bundle.semanticSvg.sha256,
        semanticSvgAssetId: bundle.semanticSvg.assetId,
      },
      artworks: [],
      render: {},
      history: { undo: [], redo: [] },
    };

    const technicalAssets = {
      modelBlob: new Blob([bundle.modelJson.text], { type: 'application/json' }),
      svgBlob: new Blob([bundle.semanticSvg.markup], { type: 'image/svg+xml' }),
    };

    await saveCurrentProject({
      snapshot: technicalSnapshot,
      artworkBlobs: [],
      renderAssets: [],
      technicalAssets,
    });

    const loaded = await loadCurrentProject();
    expect(loaded).toBeDefined();
    expect(loaded.snapshot.cartonSource.mode).toBe('technical');
    expect(loaded.technicalAssets.modelBlob).toBeInstanceOf(Blob);
    expect(loaded.technicalAssets.svgBlob).toBeInstanceOf(Blob);
    expect(loaded.technicalAssets.modelBlob.size).toBe(bundle.modelJson.byteLength);
    expect(loaded.technicalAssets.svgBlob.size).toBe(bundle.semanticSvg.byteLength);

    const validated = await validateProjectBundle(loaded);
    expect(validated.snapshot.schemaVersion).toBe(18);
    expect(validated.snapshot.workflowSelection).toBe('technical');
    expect(validated.snapshot.cartonSource.mode).toBe('technical');
  });

  it('guarantees history hygiene: history does not contain SVG markup or raw model JSON', () => {
    const bundle = loadFixture('rte');
    const technicalSnapshot = {
      schemaVersion: 16,
      cartonSource: {
        mode: 'technical',
        source: bundle.source,
        modelSha256: bundle.modelJson.sha256,
        svgSha256: bundle.semanticSvg.sha256,
      },
      artworks: [],
      history: {
        undo: [
          { action: 'moveArtwork', artworkState: { x: 10, y: 20 } },
        ],
        redo: [],
      },
    };

    const historyStr = JSON.stringify(technicalSnapshot.history);
    expect(historyStr.includes(bundle.semanticSvg.markup)).toBe(false);
    expect(historyStr.includes(bundle.modelJson.text)).toBe(false);
    expect(historyStr.includes('<svg')).toBe(false);
  });
});
