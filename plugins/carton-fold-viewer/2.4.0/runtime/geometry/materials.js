import * as THREE from 'three';

export const ARTWORK_MAP_KEYS = Object.freeze([
  'alpha',
  'normal',
  'roughness',
  'metalness'
]);

export function panelColor(spec){
  const k=String(spec.kind||'').toUpperCase(), l=String(spec.layerClass||'').toLowerCase();
  if(l==='glue'||k==='GLUE_FLAP') return 0xfff4d6;
  if(k.includes('TONGUE')) return 0xdceafb;
  if(k.includes('FLAP') && l==='inner') return 0xeaf6ef;
  if(k.includes('FLAP')) return 0xe8f1fb;
  if(/side/i.test(spec.semanticRole||'')) return 0xedf2f7;
  return 0xf5f7fa;
}

export function makeTechMaterials(spec){
  const surface=new THREE.MeshStandardMaterial({color:panelColor(spec),roughness:1,metalness:0,side:THREE.FrontSide});
  surface.name=`${spec.nodeName}_outer_paper`;
  const inner=new THREE.MeshStandardMaterial({color:0xfafaf6,roughness:1,metalness:0,side:THREE.FrontSide});
  inner.name=`${spec.nodeName}_inner_paper`;
  const edge=new THREE.MeshStandardMaterial({color:0xeadfcf,roughness:1,metalness:0,side:THREE.DoubleSide});
  edge.name=`${spec.nodeName}_edge`;
  return [surface,inner,edge];
}

export function makeCreaseMaterial(foldId, creaseMeshName){
  const surface=new THREE.MeshStandardMaterial({color:0xf2efe8,roughness:1,metalness:0,side:THREE.FrontSide});
  surface.name=`${creaseMeshName(foldId)}_outer_paper`;
  const inner=new THREE.MeshStandardMaterial({color:0xfafaf6,roughness:1,metalness:0,side:THREE.FrontSide});
  inner.name=`${creaseMeshName(foldId)}_inner_paper`;
  const edge=new THREE.MeshStandardMaterial({color:0xeadfcf,roughness:1,metalness:0,side:THREE.DoubleSide});
  edge.name=`${creaseMeshName(foldId)}_edge`;
  return [surface,inner,edge];
}

export function getArtworkSurfaceMaterials(root) {
  const materials = [];
  const seen = new Set();
  root?.traverse?.((node) => {
    if (!node.isMesh || node.userData?.artwork_surface !== true) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    // Panel meshes use material slot 0 for the outside surface, slot 1 for the
    // inner paper surface and slot 2 for cut/edge faces. Crease ribbons have
    // one material, which is their artwork surface.
    const material = list[0];
    if (material && !seen.has(material)) {
      seen.add(material);
      materials.push(material);
    }
  });
  return materials;
}
