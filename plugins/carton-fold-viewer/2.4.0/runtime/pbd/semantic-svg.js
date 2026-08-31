import { parseSvgPathD, svgXY, safeNodeName, polyCentroid, lineInfo, requireFinite } from './path-parser.js';
import { trimmedPanelPolygonGlobal } from '../geometry/panel-geometry.js';
import { resolveCreaseProfile } from '../geometry/crease-geometry.js';

function readViewBox(value, label) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').trim().split(/[\s,]+/).filter(Boolean);
  if (!values.length) return null;
  if (values.length !== 4) throw new Error(`${label} must contain four numbers`);
  const viewBox = values.map(Number);
  if (viewBox.some(value => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error(`${label} must contain a finite positive-size viewBox`);
  }
  return viewBox;
}

export function parseSemanticCartonSvg(svgText) {
  const doc=new DOMParser().parseFromString(svgText,'image/svg+xml');
  const parseError=doc.querySelector('parsererror'); if(parseError) throw new Error('Invalid SVG/XML');
  const mdEl=doc.querySelector('metadata#cartonbuilder-metadata') || doc.querySelector('metadata');
  if(!mdEl?.textContent?.trim()) throw new Error('pbd.svg.v4 metadata is missing');
  let metadata={}; try{ metadata=JSON.parse(mdEl.textContent.trim()); }catch(e){ throw new Error('Invalid pbd.svg.v4 metadata JSON'); }
  const schema=metadata.schemaVersion || doc.documentElement.dataset.exportSchemaVersion || '';
  const viewBox = readViewBox(metadata.canvas?.viewBox, 'metadata.canvas.viewBox')
    || readViewBox(doc.documentElement.getAttribute('viewBox'), 'svg viewBox');
  const canvas = viewBox ? { viewBox } : null;
  const idIndex={}; doc.querySelectorAll('[id]').forEach(el=>{ idIndex[el.getAttribute('id')]=el; });
  if(!/^pbd\.svg\.v4(?:\.|$)/i.test(schema)) throw new Error(`Unsupported SVG schema "${schema||'unknown'}". Expected pbd.svg.v4.`);
  if(metadata.capabilities?.panelGeometry===false || metadata.capabilities?.foldGraph===false) throw new Error('SVG declares that panelGeometry/foldGraph capability is unavailable');

  const dims={
    L:requireFinite(metadata.dimensions?.lengthMm,'dimensions.lengthMm'),
    W:requireFinite(metadata.dimensions?.widthMm,'dimensions.widthMm'),
    H:requireFinite(metadata.dimensions?.heightMm,'dimensions.heightMm'),
    thickness:requireFinite(metadata.material?.caliperMm,'material.caliperMm')
  };
  if(dims.thickness<=0) throw new Error('material.caliperMm must be > 0');
  const outsideNormal=metadata.coordinateConvention?.outsideNormal || '+Z';
  if(outsideNormal!=='+Z' && outsideNormal!=='-Z') throw new Error(`Unsupported outsideNormal "${outsideNormal}"`);

  const panelMeta=Array.isArray(metadata.panels)?metadata.panels:[];
  const graph=Array.isArray(metadata.folding?.foldGraph)?metadata.folding.foldGraph:[];
  const rootId=metadata.folding?.rootPanelId;
  if(!rootId) throw new Error('folding.rootPanelId is missing');
  if(!panelMeta.length) throw new Error('metadata.panels is empty');

  const panels={}, panelById={};
  for(const p of panelMeta){
    const id=p.id, entityId=p.entityId||id; if(!id) throw new Error('Panel without id in metadata.panels');
    if(panelById[id]) throw new Error(`Duplicate panel id: ${id}`);
    const el=idIndex[entityId]; if(!el || !el.closest('#regions')) throw new Error(`Panel region missing: ${entityId}`);
    const poly=parseSvgPathD(el.getAttribute('d')||'').map(svgXY); if(poly.length<3) throw new Error(`Panel ${id} has invalid polygon`);
    panelById[id]=p; panels[id]={id,entityId,meta:p,el,polygon:poly,nodeName:safeNodeName(id)};
  }
  if(!panels[rootId]) throw new Error(`Root panel not found: ${rootId}`);

  const folds={}, incoming=new Map();
  for(const f of graph){
    const foldId=f.foldId, parent=f.parentPanelId, child=f.childPanelId;
    if(!foldId||!parent||!child) throw new Error('foldGraph record missing foldId/parentPanelId/childPanelId');
    if(!panels[parent]||!panels[child]) throw new Error(`Fold ${foldId} references unknown panel`);
    if(incoming.has(child)) throw new Error(`Panel ${child} has more than one parent fold`); incoming.set(child,foldId);
    const el=idIndex[foldId]; if(!el || !el.closest('#folds')) throw new Error(`Fold path missing: ${foldId}`);
    const pts=parseSvgPathD(el.getAttribute('d')||'').map(svgXY), line=lineInfo(pts);
    const geometryType=(f.geometryType||el.dataset.foldGeometry||'LINE').toUpperCase();
    if(geometryType!=='LINE') throw new Error(`Fold ${foldId} geometryType=${geometryType} is not supported by the rigid hinge solver`);
    folds[foldId]={...f,foldId,parentPanelId:parent,childPanelId:child,targetAngleDeg:requireFinite(f.targetAngleDeg,`${foldId}.targetAngleDeg`),points:pts,line,el};
  }
  for(const id of Object.keys(panels)) if(id!==rootId && !incoming.has(id)) throw new Error(`Panel ${id} is disconnected from foldGraph`);

  // Detect graph cycles from child->parent references.
  const parentOf={}; Object.values(folds).forEach(f=>parentOf[f.childPanelId]=f.parentPanelId);
  for(const id of Object.keys(panels)){
    const seen=new Set(); let q=id;
    while(parentOf[q]){ if(seen.has(q)) throw new Error(`Cycle detected in foldGraph at ${q}`); seen.add(q); q=parentOf[q]; }
  }

  // Invariant: parseSemanticCartonSvg is a pure parser that preserves canonical
  // semantic SVG panel polygons, fold lines, panel positions, and origins untouched.

  const origins={}; origins[rootId]=polyCentroid(panels[rootId].polygon);
  for(const f of Object.values(folds)) origins[f.childPanelId]=f.line.a;
  const creaseProfile=resolveCreaseProfile(metadata,dims), halfCrease=creaseProfile.creaseWidthMm/2;
  const specs=[];

  // Build rigid panel zones with a finite band removed around every incident fold.
  // The removed bands are filled by morphing Crease meshes below.
  const parsedForTrim={panels,folds};
  for(const p of panelMeta){
    const id=p.id, foldId=incoming.get(id), fold=foldId?folds[foldId]:null, org=origins[id];
    const parentId=fold?.parentPanelId||null, parentOrg=parentId?origins[parentId]:org;
    const trimmed=trimmedPanelPolygonGlobal(id,parsedForTrim,halfCrease);
    specs.push({
      id, entityId:p.entityId||id, nodeName:panels[id].nodeName, semanticRole:p.semanticRole||'', kind:p.kind||'PANEL', layerClass:p.layerClass||'shell', artworkSide:p.artworkSide||'outside',
      parentId, foldId, targetAngleDeg:fold?.targetAngleDeg||0, axis:fold?.line.axis||[0,1,0], origin:org,
      translation:parentId?[org[0]-parentOrg[0],org[1]-parentOrg[1],0]:[0,0,0],
      polygon:trimmed.map(q=>[q[0]-org[0],q[1]-org[1]]), originalPolygon:panels[id].polygon.map(q=>[q[0]-org[0],q[1]-org[1]])
    });
  }

  const interactions={};
  for(const r of (metadata.interactions||[])){
    if(!r.relationId) throw new Error('Interaction missing relationId');
    if(interactions[r.relationId]) throw new Error(`Duplicate interaction relationId: ${r.relationId}`);
    interactions[r.relationId]=r;
  }
  const openings={};
  for(const o of (metadata.receivingOpenings||[])){
    const el=idIndex[o.id];
    if(el){
      const pts=parseSvgPathD(el.getAttribute('d')||'').map(svgXY);
      openings[o.id]={...o,points:pts,line:lineInfo(pts)};
    } else {
      openings[o.id]={...o,points:[],line:null};
    }
  }
  for(const r of Object.values(interactions)){
    for(const pid of [r.tonguePanelId,r.closurePanelId,r.lockingPanelId]) if(pid && !panels[pid]) throw new Error(`Interaction ${r.relationId} references unknown panel ${pid}`);
    for(const fid of [r.tongueFoldId,r.closureFoldId]) if(fid && !folds[fid]) throw new Error(`Interaction ${r.relationId} references unknown fold ${fid}`);
    if(r.receivingOpeningId && !openings[r.receivingOpeningId]) throw new Error(`Interaction ${r.relationId} references unknown opening ${r.receivingOpeningId}`);
  }

  const assembly=metadata.assembly||{stages:[],actions:[]};
  const stages=Array.isArray(assembly.stages)?[...assembly.stages]:[];
  const actions=Array.isArray(assembly.actions)?[...assembly.actions]:[];
  const stageIds=new Set(stages.map(s=>s.id));
  for(const a of actions){
    if(!stageIds.has(a.stage)) throw new Error(`Assembly action references unknown stage ${a.stage}`);
    if(a.type==='fold' && !folds[a.foldId]) throw new Error(`Assembly fold action references unknown fold ${a.foldId}`);
    if((a.type==='interaction' || a.type==='engage') && !interactions[a.relationId]) throw new Error(`Assembly action references unknown relation ${a.relationId}`);
    if(a.type!=='fold' && a.type!=='interaction' && a.type!=='engage') throw new Error(`Unsupported assembly action type: ${a.type}`);
  }

  const rootOrigin=origins[rootId];
  return {doc,metadata,canvas,sourceSchema:schema,dimensions:dims,panels,panelById,folds,specs,rootId,rootOrigin,origins,creaseProfile,interactions,openings,assembly:{stages,actions},cartonType:metadata.cartonType||'generic'};
}
