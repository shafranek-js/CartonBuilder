import threeCoreSource from '../../node_modules/three/build/three.core.min.js?raw';
import threeModuleSource from '../../node_modules/three/build/three.module.min.js?raw';
import roomEnvironmentSource from '../../node_modules/three/examples/jsm/environments/RoomEnvironment.js?raw';
import gltfLoaderSource from '../../node_modules/three/examples/jsm/loaders/GLTFLoader.js?raw';
import bufferGeometryUtilsSource from '../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js?raw';
import skeletonUtilsSource from '../../node_modules/three/examples/jsm/utils/SkeletonUtils.js?raw';
import { ShapeUtils, Vector2 } from 'three';

import { HTML_EXPORT_QUALITY_OPTIONS } from '../render/RenderSettings.js';
import { sanitizeBoardAppearance } from '../render/BoardAppearance.js';
import { buildFoldGraph } from '../preview3d/foldGraph.js';
import {
  composeArtworkTexture,
  HTML_TEXTURE_LIMITS,
} from '../preview3d/textureComposer.js';

const VIEWER_SCRIPT = `
  const DATA = JSON.parse(document.getElementById('embeddedViewerData').textContent || '{}');
  const PRESENTATION_ID = DATA.presentationId || 'carton-builder-export';
  const STORAGE_KEY = 'cartonBuilder.standalone.' + PRESENTATION_ID + '.v1';
  const DEFAULT_STATE = {
    locale: DATA.locale || 'en',
    modelId: 'carton',
    foldProgress: 1,
    projection: 'perspective',
    background: '#e8e8e8',
    autoRotate: true,
    rotationSpeed: 0.6,
    cameraDistance: 2.4,
    environmentIntensity: 0.65,
    environmentRotation: 0,
    backgroundIntensity: 1,
    backgroundBlur: 0,
    key: { enabled: true, color: '#ffffff', intensity: 1.1, azimuth: 63, elevation: 48 },
    fill: { enabled: true, color: '#ffffff', intensity: 0.4 },
    rim: { enabled: true, color: '#ffffff', intensity: 0.25, azimuth: 225, elevation: 55 },
    shadows: { enabled: true, opacity: 0.25, softness: 1.5 },
    exposure: 0.85,
    toneMapping: 'Neutral',
    music: { enabled: false, volume: 1 },
  };

  function mergeState(base, patch) {
    const next = { ...base, ...(patch || {}) };
    for (const key of ['key', 'fill', 'rim', 'shadows', 'music']) {
      next[key] = { ...base[key], ...(patch?.[key] || {}) };
    }
    next.foldProgress = Math.max(0, Math.min(1, Number(next.foldProgress) || 0));
    next.projection = next.projection === 'orthographic' ? 'orthographic' : 'perspective';
    next.background = /^#[0-9a-f]{6}$/i.test(next.background) ? next.background : base.background;
    next.autoRotate = next.autoRotate !== false;
    next.rotationSpeed = Math.max(0, Math.min(4, Number(next.rotationSpeed) || base.rotationSpeed));
    next.cameraDistance = Math.max(0.25, Math.min(10, Number(next.cameraDistance) || base.cameraDistance));
    next.environmentIntensity = Math.max(0, Math.min(5, Number(next.environmentIntensity) || 0));
    next.environmentRotation = Number(next.environmentRotation) || 0;
    next.backgroundIntensity = Math.max(0, Math.min(5, Number(next.backgroundIntensity) || 0));
    next.backgroundBlur = Math.max(0, Math.min(1, Number(next.backgroundBlur) || 0));
    next.exposure = Math.max(0, Math.min(5, Number(next.exposure) || base.exposure));
    next.toneMapping = ['Neutral', 'AgX', 'ACES', 'Reinhard'].includes(next.toneMapping) ? next.toneMapping : base.toneMapping;
    next.modelId = typeof next.modelId === 'string' ? next.modelId : base.modelId;
    for (const key of ['key', 'fill', 'rim']) {
      next[key].color = /^#[0-9a-f]{6}$/i.test(next[key].color) ? next[key].color : base[key].color;
      next[key].intensity = Math.max(0, Math.min(5, Number(next[key].intensity) || 0));
    }
    next.shadows.opacity = Math.max(0, Math.min(1, Number(next.shadows.opacity) || 0));
    next.shadows.softness = Math.max(0, Math.min(8, Number(next.shadows.softness) || 0));
    next.music.volume = Math.max(0, Math.min(1, Number(next.music.volume) || 0));
    return next;
  }

  let state = mergeState(DEFAULT_STATE, DATA.initialState);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.presentationId === PRESENTATION_ID) state = mergeState(state, saved.state);
  } catch { /* standalone files may not have storage access */ }

  function persistState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ presentationId: PRESENTATION_ID, state })); } catch { /* ignore */ }
  }

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
  const modelsButton = document.getElementById('modelsButton');
  const settingsButton = document.getElementById('settingsButton');
  const modelsPanel = document.getElementById('modelsPanel');
  const settingsPanel = document.getElementById('settingsPanel');
  const modelList = document.getElementById('modelList');
  const openGlbButton = document.getElementById('openGlbButton');
  const fileInput = document.getElementById('fileInput');
  const closeModelsButton = document.getElementById('closeModels');
  const statusEl = document.getElementById('status');
  const settingsExportButton = document.getElementById('exportSettings');
  const settingsImportButton = document.getElementById('importSettings');
  const settingsImportInput = document.getElementById('settingsImportInput');
  const standaloneButton = document.getElementById('exportStandalone');
  const fullscreenButton = document.getElementById('fullscreen');
  const resetLightingButton = document.getElementById('resetLighting');
  const rotationSpeedInput = document.getElementById('rotationSpeed');
  const rotationSpeedValue = document.getElementById('rotationSpeedValue');
  const cameraDistanceInput = document.getElementById('cameraDistance');
  const cameraDistanceValue = document.getElementById('cameraDistanceValue');
  const environmentIntensityInput = document.getElementById('environmentIntensity');
  const environmentIntensityValue = document.getElementById('environmentIntensityValue');
  const environmentRotationInput = document.getElementById('environmentRotation');
  const environmentRotationValue = document.getElementById('environmentRotationValue');
  const backgroundIntensityInput = document.getElementById('backgroundIntensity');
  const backgroundIntensityValue = document.getElementById('backgroundIntensityValue');
  const backgroundBlurInput = document.getElementById('backgroundBlur');
  const backgroundBlurValue = document.getElementById('backgroundBlurValue');
  const toneMappingInput = document.getElementById('toneMapping');
  const exposureInput = document.getElementById('exposure');
  const exposureValue = document.getElementById('exposureValue');
  const musicToggle = document.getElementById('musicToggle');
  const musicVolumeInput = document.getElementById('musicVolume');
  const musicVolumeValue = document.getElementById('musicVolumeValue');
  const keyColorInput = document.getElementById('keyColor');
  const keyEnabledInput = document.getElementById('keyEnabled');
  const keyIntensityInput = document.getElementById('keyIntensity');
  const keyIntensityValue = document.getElementById('keyIntensityValue');
  const fillIntensityInput = document.getElementById('fillIntensity');
  const fillIntensityValue = document.getElementById('fillIntensityValue');
  const fillColorInput = document.getElementById('fillColor');
  const fillEnabledInput = document.getElementById('fillEnabled');
  const rimIntensityInput = document.getElementById('rimIntensity');
  const rimIntensityValue = document.getElementById('rimIntensityValue');
  const rimColorInput = document.getElementById('rimColor');
  const rimEnabledInput = document.getElementById('rimEnabled');
  const shadowOpacityInput = document.getElementById('shadowOpacity');
  const shadowOpacityValue = document.getElementById('shadowOpacityValue');
  const shadowSoftnessInput = document.getElementById('shadowSoftness');
  const shadowSoftnessValue = document.getElementById('shadowSoftnessValue');
  const languageButtons = [...document.querySelectorAll('[data-language]')];

  const UI_COPY = {
    en: {
      brand: 'CartonBuilder · 3D Viewer', models: 'Models', settings: 'Settings', fullscreen: 'Fullscreen',
      controls: '⚙ Controls', autoRotateOn: 'Auto-rotate: On', autoRotateOff: 'Auto-rotate: Off', reset: 'Reset view',
      open: 'Open', fold: 'Fold', camera: 'Camera: ', background: 'Background', modelsTitle: 'Models',
      procedural: 'Procedural carton', embedded: 'Embedded carton GLB', openGlb: 'Open GLB', close: 'Close',
      presentation: 'Presentation settings', resetLighting: 'Reset lighting', exportSettings: 'Export settings',
      importSettings: 'Import settings', exportStandalone: 'Export standalone viewer', hint: 'Drag to orbit · wheel to zoom · right-drag to pan',
    },
    ru: {
      brand: 'CartonBuilder · 3D-просмотр', models: 'Модели', settings: 'Настройки', fullscreen: 'На весь экран',
      controls: '⚙ Управление', autoRotateOn: 'Автоповорот: вкл.', autoRotateOff: 'Автоповорот: выкл.', reset: 'Сбросить вид',
      open: 'Развернуть', fold: 'Свернуть', camera: 'Камера: ', background: 'Фон', modelsTitle: 'Модели',
      procedural: 'Процедурная коробка', embedded: 'Встроенная GLB-коробка', openGlb: 'Открыть GLB', close: 'Закрыть',
      presentation: 'Настройки презентации', resetLighting: 'Сбросить свет', exportSettings: 'Экспорт настроек',
      importSettings: 'Импорт настроек', exportStandalone: 'Экспорт standalone', hint: 'Тяните для вращения · колесо — масштаб · правая кнопка — панорамирование',
    },
  };

  function applyLocale() {
    const copy = UI_COPY[state.locale === 'ru' ? 'ru' : 'en'];
    const text = {
      brand: copy.brand, modelsButton: copy.models, settingsButton: copy.settings, fullscreen: copy.fullscreen,
      panelToggle: copy.controls, reset: copy.reset, open: copy.open, close: copy.fold,
      modelsTitle: copy.modelsTitle, proceduralModel: copy.procedural, embeddedModel: copy.embedded,
      openGlbButton: copy.openGlb, closeModels: copy.close, settingsTitle: copy.presentation,
      resetLighting: copy.resetLighting, exportSettings: copy.exportSettings, importSettings: copy.importSettings,
      exportStandalone: copy.exportStandalone, hint: copy.hint,
    };
    for (const [id, value] of Object.entries(text)) {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    }
    autoRotateBtn.textContent = autoRotateEnabled ? copy.autoRotateOn : copy.autoRotateOff;
    cameraToggle.textContent = copy.camera + projection;
    document.documentElement.lang = state.locale === 'ru' ? 'ru' : 'en';
  }

  const nodes = new Map(DATA.nodes.map((node) => [node.id, node]));

  let foldProgress = state.foldProgress;
  let animationFrame = null;
  let videoAudioController = null;
  let autoRotateEnabled = state.autoRotate;
  // Compatibility marker for older export consumers: autoRotateEnabled = true;
  let lastRotateTime = 0;

  const DEFAULT_BACKGROUND = state.background;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_BACKGROUND);

  function applyBackground(color) {
    scene.background = new THREE.Color(color);
    document.body.style.background = color;
    canvas.style.background = color;
  }

  bgColorInput.value = state.background;
  applyBackground(DEFAULT_BACKGROUND);
  bgColorInput.addEventListener('input', () => {
    state.background = bgColorInput.value;
    applyBackground(state.background);
    persistState();
  });

  let projection = state.projection;
  let camera;
  let renderer;

  let radius = 300;
  let theta = 0;
  let phi = Math.PI / 2;
  const target = new THREE.Vector3(0, 0, 0);

  let texture;
  let videoTextureFrame = null;
  let videoLoopVideo = null;
  let gltfRoot = null;
  let gltfLoader = null;
  let customModelData = DATA.models?.custom || null;
  let activeModelId = state.modelId === 'carton-glb' && DATA.models?.glb ? 'carton-glb' : 'carton';
  let musicElement = null;

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
    color: DATA.boardAppearance?.interiorColor || '#f4f2ec',
    side: THREE.FrontSide,
    roughness: 0.95,
    metalness: 0,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: DATA.boardAppearance?.edgeColor || '#c8c1b5',
    roughness: 0.9,
    metalness: 0,
  });

  const meshes = new Map();

  function setStatus(message, tone = 'ready') {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  }

  function setPanelVisibility(panel, visible) {
    if (!panel) return;
    panel.hidden = !visible;
  }

  function updateModelButtons() {
    modelList?.querySelectorAll('[data-model-id]').forEach((button) => {
      button.classList.toggle('active', button.dataset.modelId === activeModelId);
      button.setAttribute('aria-pressed', String(button.dataset.modelId === activeModelId));
      if (button.dataset.modelId === 'carton-glb') button.disabled = !DATA.models?.glb;
    });
    const procedural = activeModelId === 'carton';
    if (foldSlider) foldSlider.disabled = !procedural;
    if (openButton) openButton.disabled = !procedural;
    if (closeButton) closeButton.disabled = !procedural;
    if (foldSlider) foldSlider.title = procedural ? '' : 'Fold controls apply to the procedural carton model.';
  }

  function updateRange(input, value, output, suffix = '') {
    if (!input) return;
    input.value = String(value);
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 1;
    input.style.setProperty('--slider-progress', (((Number(value) - min) / (max - min)) * 100) + '%');
    if (output) output.textContent = String(value) + suffix;
  }

  function applyToneMapping() {
    if (!renderer) return;
    renderer.toneMapping = {
      Neutral: THREE.NeutralToneMapping,
      AgX: THREE.AgXToneMapping,
      ACES: THREE.ACESFilmicToneMapping,
      Reinhard: THREE.ReinhardToneMapping,
    }[state.toneMapping] || THREE.NeutralToneMapping;
    renderer.toneMappingExposure = state.exposure;
  }

  function buildPanelObjects(node) {
    if (Array.isArray(node.polygon) && node.polygon.length >= 3) {
      const cx = node.rect.x + node.width / 2;
      const cy = node.rect.y + node.height / 2;
      const local = node.polygon.map((point) => new THREE.Vector2(point.x - cx, cy - point.y));
      const triangles = THREE.ShapeUtils.triangulateShape(local, []);
      const half = Math.max(0, Number(DATA.caliperMm) || 0) / 2;
      const frontPositions = local.flatMap(({ x, y }) => [x, y, half]);
      const frontUvs = node.polygon.flatMap((point) => [
        (point.x - DATA.bounds.minX) / DATA.bounds.width,
        1 - (point.y - DATA.bounds.minY) / DATA.bounds.height,
      ]);
      const cap = new THREE.BufferGeometry();
      cap.setAttribute('position', new THREE.Float32BufferAttribute(frontPositions, 3));
      cap.setAttribute('uv', new THREE.Float32BufferAttribute(frontUvs, 2));
      cap.setIndex(triangles.flat()); cap.computeVertexNormals(); cap.computeBoundingSphere();
      const exterior = new THREE.Mesh(cap, frontMaterial);
      exterior.matrixAutoUpdate = false; exterior.castShadow = true; exterior.userData.panelId = node.id;
      const back = new THREE.BufferGeometry();
      back.setAttribute('position', new THREE.Float32BufferAttribute(local.flatMap(({ x, y }) => [x, y, -half]), 3));
      back.setIndex(triangles.flatMap(([a, b, c]) => [c, b, a])); back.computeVertexNormals(); back.computeBoundingSphere();
      const interior = new THREE.Mesh(back, backMaterial); interior.matrixAutoUpdate = false;
      const sidePositions = [];
      const sideIndices = [];
      for (let index = 0; index < local.length; index += 1) {
        const next = (index + 1) % local.length;
        const base = sidePositions.length / 3;
        const { x: ax, y: ay } = local[index]; const { x: bx, y: by } = local[next];
        sidePositions.push(ax, ay, half, bx, by, half, bx, by, -half, ax, ay, -half);
        sideIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const sidesGeometry = new THREE.BufferGeometry();
      sidesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sidePositions, 3));
      sidesGeometry.setIndex(sideIndices); sidesGeometry.computeVertexNormals(); sidesGeometry.computeBoundingSphere();
      const sides = new THREE.Mesh(sidesGeometry, edgeMaterial); sides.matrixAutoUpdate = false;
      scene.add(exterior, interior, sides); meshes.set(node.id, [exterior, interior, sides]);
      return;
    }
    const hw = node.width / 2;
    const hh = node.height / 2;
    const u0 = (node.rect.x - DATA.bounds.minX) / DATA.bounds.width;
    const u1 = (node.rect.x + node.width - DATA.bounds.minX) / DATA.bounds.width;
    const v0 = 1 - (node.rect.y - DATA.bounds.minY) / DATA.bounds.height;
    const v1 = 1 - (node.rect.y + node.height - DATA.bounds.minY) / DATA.bounds.height;

    const halfCaliper = Math.max(0, Number(DATA.caliperMm) || 0) / 2;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -hw, -hh, halfCaliper, hw, -hh, halfCaliper, hw, hh, halfCaliper, -hw, hh, halfCaliper,
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
    const interiorGeometry = new THREE.BufferGeometry();
    interiorGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -hw, -hh, -halfCaliper, hw, -hh, -halfCaliper, hw, hh, -halfCaliper, -hw, hh, -halfCaliper,
    ]), 3));
    interiorGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      u0, v1, u1, v1, u1, v0, u0, v0,
    ]), 2));
    interiorGeometry.setIndex([0, 3, 2, 0, 2, 1]);
    interiorGeometry.computeVertexNormals();
    interiorGeometry.computeBoundingSphere();
    const interior = new THREE.Mesh(interiorGeometry, backMaterial);
    interior.matrixAutoUpdate = false;
    const sideGeometry = new THREE.BufferGeometry();
    sideGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -hw, -hh, halfCaliper, hw, -hh, halfCaliper, hw, hh, halfCaliper, -hw, hh, halfCaliper,
      -hw, -hh, -halfCaliper, hw, -hh, -halfCaliper, hw, hh, -halfCaliper, -hw, hh, -halfCaliper,
    ]), 3));
    sideGeometry.setIndex([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
    sideGeometry.computeVertexNormals();
    sideGeometry.computeBoundingSphere();
    const sides = new THREE.Mesh(sideGeometry, edgeMaterial);
    sides.matrixAutoUpdate = false;
    scene.add(exterior, interior, sides);
    meshes.set(node.id, [exterior, interior, sides]);
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
      const points = Array.isArray(node.polygon)
        ? node.polygon.map((point) => [point.x - (node.rect.x + node.width / 2), (node.rect.y + node.height / 2) - point.y, 0])
        : [[-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0]];
      for (const point of points) {
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

  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x73777a, state.fill.enabled ? state.fill.intensity : 0);
  hemisphereLight.color.set(state.fill.color);
  const directionalLight = new THREE.DirectionalLight(state.key.color, state.key.enabled ? state.key.intensity : 0);
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
  const rimLight = new THREE.DirectionalLight(state.rim.color, state.rim.enabled ? state.rim.intensity : 0);
  scene.add(hemisphereLight, directionalLight, rimLight);

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

  let lightAzimuth = state.key.azimuth;
  let lightElevation = state.key.elevation;
  let shadowIntensity = state.shadows.opacity;

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
    const rimElevation = state.rim.elevation * Math.PI / 180;
    const rimAzimuth = state.rim.azimuth * Math.PI / 180;
    rimLight.position.set(
      Math.sin(rimElevation) * Math.cos(rimAzimuth),
      Math.cos(rimElevation),
      Math.sin(rimElevation) * Math.sin(rimAzimuth),
    );
    directionalLight.updateMatrixWorld();
    rimLight.updateMatrixWorld();
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
    state.key.azimuth = lightAzimuth;
    applyLightDirection();
    syncLightControls();
    persistState();
  });
  lightElevationEl.addEventListener('input', () => {
    lightElevation = Number(lightElevationEl.value);
    state.key.elevation = lightElevation;
    applyLightDirection();
    syncLightControls();
    persistState();
  });
  lightIntensityEl.addEventListener('input', () => {
    directionalLight.intensity = Number(lightIntensityEl.value);
    state.key.intensity = directionalLight.intensity;
    syncLightControls();
    persistState();
  });
  shadowBlurEl.addEventListener('input', () => {
    directionalLight.shadow.radius = Number(shadowBlurEl.value);
    state.shadows.softness = directionalLight.shadow.radius;
    renderer.shadowMap.needsUpdate = true;
    syncLightControls();
    persistState();
  });
  syncLightControls();

  shadowIntensityEl.addEventListener('input', () => {
    shadowIntensity = Number(shadowIntensityEl.value);
    state.shadows.opacity = shadowIntensity;
    applyShadowIntensity();
    shadowIntensityValue.textContent = shadowIntensity.toFixed(2);
    persistState();
  });

  function syncAdvancedControls() {
    updateRange(rotationSpeedInput, state.rotationSpeed.toFixed(2), rotationSpeedValue);
    updateRange(cameraDistanceInput, state.cameraDistance.toFixed(2), cameraDistanceValue);
    updateRange(environmentIntensityInput, state.environmentIntensity.toFixed(2), environmentIntensityValue);
    updateRange(environmentRotationInput, Math.round(state.environmentRotation), environmentRotationValue, '°');
    updateRange(backgroundIntensityInput, state.backgroundIntensity.toFixed(2), backgroundIntensityValue);
    updateRange(backgroundBlurInput, state.backgroundBlur.toFixed(2), backgroundBlurValue);
    updateRange(exposureInput, state.exposure.toFixed(2), exposureValue);
    updateRange(musicVolumeInput, state.music.volume.toFixed(2), musicVolumeValue);
    updateRange(keyIntensityInput, state.key.intensity.toFixed(2), keyIntensityValue);
    updateRange(fillIntensityInput, state.fill.intensity.toFixed(2), fillIntensityValue);
    updateRange(rimIntensityInput, state.rim.intensity.toFixed(2), rimIntensityValue);
    updateRange(shadowOpacityInput, state.shadows.opacity.toFixed(2), shadowOpacityValue);
    updateRange(shadowSoftnessInput, state.shadows.softness.toFixed(1), shadowSoftnessValue);
    if (toneMappingInput) toneMappingInput.value = state.toneMapping;
    if (musicToggle) musicToggle.checked = state.music.enabled;
    if (rotationSpeedInput) rotationSpeedInput.value = String(state.rotationSpeed);
    if (cameraDistanceInput) cameraDistanceInput.value = String(state.cameraDistance);
    if (environmentIntensityInput) environmentIntensityInput.value = String(state.environmentIntensity);
    if (environmentRotationInput) environmentRotationInput.value = String(state.environmentRotation);
    if (backgroundIntensityInput) backgroundIntensityInput.value = String(state.backgroundIntensity);
    if (backgroundBlurInput) backgroundBlurInput.value = String(state.backgroundBlur);
    if (exposureInput) exposureInput.value = String(state.exposure);
    if (musicVolumeInput) musicVolumeInput.value = String(state.music.volume);
    if (keyIntensityInput) keyIntensityInput.value = String(state.key.intensity);
    if (fillIntensityInput) fillIntensityInput.value = String(state.fill.intensity);
    if (rimIntensityInput) rimIntensityInput.value = String(state.rim.intensity);
    if (shadowOpacityInput) shadowOpacityInput.value = String(state.shadows.opacity);
    if (shadowSoftnessInput) shadowSoftnessInput.value = String(state.shadows.softness);
    if (keyColorInput) keyColorInput.value = state.key.color;
    if (fillColorInput) fillColorInput.value = state.fill.color;
    if (rimColorInput) rimColorInput.value = state.rim.color;
    if (keyEnabledInput) keyEnabledInput.checked = state.key.enabled;
    if (fillEnabledInput) fillEnabledInput.checked = state.fill.enabled;
    if (rimEnabledInput) rimEnabledInput.checked = state.rim.enabled;
  }

  function updateAdvancedLighting() {
    scene.environmentIntensity = state.environmentIntensity;
    scene.backgroundIntensity = state.backgroundIntensity;
    scene.backgroundBlurriness = state.backgroundBlur;
    if (scene.environmentRotation) scene.environmentRotation.y = state.environmentRotation * Math.PI / 180;
    directionalLight.color.set(state.key.color);
    directionalLight.intensity = state.key.enabled ? state.key.intensity : 0;
    hemisphereLight.color.set(state.fill.color);
    hemisphereLight.intensity = state.fill.enabled ? state.fill.intensity : 0;
    rimLight.color.set(state.rim.color);
    rimLight.intensity = state.rim.enabled ? state.rim.intensity : 0;
    directionalLight.shadow.radius = state.shadows.softness;
    applyShadowIntensity();
    applyToneMapping();
    applyLightDirection();
  }

  function bindAdvancedInput(input, callback) {
    input?.addEventListener('input', () => {
      callback(Number(input.value));
      updateAdvancedLighting();
      syncAdvancedControls();
      persistState();
    });
  }

  bindAdvancedInput(rotationSpeedInput, (value) => { state.rotationSpeed = value; });
  bindAdvancedInput(cameraDistanceInput, (value) => { state.cameraDistance = value; radius = boxRadius * state.cameraDistance; });
  bindAdvancedInput(environmentIntensityInput, (value) => { state.environmentIntensity = value; });
  bindAdvancedInput(environmentRotationInput, (value) => { state.environmentRotation = value; });
  bindAdvancedInput(backgroundIntensityInput, (value) => { state.backgroundIntensity = value; });
  bindAdvancedInput(backgroundBlurInput, (value) => { state.backgroundBlur = value; });
  bindAdvancedInput(exposureInput, (value) => { state.exposure = value; });
  bindAdvancedInput(musicVolumeInput, (value) => { state.music.volume = value; if (musicElement) musicElement.volume = value; });
  bindAdvancedInput(keyIntensityInput, (value) => { state.key.intensity = value; });
  bindAdvancedInput(fillIntensityInput, (value) => { state.fill.intensity = value; });
  bindAdvancedInput(rimIntensityInput, (value) => { state.rim.intensity = value; });
  bindAdvancedInput(shadowOpacityInput, (value) => { state.shadows.opacity = value; shadowIntensity = value; });
  bindAdvancedInput(shadowSoftnessInput, (value) => { state.shadows.softness = value; });
  keyColorInput?.addEventListener('input', () => { state.key.color = keyColorInput.value; updateAdvancedLighting(); persistState(); });
  fillColorInput?.addEventListener('input', () => { state.fill.color = fillColorInput.value; updateAdvancedLighting(); persistState(); });
  rimColorInput?.addEventListener('input', () => { state.rim.color = rimColorInput.value; updateAdvancedLighting(); persistState(); });
  keyEnabledInput?.addEventListener('change', () => { state.key.enabled = keyEnabledInput.checked; updateAdvancedLighting(); persistState(); });
  fillEnabledInput?.addEventListener('change', () => { state.fill.enabled = fillEnabledInput.checked; updateAdvancedLighting(); persistState(); });
  rimEnabledInput?.addEventListener('change', () => { state.rim.enabled = rimEnabledInput.checked; updateAdvancedLighting(); persistState(); });
  toneMappingInput?.addEventListener('change', () => {
    state.toneMapping = toneMappingInput.value;
    applyToneMapping();
    persistState();
  });
  musicToggle?.addEventListener('change', () => {
    state.music.enabled = musicToggle.checked;
    if (musicElement) {
      if (state.music.enabled) musicElement.play().catch(() => {});
      else musicElement.pause();
    }
    persistState();
  });

  syncAdvancedControls();

  radius = boxRadius * state.cameraDistance;
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
        const phase = Array.isArray(node.phase) ? node.phase : [0, 1];
        const staged = Math.min(1, Math.max(0, (progress - phase[0]) / Math.max(1e-6, phase[1] - phase[0])));
        frame = parentFrame.clone()
          .multiply(new THREE.Matrix4().makeTranslation(node.parentOffset[0], node.parentOffset[1], node.parentOffset[2] + (DATA.caliperMm || 0) / 2))
          .multiply(new THREE.Matrix4().makeRotationAxis(axis, node.targetAngle * staged))
          .multiply(new THREE.Matrix4().makeTranslation(node.centerOffset[0], node.centerOffset[1], node.centerOffset[2] - (DATA.caliperMm || 0) / 2));
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
    scene.environmentIntensity = state.environmentIntensity;
    scene.backgroundIntensity = state.backgroundIntensity;
    scene.backgroundBlurriness = state.backgroundBlur;
    pmremGenerator.dispose();
    environment.dispose();
    applyToneMapping();
    updateAdvancedLighting();
  }

  async function readDataUrl(dataUrl) {
    if (!dataUrl) return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const encoded = dataUrl.slice(comma + 1);
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function disposeGltf() {
    if (!gltfRoot) return;
    gltfRoot.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material) return;
        for (const value of Object.values(material)) value?.isTexture && value.dispose?.();
        material.dispose?.();
      });
    });
    scene.remove(gltfRoot);
    gltfRoot = null;
  }

  function fitGltfRoot(root) {
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    root.position.sub(center);
    target.set(0, 0, 0);
    const largest = Math.max(size.x, size.y, size.z, 1);
    radius = largest * 2.4;
    radiusMin = largest * 0.4;
    radiusMax = largest * 20;
    rebuildCamera();
  }

  async function loadGltfData(dataUrl, modelId = 'carton-glb') {
    if (!dataUrl) throw new Error('No GLB data is embedded in this export.');
    if (!gltfLoader) gltfLoader = new GLTFLoader();
    const buffer = await readDataUrl(dataUrl);
    if (!buffer) throw new Error('Embedded GLB data is invalid.');
    return new Promise((resolve, reject) => {
      gltfLoader.parse(buffer, '', (result) => {
        disposeGltf();
        gltfRoot = result.scene || result.scenes?.[0];
        if (!gltfRoot) {
          reject(new Error('GLB does not contain a scene.'));
          return;
        }
        gltfRoot.name = modelId;
        gltfRoot.scale.setScalar(1000);
        gltfRoot.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = true;
          object.receiveShadow = true;
        });
        scene.add(gltfRoot);
        fitGltfRoot(gltfRoot);
        resolve(gltfRoot);
      }, undefined, reject);
    });
  }

  async function activateModel(modelId) {
    try {
      if (modelId === 'carton') {
        activeModelId = 'carton';
        state.modelId = 'carton';
        disposeGltf();
        target.set(extents.centerX, extents.centerY, extents.centerZ);
        radius = boxRadius * state.cameraDistance;
        rebuildCamera();
        updateModelButtons();
        setStatus('Carton model ready');
        persistState();
        return;
      }
      const dataUrl = modelId === 'carton-glb' ? DATA.models?.glb : customModelData;
      await loadGltfData(dataUrl, modelId);
      activeModelId = modelId;
      state.modelId = modelId;
      updateModelButtons();
      setStatus(modelId === 'carton-glb' ? 'Embedded GLB model ready' : 'Custom GLB model ready');
      persistState();
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Could not load GLB model', 'error');
      await activateModel('carton');
    }
  }

  async function handleGlbFile(file) {
    if (!file) return;
    if (file.size > 128 * 1024 * 1024) {
      setStatus('GLB exceeds the 128 MB standalone limit', 'error');
      return;
    }
    if (!/\.glb$/i.test(file.name) && file.type !== 'model/gltf-binary') {
      setStatus('Choose a binary .glb file', 'error');
      return;
    }
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    customModelData = 'data:model/gltf-binary;base64,' + btoa(binary);
    if (modelList && !modelList.querySelector('[data-model-id="custom"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.modelId = 'custom';
      button.textContent = file.name;
      modelList.appendChild(button);
      button.addEventListener('click', () => activateModel('custom'));
    }
    await activateModel('custom');
  }

  function applyProgress(progress) {
    foldProgress = Math.min(1, Math.max(0, progress));
    state.foldProgress = foldProgress;
    foldSlider.value = String(foldProgress);
    foldValue.textContent = Math.round(foldProgress * 100) + '%';
    foldSlider.style.setProperty('--slider-progress', (foldProgress * 100) + '%');
  }

  function animate() {
    const transforms = computeTransforms(foldProgress);
    for (const [id, pair] of meshes) {
      const matrix = transforms.get(id);
      pair[0].visible = activeModelId === 'carton';
      pair[1].visible = activeModelId === 'carton';
      if (activeModelId === 'carton') {
        pair[0].matrix.copy(matrix);
        pair[1].matrix.copy(matrix);
      }
    }
    if (gltfRoot) gltfRoot.visible = activeModelId !== 'carton';

    if (autoRotateEnabled) {
      const now = performance.now();
      const delta = lastRotateTime ? (now - lastRotateTime) / 1000 : 0;
      lastRotateTime = now;
      theta += delta * state.rotationSpeed;
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
    persistState();
  });
  openButton.addEventListener('click', () => animateFold(0));
  closeButton.addEventListener('click', () => animateFold(1));
  resetButton.addEventListener('click', () => {
    theta = 0;
    phi = Math.PI / 2;
    target.set(extents.centerX, extents.centerY, extents.centerZ);
    radius = boxRadius * state.cameraDistance;
    rebuildCamera();
    persistState();
  });
  autoRotateBtn.addEventListener('click', () => {
    autoRotateEnabled = !autoRotateEnabled;
    state.autoRotate = autoRotateEnabled;
    autoRotateBtn.textContent = autoRotateEnabled ? 'Auto-rotate: On' : 'Auto-rotate: Off';
    persistState();
  });
  cameraToggle.addEventListener('click', () => {
    projection = projection === 'perspective' ? 'orthographic' : 'perspective';
    state.projection = projection;
    cameraToggle.textContent = 'Camera: ' + projection;
    rebuildCamera();
    persistState();
  });

  modelsButton?.addEventListener('click', () => {
    setPanelVisibility(modelsPanel, modelsPanel.hidden);
    setPanelVisibility(settingsPanel, false);
  });
  settingsButton?.addEventListener('click', () => {
    setPanelVisibility(settingsPanel, settingsPanel.hidden);
    setPanelVisibility(modelsPanel, false);
  });
  panelToggle.addEventListener('click', () => {
    setPanelVisibility(settingsPanel, settingsPanel.hidden);
    setPanelVisibility(modelsPanel, false);
  });
  closeModelsButton?.addEventListener('click', () => setPanelVisibility(modelsPanel, false));
  openGlbButton?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    try { await handleGlbFile(fileInput.files?.[0]); } catch (error) {
      console.error(error);
      setStatus(error.message || 'Could not read GLB file', 'error');
    } finally {
      fileInput.value = '';
    }
  });
  modelList?.querySelectorAll('[data-model-id]').forEach((button) => {
    button.addEventListener('click', () => activateModel(button.dataset.modelId));
  });
  fullscreenButton?.addEventListener('click', () => {
    const targetElement = document.documentElement;
    if (!document.fullscreenElement) targetElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  });
  resetLightingButton?.addEventListener('click', () => {
    state = mergeState(state, DEFAULT_STATE);
    lightAzimuth = state.key.azimuth;
    lightElevation = state.key.elevation;
    shadowIntensity = state.shadows.opacity;
    updateAdvancedLighting();
    syncLightControls();
    syncAdvancedControls();
    persistState();
  });
  settingsExportButton?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ presentationId: PRESENTATION_ID, state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'carton-' + PRESENTATION_ID + '-settings.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  settingsImportButton?.addEventListener('click', () => settingsImportInput?.click());
  settingsImportInput?.addEventListener('change', async () => {
    try {
      const file = settingsImportInput.files?.[0];
      if (!file) return;
      const imported = JSON.parse(await file.text());
      if (imported.presentationId && imported.presentationId !== PRESENTATION_ID) throw new Error('Settings belong to another presentation.');
      state = mergeState(state, imported.state || imported);
      foldProgress = state.foldProgress;
      projection = state.projection;
      autoRotateEnabled = state.autoRotate;
      applyProgress(foldProgress);
      updateAdvancedLighting();
      syncLightControls();
      syncAdvancedControls();
      updateModelButtons();
      persistState();
      setStatus('Settings imported');
    } catch (error) {
      setStatus(error.message || 'Could not import settings', 'error');
    } finally {
      settingsImportInput.value = '';
    }
  });
  languageButtons.forEach((button) => button.addEventListener('click', () => {
    state.locale = button.dataset.language;
    applyLocale();
    languageButtons.forEach((entry) => entry.classList.toggle('active', entry === button));
    persistState();
  }));

  standaloneButton?.addEventListener('click', () => {
    const dataScript = document.getElementById('embeddedViewerData');
    if (!dataScript) return;
    const nextData = {
      ...DATA,
      locale: state.locale,
      initialState: state,
      models: { ...(DATA.models || {}), custom: customModelData },
    };
    const serialized = JSON.stringify(nextData).replace(/</g, '\\u003c');
    const source = document.documentElement.outerHTML
      .replace(/(<script id="embeddedViewerData"[^>]*>)[\s\S]*?(<\/script>)/i, '$1' + serialized + '$2')
      .replace(/<html lang="[^"]*"/i, '<html lang="' + (state.locale === 'ru' ? 'ru' : 'en') + '"');
    const blob = new Blob(['<!doctype html>\\n', source], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'carton-' + PRESENTATION_ID + '-standalone.html';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Standalone viewer exported');
  });

  window.addEventListener('resize', () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    rebuildCamera();
  });

  setupRenderer();
  rebuildCamera();
  if (DATA.music) {
    musicElement = document.createElement('audio');
    musicElement.src = DATA.music.data;
    musicElement.loop = true;
    musicElement.volume = state.music.volume;
    musicElement.preload = 'auto';
    document.body.appendChild(musicElement);
  } else if (musicToggle) {
    musicToggle.disabled = true;
  }
  applyProgress(state.foldProgress);
  updateModelButtons();
  syncAdvancedControls();
  applyLocale();
  languageButtons.forEach((button) => button.classList.toggle('active', button.dataset.language === state.locale));
  if (activeModelId === 'carton-glb' && DATA.models?.glb) activateModel('carton-glb');
  setStatus('Ready');
  loop();
`;

