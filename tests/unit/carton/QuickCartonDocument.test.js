import { describe, expect, it } from 'vitest';
import { BoxNetModel } from '../../../src/model/BoxNetModel.js';
import { QuickCartonDocument } from '../../../src/carton/QuickCartonDocument.js';
import { createCartonDocument } from '../../../src/carton/createCartonDocument.js';
import { CartonDocument } from '../../../src/carton/CartonDocument.js';
import { AppError } from '../../../src/errors.js';

describe('QuickCartonDocument parity & contract', () => {
  it('instantiates from BoxNetModel and implements CartonDocument interface', () => {
    const boxModel = new BoxNetModel({ width: 120, height: 160, depth: 60 }, { caliperMm: 0.5 });
    const doc = new QuickCartonDocument(boxModel);

    expect(doc).toBeInstanceOf(CartonDocument);
    expect(doc.mode).toBe('quick');
    expect(doc.isComplete).toBe(boxModel.isComplete);
    expect(doc.dimensions).toEqual({ width: 120, height: 160, depth: 60 });
    expect(doc.board.caliperMm).toBe(0.5);
    expect(doc.boxModel).toBe(boxModel);
    expect(doc.getBoxModel()).toBe(boxModel);
  });

  it('rejects instantiation without valid BoxNetModel', () => {
    expect(() => new QuickCartonDocument(null)).toThrow();
    expect(() => new QuickCartonDocument({})).toThrow();
  });

  it('matches BoxNetModel getBounds() exactly', () => {
    const boxModel = new BoxNetModel({ width: 100, height: 150, depth: 50 });
    const doc = new QuickCartonDocument(boxModel);

    const modelBounds = boxModel.getBounds();
    const docBounds = doc.getBounds();

    expect(docBounds).toEqual(modelBounds);
    expect(docBounds.width).toBeGreaterThan(0);
    expect(docBounds.height).toBeGreaterThan(0);
  });

  it('extracts artwork surfaces with matching panel IDs, labels and polygons', () => {
    const boxModel = new BoxNetModel({ width: 100, height: 150, depth: 50 });
    const doc = new QuickCartonDocument(boxModel);

    const surfaces = doc.getArtworkSurfaces();
    const panels = boxModel.getPanels();

    expect(surfaces.length).toBe(panels.length);
    for (let i = 0; i < panels.length; i++) {
      expect(surfaces[i].id).toBe(panels[i].id);
      expect(surfaces[i].label).toBe(panels[i].faceName);
      expect(surfaces[i].polygon.length).toBe(4);
      expect(surfaces[i].contour.segments.length).toBe(4);
      expect(surfaces[i].bounds.width).toBe(panels[i].width);
      expect(surfaces[i].bounds.height).toBe(panels[i].height);
    }
  });

  it('extracts cut and fold dieline primitives', () => {
    const boxModel = new BoxNetModel({ width: 100, height: 150, depth: 50 });
    boxModel.addPanel('front', 'top');
    boxModel.addPanel('front', 'bottom');
    boxModel.addPanel('front', 'left');
    boxModel.addPanel('front', 'right');
    const doc = new QuickCartonDocument(boxModel);

    const primitives = doc.getDielinePrimitives();
    expect(primitives.length).toBeGreaterThan(0);

    const folds = primitives.filter((p) => p.classification === 'fold');
    const cuts = primitives.filter((p) => p.classification === 'cut');

    expect(folds.length).toBeGreaterThan(0);
    expect(cuts.length).toBeGreaterThan(0);

    for (const prim of primitives) {
      expect(prim.kind).toBe('LINE');
      expect(Number.isFinite(prim.start.x)).toBe(true);
      expect(Number.isFinite(prim.start.y)).toBe(true);
      expect(Number.isFinite(prim.end.x)).toBe(true);
      expect(Number.isFinite(prim.end.y)).toBe(true);
      expect(Array.isArray(prim.owners)).toBe(true);
    }
  });

  it('generates closed artwork mask paths', () => {
    const boxModel = new BoxNetModel({ width: 100, height: 150, depth: 50 });
    const doc = new QuickCartonDocument(boxModel);

    const masks = doc.getArtworkMaskPaths();
    expect(masks.length).toBe(boxModel.getPanels().length);
    for (const mask of masks) {
      expect(typeof mask.d).toBe('string');
      expect(mask.d.startsWith('M')).toBe(true);
      expect(mask.d.endsWith('Z')).toBe(true);
      expect(Array.isArray(mask.polygon)).toBe(true);
    }
  });

  it('returns stable quick source identity and serialize() representation', () => {
    const boxModel = new BoxNetModel({ width: 100, height: 150, depth: 50 });
    const doc = new QuickCartonDocument(boxModel);

    const identity = doc.getSourceIdentity();
    expect(identity).toEqual({
      mode: 'quick',
      producer: 'carton-builder',
      modelType: 'legacy-custom-net',
    });

    const serialized = doc.serialize();
    expect(serialized).toEqual({
      mode: 'quick',
      box: boxModel.toJSON(),
    });

    const restoredModel = BoxNetModel.fromJSON(serialized.box);
    expect(restoredModel.dimensions).toEqual(boxModel.dimensions);
  });

  it('works with construction templates (RTE, STE)', () => {
    const steModel = new BoxNetModel(
      { width: 100, height: 150, depth: 50 },
      { caliperMm: 0.5 },
      { templateId: 'ste', parameters: {} }
    );
    const steDoc = new QuickCartonDocument(steModel);

    expect(steDoc.mode).toBe('quick');
    expect(steDoc.getBounds()).toEqual(steModel.getBounds());
    expect(steDoc.getArtworkSurfaces().length).toBe(steModel.getElements().length);

    const rteModel = new BoxNetModel(
      { width: 100, height: 150, depth: 50 },
      { caliperMm: 0.5 },
      { templateId: 'rte', parameters: {} }
    );
    const rteDoc = new QuickCartonDocument(rteModel);

    expect(rteDoc.mode).toBe('quick');
    expect(rteDoc.getBounds()).toEqual(rteModel.getBounds());
    expect(rteDoc.getArtworkSurfaces().length).toBe(rteModel.getElements().length);
  });

  it('creates QuickCartonDocument via createCartonDocument factory', async () => {
    const boxModel = new BoxNetModel({ width: 100, height: 150, depth: 50 });
    const doc = await createCartonDocument({
      mode: 'quick',
      box: boxModel.toJSON(),
    });

    expect(doc).toBeInstanceOf(QuickCartonDocument);
    expect(doc.mode).toBe('quick');
    expect(doc.dimensions).toEqual({ width: 100, height: 150, depth: 50 });
  });

  it('rejects invalid cartonSource in createCartonDocument', async () => {
    await expect(createCartonDocument(null)).rejects.toBeInstanceOf(AppError);
    await expect(createCartonDocument({ mode: 'unknown' })).rejects.toBeInstanceOf(AppError);
  });

  it('CartonDocument base class throws on unimplemented methods', () => {
    const base = new CartonDocument();
    expect(() => base.mode).toThrow();
    expect(() => base.isComplete).toThrow();
    expect(() => base.dimensions).toThrow();
    expect(() => base.board).toThrow();
    expect(() => base.getBounds()).toThrow();
    expect(() => base.getArtworkSurfaces()).toThrow();
    expect(() => base.getDielinePrimitives()).toThrow();
    expect(() => base.getArtworkMaskPaths()).toThrow();
    expect(() => base.getSourceIdentity()).toThrow();
    expect(() => base.serialize()).toThrow();
  });
});
