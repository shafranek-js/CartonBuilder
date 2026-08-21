import { parseSvgPathD, svgXY, safeNodeName, polyCentroid, lineInfo, requireFinite } from './path-parser.js';
import { trimmedPanelPolygonGlobal } from '../geometry/panel-geometry.js';
import { resolveCreaseProfile } from '../geometry/crease-geometry.js';

export function parseSemanticCartonSvg(svgText) {
  const doc=new DOMParser().parseFromString(svgText,'image/svg+xml');
  const parseError=doc.querySelector('parsererror'); if(parseError) throw new Error('Invalid SVG/XML');
  const mdEl=doc.querySelector('metadata#cartonbuilder-metadata') || doc.querySelector('metadata');
  if(!mdEl?.textContent?.trim()) throw new Error('pbd.svg.v4 metadata is missing');
  let metadata={}; try{ metadata=JSON.parse(mdEl.textContent.trim()); }catch(e){ throw new Error('Invalid pbd.svg.v4 metadata JSON'); }
  const schema=metadata.schemaVersion || doc.documentElement.dataset.exportSchemaVersion || '';
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

  // Apply packaging CAD bend compensation (caliper compensation) to tuck-insertion closure flaps.
  // In 2D CAD die-lines, major closure panels are drafted shorter by 1x caliper (d2d = W - t).
  // In physical folding, outer corner bend expansion gives the full box depth W.
  for (const r of (metadata.interactions || [])) {
    if (r.type === 'tuck-insertion' && r.closureFoldId && r.tongueFoldId && r.closurePanelId && r.tonguePanelId) {
      const cf = folds[r.closureFoldId], tf = folds[r.tongueFoldId];
      const cp = panels[r.closurePanelId], tp = panels[r.tonguePanelId];
      if (cf && tf && cp && tp) {
        const midC = [(cf.line.a[0] + cf.line.b[0]) / 2, (cf.line.a[1] + cf.line.b[1]) / 2];
        const midT = [(tf.line.a[0] + tf.line.b[0]) / 2, (tf.line.a[1] + tf.line.b[1]) / 2];
        const d2d = Math.hypot(midT[0] - midC[0], midT[1] - midC[1]);
        const targetDepth = dims.width || dims.widthMm || 60.0;
        const comp = targetDepth - d2d;
        if (comp > 0.1 && d2d > 0.1) {
          const n = [(midT[0] - midC[0]) / d2d, (midT[1] - midC[1]) / d2d];
          cp.polygon.forEach(p => {
            const dp = (p[0] - cf.line.a[0]) * n[0] + (p[1] - cf.line.a[1]) * n[1];
            if (dp > 0.01) {
              p[0] += n[0] * dp * (comp / d2d);
              p[1] += n[1] * dp * (comp / d2d);
            }
          });
          tf.line.a[0] += n[0] * comp; tf.line.a[1] += n[1] * comp;
          tf.line.b[0] += n[0] * comp; tf.line.b[1] += n[1] * comp;
          tf.points.forEach(p => { p[0] += n[0] * comp; p[1] += n[1] * comp; });
          tp.polygon.forEach(p => { p[0] += n[0] * comp; p[1] += n[1] * comp; });
        }
      }
    }
  }

  // Apply packaging CAD bend compensation (caliper compensation) to manufacturer's glue seam.
  // In physical folding, the back panel must fold 1x caliper earlier (L_back = L - t) so that
  // the glue flap is positioned along the inner face of the mating side panel.
  for (const f of Object.values(folds)) {
    const childMeta = panelMeta.find(p => p.id === f.childPanelId) || {};
    const isGlue = childMeta.layerClass === 'glue' || String(childMeta.kind || '').toUpperCase() === 'GLUE_FLAP';
    if (isGlue && f.parentPanelId && panels[f.parentPanelId] && panels[f.childPanelId]) {
      const parentP = panels[f.parentPanelId], childP = panels[f.childPanelId];
      const t = dims.thickness || dims.thicknessMm || 3.2;
      const u = [f.line.axis[0], f.line.axis[1]];
      const childC = polyCentroid(childP.polygon);
      const mid = [(f.line.a[0] + f.line.b[0]) / 2, (f.line.a[1] + f.line.b[1]) / 2];
      let n = [-u[1], u[0]];
      if ((childC[0] - mid[0]) * n[0] + (childC[1] - mid[1]) * n[1] < 0) {
        n[0] = -n[0];
        n[1] = -n[1];
      }

      const shift = [-n[0] * t, -n[1] * t];
      f.line.a[0] += shift[0]; f.line.a[1] += shift[1];
      f.line.b[0] += shift[0]; f.line.b[1] += shift[1];
      f.points.forEach(p => { p[0] += shift[0]; p[1] += shift[1]; });

      parentP.polygon.forEach(p => {
        const dp = (p[0] - mid[0]) * n[0] + (p[1] - mid[1]) * n[1];
        if (dp > -1.0) {
          p[0] += shift[0];
          p[1] += shift[1];
        }
      });

      childP.polygon.forEach(p => {
        p[0] += shift[0];
        p[1] += shift[1];
      });
    }
  }

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
  return {doc,metadata,sourceSchema:schema,dimensions:dims,panels,panelById,folds,specs,rootId,rootOrigin,origins,creaseProfile,interactions,openings,assembly:{stages,actions},cartonType:metadata.cartonType||'generic'};
}