function escapeScriptClosing(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

function trimNumber(value) {
  return String(Math.round(value * 10) / 10);
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

function inlineThreeAddon(source, threeUrl) {
  return source
    .replace(/from 'three';/g, `from '${threeUrl}';`)
    .replace(/from "three";/g, `from '${threeUrl}';`);
}

function inlineGltfLoader(source, threeUrl, bufferUtilsUrl, skeletonUtilsUrl) {
  return inlineThreeAddon(source, threeUrl)
    .replace(/from ['"]\.\.\/utils\/BufferGeometryUtils\.js['"]/g, `from '${bufferUtilsUrl}'`)
    .replace(/from ['"]\.\.\/utils\/SkeletonUtils\.js['"]/g, `from '${skeletonUtilsUrl}'`);
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

async function blobToDataUrl(blob) {
  if (!blob) return null;
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

function stablePresentationId(boxModel, entries) {
  const dimensions = boxModel?.dimensions || {};
  const names = entries.map((entry) => entry.model?.source?.fileName || entry.model?.source?.mimeType || 'artwork');
  const raw = `${dimensions.width}x${dimensions.height}x${dimensions.depth}:${names.join('|')}`;
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `carton-${(hash >>> 0).toString(16)}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

function align4(value) {
  return (value + 3) & ~3;
}

function hexToColorFactor(value) {
  const normalized = /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : 'ffffff';
  const number = Number.parseInt(normalized, 16);
  return [
    ((number >> 16) & 0xff) / 255,
    ((number >> 8) & 0xff) / 255,
    (number & 0xff) / 255,
    1,
  ];
}

/**
 * Builds a compact, valid GLB fallback without invoking GLTFExporter. The
 * renderer's full GLB export remains available from Render, while HTML export
 * gets a deterministic model immediately and never blocks the UI on a large
 * WebGL scene or texture encoder.
 */
function createCartonGlbDataUrl({ nodes, bounds, textureUrl, boardAppearance = null }) {
  const appearance = sanitizeBoardAppearance(boardAppearance);
  const buffer = [];
  const views = [];
  const accessors = [];
  const append = (typedArray, target) => {
    const offset = buffer.length;
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    buffer.push(...bytes);
    while (buffer.length % 4) buffer.push(0);
    const viewIndex = views.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    return viewIndex;
  };
  const meshes = [];
  const gltfNodes = [];
  const rootChildren = [];
  const minX = Number(bounds.minX) || 0;
  const minY = Number(bounds.minY) || 0;
  const scale = 0.001;
  const halfCaliper = appearance.thicknessMm * scale / 2;
  for (const node of nodes) {
    if (Array.isArray(node.polygon) && node.polygon.length >= 3) {
      const points = node.polygon;
      const local = points.map((point) => new Vector2(
        (point.x - minX) * scale,
        -(point.y - minY) * scale,
      ));
      const triangles = ShapeUtils.triangulateShape(local, []);
      const positions = [];
      const uvs = [];
      for (const point of points) {
        positions.push((point.x - minX) * scale, -(point.y - minY) * scale, halfCaliper);
        uvs.push((point.x - minX) / Math.max(1, bounds.width), 1 - (point.y - minY) / Math.max(1, bounds.height));
      }
      for (const point of points) {
        positions.push((point.x - minX) * scale, -(point.y - minY) * scale, -halfCaliper);
        uvs.push((point.x - minX) / Math.max(1, bounds.width), 1 - (point.y - minY) / Math.max(1, bounds.height));
      }
      const frontIndices = [];
      const backIndices = [];
      const sideIndices = [];
      const count = points.length;
      for (const [a, b, c] of triangles) {
        frontIndices.push(a, b, c);
        backIndices.push(count + c, count + b, count + a);
      }
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        sideIndices.push(index, next, count + next, index, count + next, count + index);
      }
      const positionView = append(new Float32Array(positions), 34962);
      const uvView = append(new Float32Array(uvs), 34962);
      const IndexCtor = positions.length / 3 > 65535 ? Uint32Array : Uint16Array;
      const indexComponentType = IndexCtor === Uint32Array ? 5125 : 5123;
      const frontIndexView = append(new IndexCtor(frontIndices), 34963);
      const backIndexView = append(new IndexCtor(backIndices), 34963);
      const sideIndexView = append(new IndexCtor(sideIndices), 34963);
      const xs = positions.filter((_, index) => index % 3 === 0);
      const ys = positions.filter((_, index) => index % 3 === 1);
      const positionAccessor = accessors.push({
        bufferView: positionView,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min: [Math.min(...xs), Math.min(...ys), -halfCaliper],
        max: [Math.max(...xs), Math.max(...ys), halfCaliper],
      }) - 1;
      const uvAccessor = accessors.push({ bufferView: uvView, componentType: 5126, count: uvs.length / 2, type: 'VEC2' }) - 1;
      const frontAccessor = accessors.push({ bufferView: frontIndexView, componentType: indexComponentType, count: frontIndices.length, type: 'SCALAR', min: [0], max: [count - 1] }) - 1;
      const backAccessor = accessors.push({ bufferView: backIndexView, componentType: indexComponentType, count: backIndices.length, type: 'SCALAR', min: [count], max: [positions.length / 3 - 1] }) - 1;
      const sideAccessor = accessors.push({ bufferView: sideIndexView, componentType: indexComponentType, count: sideIndices.length, type: 'SCALAR', min: [0], max: [positions.length / 3 - 1] }) - 1;
      const meshIndex = meshes.push({ name: node.name, primitives: [
        { attributes: { POSITION: positionAccessor, TEXCOORD_0: uvAccessor }, indices: frontAccessor, material: 0 },
        { attributes: { POSITION: positionAccessor }, indices: backAccessor, material: 1 },
        { attributes: { POSITION: positionAccessor }, indices: sideAccessor, material: 2 },
      ] }) - 1;
      const nodeIndex = gltfNodes.push({ name: node.name, mesh: meshIndex, extras: { cartonBuilderPanelId: node.id, role: node.role || 'body' } }) - 1;
      rootChildren.push(nodeIndex + 1);
      continue;
    }
    const x0 = (node.rect.x - minX) * scale;
    const x1 = (node.rect.x + node.width - minX) * scale;
    const y0 = -(node.rect.y - minY) * scale;
    const y1 = -(node.rect.y + node.height - minY) * scale;
    const u0 = (node.rect.x - minX) / Math.max(1, bounds.width);
    const u1 = (node.rect.x + node.width - minX) / Math.max(1, bounds.width);
    const v0 = 1 - (node.rect.y - minY) / Math.max(1, bounds.height);
    const v1 = 1 - (node.rect.y + node.height - minY) / Math.max(1, bounds.height);
    const positionView = append(new Float32Array([
      x0, y0, halfCaliper, x1, y0, halfCaliper, x1, y1, halfCaliper, x0, y1, halfCaliper,
      x0, y0, -halfCaliper, x1, y0, -halfCaliper, x1, y1, -halfCaliper, x0, y1, -halfCaliper,
    ]), 34962);
    const uvView = append(new Float32Array([
      u0, v0, u1, v0, u1, v1, u0, v1,
      u0, v0, u1, v0, u1, v1, u0, v1,
    ]), 34962);
    const frontIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const backIndices = new Uint16Array([4, 6, 5, 4, 7, 6]);
    const sideIndices = new Uint16Array([
      0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
    ]);
    const frontIndexView = append(frontIndices, 34963);
    const backIndexView = append(backIndices, 34963);
    const sideIndexView = append(sideIndices, 34963);
    const positionAccessor = accessors.push({ bufferView: positionView, componentType: 5126, count: 8, type: 'VEC3', min: [x0, Math.min(y0, y1), -halfCaliper], max: [x1, Math.max(y0, y1), halfCaliper] }) - 1;
    const uvAccessor = accessors.push({ bufferView: uvView, componentType: 5126, count: 8, type: 'VEC2' }) - 1;
    const frontAccessor = accessors.push({ bufferView: frontIndexView, componentType: 5123, count: frontIndices.length, type: 'SCALAR', min: [0], max: [3] }) - 1;
    const backAccessor = accessors.push({ bufferView: backIndexView, componentType: 5123, count: backIndices.length, type: 'SCALAR', min: [4], max: [7] }) - 1;
    const sideAccessor = accessors.push({ bufferView: sideIndexView, componentType: 5123, count: sideIndices.length, type: 'SCALAR', min: [0], max: [7] }) - 1;
    const meshIndex = meshes.push({ name: node.name, primitives: [
      { attributes: { POSITION: positionAccessor, TEXCOORD_0: uvAccessor }, indices: frontAccessor, material: 0 },
      { attributes: { POSITION: positionAccessor }, indices: backAccessor, material: 1 },
      { attributes: { POSITION: positionAccessor }, indices: sideAccessor, material: 2 },
    ] }) - 1;
    const nodeIndex = gltfNodes.push({ name: node.name, mesh: meshIndex, extras: { cartonBuilderPanelId: node.id } }) - 1;
    rootChildren.push(nodeIndex + 1);
  }
  gltfNodes.unshift({
    name: 'CartonBuilder GLB',
    children: rootChildren,
    extras: { sourceUnit: 'mm', presentation: 'solid', caliperMm: appearance.thicknessMm },
  });
  const json = {
    asset: { version: '2.0', generator: 'CartonBuilder HTML export' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: gltfNodes,
    meshes,
    materials: [
      { name: 'Artwork', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.78 } },
      { name: 'Interior', pbrMetallicRoughness: { baseColorFactor: hexToColorFactor(appearance.interiorColor), metallicFactor: 0, roughnessFactor: 0.95 } },
      { name: 'Edges', pbrMetallicRoughness: { baseColorFactor: hexToColorFactor(appearance.edgeColor), metallicFactor: 0, roughnessFactor: 0.9 } },
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ uri: textureUrl, mimeType: 'image/png' }],
    buffers: [{ byteLength: buffer.length, uri: `data:application/octet-stream;base64,${bytesToBase64(new Uint8Array(buffer))}` }],
    bufferViews: views,
    accessors,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(align4(jsonBytes.length));
  jsonPadded.fill(0x20);
  jsonPadded.set(jsonBytes);
  const binBytes = new Uint8Array(buffer);
  const totalLength = 12 + 8 + jsonPadded.length + 8 + binBytes.length;
  const glb = new Uint8Array(totalLength);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  let offset = 12;
  view.setUint32(offset, jsonPadded.length, true); offset += 4;
  view.setUint32(offset, 0x4e4f534a, true); offset += 4;
  glb.set(jsonPadded, offset); offset += jsonPadded.length;
  view.setUint32(offset, binBytes.length, true); offset += 4;
  view.setUint32(offset, 0x004e4942, true); offset += 4;
  glb.set(binBytes, offset);
  return `data:model/gltf-binary;base64,${bytesToBase64(glb)}`;
}

export async function createInteractive3dHtml({
  boxModel,
  artworks,
  htmlQuality = 'auto',
  renderState = null,
  boardAppearance = null,
  previewState = null,
  locale = 'en',
  glbBlob = null,
  musicBlob = null,
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
  const graph = buildFoldGraph(boxModel, { caliperMm: boxModel.board?.caliperMm || 0 });
  const bounds = boxModel.getBounds();
  const nodes = [];
  for (const node of graph.nodes.values()) {
    nodes.push({
      id: node.id,
      name: node.panel.faceName,
      width: node.panel.width,
      height: node.panel.height,
      rect: { x: node.panel.x, y: node.panel.y },
      polygon: Array.isArray(node.panel.polygon) ? node.panel.polygon : null,
      role: node.panel.role || 'body',
      phase: node.panel.phase || [0, 1],
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

  const presentationId = stablePresentationId(boxModel, entries);
  const normalizedLocale = locale === 'ru' ? 'ru' : 'en';
  const appearance = sanitizeBoardAppearance({
    ...(boardAppearance && typeof boardAppearance === 'object' ? boardAppearance : {}),
    thicknessMm: boxModel.board?.caliperMm ?? boardAppearance?.thicknessMm,
  });
  const glbData = await blobToDataUrl(glbBlob)
    || createCartonGlbDataUrl({ nodes, bounds, textureUrl, boardAppearance: appearance });
  const musicData = await blobToDataUrl(musicBlob);
  const sourceRender = renderState && typeof renderState === 'object' ? renderState : {};
  const sourcePreview = previewState && typeof previewState === 'object' ? previewState : {};
  const initialState = {
    locale: normalizedLocale,
    modelId: 'carton',
    foldProgress: Number.isFinite(Number(sourcePreview.foldProgress)) ? Number(sourcePreview.foldProgress) : 1,
    projection: sourcePreview.cameraProjection === 'orthographic' || sourceRender.camera?.projection === 'orthographic'
      ? 'orthographic'
      : 'perspective',
    background: sourcePreview.backgroundColor || '#e8e8e8',
    autoRotate: true,
    rotationSpeed: 0.6,
    cameraDistance: Number(sourceRender.camera?.cameraDistance) > 0
      ? Math.max(0.25, Math.min(10, Number(sourceRender.camera.cameraDistance)))
      : 2.4,
    environmentIntensity: Number(sourceRender.lighting?.environmentMap?.intensity ?? sourcePreview.environmentIntensity ?? 0.65),
    environmentRotation: Number(sourceRender.lighting?.environmentMap?.rotation || 0),
    backgroundIntensity: Number(sourceRender.lighting?.environmentMap?.backgroundIntensity || 1),
    backgroundBlur: Number(sourceRender.lighting?.environmentMap?.backgroundBlur || 0),
    key: {
      enabled: true,
      color: '#ffffff',
      intensity: Number(sourcePreview.lightIntensity ?? sourceRender.lighting?.intensity ?? 1.1),
      azimuth: Number(sourcePreview.lightAzimuth ?? sourceRender.lighting?.azimuth ?? 63),
      elevation: Number(sourcePreview.lightElevation ?? sourceRender.lighting?.elevation ?? 48),
    },
    fill: { enabled: true, color: '#ffffff', intensity: Number(sourcePreview.hemisphereIntensity ?? 0.4) },
    rim: { enabled: true, color: '#ffffff', intensity: 0.25, azimuth: 225, elevation: 55 },
    shadows: {
      enabled: sourcePreview.shadowEnabled !== false && sourceRender.shadows?.enabled !== false,
      opacity: Number(sourcePreview.shadowIntensity ?? sourceRender.shadows?.intensity ?? 0.25),
      softness: Number(sourcePreview.shadowBlur ?? sourceRender.shadows?.blur ?? 1.5),
    },
    exposure: Number(sourceRender.lighting?.exposure ?? 0.85),
    toneMapping: 'Neutral',
    music: { enabled: false, volume: 1 },
  };

  const data = {
    schemaVersion: 1,
    geometryMode: 'solid',
    caliperMm: appearance.thicknessMm,
    boardAppearance: appearance,
    construction: boxModel.construction ? structuredClone(boxModel.construction) : { templateId: 'legacy-six-panel', templateVersion: 1, parameters: {} },
    presentationId,
    locale: normalizedLocale,
    initialState,
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
    models: {
      ...(glbData ? { glb: glbData } : {}),
    },
    ...(musicData ? { music: { data: musicData, name: musicBlob.name || 'music' } } : {}),
    ...(videos.length ? { videos } : {}),
  };

  const threeModuleDataUrl = `data:text/javascript;base64,${toBase64(inlineThreeModule(threeModuleSource, threeCoreSource))}`;
  const bufferGeometryUtilsDataUrl = `data:text/javascript;base64,${toBase64(inlineThreeAddon(bufferGeometryUtilsSource, threeModuleDataUrl))}`;
  const skeletonUtilsDataUrl = `data:text/javascript;base64,${toBase64(inlineThreeAddon(skeletonUtilsSource, threeModuleDataUrl))}`;
  const gltfLoaderDataUrl = `data:text/javascript;base64,${toBase64(inlineGltfLoader(gltfLoaderSource, threeModuleDataUrl, bufferGeometryUtilsDataUrl, skeletonUtilsDataUrl))}`;
  const viewer = VIEWER_SCRIPT;
  const roomEnvironment = inlineRoomEnvironment(roomEnvironmentSource);
  const moduleScript = `import * as THREE from '${threeModuleDataUrl}';\nimport { GLTFLoader } from '${gltfLoaderDataUrl}';\n${roomEnvironment}\n${viewer}`;

  const dims = boxModel.dimensions;
  const dimText = `${trimNumber(dims.width)}×${trimNumber(dims.height)}×${trimNumber(dims.depth)} mm`;
  const exportTitle = `Carton ${dimText}`;
  const exportDescription = 'Interactive 3D carton preview — drag to rotate, click a face to play video with sound.';

  const html = `<!doctype html>
<html lang="${normalizedLocale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${exportTitle}</title>
<meta name="description" content="${exportDescription}">
<meta property="og:title" content="${exportTitle}">
<meta property="og:type" content="website">
<meta property="og:description" content="${exportDescription}">
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
  #topbar { position: fixed; inset: 0 0 auto; z-index: 30; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: linear-gradient(180deg, rgb(14 16 19 / 92%), rgb(14 16 19 / 55%), transparent); pointer-events: none; }
  #topbar > * { pointer-events: auto; }
  #brand { font-size: 14px; font-weight: 700; letter-spacing: .02em; }
  #topbarActions { display: flex; align-items: center; gap: 6px; }
  #status { padding: 5px 9px; border-radius: 999px; background: rgb(175 202 66 / 22%); color: #d7ec85; font-size: 11px; }
  #status[data-tone="error"] { background: rgb(224 86 86 / 25%); color: #ffb0b0; }
  .viewer-panel { position: fixed; z-index: 25; top: 58px; right: 16px; width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 90px); overflow: auto; padding: 14px; border: 1px solid #3a3f46; border-radius: 12px; background: rgb(20 22 25 / 94%); box-shadow: 0 14px 42px rgb(0 0 0 / 35%); }
  .viewer-panel[hidden] { display: none; }
  .viewer-panel h2 { margin: 0 0 12px; font-size: 14px; }
  .viewer-section { display: grid; gap: 8px; padding: 10px 0; border-top: 1px solid #3a3f46; }
  .viewer-section:first-of-type { border-top: 0; padding-top: 0; }
  .viewer-section h3 { margin: 0; font-size: 11px; color: #bfc6ce; text-transform: uppercase; letter-spacing: .08em; }
  .viewer-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 11px; }
  .viewer-control input[type="range"], .viewer-control select { width: 100%; min-width: 0; }
  .viewer-control output { min-width: 42px; color: #e8e8e8; text-align: right; font-variant-numeric: tabular-nums; }
  .model-list { display: grid; gap: 6px; }
  .model-list button { text-align: left; }
  .model-list button.active { border-color: #afca42; color: #e4f4a9; }
  .inline-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .color-row { display: grid; grid-template-columns: 1fr 38px; gap: 8px; align-items: center; }
  .color-row input[type="color"] { width: 38px; height: 24px; padding: 0; }
  #embeddedViewerData { display: none; }
  @media (max-width: 720px) { #topbar { padding: 10px; } #brand { max-width: 42vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .viewer-panel { top: 52px; right: 10px; width: min(360px, calc(100vw - 20px)); } }
</style>
</head>
<body>
<script id="embeddedViewerData" type="application/json">__EMBEDDED_DATA__</script>
<canvas id="viewer"></canvas>
<header id="topbar">
  <div id="brand">CartonBuilder · 3D Viewer</div>
  <div id="topbarActions">
    <span id="status">Loading…</span>
    <button id="modelsButton" type="button">Models</button>
    <button id="settingsButton" type="button">Settings</button>
    <button id="fullscreen" type="button">Fullscreen</button>
    <button data-language="en" type="button">EN</button>
    <button data-language="ru" type="button">RU</button>
  </div>
</header>
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
<section id="modelsPanel" class="viewer-panel" hidden>
  <h2 id="modelsTitle">Models</h2>
  <div id="modelList" class="model-list">
    <button id="proceduralModel" type="button" data-model-id="carton">Procedural carton</button>
    <button id="embeddedModel" type="button" data-model-id="carton-glb">Embedded carton GLB</button>
  </div>
  <div class="inline-actions">
    <button id="openGlbButton" type="button">Open GLB</button>
    <button id="closeModels" type="button">Close</button>
    <input id="fileInput" type="file" accept=".glb,model/gltf-binary" hidden>
  </div>
</section>
<section id="settingsPanel" class="viewer-panel" hidden>
  <h2 id="settingsTitle">Presentation settings</h2>
  <div class="viewer-section">
    <h3>Environment</h3>
    <label class="viewer-control">Intensity <input id="environmentIntensity" type="range" min="0" max="5" step="0.01"><output id="environmentIntensityValue"></output></label>
    <label class="viewer-control">Rotation <input id="environmentRotation" type="range" min="-360" max="360" step="1"><output id="environmentRotationValue"></output></label>
    <label class="viewer-control">Background intensity <input id="backgroundIntensity" type="range" min="0" max="5" step="0.01"><output id="backgroundIntensityValue"></output></label>
    <label class="viewer-control">Background blur <input id="backgroundBlur" type="range" min="0" max="1" step="0.01"><output id="backgroundBlurValue"></output></label>
  </div>
  <div class="viewer-section">
    <h3>Key / fill / rim lights</h3>
    <label class="viewer-control"><span>Key enabled</span><input id="keyEnabled" type="checkbox" checked></label>
    <label class="color-row">Key color <input id="keyColor" type="color" value="#ffffff"></label>
    <label class="viewer-control">Key intensity <input id="keyIntensity" type="range" min="0" max="5" step="0.01"><output id="keyIntensityValue"></output></label>
    <label class="viewer-control"><span>Fill enabled</span><input id="fillEnabled" type="checkbox" checked></label>
    <label class="color-row">Fill color <input id="fillColor" type="color" value="#ffffff"></label>
    <label class="viewer-control">Fill intensity <input id="fillIntensity" type="range" min="0" max="5" step="0.01"><output id="fillIntensityValue"></output></label>
    <label class="viewer-control"><span>Rim enabled</span><input id="rimEnabled" type="checkbox" checked></label>
    <label class="color-row">Rim color <input id="rimColor" type="color" value="#ffffff"></label>
    <label class="viewer-control">Rim intensity <input id="rimIntensity" type="range" min="0" max="5" step="0.01"><output id="rimIntensityValue"></output></label>
  </div>
  <div class="viewer-section">
    <h3>Shadows & rendering</h3>
    <label class="viewer-control">Shadow opacity <input id="shadowOpacity" type="range" min="0" max="1" step="0.01"><output id="shadowOpacityValue"></output></label>
    <label class="viewer-control">Shadow softness <input id="shadowSoftness" type="range" min="0" max="8" step="0.1"><output id="shadowSoftnessValue"></output></label>
    <label class="viewer-control">Exposure <input id="exposure" type="range" min="0" max="3" step="0.01"><output id="exposureValue"></output></label>
    <label class="viewer-control">Tone mapping <select id="toneMapping"><option>Neutral</option><option>AgX</option><option>ACES</option><option>Reinhard</option></select></label>
  </div>
  <div class="viewer-section">
    <h3>View & audio</h3>
    <label class="viewer-control">Rotation speed <input id="rotationSpeed" type="range" min="0" max="4" step="0.01"><output id="rotationSpeedValue"></output></label>
    <label class="viewer-control">Camera distance <input id="cameraDistance" type="range" min="0.25" max="10" step="0.01"><output id="cameraDistanceValue"></output></label>
    <label class="viewer-control"><span>Music enabled</span><input id="musicToggle" type="checkbox"></label>
    <label class="viewer-control">Music volume <input id="musicVolume" type="range" min="0" max="1" step="0.01"><output id="musicVolumeValue"></output></label>
  </div>
  <div class="inline-actions">
    <button id="resetLighting" type="button">Reset lighting</button>
    <button id="exportSettings" type="button">Export settings</button>
    <button id="importSettings" type="button">Import settings</button>
    <button id="exportStandalone" type="button">Export standalone viewer</button>
    <input id="settingsImportInput" type="file" accept="application/json,.json" hidden>
  </div>
</section>
<div id="hint">Drag to orbit · wheel to zoom · right-drag to pan</div>
<script type="module">
${escapeScriptClosing(moduleScript)}
</script>
</body>
</html>`;

  const embeddedData = JSON.stringify(data).replace(/</g, '\\u003c');
  return new Blob([html.replace('__EMBEDDED_DATA__', embeddedData)], { type: 'text/html;charset=utf-8' });
}
