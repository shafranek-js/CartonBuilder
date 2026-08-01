import threeCoreSource from '../../node_modules/three/build/three.core.min.js?raw';
import threeModuleSource from '../../node_modules/three/build/three.module.min.js?raw';

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

  const nodes = new Map(DATA.nodes.map((node) => [node.id, node]));

  let foldProgress = 1;
  let animationFrame = null;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x23262a);

  let projection = 'perspective';
  let camera;
  let renderer;

  const radiusBase = Math.max(DATA.bounds.width, DATA.bounds.height, DATA.bounds.depth || 1);
  let radius = radiusBase * 1.5;
  let theta = 0.65;
  let phi = 1.15;
  const target = new THREE.Vector3(0, 0, 0);

  const textureImage = new Image();
  textureImage.src = DATA.texture;
  const texture = new THREE.Texture(textureImage);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureImage.onload = () => { texture.needsUpdate = true; };

  const frontMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
  const backMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide });
  const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x14171a });
  const foldMaterial = new THREE.LineBasicMaterial({ color: 0x3157d5 });

  const meshes = new Map();
  const outlines = new Map();
  const foldLines = new Map();

  function buildPanelObjects(node) {
    const hw = node.width / 2;
    const hh = node.height / 2;
    const u0 = (node.rect.x - DATA.bounds.minX) / DATA.bounds.width;
    const u1 = (node.rect.x + node.width - DATA.bounds.minX) / DATA.bounds.width;
    const v0 = 1 - (node.rect.y - DATA.bounds.minY) / DATA.bounds.height;
    const v1 = 1 - (node.rect.y + node.height - DATA.bounds.minY) / DATA.bounds.height;

    const positions = new Float32Array([
      -hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0,
      -hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0,
    ]);
    const uvs = new Float32Array([
      u0, v1, u1, v1, u1, v0, u0, v0,
      u1, v1, u0, v1, u0, v0, u1, v0,
    ]);
    const indices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.addGroup(0, 6, 0);
    geometry.addGroup(6, 6, 1);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, [frontMaterial, backMaterial]);
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    meshes.set(node.id, mesh);

    const outlinePositions = new Float32Array([
      -hw, -hh, 0.02, hw, -hh, 0.02, hw, hh, 0.02, -hw, hh, 0.02,
      -hw, -hh, 0.02, hw, -hh, 0.02, hw, hh, 0.02, -hw, hh, 0.02,
    ]);
    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute('position', new THREE.BufferAttribute(outlinePositions, 3));
    outlineGeometry.setIndex([0, 1, 2, 3, 0, 4, 5, 6, 7, 4]);
    const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    outline.matrixAutoUpdate = false;
    scene.add(outline);
    outlines.set(node.id, outline);

    if (node.parentEdge) {
      let foldPositions;
      switch (node.parentEdge) {
        case 'top': foldPositions = [-hw, hh, 0.04, hw, hh, 0.04]; break;
        case 'right': foldPositions = [hw, hh, 0.04, hw, -hh, 0.04]; break;
        case 'bottom': foldPositions = [hw, -hh, 0.04, -hw, -hh, 0.04]; break;
        default: foldPositions = [-hw, -hh, 0.04, -hw, hh, 0.04]; break;
      }
      const foldGeometry = new THREE.BufferGeometry();
      foldGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(foldPositions), 3));
      const foldLine = new THREE.LineSegments(foldGeometry, foldMaterial);
      foldLine.matrixAutoUpdate = false;
      scene.add(foldLine);
      foldLines.set(node.id, foldLine);
    }
  }

  DATA.nodes.forEach(buildPanelObjects);

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
  }

  function applyProgress(progress) {
    foldProgress = Math.min(1, Math.max(0, progress));
    foldSlider.value = String(foldProgress);
    foldValue.textContent = Math.round(foldProgress * 100) + '%';
  }

  function animate() {
    const transforms = computeTransforms(foldProgress);
    for (const [id, mesh] of meshes) mesh.matrix.copy(transforms.get(id));
    for (const [id, outline] of outlines) outline.matrix.copy(transforms.get(id));
    for (const [id, line] of foldLines) line.matrix.copy(transforms.get(id));

    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.sin(theta),
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
    radius = Math.max(radiusBase * 0.2, Math.min(radiusBase * 20, radius));
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
    radius = radiusBase * 1.5;
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
  artwork,
  previewBlob,
  documentRef = globalThis.document,
  composeTexture = composeArtworkTexture,
} = {}) {
  if (!artwork?.hasArtwork || !previewBlob) {
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

  const composed = await composeTexture({ boxModel, artwork, previewBlob, documentRef });
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
  const moduleScript = `import * as THREE from '${threeModuleDataUrl}';\n${viewer}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CartonBuilder — folded box</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; font-family: Arial, Helvetica, sans-serif; background: #23262a; color: #e8eaed; }
  #viewer { position: fixed; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; }
  #panel { position: fixed; top: 12px; left: 12px; padding: 10px 12px; background: rgb(20 22 25 / 85%); border: 1px solid #3a3f46; border-radius: 8px; font-size: 13px; display: grid; gap: 8px; min-width: 190px; user-select: none; }
  #panel h1 { margin: 0; font-size: 13px; font-weight: 600; }
  #foldRow { display: flex; align-items: center; gap: 8px; }
  #foldRow input[type="range"] { flex: 1; }
  #buttons { display: flex; gap: 6px; flex-wrap: wrap; }
  button { font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid #4a5058; border-radius: 6px; background: #2c3138; color: inherit; cursor: pointer; }
  button:hover { background: #383e46; }
  #hint { position: fixed; bottom: 12px; left: 12px; color: #9aa3ad; font-size: 11px; }
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
</div>
<div id="hint">Drag to orbit · wheel to zoom · right-drag to pan</div>
<script type="module">
${escapeScriptClosing(moduleScript)}
</script>
</body>
</html>`;

  return new Blob([html], { type: 'text/html;charset=utf-8' });
}
