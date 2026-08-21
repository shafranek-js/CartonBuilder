import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildFoldableFromSemanticSvg } from '../model/model-builder.js';
import { disposeObject } from '../utils/dispose.js';

export function createViewerApp({ defaultModelUrl = null } = {}) {
  const byId = id => document.getElementById(id);
  const viewport = byId('viewport'), slider = byId('slider'), pct = byId('pct'), clipSelect = byId('clipSelect');
  const displayModeSel = byId('displayModeSel'), playBtn = byId('playBtn'), reverseBtn = byId('reverseBtn');
  const unfoldBtn = byId('unfoldBtn'), foldBtn = byId('foldBtn'), fitBtn = byId('fitBtn'), saveGlbBtn = byId('saveGlbBtn');
  const fileInput = byId('fileInput'), gridChk = byId('gridChk'), axesChk = byId('axesChk'), wireChk = byId('wireChk'), rotateChk = byId('rotateChk');
  const clipInfo = byId('clipInfo'), nodeInfo = byId('nodeInfo'), meshInfo = byId('meshInfo'), modelName = byId('modelName');
  const modelBadge = byId('modelBadge'), errorEl = byId('error'), sourceInfo = byId('sourceInfo');

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15181d);
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.0001, 10000); camera.position.set(0.5, 0.5, 2);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  viewport.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.07; controls.screenSpacePanning = true; controls.autoRotateSpeed = 1.2;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x59616d, 2.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.75); key.position.set(3, 4, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xd7e5f5, 0.75); fill.position.set(-4, 2, 3); scene.add(fill);
  const grid = new THREE.GridHelper(10, 40, 0x59616d, 0x343a43); grid.material.opacity = 0.35; grid.material.transparent = true; scene.add(grid);
  const axes = new THREE.AxesHelper(1); axes.visible = false; scene.add(axes);
  const loader = new GLTFLoader();

  let root = null, mixer = null, clips = [], action = null, activeClip = null, progress = 0, playing = false, direction = 1, lastTs = performance.now();
  let creaseGuides = [], canSaveConvertedGLB = false, suggestedGlbName = 'converted-carton.glb';

  const showError = msg => { errorEl.textContent = msg; errorEl.style.display = 'block'; };
  const clearError = () => { errorEl.textContent = ''; errorEl.style.display = 'none'; };

  function clearModel() {
    playing = false;
    if (mixer) { mixer.stopAllAction(); if (root) mixer.uncacheRoot(root); }
    if (root) { scene.remove(root); disposeObject(root); }
    root = null; mixer = null; clips = []; action = null; activeClip = null; creaseGuides = [];
    canSaveConvertedGLB = false; saveGlbBtn.disabled = true;
  }

  function centerModelOnGrid() {
    if (!root) return;
    if (mixer && clips.length) {
      const sampleClip = clips.find(c => /assembly/i.test(c.name)) || clips[0];
      const tempAction = mixer.clipAction(sampleClip);
      tempAction.reset();
      tempAction.enabled = true;
      tempAction.play();
      mixer.setTime(sampleClip.duration);
      mixer.update(0);
      root.updateMatrixWorld(true);
      const foldedBox = new THREE.Box3().setFromObject(root);
      if (!foldedBox.isEmpty()) {
        const foldedCenter = foldedBox.getCenter(new THREE.Vector3());
        root.position.x -= foldedCenter.x;
        root.position.y -= foldedBox.min.y;
        root.position.z -= foldedCenter.z;
        root.updateMatrixWorld(true);
      }
      tempAction.reset();
      mixer.setTime(0);
      mixer.update(0);
      root.updateMatrixWorld(true);
    } else {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        root.position.x -= center.x;
        root.position.y -= box.min.y;
        root.position.z -= center.z;
        root.updateMatrixWorld(true);
      }
    }
  }

  function fitCamera() {
    if (!root) return;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()), maxSize = Math.max(size.x, size.y, size.z, 1e-6);
    const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5), dist = (maxSize * 0.65) / Math.tan(halfFov), dir = new THREE.Vector3(0.18, 0.12, 1.35).normalize();
    camera.position.set(dir.x * dist * 1.32, center.y + dir.y * dist * 1.32, dir.z * dist * 1.32);
    camera.near = Math.max(maxSize / 10000, 0.00001); camera.far = Math.max(maxSize * 100, 100); camera.updateProjectionMatrix();
    controls.target.set(0, center.y, 0); controls.update();
    grid.position.set(0, 0, 0);
    grid.scale.setScalar(Math.max(maxSize / 3.5, 0.001));
    axes.position.set(0, 0, 0);
    axes.scale.setScalar(Math.max(maxSize / 4, 0.001));
  }

  function createPaperMaterial(orig, meshName = '', lit = false) {
    const isEdge = /edge|rim|cut/i.test(orig?.name || '') || /edge|rim|cut/i.test(meshName);
    // Use consistent warm paper tone with subtle shading so fold seams remain seamless
    const color = isEdge ? 0xf2ece1 : 0xf7f4ec;
    const params = { color, side: orig?.side !== undefined ? orig.side : THREE.DoubleSide };
    if (orig?.map) { params.map = orig.map; params.color = 0xffffff; }
    const mat = lit ? new THREE.MeshStandardMaterial({ ...params, roughness: 0.92, metalness: 0 }) : new THREE.MeshBasicMaterial(params);
    mat.name = (orig?.name || 'mat') + (lit ? '__artwork_lit' : '__artwork_flat');
    mat.transparent = !!orig?.transparent;
    mat.opacity = orig?.opacity ?? 1;
    mat.alphaTest = orig?.alphaTest ?? 0;
    mat.wireframe = !!wireChk.checked;
    return mat;
  }
  function ensureArtworkMaterials(o) {
    if (!o?.isMesh) return;
    if (!o.userData.originalMaterials) { const mats = Array.isArray(o.material) ? o.material : [o.material]; o.userData.originalMaterials = mats.slice(); o.userData.materialWasArray = Array.isArray(o.material); }
    if (!o.userData.artworkFlatMaterials) o.userData.artworkFlatMaterials = o.userData.originalMaterials.map(m => createPaperMaterial(m, o.name || '', false));
    if (!o.userData.artworkLitMaterials) o.userData.artworkLitMaterials = o.userData.originalMaterials.map(m => createPaperMaterial(m, o.name || '', true));
  }
  const assignMaterialSet = (o, mats) => { o.material = o.userData.materialWasArray ? mats : mats[0]; };
  function setWireframe(on) { if (!root) return; root.traverse(o => { if (!o.isMesh) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m) m.wireframe = on; }); }); }
  function updateArtworkShading() {
    if (!root || (displayModeSel?.value || 'plain') !== 'plain') return; const useLit = progress > 0.008;
    root.traverse(o => { if (!o.isMesh) return; ensureArtworkMaterials(o); assignMaterialSet(o, useLit ? o.userData.artworkLitMaterials : o.userData.artworkFlatMaterials); }); setWireframe(wireChk.checked);
  }
  const isCreaseMesh = o => !!o?.isMesh && (/^Crease__/i.test(o.name || '') || /finite-crease-zone/i.test(o?.userData?.semantic_role || o?.parent?.userData?.semantic_role || ''));

  function updateCreaseGuides() { const plain = (displayModeSel?.value || 'plain') === 'plain', alpha = plain ? THREE.MathUtils.clamp(1 - progress / 0.06, 0, 1) : 0; creaseGuides.forEach(line => { line.visible = alpha > 0.001; if (line.material) line.material.opacity = 0.72 * alpha; }); }
  function buildCreaseGuides() {
    creaseGuides = []; if (!root) return;
    root.traverse(o => {
      if (!isCreaseMesh(o) || !o.geometry?.attributes?.position) return; const pos = o.geometry.attributes.position; let cx = 0, cy = 0, n = pos.count, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < n; i++) { cx += pos.getX(i); cy += pos.getY(i); const z = pos.getZ(i); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); } cx /= n; cy /= n; let xx = 0, xy = 0, yy = 0;
      for (let i = 0; i < n; i++) { const x = pos.getX(i) - cx, y = pos.getY(i) - cy; xx += x * x; xy += x * y; yy += y * y; } const angle = 0.5 * Math.atan2(2 * xy, xx - yy), dx = Math.cos(angle), dy = Math.sin(angle); let tmin = Infinity, tmax = -Infinity;
      for (let i = 0; i < n; i++) { const t = (pos.getX(i) - cx) * dx + (pos.getY(i) - cy) * dy; tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); } if (!(tmax > tmin)) return;
      const thickness = Math.max(1e-7, maxZ - minZ), eps = Math.max(2e-6, thickness * 0.04); const mk = (z, name) => { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx + dx * tmin, cy + dy * tmin, z), new THREE.Vector3(cx + dx * tmax, cy + dy * tmax, z)]); const m = new THREE.LineBasicMaterial({ color: 0xb9b7b0, transparent: true, opacity: 0.72, depthTest: true, depthWrite: false }); const line = new THREE.Line(g, m); line.name = name; line.renderOrder = 3; o.add(line); creaseGuides.push(line); }; mk(maxZ + eps, (o.name || 'Crease') + '__guide_front'); mk(minZ - eps, (o.name || 'Crease') + '__guide_back');
    }); updateCreaseGuides();
  }
  function sanitizeModelNormalsAndWindings(model) {
    if (!model) return;
    const clonedForMesh = new Map();
    model.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      // If geometry is shared with different orientations, ensure unique instance per mesh
      if (!o.geometry.index || !o.geometry.attributes.position || !o.geometry.attributes.normal) return;
      const g = o.geometry.clone();
      o.geometry = g;

      const pos = g.attributes.position, norm = g.attributes.normal, idx = g.index;
      let dotSum = 0, count = 0;
      const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
      const cb = new THREE.Vector3(), ab = new THREE.Vector3();
      const vn = new THREE.Vector3();

      const numTris = Math.floor(idx.count / 3);
      const step = Math.max(1, Math.floor(numTris / 32));
      for (let t = 0; t < numTris; t += step) {
        const i0 = idx.getX(t * 3), i1 = idx.getX(t * 3 + 1), i2 = idx.getX(t * 3 + 2);
        pA.fromBufferAttribute(pos, i0);
        pB.fromBufferAttribute(pos, i1);
        pC.fromBufferAttribute(pos, i2);
        cb.subVectors(pC, pB);
        ab.subVectors(pA, pB);
        cb.cross(ab).normalize();

        vn.fromBufferAttribute(norm, i0);
        if (cb.lengthSq() > 0.5 && vn.lengthSq() > 0.5) {
          dotSum += cb.dot(vn);
          count++;
        }
      }

      if (count > 0 && (dotSum / count) < -0.2) {
        const arr = idx.array.slice();
        for (let t = 0; t < numTris; t++) {
          const tmp = arr[t * 3 + 1];
          arr[t * 3 + 1] = arr[t * 3 + 2];
          arr[t * 3 + 2] = tmp;
        }
        g.setIndex(new THREE.BufferAttribute(arr, 1));
      }

      // Also sanitize morph target normal deltas if they point opposite to morphed bend
      if (g.morphAttributes?.position && g.morphAttributes?.normal) {
        const curIdx = g.index;
        const mpList = g.morphAttributes.position, mnList = g.morphAttributes.normal;
        for (let j = 0; j < mpList.length && j < mnList.length; j++) {
          const mp = mpList[j], mn = mnList[j];
          let mDotSum = 0, mCount = 0;
          for (let t = 0; t < numTris; t += step) {
            const i0 = curIdx.getX(t * 3), i1 = curIdx.getX(t * 3 + 1), i2 = curIdx.getX(t * 3 + 2);
            pA.fromBufferAttribute(pos, i0).addScaledVector(new THREE.Vector3().fromBufferAttribute(mp, i0), 1);
            pB.fromBufferAttribute(pos, i1).addScaledVector(new THREE.Vector3().fromBufferAttribute(mp, i1), 1);
            pC.fromBufferAttribute(pos, i2).addScaledVector(new THREE.Vector3().fromBufferAttribute(mp, i2), 1);
            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            cb.cross(ab).normalize();

            vn.fromBufferAttribute(norm, i0).addScaledVector(new THREE.Vector3().fromBufferAttribute(mn, i0), 1).normalize();
            if (cb.lengthSq() > 0.5 && vn.lengthSq() > 0.5) {
              mDotSum += cb.dot(vn);
              mCount++;
            }
          }
          if (mCount > 0 && (mDotSum / mCount) < -0.2) {
            const mnArr = mn.array.slice();
            for (let k = 0; k < mnArr.length; k++) mnArr[k] = -mnArr[k];
            g.morphAttributes.normal[j] = new THREE.BufferAttribute(mnArr, 3);
          }
        }
      }
    });
  }

  function applyDisplayMode(mode = displayModeSel?.value || 'plain') { if (!root) return; root.traverse(o => { if (!o.isMesh) return; ensureArtworkMaterials(o); if (mode === 'technical') assignMaterialSet(o, o.userData.originalMaterials); }); if (mode === 'plain') updateArtworkShading(); setWireframe(wireChk.checked); updateCreaseGuides(); }

  function populateAnimations() { clipSelect.innerHTML = ''; clips.forEach((clip, i) => { const opt = document.createElement('option'); opt.value = String(i); opt.textContent = `${clip.name || 'Animation ' + (i + 1)} (${clip.duration.toFixed(2)} s)`; clipSelect.appendChild(opt); }); let preferred = clips.findIndex(c => /assembly/i.test(c.name)); if (preferred < 0) preferred = clips.findIndex(c => /simultaneous/i.test(c.name)); if (preferred < 0) preferred = 0; clipSelect.value = String(Math.max(0, preferred)); selectClip(preferred); }
  function selectClip(index) { if (!mixer || !clips.length) return; mixer.stopAllAction(); activeClip = clips[index] || clips[0]; action = mixer.clipAction(activeClip); action.reset(); action.enabled = true; action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); playing = false; setProgress(0); clipInfo.textContent = `${activeClip.name || 'unnamed'} · ${activeClip.duration.toFixed(3)} s · ${activeClip.tracks.length} tracks`; }
  function setProgress(p) { progress = THREE.MathUtils.clamp(p, 0, 1); slider.value = String(Math.round(progress * 1000)); pct.textContent = `${(progress * 100).toFixed(1)}%`; updateCreaseGuides(); updateArtworkShading(); if (!mixer || !activeClip || !action) return; action.paused = false; action.enabled = true; action.play(); mixer.setTime(progress * activeClip.duration); mixer.update(0); root.updateMatrixWorld(true); action.paused = true; }
  const setEnabled = enabled => [slider, clipSelect, playBtn, reverseBtn, unfoldBtn, foldBtn, displayModeSel].forEach(el => el.disabled = !enabled);

  function activateGeneratedModel(result, sourceName) {
    clearError(); clearModel(); setEnabled(false); root = result.model; scene.add(root); sanitizeModelNormalsAndWindings(root); clips = result.animations; mixer = new THREE.AnimationMixer(root); let nodes = 0, meshes = 0; root.traverse(o => { nodes++; if (o.isMesh) meshes++; }); nodeInfo.textContent = String(nodes); meshInfo.textContent = String(meshes);
    const d = result.parsed.dimensions; modelName.textContent = sourceName.replace(/\.svg$/i, '.glb'); modelBadge.textContent = 'pbd.svg.v4 → GLB · finite crease · junction-trim'; sourceInfo.textContent = `${result.parsed.sourceSchema} · ${d.L.toFixed(1)}×${d.W.toFixed(1)}×${d.H.toFixed(1)} mm · t=${d.thickness.toFixed(2)} mm · crease=${result.parsed.creaseProfile.creaseWidthMm.toFixed(2)} mm · R=${result.parsed.creaseProfile.bendRadiusMm.toFixed(2)} mm (${result.parsed.creaseProfile.source}) · ${Object.keys(result.parsed.panels).length} panels / ${Object.keys(result.parsed.folds).length} folds`;
    canSaveConvertedGLB = true; saveGlbBtn.disabled = false; suggestedGlbName = sourceName.replace(/\.svg$/i, '') + '_foldable.glb'; populateAnimations(); centerModelOnGrid(); fitCamera(); creaseGuides = []; buildCreaseGuides(); applyDisplayMode(displayModeSel?.value || 'plain'); setWireframe(wireChk.checked); setEnabled(true);
  }
  async function convertSvgFile(file) { const text = await file.text(); activateGeneratedModel(buildFoldableFromSemanticSvg(text, file.name), file.name); }
  function restoreOriginalMaterialsForExport() { if (!root) return; root.traverse(o => { if (!o.isMesh) return; ensureArtworkMaterials(o); if (o.userData.originalMaterials) assignMaterialSet(o, o.userData.originalMaterials); }); }
  function saveConvertedGLB() {
    if (!root || !canSaveConvertedGLB) return; const oldProgress = progress, oldPlaying = playing; playing = false; setProgress(0); restoreOriginalMaterialsForExport(); root.updateMatrixWorld(true); const exporter = new GLTFExporter();
    exporter.parse(root, data => { const blob = new Blob([data], { type: 'model/gltf-binary' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = suggestedGlbName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); applyDisplayMode(displayModeSel?.value || 'plain'); setProgress(oldProgress); playing = oldPlaying; }, err => { showError('GLB export error: ' + (err?.message || err)); applyDisplayMode(displayModeSel?.value || 'plain'); setProgress(oldProgress); playing = oldPlaying; }, { binary: true, trs: true, onlyVisible: false, animations: clips });
  }
  function loadArrayBuffer(buffer, name = 'model.glb', badge = 'loaded') {
    clearError(); clearModel(); setEnabled(false); loader.parse(buffer, '', gltf => { root = gltf.scene; root.name = root.name || 'CartonRoot'; scene.add(root); sanitizeModelNormalsAndWindings(root); clips = gltf.animations || []; mixer = new THREE.AnimationMixer(root); let nodes = 0, meshes = 0; root.traverse(o => { nodes++; if (o.isMesh) meshes++; }); nodeInfo.textContent = String(nodes); meshInfo.textContent = String(meshes); modelName.textContent = name; modelBadge.textContent = badge; sourceInfo.textContent = 'GLB'; canSaveConvertedGLB = false; saveGlbBtn.disabled = true; if (clips.length) { populateAnimations(); setEnabled(true); } else { clipInfo.textContent = 'No animation clips'; slider.value = '0'; pct.textContent = 'static'; clipSelect.innerHTML = '<option>No animations</option>'; }; centerModelOnGrid(); fitCamera(); buildCreaseGuides(); applyDisplayMode(displayModeSel?.value || 'plain'); setWireframe(wireChk.checked); }, err => { console.error(err); showError('GLB load error: ' + (err?.message || err)); });
  }

  async function loadDefaultModel() { if (!defaultModelUrl) return; try { const response = await fetch(defaultModelUrl); if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); loadArrayBuffer(await response.arrayBuffer(), defaultModelUrl.split('/').pop(), 'default GLB'); } catch (e) { console.warn('Default model was not loaded:', e); modelBadge.textContent = 'ready · open GLB / SVG'; modelName.textContent = '—'; clipInfo.textContent = 'No model loaded'; } }

  slider.addEventListener('input', () => { playing = false; setProgress(Number(slider.value) / 1000); }); clipSelect.addEventListener('change', () => selectClip(Number(clipSelect.value))); unfoldBtn.addEventListener('click', () => { playing = false; setProgress(0); }); foldBtn.addEventListener('click', () => { playing = false; setProgress(1); });
  playBtn.addEventListener('click', () => { if (!activeClip) return; if (playing && direction === 1) { playing = false; return; } direction = 1; if (progress >= 1) setProgress(0); playing = true; }); reverseBtn.addEventListener('click', () => { if (!activeClip) return; if (playing && direction === -1) { playing = false; return; } direction = -1; if (progress <= 0) setProgress(1); playing = true; });
  fitBtn.addEventListener('click', fitCamera); wireChk.addEventListener('change', () => setWireframe(wireChk.checked)); gridChk.addEventListener('change', () => grid.visible = gridChk.checked); axesChk.addEventListener('change', () => axes.visible = axesChk.checked); rotateChk.addEventListener('change', () => controls.autoRotate = rotateChk.checked); displayModeSel.addEventListener('change', () => { applyDisplayMode(displayModeSel.value); setWireframe(wireChk.checked); });
  fileInput.addEventListener('change', async () => { const f = fileInput.files?.[0]; if (!f) return; try { if (/\.svg$/i.test(f.name) || f.type === 'image/svg+xml') await convertSvgFile(f); else loadArrayBuffer(await f.arrayBuffer(), f.name, 'local GLB'); } catch (e) { console.error(e); showError(String(e?.message || e)); } fileInput.value = ''; }); saveGlbBtn.addEventListener('click', saveConvertedGLB);
  document.addEventListener('keydown', e => { if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return; if (e.code === 'Space') { e.preventDefault(); if (!activeClip) return; if (playing) playing = false; else { direction = 1; if (progress >= 1) setProgress(0); playing = true; } } if (e.code === 'Home') { e.preventDefault(); playing = false; setProgress(0); } if (e.code === 'End') { e.preventDefault(); playing = false; setProgress(1); } });
  window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  function loop(ts) { requestAnimationFrame(loop); const dt = Math.min((ts - lastTs) / 1000, 0.1); lastTs = ts; if (playing && activeClip) { let p = progress + direction * dt / Math.max(activeClip.duration, 0.001); if (p >= 1) { p = 1; playing = false; } if (p <= 0) { p = 0; playing = false; } setProgress(p); } controls.update(); renderer.render(scene, camera); } requestAnimationFrame(loop); loadDefaultModel();

  return { loadArrayBuffer, convertSvgFile, fitCamera, setProgress };
}
