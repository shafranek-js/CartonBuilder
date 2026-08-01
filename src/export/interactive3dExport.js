import threeCoreSource from '../../node_modules/three/build/three.core.min.js?raw';
import threeModuleSource from '../../node_modules/three/build/three.module.min.js?raw';
import roomEnvironmentSource from '../../node_modules/three/examples/jsm/environments/RoomEnvironment.js?raw';

import { buildFoldGraph } from '../preview3d/foldGraph.js';
import { composeArtworkTexture } from '../preview3d/textureComposer.js';

const VIEWER_SCRIPT = `
  const DATA = __DATA__;

  const canvas = document.getElementById('viewer');
  const foldSlider = document.getElementById('fold');
  const foldValue = document.getElementById('foldValue');
  const cameraToggle = document.getElementById('camera');
  const openButton = document.getElementById('open');
  const closeButton = document.getElementById('close');
  const resetButton = document.getElementById('reset');
  const bgColorInput = document.getElementById('bgColor');

  const nodes = new Map(DATA.nodes.map((node) => [node.id, node]));

  let foldProgress = 1;
  let animationFrame = null;

  const DEFAULT_BACKGROUND = '#e8e8e8';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_BACKGROUND);

  function applyBackground(color) {
    scene.background = new THREE.Color(color);
    document.body.style.background = color;
    canvas.style.background = color;
  }

  bgColorInput.value = DEFAULT_BACKGROUND;
  applyBackground(DEFAULT_BACKGROUND);
  bgColorInput.addEventListener('input', () => applyBackground(bgColorInput.value));

  let projection = 'perspective';
  let camera;
  let renderer;

  let radius = 300;
  let theta = 0.65;
  let phi = 1.15;
  const target = new THREE.Vector3(0, 0, 0);

  const textureImage = new Image();
  textureImage.src = DATA.texture;
  const texture = new THREE.Texture(textureImage);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  textureImage.onload = () => { texture.needsUpdate = true; };
  textureImage.onerror = () => { console.error('texture failed to load'); };

  const frontMaterial = new THREE.MeshPhysicalMaterial({
    map: texture,
    side: THREE.FrontSide,
    roughness: 0.68,
    metalness: 0,
    clearcoat: 0.05,
    clearcoatRoughness: 0.85,
  });
  const backMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf4f2ec,
    side: THREE.BackSide,
    roughness: 0.95,
    metalness: 0,
  });

  const meshes = new Map();

  function buildPanelObjects(node) {
    const hw = node.width / 2;
    const hh = node.height / 2;
    const u0 = (node.rect.x - DATA.bounds.minX) / DATA.bounds.width;
    const u1 = (node.rect.x + node.width - DATA.bounds.minX) / DATA.bounds.width;
    const v0 = 1 - (node.rect.y - DATA.bounds.minY) / DATA.bounds.height;
    const v1 = 1 - (node.rect.y + node.height - DATA.bounds.minY) / DATA.bounds.height;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0,
    ]), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      u0, v1, u1, v1, u1, v0, u0, v0,
    ]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const exterior = new THREE.Mesh(geometry, frontMaterial);
    exterior.matrixAutoUpdate = false;
    exterior.castShadow = true;
    const interior = new THREE.Mesh(geometry, backMaterial);
    interior.matrixAutoUpdate = false;
    scene.add(exterior, interior);
    meshes.set(node.id, [exterior, interior]);
  }

  DATA.nodes.forEach(buildPanelObjects);

  function computeBoxExtents() {
    const transforms = computeTransforms(1);
    let minY = Infinity;
    let maxY = -Infinity;
    let maxRadius = 0;
    const corner = new THREE.Vector3();
    for (const node of DATA.nodes) {
      const matrix = transforms.get(node.id);
      if (!matrix) continue;
      const hw = node.width / 2;
      const hh = node.height / 2;
      for (const point of [[-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0]]) {
        corner.set(point[0], point[1], point[2]).applyMatrix4(matrix);
        if (corner.y < minY) minY = corner.y;
        if (corner.y > maxY) maxY = corner.y;
        const radial = Math.hypot(corner.x, corner.z);
        if (radial > maxRadius) maxRadius = radial;
      }
    }
    return { minY, maxY, maxRadius: Math.max(1, maxRadius) };
  }

  const extents = computeBoxExtents();
  const boxRadius = extents.maxRadius;
  const shadowExtent = boxRadius * 2.2;

  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x73777a, 0.4);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.1);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.set(1024, 1024);
  directionalLight.shadow.bias = -0.0002;
  directionalLight.shadow.normalBias = 0.2;
  directionalLight.shadow.radius = 1.5;
  directionalLight.shadow.camera.left = -shadowExtent;
  directionalLight.shadow.camera.right = shadowExtent;
  directionalLight.shadow.camera.top = shadowExtent;
  directionalLight.shadow.camera.bottom = -shadowExtent;
  directionalLight.shadow.camera.near = 1;
  directionalLight.shadow.camera.far = shadowExtent * 3;
  directionalLight.shadow.camera.updateProjectionMatrix();
  scene.add(hemisphereLight, directionalLight);

  const lightAzimuthEl = document.getElementById('lightAzimuth');
  const lightAzimuthValue = document.getElementById('lightAzimuthValue');
  const lightElevationEl = document.getElementById('lightElevation');
  const lightElevationValue = document.getElementById('lightElevationValue');
  const lightIntensityEl = document.getElementById('lightIntensity');
  const lightIntensityValue = document.getElementById('lightIntensityValue');
  const shadowBlurEl = document.getElementById('shadowBlur');
  const shadowBlurValue = document.getElementById('shadowBlurValue');
  const shadowIntensityEl = document.getElementById('shadowIntensity');
  const shadowIntensityValue = document.getElementById('shadowIntensityValue');

  let lightAzimuth = 63;
  let lightElevation = 48;
  let shadowIntensity = 0.25;

  const groundMaterial = new THREE.ShadowMaterial({ color: 0x1d2428, opacity: 0.25 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function createContactShadow() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(15, 20, 24, 1)');
    gradient.addColorStop(0.35, 'rgba(15, 20, 24, 0.55)');
    gradient.addColorStop(1, 'rgba(15, 20, 24, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 1 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = -1;
    scene.add(mesh);
    return mesh;
  }
  const contactShadow = createContactShadow();

  function applyShadowIntensity() {
    groundMaterial.opacity = shadowIntensity;
    contactShadow.material.opacity = Math.min(1, shadowIntensity * 1.4);
  }

  function applyGroundLayout() {
    ground.scale.set(shadowExtent, shadowExtent, 1);
    ground.position.y = extents.minY - 0.02;
    contactShadow.scale.set(shadowExtent * 0.64, shadowExtent * 0.64, 1);
    contactShadow.position.y = extents.minY - 0.01;
  }
  applyGroundLayout();
  applyShadowIntensity();

  function applyLightDirection() {
    const elevation = lightElevation * Math.PI / 180;
    const azimuth = lightAzimuth * Math.PI / 180;
    directionalLight.position.set(
      Math.sin(elevation) * Math.cos(azimuth),
      Math.cos(elevation),
      Math.sin(elevation) * Math.sin(azimuth),
    );
    directionalLight.updateMatrixWorld();
  }
  applyLightDirection();

  function syncLightControls() {
    lightAzimuthValue.textContent = Math.round(lightAzimuth) + '°';
    lightElevationValue.textContent = Math.round(lightElevation) + '°';
    lightIntensityValue.textContent = directionalLight.intensity.toFixed(1);
    shadowBlurValue.textContent = directionalLight.shadow.radius.toFixed(1);
  }
  lightAzimuthEl.addEventListener('input', () => {
    lightAzimuth = Number(lightAzimuthEl.value);
    applyLightDirection();
    syncLightControls();
  });
  lightElevationEl.addEventListener('input', () => {
    lightElevation = Number(lightElevationEl.value);
    applyLightDirection();
    syncLightControls();
  });
  lightIntensityEl.addEventListener('input', () => {
    directionalLight.intensity = Number(lightIntensityEl.value);
    syncLightControls();
  });
  shadowBlurEl.addEventListener('input', () => {
    directionalLight.shadow.radius = Number(shadowBlurEl.value);
    renderer.shadowMap.needsUpdate = true;
    syncLightControls();
  });
  syncLightControls();

  shadowIntensityEl.addEventListener('input', () => {
    shadowIntensity = Number(shadowIntensityEl.value);
    applyShadowIntensity();
    shadowIntensityValue.textContent = shadowIntensity.toFixed(2);
  });

  radius = boxRadius * 2.4;
  let radiusMin = boxRadius * 0.4;
  let radiusMax = boxRadius * 20;

  function computeTransforms(progress) {
    const transforms = new Map();
    function visit(id, parentFrame) {
      const node = nodes.get(id);
      let frame;
      if (!node.parentId) {
        frame = parentFrame.clone();
      } else {
        const axis = new THREE.Vector3(node.axis[0], node.axis[1], node.axis[2]);
        const rotation = new THREE.Matrix4().makeRotationAxis(axis, node.targetAngle * progress);
        frame = parentFrame.clone()
          .multiply(new THREE.Matrix4().makeTranslation(node.parentOffset[0], node.parentOffset[1], node.parentOffset[2]))
          .multiply(rotation)
          .multiply(new THREE.Matrix4().makeTranslation(node.centerOffset[0], node.centerOffset[1], node.centerOffset[2]));
      }
      transforms.set(id, frame);
      node.children.forEach((childId) => visit(childId, frame));
    }
    visit(DATA.rootId, new THREE.Matrix4());
    return transforms;
  }

  function rebuildCamera() {
    const aspect = canvas.clientWidth / canvas.clientHeight || 1;
    if (projection === 'orthographic') {
      camera = new THREE.OrthographicCamera(-radius, radius, radius / aspect, -radius / aspect, 0.1, 100000);
    } else {
      camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100000);
    }
    camera.position.set(radius, radius * 0.7, radius);
    camera.lookAt(target);
  }

  function setupRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.85;

    const environment = new RoomEnvironment();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(environment, 0.04).texture;
    scene.environmentIntensity = 0.65;
    pmremGenerator.dispose();
    environment.dispose();
  }

  function applyProgress(progress) {
    foldProgress = Math.min(1, Math.max(0, progress));
    foldSlider.value = String(foldProgress);
    foldValue.textContent = Math.round(foldProgress * 100) + '%';
    foldSlider.style.setProperty('--slider-progress', (foldProgress * 100) + '%');
  }

  function animate() {
    const transforms = computeTransforms(foldProgress);
    for (const [id, pair] of meshes) {
      const matrix = transforms.get(id);
      pair[0].matrix.copy(matrix);
      pair[1].matrix.copy(matrix);
    }

    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(target);
    renderer.render(scene, camera);
  }

  function loop() {
    animationFrame = requestAnimationFrame(loop);
    animate();
  }

  function animateFold(destination) {
    cancelAnimationFrame(animationFrame);
    const start = foldProgress;
    const duration = 400;
    const startTime = performance.now();
    const ease = (value) => (value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2);
    const tick = (now) => {
      const elapsed = Math.min(1, (now - startTime) / duration);
      applyProgress(start + (destination - start) * ease(elapsed));
      if (elapsed < 1) animationFrame = requestAnimationFrame(tick);
      else loop();
    };
    animationFrame = requestAnimationFrame(tick);
  }

  let dragMode = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 1 || event.button === 2 || event.shiftKey) dragMode = 'pan';
    else dragMode = 'orbit';
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragMode) return;
    if (dragMode === 'orbit') {
      theta -= event.movementX * 0.008;
      phi = Math.max(0.08, Math.min(Math.PI - 0.08, phi - event.movementY * 0.008));
    } else {
      const factor = radius * 0.0016;
      target.x -= event.movementX * factor;
      target.y += event.movementY * factor;
    }
  });
  canvas.addEventListener('pointerup', () => { dragMode = null; });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    radius *= Math.exp(event.deltaY * 0.001);
    radius = Math.max(radiusMin, Math.min(radiusMax, radius));
    if (projection === 'orthographic') rebuildCamera();
  }, { passive: false });

  foldSlider.addEventListener('input', () => {
    applyProgress(Number(foldSlider.value));
  });
  openButton.addEventListener('click', () => animateFold(0));
  closeButton.addEventListener('click', () => animateFold(1));
  resetButton.addEventListener('click', () => {
    theta = 0.65;
    phi = 1.15;
    target.set(0, 0, 0);
    radius = boxRadius * 2.4;
    rebuildCamera();
  });
  cameraToggle.addEventListener('click', () => {
    projection = projection === 'perspective' ? 'orthographic' : 'perspective';
    cameraToggle.textContent = 'Camera: ' + projection;
    rebuildCamera();
  });

  window.addEventListener('resize', () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    rebuildCamera();
  });

  setupRenderer();
  rebuildCamera();
  applyProgress(1);
  loop();
`;

