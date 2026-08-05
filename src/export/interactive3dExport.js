import threeCoreSource from '../../node_modules/three/build/three.core.min.js?raw';
import threeModuleSource from '../../node_modules/three/build/three.module.min.js?raw';
import roomEnvironmentSource from '../../node_modules/three/examples/jsm/environments/RoomEnvironment.js?raw';

import { HTML_EXPORT_QUALITY_OPTIONS } from '../render/RenderSettings.js';
import { buildFoldGraph } from '../preview3d/foldGraph.js';
import {
  composeArtworkTexture,
  HTML_TEXTURE_LIMITS,
} from '../preview3d/textureComposer.js';

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
  const panelEl = document.getElementById('panel');
  const panelToggle = document.getElementById('panelToggle');
  const autoRotateBtn = document.getElementById('autoRotate');

  const nodes = new Map(DATA.nodes.map((node) => [node.id, node]));

  let foldProgress = 1;
  let animationFrame = null;
  let videoAudioController = null;
  let autoRotateEnabled = true;
  let lastRotateTime = 0;

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
  let theta = 0;
  let phi = Math.PI / 2;
  const target = new THREE.Vector3(0, 0, 0);

  let texture;
  let videoTextureFrame = null;
  let videoLoopVideo = null;

  function stopVideoTextureLoop() {
    if (videoTextureFrame != null) {
      if (videoLoopVideo && typeof videoLoopVideo.cancelVideoFrameCallback === 'function') {
        videoLoopVideo.cancelVideoFrameCallback(videoTextureFrame);
      } else {
        cancelAnimationFrame(videoTextureFrame);
      }
      videoTextureFrame = null;
    }
    videoLoopVideo = null;
  }

  function drawVideoFrames(ctx, videos, baseImage, ppm, bb) {
    ctx.drawImage(baseImage, 0, 0);
    for (const item of videos) {
      const artwork = item.artwork;
      const video = item.video;
      if (!artwork || !video.videoWidth) continue;
      const uw = artwork.initialWidthMm * artwork.scaleX;
      const uh = artwork.initialHeightMm * artwork.scaleY;
      ctx.save();
      ctx.scale(ppm, ppm);
      ctx.translate(-bb.minX, -bb.minY);
      ctx.globalAlpha = artwork.opacity;
      ctx.translate(artwork.centerXmm, artwork.centerYmm);
      ctx.rotate(artwork.rotation * Math.PI / 180);
      ctx.scale(artwork.flipX ? -1 : 1, artwork.flipY ? -1 : 1);
      if (artwork.crop && artwork.crop.width > 0 && artwork.crop.height > 0) {
        ctx.beginPath();
        ctx.rect(
          -uw / 2 + (artwork.crop.x || 0),
          -uh / 2 + (artwork.crop.y || 0),
          artwork.crop.width,
          artwork.crop.height,
        );
        ctx.clip();
      }
      try {
        ctx.drawImage(video, -uw / 2, -uh / 2, uw, uh);
      } catch { /* frame not ready */ }
      ctx.restore();
    }
    if (texture) texture.needsUpdate = true;
  }

  if (DATA.videos && DATA.videos.length) {
    // Composite every video frame onto the composed base texture so each
    // artwork keeps its exact placement (position, rotation, scale, crop).
    const cw = DATA.textureSize.width;
    const ch = DATA.textureSize.height;
    const composeCanvas = document.createElement('canvas');
    composeCanvas.width = cw;
    composeCanvas.height = ch;
    const ctx = composeCanvas.getContext('2d', { willReadFrequently: false });

    const baseImage = new Image();
    baseImage.src = DATA.texture;
    const ppm = DATA.pixelsPerMm || 1;
    const bb = DATA.bounds;

    const videos = DATA.videos.map((item) => {
      const video = document.createElement('video');
      video.src = item.videoData;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.preload = 'auto';
      return { video, artwork: item.artwork || null };
    });

    let videoAudioSourceIndex = null;

    function panelIdForVideo(item) {
      const a = item.artwork;
      if (!a) return null;
      const halfW = Math.abs(a.initialWidthMm * a.scaleX) / 2;
      const halfH = Math.abs(a.initialHeightMm * a.scaleY) / 2;
      const minX = a.centerXmm - halfW;
      const maxX = a.centerXmm + halfW;
      const minY = a.centerYmm - halfH;
      const maxY = a.centerYmm + halfH;
      let best = null;
      let bestOverlap = 0;
      for (const node of DATA.nodes) {
        const r = node.rect;
        const overlapX = Math.max(0, Math.min(maxX, r.x + node.width) - Math.max(minX, r.x));
        const overlapY = Math.max(0, Math.min(maxY, r.y + node.height) - Math.max(minY, r.y));
        const overlap = overlapX * overlapY;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = node.id;
        }
      }
      return best;
    }

    function startLoop() {
      stopVideoTextureLoop();
      const active = videoAudioSourceIndex != null ? videos[videoAudioSourceIndex] : null;
      if (!active) {
        // No active video: render a single static frame and stop.
        drawVideoFrames(ctx, videos, baseImage, ppm, bb);
        return;
      }
      const driver = active.video;
      if (typeof driver.requestVideoFrameCallback === 'function') {
        videoLoopVideo = driver;
        const onVideoFrame = () => {
          drawVideoFrames(ctx, videos, baseImage, ppm, bb);
          if (videoAudioSourceIndex != null) {
            videoTextureFrame = driver.requestVideoFrameCallback(onVideoFrame);
          }
        };
        videoTextureFrame = driver.requestVideoFrameCallback(onVideoFrame);
      } else {
        const tick = () => {
          drawVideoFrames(ctx, videos, baseImage, ppm, bb);
          if (videoAudioSourceIndex != null) {
            videoTextureFrame = requestAnimationFrame(tick);
          }
        };
        videoTextureFrame = requestAnimationFrame(tick);
      }
    }

    // All videos play together (synchronised), but only the sound source has
    // audio. When no sound source is set, every video is paused and muted.
    function applyVideoState() {
      const playing = videoAudioSourceIndex != null;
      for (let i = 0; i < videos.length; i++) {
        videos[i].video.muted = i !== videoAudioSourceIndex;
        if (playing) videos[i].video.play().catch(() => {});
        else videos[i].video.pause();
      }
      startLoop();
    }

    // Clicking a panel with a video starts playback on every panel (sound on
    // the clicked one); clicking the sound panel again stops everything;
    // clicking another panel moves the sound there while videos keep playing.
    function setVideoAudioForPanel(panelId) {
      const index = videos.findIndex((item) => panelIdForVideo(item) === panelId);
      if (index === -1) return;
      videoAudioSourceIndex = index === videoAudioSourceIndex ? null : index;
      applyVideoState();
    }

    videoAudioController = {
      setPanel: setVideoAudioForPanel,
    };

    baseImage.onload = () => {
      // Videos start stopped (paused, muted). A panel click starts them.
      applyVideoState();
    };
    baseImage.onerror = () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      applyVideoState();
    };

    const hintEl = document.getElementById('hint');
    if (hintEl) hintEl.textContent += ' · click a side to play its video';

    texture = new THREE.CanvasTexture(composeCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
  } else {
    const textureImage = new Image();
    textureImage.src = DATA.texture;
    texture = new THREE.Texture(textureImage);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    textureImage.onload = () => { texture.needsUpdate = true; };
    textureImage.onerror = () => { console.error('texture failed to load'); };
  }

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
    exterior.userData.panelId = node.id;
    const interior = new THREE.Mesh(geometry, backMaterial);
    interior.matrixAutoUpdate = false;
    scene.add(exterior, interior);
    meshes.set(node.id, [exterior, interior]);
  }

  DATA.nodes.forEach(buildPanelObjects);

  function computeBoxExtents() {
    const transforms = computeTransforms(1);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxRadius = 0;
    const corner = new THREE.Vector3();
    for (const node of DATA.nodes) {
      const matrix = transforms.get(node.id);
      if (!matrix) continue;
      const hw = node.width / 2;
      const hh = node.height / 2;
      for (const point of [[-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0]]) {
        corner.set(point[0], point[1], point[2]).applyMatrix4(matrix);
        if (corner.x < minX) minX = corner.x;
        if (corner.x > maxX) maxX = corner.x;
        if (corner.y < minY) minY = corner.y;
        if (corner.y > maxY) maxY = corner.y;
        if (corner.z < minZ) minZ = corner.z;
        if (corner.z > maxZ) maxZ = corner.z;
        const radial = Math.hypot(corner.x, corner.z);
        if (radial > maxRadius) maxRadius = radial;
      }
    }
    return {
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      centerZ: (minZ + maxZ) / 2,
      minY,
      maxY,
      maxRadius: Math.max(1, maxRadius),
    };
  }

  const extents = computeBoxExtents();
  target.set(extents.centerX, extents.centerY, extents.centerZ);
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
    renderer.shadowMap.type = THREE.PCFShadowMap;
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

    if (autoRotateEnabled) {
      const now = performance.now();
      const delta = lastRotateTime ? (now - lastRotateTime) / 1000 : 0;
      lastRotateTime = now;
      theta += delta * 0.6;
    } else {
      lastRotateTime = 0;
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
  let downX = 0;
  let downY = 0;
  let dragged = false;
  canvas.addEventListener('pointerdown', (event) => {
    downX = event.clientX;
    downY = event.clientY;
    dragged = false;
    if (event.button === 1 || event.button === 2 || event.shiftKey) dragMode = 'pan';
    else dragMode = 'orbit';
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragMode) return;
    if (Math.abs(event.clientX - downX) > 4 || Math.abs(event.clientY - downY) > 4) dragged = true;
    if (dragMode === 'orbit') {
      theta -= event.movementX * 0.008;
      phi = Math.max(0.08, Math.min(Math.PI - 0.08, phi - event.movementY * 0.008));
    } else {
      const factor = radius * 0.0016;
      target.x -= event.movementX * factor;
      target.y += event.movementY * factor;
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!dragged && videoAudioController) {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      const pointerVec = new THREE.Vector2(ndcX, ndcY);
      raycaster.setFromCamera(pointerVec, camera);
      const pickable = [];
      for (const pair of meshes.values()) pickable.push(pair[0]);
      const hits = raycaster.intersectObjects(pickable, false);
      if (hits.length && hits[0].object.userData.panelId) {
        videoAudioController.setPanel(hits[0].object.userData.panelId);
      }
    }
    dragMode = null;
  });
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
    theta = 0;
    phi = Math.PI / 2;
    target.set(extents.centerX, extents.centerY, extents.centerZ);
    radius = boxRadius * 2.4;
    rebuildCamera();
  });
  panelToggle.addEventListener('click', () => {
    panelEl.hidden = !panelEl.hidden;
  });
  autoRotateBtn.addEventListener('click', () => {
    autoRotateEnabled = !autoRotateEnabled;
    autoRotateBtn.textContent = autoRotateEnabled ? 'Auto-rotate: On' : 'Auto-rotate: Off';
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
  htmlQuality = 'auto',
  documentRef = globalThis.document,
  composeTexture = composeArtworkTexture,
} = {}) {
  const entries = (artworks || [])
    .filter((entry) => (
      entry?.model?.hasArtwork
      && entry.visible !== false
      && (entry.previewBlob || entry.originalBlob)
    ));
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

  const quality = HTML_EXPORT_QUALITY_OPTIONS.includes(Number(htmlQuality))
    ? Number(htmlQuality)
    : 'auto';
  const renderQuality = entries
    .map((entry) => Number(entry.model?.quality?.render))
    .filter((value) => Number.isFinite(value) && value > 0);
  const targetDpi = quality === 'auto'
    ? Math.max(600, renderQuality.length ? Math.max(...renderQuality) : 0)
    : quality;
  const composed = await composeTexture({
    boxModel,
    artworks: entries,
    documentRef,
    purpose: 'render-export',
    targetDpi,
    textureLimits: HTML_TEXTURE_LIMITS,
    useNativeSourceResolution: true,
    getEntryTargetDpi: () => targetDpi,
  });
  const textureUrl = await canvasToDataUrl(composed.canvas);

  const videos = [];
  const videoEntries = entries.filter((entry) => (
    entry.model?.source?.isVideo
    || entry.model?.source?.mimeType?.startsWith('video/')
    || entry.originalBlob?.type?.startsWith('video/')
  ));
  for (const videoEntry of videoEntries) {
    if (!videoEntry.originalBlob) continue;
    const videoData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(videoEntry.originalBlob);
    });
    const artwork = videoEntry.model;
    videos.push({
      videoData,
      artwork: {
        centerXmm: artwork.centerXmm,
        centerYmm: artwork.centerYmm,
        initialWidthMm: artwork.initialWidthMm,
        initialHeightMm: artwork.initialHeightMm,
        scaleX: artwork.scaleX,
        scaleY: artwork.scaleY,
        rotation: artwork.rotation,
        opacity: artwork.opacity,
        flipX: artwork.flipX,
        flipY: artwork.flipY,
        crop: artwork.crop ? { ...artwork.crop } : null,
      },
    });
  }

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
    textureSize: {
      width: composed.width,
      height: composed.height,
    },
    pixelsPerMm: composed.pixelsPerMm,
    ...(videos.length ? { videos } : {}),
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
  #panelToggle {
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 20;
    padding: 6px 12px;
    border: 1px solid #4a5058;
    border-radius: 6px;
    background: rgb(20 22 25 / 85%);
    color: inherit;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
  }
  #panelToggle:hover { background: #383e46; }
  #panel {
    position: fixed;
    top: 48px;
    left: 12px;
    padding: 10px 12px;
    background: rgb(20 22 25 / 85%);
    border: 1px solid #3a3f46;
    border-radius: 8px;
    font-size: 13px;
    display: grid;
    gap: 8px;
    min-width: 200px;
    user-select: none;
  }
  #panel[hidden] { display: none; }
  #bottomControls {
    position: fixed;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    gap: 8px;
  }
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
<button id="panelToggle" type="button">⚙ Controls</button>
<div id="bottomControls">
  <button id="autoRotate" type="button">Auto-rotate: On</button>
  <button id="reset" type="button">Reset view</button>
</div>
<div id="panel" hidden>
  <h1>CartonBuilder — folded box</h1>
  <div id="foldRow">
    <label for="fold">Fold</label>
    <input id="fold" type="range" min="0" max="1" step="0.01" value="1">
    <output id="foldValue">100%</output>
  </div>
  <div id="buttons">
    <button id="open" type="button">Open</button>
    <button id="close" type="button">Fold</button>
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
