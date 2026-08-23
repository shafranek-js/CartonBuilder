import * as THREE from 'three';
import { parseSemanticCartonSvg } from '../pbd/semantic-svg.js';
import { makePanelGeometry } from '../geometry/panel-geometry.js';
import { makeFiniteCreaseGeometry, creaseMeshName } from '../geometry/crease-geometry.js';
import { makeTechMaterials, makeCreaseMaterial } from '../geometry/materials.js';
import { buildGenericAnimations } from '../animation/fold-animations.js';
import { createFlatNetUvMapper } from '../geometry/flat-net-uv.js';

export function buildFoldableFromSemanticSvg(svgText, name = 'carton.svg') {
  const parsed = parseSemanticCartonSvg(svgText), flatNetUv = createFlatNetUvMapper(parsed.canvas), model = new THREE.Group();
  model.name = 'PBD_SVG_Carton_Root';
  model.userData = {
    source: 'pbd.svg.v4',
    schema: parsed.sourceSchema,
    cartonType: parsed.cartonType,
    dimensions_mm: parsed.dimensions,
    crease_profile: parsed.creaseProfile,
    pbdMetadata: parsed.metadata,
    referenceOnly: parsed.metadata.referenceOnly === true,
    productionCertified: parsed.metadata.productionCertified === true
  };

  const nodes = {};
  for (const s of parsed.specs) {
    const node = new THREE.Group();
    node.name = s.nodeName;
    node.position.set(s.translation[0] * 0.001, s.translation[1] * 0.001, 0);
    node.userData = {
      panel_id: s.id,
      semantic_role: s.semanticRole,
      kind: s.kind,
      layer_class: s.layerClass,
      artwork_side: s.artworkSide,
      fold_id: s.foldId || null,
      target_angle_deg: s.targetAngleDeg
    };

    const mesh = new THREE.Mesh(
      makePanelGeometry(s.polygon, parsed.dimensions.thickness, s, flatNetUv),
      makeTechMaterials(s)
    );
    mesh.name = s.nodeName + '__mesh';
    mesh.userData = {
      panel_id: s.id,
      semantic_role: s.semanticRole,
      kind: s.kind,
      layer_class: s.layerClass,
      artwork_surface: String(s.artworkSide || '').toLowerCase() === 'outside',
      artwork_surface_type: 'panel'
    };
    if (mesh.geometry.morphAttributes?.position?.length) {
      mesh.updateMorphTargets();
    }
    node.add(mesh);
    nodes[s.id] = node;
  }

  for (const s of parsed.specs) {
    const node = nodes[s.id];
    if (s.parentId) nodes[s.parentId].add(node);
    else model.add(node);
  }

  // Finite crease ribbons attached to parent panel nodes
  for (const f of Object.values(parsed.folds)) {
    const parentNode = nodes[f.parentPanelId], parentOrigin = parsed.origins[f.parentPanelId];
    const mesh = new THREE.Mesh(
      makeFiniteCreaseGeometry(f, parsed, parentOrigin, parsed.creaseProfile, flatNetUv),
      makeCreaseMaterial(f.foldId, creaseMeshName)
    );
    mesh.name = creaseMeshName(f.foldId);
    mesh.userData = {
      semantic_role: 'finite-crease-zone',
      fold_id: f.foldId,
      parent_panel_id: f.parentPanelId,
      child_panel_id: f.childPanelId,
      crease_width_mm: parsed.creaseProfile.creaseWidthMm,
      bend_radius_mm: parsed.creaseProfile.bendRadiusMm,
      artwork_surface: true,
      artwork_surface_type: 'crease'
    };
    mesh.updateMorphTargets();
    parentNode.add(mesh);
  }

  return { model, animations: buildGenericAnimations(parsed), parsed, name };
}
