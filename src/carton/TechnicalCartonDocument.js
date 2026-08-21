/**
 * TechnicalCartonDocument domain model.
 * Wraps a validated carton-workflow.v1 bundle conforming to pbd.model.v1 and pbd.svg.v4.
 */

import { CartonDocument } from './CartonDocument.js';
import { validateCartonWorkflowBundle } from '../workflow/index.js';
import { AppError } from '../errors.js';

export class TechnicalCartonDocument extends CartonDocument {
  /**
   * Asynchronously validate and create a TechnicalCartonDocument.
   *
   * @param {Record<string, unknown>} bundle - carton-workflow.v1 bundle
   * @param {object} [trustOptions] - verification options (e.g. expectedProducer, expectedArtifactSha256)
   * @returns {Promise<TechnicalCartonDocument>}
   */
  static async create(bundle, trustOptions = {}) {
    if (!bundle || typeof bundle !== 'object') {
      throw new AppError('cartonWorkflowInvalid', { errors: ['Bundle must be an object.'] });
    }

    const validation = await validateCartonWorkflowBundle(bundle, trustOptions);
    if (!validation.valid) {
      throw new AppError('cartonWorkflowInvalid', {
        errors: validation.errors || [],
        issues: validation.issues || [],
      });
    }

    // Use verified model returned directly from validateCartonWorkflowBundle
    return new TechnicalCartonDocument(bundle, validation.model);
  }

  /**
   * @param {Record<string, unknown>} bundle
   * @param {Record<string, unknown>} validatedModel
   */
  constructor(bundle, validatedModel) {
    super();
    this._bundle = Object.freeze(structuredClone(bundle));
    this._model = Object.freeze(structuredClone(validatedModel));
  }

  get mode() {
    return 'technical';
  }

  get isComplete() {
    return true;
  }

  get dimensions() {
    const requested = this._model.resolvedDimensions?.requested || {};
    return {
      width: Number(requested.width),
      height: Number(requested.height),
      depth: Number(requested.depth),
      requestedDimensionReference: this._model.requestedDimensionReference,
      resolvedDimensions: structuredClone(this._model.resolvedDimensions),
    };
  }

  get board() {
    const mat = this._model.material || {};
    return {
      caliperMm: Number(mat.thickness),
      insideLoss: Number(mat.insideLoss),
      outsideGain: Number(mat.outsideGain),
      grainDirection: mat.grainDirection,
      materialProfileId: mat.materialProfileId,
      converterProfileId: mat.converterProfileId,
    };
  }

  /**
   * Get raw validated pbd.model.v1 object.
   */
  getModel() {
    return this._model;
  }

  /**
   * Get raw validated workflow bundle.
   */
  getBundle() {
    return this._bundle;
  }

  getBounds() {
    const bbox = this._model.outputMetrics?.flattenedDimensions?.bbox;
    if (!bbox) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }
    const minX = Number(bbox.minX);
    const minY = Number(bbox.minY);
    const maxX = Number(bbox.maxX);
    const maxY = Number(bbox.maxY);
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  getArtworkSurfaces() {
    const surfaces = [];
    const regions = Array.isArray(this._model.regions) ? this._model.regions : [];

    for (const region of regions) {
      if (region.kind === 'DIAGNOSTIC' || region.role?.startsWith('DIAGNOSTIC')) {
        continue;
      }

      const points = Array.isArray(region.points)
        ? region.points.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
        : [];

      const segments = Array.isArray(region.contour?.segments)
        ? region.contour.segments.map((seg) => {
            const item = {
              kind: seg.kind,
              start: { x: Number(seg.start?.x), y: Number(seg.start?.y) },
              end: { x: Number(seg.end?.x), y: Number(seg.end?.y) },
            };
            if (seg.kind === 'ARC') {
              item.center = { x: Number(seg.center?.x), y: Number(seg.center?.y) };
              item.radius = Number(seg.radius);
              item.clockwise = Boolean(seg.clockwise);
            }
            return item;
          })
        : [];

      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = xs.length ? Math.min(...xs) : 0;
      const maxX = xs.length ? Math.max(...xs) : 0;
      const minY = ys.length ? Math.min(...ys) : 0;
      const maxY = ys.length ? Math.max(...ys) : 0;

      surfaces.push({
        id: region.id,
        role: region.role,
        kind: region.kind || 'PANEL',
        label: region.label || region.id,
        polygon: points,
        contour: {
          segments,
          closed: region.contour?.closed !== false,
        },
        bounds: {
          minX,
          minY,
          maxX,
          maxY,
          width: maxX - minX,
          height: maxY - minY,
        },
        panelId: region.id,
      });
    }

    return surfaces;
  }

