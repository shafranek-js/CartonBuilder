import * as THREE from 'three';

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
  const surface=new THREE.MeshStandardMaterial({color:panelColor(spec),roughness:1,metalness:0,side:THREE.DoubleSide});
  surface.name=`${spec.nodeName}_paper`;
  const edge=new THREE.MeshStandardMaterial({color:0xeadfcf,roughness:1,metalness:0,side:THREE.DoubleSide});
  edge.name=`${spec.nodeName}_edge`;
  return [surface,edge];
}

export function makeCreaseMaterial(foldId, creaseMeshName){
  const m=new THREE.MeshStandardMaterial({color:0xf2efe8,roughness:1,metalness:0,side:THREE.DoubleSide});
  m.name=`${creaseMeshName(foldId)}_paper`;
  return m;
}