function escapeScriptClosing(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

function toBase64(source) {
  return btoa(unescape(encodeURIComponent(source)));
}

function inlineThreeModule(moduleSource, coreSource) {
  const coreUrl = `data:text/javascript;base64,${toBase64(coreSource)}`;
  return moduleSource.replaceAll('from"./three.core.min.js"', `from"${coreUrl}"`);
}

function inlineRoomEnvironment(source) {
  const prologue = 'const { BackSide, BoxGeometry, InstancedMesh, Mesh, MeshLambertMaterial, MeshStandardMaterial, PointLight, Scene, Object3D } = THREE;\n';
  return source
    .replace(/import \{[\s\S]*?\} from 'three';/, prologue)
    .replace(/export \{ RoomEnvironment \};/, '');
}

async function canvasToDataUrl(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  return canvas.toDataURL('image/png');
}

export async function createInteractive3dHtml({
  boxModel,
  artworks,
  documentRef = globalThis.document,
  composeTexture = composeArtworkTexture,
} = {}) {
  const entries = (artworks || [])
    .filter((entry) => entry?.model?.hasArtwork && entry.visible !== false && entry.previewBlob);
  if (!entries.length) {
    throw new Error('Artwork preview is required for the 3D export.');
  }
  const graph = buildFoldGraph(boxModel);
  const bounds = boxModel.getBounds();
  const nodes = [];
  for (const node of graph.nodes.values()) {
    nodes.push({
      id: node.id,
      name: node.panel.faceName,
      width: node.panel.width,
      height: node.panel.height,
      rect: { x: node.panel.x, y: node.panel.y },
      parentId: node.parentId,
      parentEdge: node.parentEdge,
      axis: node.axis,
      targetAngle: node.targetAngle,
      parentOffset: node.parentOffset,
      centerOffset: node.centerOffset,
      children: node.children,
    });
  }

  const composed = await composeTexture({ boxModel, artworks: entries, documentRef });
  const textureUrl = await canvasToDataUrl(composed.canvas);

  const data = {
    rootId: graph.rootId,
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      width: bounds.width,
      height: bounds.height,
      depth: boxModel.dimensions?.depth || 0,
    },
    nodes,
    texture: textureUrl,
  };

  const threeModuleDataUrl = `data:text/javascript;base64,${toBase64(inlineThreeModule(threeModuleSource, threeCoreSource))}`;
  const viewer = VIEWER_SCRIPT.replace('__DATA__', JSON.stringify(data));
  const roomEnvironment = inlineRoomEnvironment(roomEnvironmentSource);
  const moduleScript = `import * as THREE from '${threeModuleDataUrl}';\n${roomEnvironment}\n${viewer}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CartonBuilder — folded box</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; font-family: Arial, Helvetica, sans-serif; background: #e8e8e8; color: #e8eaed; }
  #viewer { position: fixed; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; background: #e8e8e8; }
  #panel { position: fixed; top: 12px; left: 12px; padding: 10px 12px; background: rgb(20 22 25 / 85%); border: 1px solid #3a3f46; border-radius: 8px; font-size: 13px; display: grid; gap: 8px; min-width: 200px; user-select: none; }
  #panel h1 { margin: 0; font-size: 13px; font-weight: 600; }
  #bgRow { display: flex; align-items: center; gap: 8px; }
  #bgRow input[type="color"] {
    width: 26px;
    height: 20px;
    padding: 0;
    border: 1px solid #4a5058;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
  }
  #lightRow { display: grid; gap: 6px; }
  #lightRow label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  #lightRow input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    height: 6px;
    margin: 0;
    padding: 0;
    border-radius: 999px;
    background: linear-gradient(to right, #afca42 0%, #afca42 var(--slider-progress, 100%), #4a4a4a var(--slider-progress, 100%), #4a4a4a 100%);
    outline: none;
    cursor: pointer;
  }
  #lightRow input[type="range"]::-webkit-slider-runnable-track {
    width: 100%;
    height: 6px;
    border: none;
    border-radius: 999px;
    background: transparent;
  }
  #lightRow input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -3px;
    border: 2px solid #3e3e3e;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
    cursor: pointer;
  }
  #lightRow input[type="range"]:hover::-webkit-slider-thumb {
    background: #afca42;
  }
  #lightRow input[type="range"]::-moz-range-track {
    width: 100%;
    height: 6px;
    border: none;
    border-radius: 999px;
    background: transparent;
  }
  #lightRow input[type="range"]::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 2px solid #3e3e3e;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
    cursor: pointer;
  }
  #lightRow input[type="range"]:hover::-moz-range-thumb {
    background: #afca42;
  }
  #lightRow output {
    min-width: 34px;
    color: #e8e8e8;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  #foldRow { display: flex; align-items: center; gap: 8px; }
  #foldRow input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    height: 6px;
    margin: 0;
    padding: 0;
    border-radius: 999px;
    background: linear-gradient(to right, #afca42 0%, #afca42 var(--slider-progress, 100%), #4a4a4a var(--slider-progress, 100%), #4a4a4a 100%);
    outline: none;
    cursor: pointer;
  }
  #foldRow input[type="range"]::-webkit-slider-runnable-track {
    width: 100%;
    height: 6px;
    border: none;
    border-radius: 999px;
    background: transparent;
  }
  #foldRow input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -4px;
    border: 2px solid #3e3e3e;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
    cursor: pointer;
  }
  #foldRow input[type="range"]:hover::-webkit-slider-thumb {
    background: #afca42;
  }
  #foldRow input[type="range"]::-moz-range-track {
    width: 100%;
    height: 6px;
    border: none;
    border-radius: 999px;
    background: transparent;
  }
  #foldRow input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: 2px solid #3e3e3e;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
    cursor: pointer;
  }
  #foldRow input[type="range"]:hover::-moz-range-thumb {
    background: #afca42;
  }
  #buttons { display: flex; gap: 6px; flex-wrap: wrap; }
  button { font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid #4a5058; border-radius: 6px; background: #2c3138; color: inherit; cursor: pointer; }
  button:hover { background: #383e46; }
  #hint { position: fixed; bottom: 12px; left: 12px; padding: 4px 10px; border-radius: 6px; background: rgb(20 22 25 / 70%); color: #d0d4d8; font-size: 11px; }
</style>
</head>
<body>
<canvas id="viewer"></canvas>
<div id="panel">
  <h1>CartonBuilder — folded box</h1>
  <div id="foldRow">
    <label for="fold">Fold</label>
    <input id="fold" type="range" min="0" max="1" step="0.01" value="1">
    <output id="foldValue">100%</output>
  </div>
  <div id="buttons">
    <button id="open" type="button">Open</button>
    <button id="close" type="button">Fold</button>
    <button id="reset" type="button">Reset view</button>
    <button id="camera" type="button">Camera: perspective</button>
  </div>
  <div id="bgRow">
    <label for="bgColor">Background</label>
    <input id="bgColor" type="color" value="#e8e8e8">
  </div>
  <div id="lightRow">
    <label>Azimuth <input id="lightAzimuth" type="range" min="0" max="360" step="1" value="63"><output id="lightAzimuthValue">63°</output></label>
    <label>Elevation <input id="lightElevation" type="range" min="5" max="85" step="1" value="48"><output id="lightElevationValue">48°</output></label>
    <label>Light <input id="lightIntensity" type="range" min="0" max="5" step="0.05" value="1.1"><output id="lightIntensityValue">1.1</output></label>
    <label>Shadow blur <input id="shadowBlur" type="range" min="0" max="8" step="0.1" value="1.5"><output id="shadowBlurValue">1.5</output></label>
    <label>Shadow intensity <input id="shadowIntensity" type="range" min="0" max="1" step="0.01" value="0.25"><output id="shadowIntensityValue">0.25</output></label>
  </div>
</div>
<div id="hint">Drag to orbit · wheel to zoom · right-drag to pan</div>
<script type="module">
${escapeScriptClosing(moduleScript)}
</script>
</body>
</html>`;

  return new Blob([html], { type: 'text/html;charset=utf-8' });
}