  getDielinePrimitives() {
    const primitives = [];
    const edges = Array.isArray(this._model.edges) ? this._model.edges : [];

    for (const edge of edges) {
      if (edge.render === false || edge.referenceAccountingOnly === true) {
        continue;
      }

      const geo = edge.geometry || {};
      const kind = geo.kind || (edge.radius ? 'ARC' : 'LINE');
      const isFold = edge.role === 'FOLD_BOUNDARY';

      const primitive = {
        id: edge.id,
        kind,
        role: edge.role,
        semanticRole: edge.semanticRole || edge.role,
        classification: isFold ? 'fold' : 'cut',
        start: { x: Number(geo.start?.x ?? edge.a?.x), y: Number(geo.start?.y ?? edge.a?.y) },
        end: { x: Number(geo.end?.x ?? edge.b?.x), y: Number(geo.end?.y ?? edge.b?.y) },
        owners: Array.isArray(edge.owners) ? edge.owners.slice() : [],
      };

      if (kind === 'ARC') {
        primitive.center = { x: Number(geo.center?.x), y: Number(geo.center?.y) };
        primitive.radius = Number(geo.radius);
        primitive.clockwise = Boolean(geo.clockwise);
      }

      primitives.push(primitive);
    }

    return primitives;
  }

  getArtworkMaskPaths() {
    const surfaces = this.getArtworkSurfaces();
    return surfaces.map((surface) => {
      let d = '';
      if (surface.contour?.segments?.length > 0) {
        const segs = surface.contour.segments;
        d = `M${segs[0].start.x} ${segs[0].start.y}`;
        for (const seg of segs) {
          if (seg.kind === 'ARC') {
            const r = seg.radius;
            const sweepFlag = seg.clockwise ? 1 : 0;
            d += ` A${r} ${r} 0 0 ${sweepFlag} ${seg.end.x} ${seg.end.y}`;
          } else {
            d += ` L${seg.end.x} ${seg.end.y}`;
          }
        }
        d += 'Z';
      } else if (surface.polygon?.length > 0) {
        d = surface.polygon.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('') + 'Z';
      }
      return {
        id: surface.id,
        d,
        polygon: surface.polygon.map((p) => ({ ...p })),
      };
    });
  }

  getSourceIdentity() {
    const src = this._bundle.source || {};
    return {
      mode: 'technical',
      producer: src.producer,
      producerVersion: src.producerVersion,
      modelEngineVersion: src.modelEngineVersion,
      contractPackageVersion: src.contractPackageVersion,
      artifactVersion: src.artifactVersion,
      artifactSha256: src.artifactSha256,
      modelSchemaVersion: src.modelSchemaVersion,
      svgSchemaVersion: src.svgSchemaVersion,
      cartonType: src.cartonType,
      profileIds: Array.isArray(src.profileIds) ? src.profileIds.slice() : [],
      referenceOnly: src.referenceOnly === true,
      productionCertified: src.productionCertified === true,
      modelSha256: this._bundle.modelJson?.sha256,
      svgSha256: this._bundle.semanticSvg?.sha256,
      semanticSvgAssetId: this._bundle.semanticSvg?.assetId,
    };
  }

  serialize() {
    return {
      mode: 'technical',
      source: this.getSourceIdentity(),
      capabilities: structuredClone(this._bundle.capabilities || {
        artwork2d: true,
        flatExport: true,
        foldPreview: true,
        technicalRender: false,
      }),
      modelJson: {
        mediaType: this._bundle.modelJson?.mediaType || 'application/json',
        byteLength: this._bundle.modelJson?.byteLength,
        sha256: this._bundle.modelJson?.sha256,
        text: this._bundle.modelJson?.text,
      },
      semanticSvg: {
        assetId: this._bundle.semanticSvg?.assetId,
        mediaType: this._bundle.semanticSvg?.mediaType || 'image/svg+xml',
        byteLength: this._bundle.semanticSvg?.byteLength,
        sha256: this._bundle.semanticSvg?.sha256,
        units: this._bundle.semanticSvg?.units || 'mm',
        markup: this._bundle.semanticSvg?.markup,
      },
      semanticSvgAssetId: this._bundle.semanticSvg?.assetId,
      modelSha256: this._bundle.modelJson?.sha256,
      svgSha256: this._bundle.semanticSvg?.sha256,
    };
  }
}
