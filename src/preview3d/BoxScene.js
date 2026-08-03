import {
  BackSide,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  FrontSide,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  NoToneMapping,
  Object3D,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Raycaster,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

import { buildFoldGraph } from './foldGraph.js';
import {
  createPanelGeometry,
  getPanelOutlinePoints,
} from './panelGeometry.js';
import { disposeObject3D } from './disposeScene.js';
import { sanitizeBoardAppearance } from '../render/BoardAppearance.js';
import { createPanelSolidGeometry } from '../render/panelSolidGeometry.js';
import {
  cameraHeadingElevation,
  cameraLensLabel,
  focalLengthToFov,
  fovToFocalLength,
} from '../render/cameraState.js';

const CAMERA_DIRECTION = new Vector3(1, 1, 1).normalize();
const PERSPECTIVE_FOV = 35;
const CAMERA_MARGIN = 1.25;
const OUTLINE_COLOR = 0xb2d235;

const LIGHT_DEFAULT_AZIMUTH = 63;
const LIGHT_DEFAULT_ELEVATION = 48;
const LIGHT_ELEVATION_MIN = 5;
const LIGHT_ELEVATION_MAX = 85;

function clonePortableTexture(texture) {
  if (!texture?.isTexture) return texture || null;
  const clone = texture.clone();
  clone.needsUpdate = true;
  return clone;
}

function clonePortableMaterial(material, materialMode) {
  if (!material) return material;
  if (materialMode === 'basic-compatibility' && material.isMeshPhysicalMaterial) {
    return new MeshStandardMaterial({
      color: material.color?.clone?.() || 0xffffff,
      map: clonePortableTexture(material.map),
      roughness: Number.isFinite(material.roughness) ? material.roughness : 0.8,
      metalness: Number.isFinite(material.metalness) ? material.metalness : 0,
      side: material.side,
      transparent: material.transparent,
      opacity: material.opacity,
      alphaTest: material.alphaTest,
    });
  }
  const clone = material.clone();
  for (const key of Object.keys(clone)) {
    if (clone[key]?.isTexture) clone[key] = clonePortableTexture(clone[key]);
  }
  return clone;
}

const SCENE_PRESETS = new Set(['technical', 'studio', 'photorealistic']);
const CAMERA_PROJECTIONS = new Set(['perspective', 'orthographic']);
export const CAMERA_PRESETS = Object.freeze({
  isometric: Object.freeze({ direction: new Vector3(1, 1, 1).normalize(), up: new Vector3(0, 1, 0) }),
  front: Object.freeze({ direction: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) }),
  back: Object.freeze({ direction: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0) }),
  left: Object.freeze({ direction: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0) }),
  right: Object.freeze({ direction: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) }),
  bottom: Object.freeze({ direction: new Vector3(0, -1, 0), up: new Vector3(0, 0, 1) }),
  top: Object.freeze({ direction: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1) }),
  'front-right': Object.freeze({ direction: new Vector3(1, 0.65, 1).normalize(), up: new Vector3(0, 1, 0) }),
  'front-left': Object.freeze({ direction: new Vector3(-1, 0.65, 1).normalize(), up: new Vector3(0, 1, 0) }),
  'top-front': Object.freeze({ direction: new Vector3(0.45, 1, 1).normalize(), up: new Vector3(0, 1, 0) }),
});
const ENVIRONMENT_PRESETS = new Set(['none', 'studio', 'neutral', 'warm', 'cool', 'bright', 'night']);

const ENVIRONMENT_PALETTES = Object.freeze({
  neutral: { base: 0xcccccc, key: 0xffffff, keyIntensity: 50, fill: 0x999999 },
  warm: { base: 0xf5e0c8, key: 0xffd9a8, keyIntensity: 70, fill: 0xffc08a },
  cool: { base: 0xdce8f5, key: 0xbcd8ff, keyIntensity: 70, fill: 0x8fb8e8 },
  bright: { base: 0xffffff, key: 0xffffff, keyIntensity: 120, fill: 0xffffff },
  night: { base: 0x10151f, key: 0x8fa8d8, keyIntensity: 25, fill: 0x3a4a66 },
});

const BACKGROUND_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BACKGROUND_FRAGMENT_SHADER = `
  uniform sampler2D map;
  uniform float hasTexture;
  uniform float imageAspect;
  uniform float viewportAspect;
  uniform float fit;
  uniform vec2 position;
  uniform float zoom;
  uniform float brightness;
  uniform vec3 overlayColor;
  uniform float overlayOpacity;
  varying vec2 vUv;
  void main() {
    if (hasTexture < 0.5) {
      gl_FragColor = vec4(0.0);
      return;
    }
    vec2 sampleUv = vUv;
    if (fit < 0.5) {
      vec2 crop = imageAspect > viewportAspect
        ? vec2(viewportAspect / imageAspect, 1.0)
        : vec2(1.0, imageAspect / viewportAspect);
      crop = clamp(crop / max(zoom, 0.1), vec2(0.01), vec2(1.0));
      vec2 center = vec2(0.5) + (position - vec2(0.5)) * (vec2(1.0) - crop);
      sampleUv = center + (vUv - vec2(0.5)) * crop;
    } else {
      vec2 display = imageAspect > viewportAspect
        ? vec2(1.0, viewportAspect / imageAspect)
        : vec2(imageAspect / viewportAspect, 1.0);
      sampleUv = (vUv - vec2(0.5)) / max(display * max(zoom, 0.1), vec2(0.01)) + vec2(0.5);
      if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }
    vec4 color = texture2D(map, sampleUv);
    color.rgb *= brightness;
    color.rgb = mix(color.rgb, overlayColor, overlayOpacity);
    gl_FragColor = color;
  }
`;

function createEnvironmentScene(preset) {
  const palette = ENVIRONMENT_PALETTES[preset];
  if (!palette) return null;
  const scene = new Scene();
  const dome = new Mesh(
    new SphereGeometry(20, 24, 12),
    new MeshBasicMaterial({ color: palette.base, side: BackSide }),
  );
  scene.add(dome);
  const keyLight = new Mesh(
    new BoxGeometry(0.2, 3, 4),
    new MeshBasicMaterial({ color: palette.key }),
  );
  keyLight.position.set(-6, 6, 4);
  scene.add(keyLight);
  const fillLight = new Mesh(
    new BoxGeometry(0.2, 4, 3),
    new MeshBasicMaterial({ color: palette.fill }),
  );
  fillLight.position.set(6, 3, -5);
  scene.add(fillLight);
  const topLight = new Mesh(
    new BoxGeometry(5, 0.2, 5),
    new MeshBasicMaterial({ color: palette.key }),
  );
  topLight.position.set(0, 7, 0);
  scene.add(topLight);
  const point = new PointLight(palette.key, palette.keyIntensity, 30, 2);
  point.position.set(2, 8, 3);
  scene.add(point);
  return scene;
}

function disposeEnvironmentScene(scene) {
  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    object.material?.dispose();
  });
}

function normalizeDegrees(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function clampDegrees(value) {
  return Math.min(LIGHT_ELEVATION_MAX, Math.max(LIGHT_ELEVATION_MIN, Number(value)));
}

function createOutlineGeometry(panel, zOffset) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(getPanelOutlinePoints(panel, zOffset), 3),
  );
  return geometry;
}

function makeExteriorMaterial(preset, texture) {
  if (preset === 'technical') {
    return new MeshBasicMaterial({
      map: texture,
      side: FrontSide,
      toneMapped: false,
    });
  }
  if (preset === 'photorealistic' || preset === 'gloss') {
    return new MeshPhysicalMaterial({
      map: texture,
      side: FrontSide,
      roughness: preset === 'gloss' ? 0.46 : 0.68,
      metalness: 0,
      clearcoat: preset === 'gloss' ? 0.25 : 0.05,
      clearcoatRoughness: preset === 'gloss' ? 0.35 : 0.85,
    });
  }
  return new MeshStandardMaterial({
    map: texture,
    side: FrontSide,
    roughness: preset === 'uncoated' ? 0.94 : preset === 'matte' ? 0.82 : 0.86,
    metalness: 0,
  });
}

function makeInteriorMaterial(preset, color = '#f4f2ec') {
  if (preset === 'technical') {
    return new MeshBasicMaterial({
      color: 0xffffff,
      side: BackSide,
      toneMapped: false,
    });
  }
  const Material = preset === 'photorealistic' || preset === 'gloss'
    ? MeshPhysicalMaterial
    : MeshStandardMaterial;
  return new Material({
    color,
    side: BackSide,
    roughness: preset === 'gloss' ? 0.72 : 0.95,
    metalness: 0,
  });
}

function visibleHeightForPerspective(camera, distance) {
  return 2 * distance * Math.tan(camera.fov * Math.PI / 360);
}

function distanceForPerspective(camera, visibleHeight) {
  return visibleHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
}

export class BoxScene {
  constructor({
    canvas,
    container,
    boxModel,
    textureCanvas,
    foldProgress = 1,
    cameraProjection = 'perspective',
    scenePreset = 'studio',
    selectedPanelId = null,
    lightAzimuth = LIGHT_DEFAULT_AZIMUTH,
    lightElevation = LIGHT_DEFAULT_ELEVATION,
    shadowBlur = 0,
    shadowIntensity = 0.25,
    shadowEnabled = true,
    shadowMapSize = 1024,
    hemisphereIntensity = 1.7,
    environmentPreset = 'studio',
    environmentIntensity = 0.65,
    cameraPreset = 'isometric',
    cameraFov = PERSPECTIVE_FOV,
    cameraFocalLength = null,
    cameraHeading = null,
    cameraElevation = null,
    cameraHorizontalPan = 0,
    cameraVerticalPan = 0,
    orthographicHeight = null,
    verticalCorrection = false,
    backgroundColor = null,
    backgroundMode = 'solid',
    backgroundImage = null,
    backgroundAsset = null,
    floorReflection = null,
    alpha = false,
    materialProfile = null,
    geometryMode = 'flat',
    boardAppearance = null,
    windowRef = window,
    onSelection = () => {},
    onCameraChange = () => {},
    onContextLost = () => {},
    onContextRestored = () => {},
  }) {
    this.canvas = canvas;
    this.container = container;
    this.boxModel = boxModel;
    this.windowRef = windowRef;
    this.onSelection = onSelection;
    this.onCameraChange = onCameraChange;
    this.onContextLost = onContextLost;
    this.onContextRestored = onContextRestored;
    this.renderCallback = null;
    this.disposed = false;
    this.foldProgress = foldProgress;
    this.cameraProjection = CAMERA_PROJECTIONS.has(cameraProjection)
      ? cameraProjection
      : 'perspective';
    this.scenePreset = SCENE_PRESETS.has(scenePreset) ? scenePreset : 'studio';
    this.materialProfile = materialProfile || this.scenePreset;
    this.geometryMode = geometryMode === 'solid' ? 'solid' : 'flat';
    this.boardAppearance = sanitizeBoardAppearance(boardAppearance);
    this.backgroundMode = ['transparent', 'image'].includes(backgroundMode) ? backgroundMode : 'solid';
    this.backgroundColor = backgroundColor || '#e8eaeb';
    this.backgroundImage = backgroundImage || null;
    this.backgroundTexture = null;
    this.backgroundObjectUrl = null;
    this.backgroundImageAspect = 1;
    this.floorReflectionSettings = {
      enabled: floorReflection?.enabled === true,
      strength: Math.max(0, Math.min(1, Number(floorReflection?.strength) || 0)),
      blur: Math.max(0, Math.min(1, Number(floorReflection?.blur) || 0)),
      fadeDistance: Math.max(0.05, Math.min(5, Number(floorReflection?.fadeDistance) || 0.65)),
      includeInTransparentExport: floorReflection?.includeInTransparentExport === true,
    };
    this.selectedPanelId = selectedPanelId;
    this.panelObjects = new Map();
    this.pickMeshes = [];
    this.pointerStart = null;
    this.suppressCameraChange = 0;
    this.environmentTexture = null;
    this.pmremGenerator = null;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: Boolean(alpha),
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(windowRef.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene = new Scene();
    this.scene.background = ['transparent', 'image'].includes(this.backgroundMode)
      ? null
      : new Color(this.backgroundColor);
    this.renderer.setClearColor(this.backgroundMode === 'transparent' ? 0x000000 : this.backgroundColor, this.backgroundMode === 'transparent' ? 0 : 1);
    this.perspectiveCamera = new PerspectiveCamera(PERSPECTIVE_FOV, 1, 0.1, 10_000);
    this.orthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000);
    this.camera = this.cameraProjection === 'orthographic'
      ? this.orthographicCamera
      : this.perspectiveCamera;
    this.scene.add(this.perspectiveCamera, this.orthographicCamera);
    this.backgroundPlanes = new Map();
    this.backgroundUniforms = {
      map: { value: null },
      hasTexture: { value: 0 },
      imageAspect: { value: 1 },
      viewportAspect: { value: 1 },
      fit: { value: 0 },
      position: { value: new Vector2(0.5, 0.5) },
      zoom: { value: 1 },
      brightness: { value: 1 },
      overlayColor: { value: new Color('#000000') },
      overlayOpacity: { value: 0 },
    };
    for (const camera of [this.perspectiveCamera, this.orthographicCamera]) {
      const plane = new Mesh(
        new PlaneGeometry(2, 2),
        new ShaderMaterial({
          uniforms: this.backgroundUniforms,
          vertexShader: BACKGROUND_VERTEX_SHADER,
          fragmentShader: BACKGROUND_FRAGMENT_SHADER,
          transparent: false,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      plane.name = 'RenderBackgroundBackplate';
      plane.position.z = -1;
      plane.renderOrder = -1000;
      camera.add(plane);
      this.backgroundPlanes.set(camera, plane);
    }

    this.hemisphereLight = new HemisphereLight(0xffffff, 0x73777a, hemisphereIntensity);
    this.hemisphereIntensity = Math.max(0, Math.min(5, Number(hemisphereIntensity) || 0));
    this.directionalLight = new DirectionalLight(0xffffff, 2.6);
    this.directionalLight.position.set(1, 2, 2);
    this.directionalLight.castShadow = shadowEnabled !== false;
    this.directionalLight.shadow.mapSize.set(
      [512, 1024, 2048].includes(Number(shadowMapSize)) ? Number(shadowMapSize) : 1024,
      [512, 1024, 2048].includes(Number(shadowMapSize)) ? Number(shadowMapSize) : 1024,
    );
    this.directionalLight.shadow.bias = -0.0002;
    this.directionalLight.shadow.normalBias = 0.2;
    this.directionalLight.shadow.radius = 0;
    this.scene.add(this.hemisphereLight, this.directionalLight);

    this.shadowEnabled = shadowEnabled !== false;
    this.shadowMapSize = [512, 1024, 2048].includes(Number(shadowMapSize))
      ? Number(shadowMapSize)
      : 1024;
    this.lightAzimuth = normalizeDegrees(lightAzimuth);
    this.lightElevation = clampDegrees(lightElevation);
    this.shadowBlur = Math.max(0, Math.min(8, Number(shadowBlur) || 0));
    this.directionalLight.shadow.radius = this.shadowBlur;
    this.applyLightDirection();

    this.environmentPreset = ENVIRONMENT_PRESETS.has(environmentPreset)
      ? environmentPreset
      : 'studio';
    this.environmentIntensity = Math.max(0, Math.min(5, Number(environmentIntensity) || 0));
    this.cameraPreset = CAMERA_PRESETS[cameraPreset] ? cameraPreset : 'isometric';
    this.cameraFov = Math.max(10, Math.min(120, Number(cameraFov) || PERSPECTIVE_FOV));
    this.cameraFocalLength = Number.isFinite(Number(cameraFocalLength))
      ? Math.max(10, Math.min(300, Number(cameraFocalLength)))
      : fovToFocalLength(this.cameraFov);
    this.cameraHeading = Number.isFinite(Number(cameraHeading)) ? Number(cameraHeading) : null;
    this.cameraElevation = Number.isFinite(Number(cameraElevation)) ? Number(cameraElevation) : null;
    this.cameraHorizontalPan = Number(cameraHorizontalPan) || 0;
    this.cameraVerticalPan = Number(cameraVerticalPan) || 0;
    this.orthographicHeight = Math.max(0.01, Number(orthographicHeight) || 0);
    this.verticalCorrection = verticalCorrection === true;
    this.perspectiveCamera.fov = this.cameraFov;
    // Transparent scenes intentionally keep `scene.background` null. Only
    // update a solid scene's Color instance during initialization.
    if (backgroundColor && this.scene.background) this.scene.background.set(backgroundColor);

    this.groundMaterial = new ShadowMaterial({ color: 0x1d2428, opacity: 0.25 });
    this.ground = new Mesh(new PlaneGeometry(1, 1), this.groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.floorReflection = this.createFloorReflection();

    this.shadowIntensity = Math.max(0, Math.min(1, Number(shadowIntensity) || 0.25));
    this.contactShadow = this.createContactShadow();
    this.applyShadowIntensity();

    this.texture = new CanvasTexture(textureCanvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    this.texture.needsUpdate = true;

    this.suppressCameraChange += 1;
    this.buildBox();
    this.createControls();
    this.setScenePreset(this.scenePreset, { render: false });
    this.applyFold(foldProgress, { render: false });
    this.setSelectedPanel(selectedPanelId, { notify: false, render: false });
    this.resetView({ render: false });
    this.suppressCameraChange -= 1;
    this.updateBackgroundBackplate();
    this.setBackgroundAsset(backgroundAsset, { render: false });

    this.raycaster = new Raycaster();
    this.pointer = new Vector2();
    this.onPointerDown = (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
    };
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onContextLostEvent = (event) => {
      if (this.disposed) return;
      event.preventDefault();
      this.onContextLost();
    };
    this.onContextRestoredEvent = () => {
      if (!this.disposed) this.onContextRestored();
    };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('webglcontextlost', this.onContextLostEvent);
    canvas.addEventListener('webglcontextrestored', this.onContextRestoredEvent);

    this.onResize = () => this.resize();
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(container);
    } else {
      windowRef.addEventListener('resize', this.onResize);
    }
    this.resize({ render: false });
    this.render();
  }

  buildBox() {
    if (this.boxRoot) disposeObject3D(this.boxRoot, { disposeTextures: false });
    this.panelObjects.clear();
    this.pickMeshes = [];
    this.foldGraph = buildFoldGraph(this.boxModel);
    this.boxRoot = new Group();
    this.boxRoot.name = 'Carton';
    this.scene.add(this.boxRoot);
    this.outlineMaterial = new LineBasicMaterial({
      color: OUTLINE_COLOR,
      linewidth: 2,
      depthTest: true,
      toneMapped: false,
    });
    this.applyMaterials(this.scenePreset);

    const rootNode = this.foldGraph.nodes.get(this.foldGraph.rootId);
    const rootFrame = this.createPanelFrame(rootNode);
    this.boxRoot.add(rootFrame);

    const attachChildren = (node, frame) => {
      for (const childId of node.children) {
        const childNode = this.foldGraph.nodes.get(childId);
        const pivot = new Object3D();
        pivot.name = `${childId}-hinge`;
        pivot.position.set(...childNode.parentOffset);
        frame.add(pivot);
        const childFrame = this.createPanelFrame(childNode);
        childFrame.position.set(...childNode.centerOffset);
        pivot.add(childFrame);
        const entry = this.panelObjects.get(childId);
        entry.pivot = pivot;
        entry.axis = new Vector3(...childNode.axis);
        entry.targetAngle = childNode.targetAngle;
        attachChildren(childNode, childFrame);
      }
    };
    attachChildren(rootNode, rootFrame);
  }

  createPanelFrame(node) {
    const frame = new Object3D();
    frame.name = `${node.id}-frame`;
    const geometry = this.geometryMode === 'solid'
      ? createPanelSolidGeometry(node.panel, this.boxModel.getBounds(), this.boardAppearance)
      : createPanelGeometry(node.panel, this.boxModel.getBounds());
    const exterior = this.geometryMode === 'solid'
      ? new Mesh(geometry, [this.exteriorMaterial, this.interiorMaterial, this.edgeMaterial])
      : new Mesh(geometry, this.exteriorMaterial);
    exterior.name = `${node.id}-exterior`;
    exterior.userData.panelId = node.id;
    exterior.castShadow = true;
    exterior.receiveShadow = true;
    const interior = this.geometryMode === 'solid' ? null : new Mesh(geometry, this.interiorMaterial);
    if (interior) {
      interior.name = `${node.id}-interior`;
      interior.userData.panelId = node.id;
      interior.castShadow = false;
      interior.receiveShadow = true;
    }

    const frontOutline = new LineLoop(
      createOutlineGeometry(node.panel, 0.12),
      this.outlineMaterial,
    );
    const backOutline = new LineLoop(
      createOutlineGeometry(node.panel, -0.12),
      this.outlineMaterial,
    );
    frontOutline.visible = false;
    backOutline.visible = false;
    frame.add(exterior, ...(interior ? [interior] : []), frontOutline, backOutline);
    this.pickMeshes.push(exterior, ...(interior ? [interior] : []));
    this.panelObjects.set(node.id, {
      frame,
      exterior,
      interior,
      outlines: [frontOutline, backOutline],
      pivot: null,
      axis: null,
      targetAngle: 0,
    });
    return frame;
  }

  applyMaterials(preset) {
    const previousExterior = this.exteriorMaterial;
    const previousInterior = this.interiorMaterial;
    const previousEdge = this.edgeMaterial;
    this.materialProfile = preset;
    this.exteriorMaterial = makeExteriorMaterial(preset, this.texture);
    this.interiorMaterial = makeInteriorMaterial(preset, this.boardAppearance.interiorColor);
    this.edgeMaterial = new MeshStandardMaterial({
      color: this.boardAppearance.edgeColor,
      roughness: preset === 'gloss' ? 0.72 : 0.92,
      metalness: 0,
    });
    for (const entry of this.panelObjects.values()) {
      entry.exterior.material = this.geometryMode === 'solid'
        ? [this.exteriorMaterial, this.interiorMaterial, this.edgeMaterial]
        : this.exteriorMaterial;
      if (entry.interior) entry.interior.material = this.interiorMaterial;
    }
    previousExterior?.dispose();
    previousInterior?.dispose();
    previousEdge?.dispose();
  }

  createControls() {
    this.controls?.stopListenToKeyEvents();
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.listenToKeyEvents(this.canvas);
    this.controls.addEventListener('change', () => {
      this.render();
      if (!this.suppressCameraChange) {
        this.cameraPreset = 'custom';
        this.onCameraChange(this.getCameraState());
      }
    });
  }

  applyFold(progress, { render = true } = {}) {
    this.foldProgress = Math.min(1, Math.max(0, Number(progress) || 0));
    for (const entry of this.panelObjects.values()) {
      if (!entry.pivot) continue;
      entry.pivot.quaternion.setFromAxisAngle(
        entry.axis,
        entry.targetAngle * this.foldProgress,
      );
    }
    this.boxRoot.updateMatrixWorld(true);
    this.updateGround();
    if (render) this.render();
  }

  createFloorReflection() {
    const reflection = new Reflector(new PlaneGeometry(1, 1), {
      textureWidth: 512,
      textureHeight: 512,
      clipBias: 0.002,
      color: 0x8d9498,
    });
    reflection.name = 'FloorReflection';
    reflection.rotation.x = -Math.PI / 2;
    reflection.renderOrder = -10;
    reflection.material.transparent = true;
    reflection.material.depthWrite = false;
    reflection.material.opacity = 0;
    this.scene.add(reflection);
    this.applyFloorReflectionSettings();
    return reflection;
  }

  applyFloorReflectionSettings() {
    if (!this.floorReflection) return;
    const enabled = this.floorReflectionSettings.enabled
      && this.scenePreset !== 'technical'
      && (this.backgroundMode !== 'transparent' || this.floorReflectionSettings.includeInTransparentExport);
    this.floorReflection.visible = enabled;
    this.floorReflection.material.opacity = enabled ? this.floorReflectionSettings.strength : 0;
    this.floorReflection.material.transparent = true;
  }

  setFloorReflection(settings = {}, { render = true } = {}) {
    this.floorReflectionSettings = {
      ...this.floorReflectionSettings,
      enabled: settings.enabled === true,
      strength: Math.max(0, Math.min(1, Number(settings.strength) || 0)),
      blur: Math.max(0, Math.min(1, Number(settings.blur) || 0)),
      fadeDistance: Math.max(0.05, Math.min(5, Number(settings.fadeDistance) || 0.65)),
      includeInTransparentExport: settings.includeInTransparentExport === true,
    };
    this.applyFloorReflectionSettings();
    if (render) this.render();
  }

  updateBackgroundBackplate() {
    const aspect = Math.max(0.01, this.container.clientWidth / Math.max(1, this.container.clientHeight));
    this.backgroundUniforms.viewportAspect.value = aspect;
    this.backgroundUniforms.imageAspect.value = this.backgroundImageAspect || 1;
    const image = this.backgroundImage || {};
    this.backgroundUniforms.fit.value = image.fit === 'contain' ? 1 : 0;
    this.backgroundUniforms.position.value.set(
      Number.isFinite(Number(image.positionX)) ? Number(image.positionX) : 0.5,
      Number.isFinite(Number(image.positionY)) ? Number(image.positionY) : 0.5,
    );
    this.backgroundUniforms.zoom.value = Math.max(0.1, Number(image.zoom) || 1);
    this.backgroundUniforms.brightness.value = Math.max(0, Number(image.brightness) || 1);
    this.backgroundUniforms.overlayColor.value.set(image.overlayColor || '#000000');
    this.backgroundUniforms.overlayOpacity.value = Math.max(0, Math.min(1, Number(image.overlayOpacity) || 0));
    for (const [camera, plane] of this.backgroundPlanes) {
      const distance = Math.max(0.5, camera.near * 2);
      plane.position.z = -distance;
      if (camera.isPerspectiveCamera) {
        const height = 2 * distance * Math.tan(camera.fov * Math.PI / 360);
        plane.scale.set(height * camera.aspect / 2, height / 2, 1);
      } else {
        plane.scale.set((camera.right - camera.left) / 2, (camera.top - camera.bottom) / 2, 1);
      }
      plane.visible = camera === this.camera
        && this.backgroundMode === 'image'
        && Boolean(this.backgroundTexture);
    }
  }

  setBackgroundAsset(asset = null, { render = true } = {}) {
    this.backgroundImage = asset ? { ...this.backgroundImage, ...asset } : this.backgroundImage;
    this.backgroundTexture?.dispose?.();
    this.backgroundTexture = null;
    this.backgroundUniforms.map.value = null;
    this.backgroundUniforms.hasTexture.value = 0;
    if (this.backgroundObjectUrl) {
      URL.revokeObjectURL(this.backgroundObjectUrl);
      this.backgroundObjectUrl = null;
    }
    if (!asset?.blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      this.updateBackgroundBackplate();
      if (render) this.render();
      return Promise.resolve(false);
    }
    const objectUrl = URL.createObjectURL(asset.blob);
    this.backgroundObjectUrl = objectUrl;
    const ImageCtor = this.windowRef?.Image || globalThis.Image;
    if (typeof ImageCtor !== 'function') {
      URL.revokeObjectURL(objectUrl);
      this.backgroundObjectUrl = null;
      return Promise.resolve(false);
    }
    const image = new ImageCtor();
    return new Promise((resolve) => {
      image.onload = () => {
        if (this.disposed || this.backgroundObjectUrl !== objectUrl) {
          URL.revokeObjectURL(objectUrl);
          resolve(false);
          return;
        }
        const texture = new Texture(image);
        texture.colorSpace = SRGBColorSpace;
        texture.wrapS = ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.needsUpdate = true;
        this.backgroundTexture = texture;
        this.backgroundUniforms.map.value = texture;
        this.backgroundUniforms.hasTexture.value = 1;
        this.backgroundImageAspect = Math.max(0.01, image.naturalWidth / Math.max(1, image.naturalHeight));
        this.updateBackgroundBackplate();
        if (render) this.render();
        resolve(true);
      };
      image.onerror = () => {
        if (this.backgroundObjectUrl === objectUrl) this.backgroundObjectUrl = null;
        URL.revokeObjectURL(objectUrl);
        resolve(false);
      };
      image.src = objectUrl;
    });
  }

  updateGround() {
    const bounds = new Box3().setFromObject(this.boxRoot);
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const maxDimension = Math.max(size.x, size.z, size.y, 1);
    const extent = maxDimension * 2.5;
    this.ground.scale.set(extent, extent, 1);
    this.ground.position.set(
      center.x,
      bounds.min.y - 0.02,
      center.z,
    );
    if (this.contactShadow) {
      const contactExtent = maxDimension * 1.6;
      this.contactShadow.scale.set(contactExtent, contactExtent, 1);
      this.contactShadow.position.set(
        center.x,
        bounds.min.y - 0.01,
        center.z,
      );
    }
    if (this.floorReflection) {
      const reflectionExtent = extent * (1 + this.floorReflectionSettings.fadeDistance * 0.35);
      this.floorReflection.scale.set(reflectionExtent, reflectionExtent, 1);
      this.floorReflection.position.set(center.x, bounds.min.y - 0.012, center.z);
    }
    const shadowExtent = extent / 2;
    const shadowCamera = this.directionalLight.shadow.camera;
    shadowCamera.left = -shadowExtent;
    shadowCamera.right = shadowExtent;
    shadowCamera.top = shadowExtent;
    shadowCamera.bottom = -shadowExtent;
    shadowCamera.near = 0.1;
    shadowCamera.far = extent * 4;
    shadowCamera.updateProjectionMatrix();
  }

  setSelectedPanel(panelId, { notify = true, render = true } = {}) {
    const nextId = this.panelObjects.has(panelId) ? panelId : null;
    this.selectedPanelId = nextId;
    for (const [id, entry] of this.panelObjects) {
      for (const outline of entry.outlines) outline.visible = id === nextId;
    }
    if (notify) this.onSelection(nextId);
    if (render) this.render();
  }

  handlePointerUp(event) {
    if (!this.pointerStart) return;
    const distance = Math.hypot(
      event.clientX - this.pointerStart.x,
      event.clientY - this.pointerStart.y,
    );
    this.pointerStart = null;
    if (distance > 5) return;

    const rectangle = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rectangle.left) / rectangle.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rectangle.top) / rectangle.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickMeshes, false)[0];
    this.setSelectedPanel(hit?.object?.userData?.panelId || null);
  }

  setCameraProjection(projection) {
    if (!CAMERA_PROJECTIONS.has(projection) || projection === this.cameraProjection) return;
    this.suppressCameraChange += 1;
    try {
    const oldCamera = this.camera;
    const target = this.controls.target.clone();
    const direction = oldCamera.position.clone().sub(target).normalize();
    let distance = oldCamera.position.distanceTo(target);
    let visibleHeight;

    if (oldCamera.isPerspectiveCamera) {
      visibleHeight = visibleHeightForPerspective(oldCamera, distance);
    } else {
      visibleHeight = (oldCamera.top - oldCamera.bottom) / oldCamera.zoom;
    }

    this.cameraProjection = projection;
    this.camera = projection === 'orthographic'
      ? this.orthographicCamera
      : this.perspectiveCamera;
    if (this.camera.isPerspectiveCamera) {
      distance = distanceForPerspective(this.camera, visibleHeight);
    } else {
      this.camera.zoom = 1;
      this.setOrthographicHeight(visibleHeight);
    }
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.up.copy(CAMERA_PRESETS[this.cameraPreset]?.up || new Vector3(0, 1, 0));
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.createControls();
    this.controls.target.copy(target);
    this.controls.update();
    this.applyVerticalCorrection();
    this.updateBackgroundBackplate();
    this.render();
    } finally {
      this.suppressCameraChange -= 1;
    }
  }

  setOrthographicHeight(height, aspectOverride = null) {
    const aspect = Number.isFinite(aspectOverride)
      ? Math.max(0.01, aspectOverride)
      : Math.max(0.01, this.container.clientWidth / Math.max(1, this.container.clientHeight));
    this.orthographicHeight = Math.max(1, height);
    this.orthographicCamera.top = this.orthographicHeight / 2;
    this.orthographicCamera.bottom = -this.orthographicHeight / 2;
    this.orthographicCamera.left = -this.orthographicHeight * aspect / 2;
    this.orthographicCamera.right = this.orthographicHeight * aspect / 2;
    this.orthographicCamera.updateProjectionMatrix();
  }

  ensureEnvironment() {
    if (this.pmremGenerator == null) this.pmremGenerator = new PMREMGenerator(this.renderer);
    let environmentScene = null;
    if (this.environmentPreset === 'studio') {
      environmentScene = new RoomEnvironment();
    } else if (this.environmentPreset !== 'none') {
      environmentScene = createEnvironmentScene(this.environmentPreset);
    }
    const previous = this.environmentTexture;
    if (!environmentScene) {
      this.environmentTexture = null;
      this.scene.environment = null;
    } else {
      this.environmentTexture = this.pmremGenerator.fromScene(environmentScene, 0.04).texture;
      if (environmentScene instanceof RoomEnvironment) environmentScene.dispose();
      else disposeEnvironmentScene(environmentScene);
    }
    previous?.dispose();
  }

  applyEnvironment() {
    if (this.scenePreset === 'technical') {
      this.scene.environment = null;
      return;
    }
    this.scene.environment = this.environmentTexture;
    this.scene.environmentIntensity = this.environmentIntensity;
  }

  setScenePreset(preset, { render = true } = {}) {
    if (!SCENE_PRESETS.has(preset)) return;
    this.scenePreset = preset;
    this.applyMaterials(preset);

    if (preset === 'technical') {
      this.setBackgroundMode('solid', '#f2f3f3', { render: false });
      this.hemisphereLight.visible = false;
      this.directionalLight.visible = false;
      this.ground.visible = false;
      if (this.contactShadow) this.contactShadow.visible = false;
      this.scene.environment = null;
      this.renderer.toneMapping = NoToneMapping;
    } else if (preset === 'photorealistic') {
      this.ensureEnvironment();
      this.setBackgroundMode('solid', '#d9dcde', { render: false });
      this.hemisphereLight.visible = true;
      this.hemisphereLight.intensity = 0.4;
      this.directionalLight.visible = true;
      this.directionalLight.intensity = 1.1;
      this.ground.visible = true;
      if (this.contactShadow) this.contactShadow.visible = true;
      this.applyEnvironment();
      this.renderer.toneMapping = NeutralToneMapping;
      this.renderer.toneMappingExposure = 0.85;
    } else {
      this.ensureEnvironment();
      this.setBackgroundMode('solid', '#e8eaeb', { render: false });
      this.hemisphereLight.visible = true;
      this.hemisphereLight.intensity = 1.7;
      this.directionalLight.visible = true;
      this.directionalLight.intensity = 2.6;
      this.ground.visible = true;
      if (this.contactShadow) this.contactShadow.visible = true;
      this.applyEnvironment();
      this.renderer.toneMapping = NoToneMapping;
      this.renderer.toneMappingExposure = 1;
    }
    this.applyShadowIntensity();
    this.applyShadowSettings();
    this.renderer.shadowMap.needsUpdate = true;
    if (render) this.render();
  }

  applyShadowSettings() {
    const enabled = this.shadowEnabled && this.scenePreset !== 'technical';
    this.renderer.shadowMap.enabled = enabled;
    this.directionalLight.castShadow = enabled;
    this.renderer.shadowMap.needsUpdate = true;
  }

  applyLightDirection() {
    const elevation = this.lightElevation * Math.PI / 180;
    const azimuth = this.lightAzimuth * Math.PI / 180;
    this.directionalLight.position.set(
      Math.sin(elevation) * Math.cos(azimuth),
      Math.cos(elevation),
      Math.sin(elevation) * Math.sin(azimuth),
    );
    this.directionalLight.updateMatrixWorld();
  }

  setLightDirection(azimuth, elevation) {
    this.lightAzimuth = normalizeDegrees(azimuth);
    this.lightElevation = clampDegrees(elevation);
    this.applyLightDirection();
    this.render();
  }

  setLightIntensity(intensity) {
    this.directionalLight.intensity = Math.max(0, Math.min(10, Number(intensity) || 0));
    this.render();
  }

  setHemisphereIntensity(intensity) {
    this.hemisphereIntensity = Math.max(0, Math.min(5, Number(intensity) || 0));
    this.hemisphereLight.intensity = this.hemisphereIntensity;
    this.render();
  }

  setEnvironment(preset) {
    if (!ENVIRONMENT_PRESETS.has(preset)) return;
    this.environmentPreset = preset;
    this.ensureEnvironment();
    this.applyEnvironment();
    this.render();
  }

  setEnvironmentIntensity(intensity) {
    this.environmentIntensity = Math.max(0, Math.min(5, Number(intensity) || 0));
    this.applyEnvironment();
    this.render();
  }

  setShadowsEnabled(enabled) {
    this.shadowEnabled = enabled !== false;
    this.applyShadowSettings();
    this.render();
  }

  setShadowMapSize(size) {
    const next = [512, 1024, 2048].includes(Number(size)) ? Number(size) : 1024;
    if (next === this.shadowMapSize) return;
    this.shadowMapSize = next;
    this.directionalLight.shadow.mapSize.set(next, next);
    this.directionalLight.shadow.map = null;
    this.applyShadowSettings();
    this.render();
  }

  setFov(fov) {
    this.cameraFov = Math.max(10, Math.min(120, Number(fov) || PERSPECTIVE_FOV));
    this.cameraFocalLength = fovToFocalLength(this.cameraFov);
    this.perspectiveCamera.fov = this.cameraFov;
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateBackgroundBackplate();
    this.render();
  }

  setCameraPreset(preset) {
    const definition = CAMERA_PRESETS[preset];
    if (!definition) return;
    this.suppressCameraChange += 1;
    try {
      this.cameraPreset = preset;
      const distance = Math.max(0.01, this.camera.position.distanceTo(this.controls.target));
      this.camera.position.copy(this.controls.target).addScaledVector(definition.direction, distance);
      this.camera.up.copy(definition.up);
      this.camera.lookAt(this.controls.target);
      this.cameraHeading = cameraHeadingElevation(this.camera.position, this.controls.target).heading;
      this.cameraElevation = cameraHeadingElevation(this.camera.position, this.controls.target).elevation;
      this.controls.update();
      this.render();
    } finally {
      this.suppressCameraChange -= 1;
    }
  }

  setBackgroundColor(color) {
    if (!color) return;
    this.setBackgroundMode('solid', color, { render: false });
    this.render();
  }

  setBackgroundMode(mode, color = this.backgroundColor, { render = true } = {}) {
    this.backgroundMode = ['transparent', 'image'].includes(mode) ? mode : 'solid';
    this.backgroundColor = color || this.backgroundColor || '#e8eaeb';
    if (this.backgroundMode === 'transparent') {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      if (!this.scene.background) this.scene.background = new Color(this.backgroundColor);
      else this.scene.background.set(this.backgroundColor);
      this.renderer.setClearColor(this.backgroundColor, 1);
    }
    this.updateBackgroundBackplate();
    this.applyFloorReflectionSettings();
    if (render) this.render();
  }

  setBackgroundImage(image = {}) {
    this.backgroundImage = { ...this.backgroundImage, ...image };
    this.updateBackgroundBackplate();
    this.render();
  }

  setMaterialProfile(profile) {
    const allowed = ['technical', 'studio', 'photorealistic', 'uncoated', 'matte', 'gloss'];
    if (!allowed.includes(profile)) return;
    this.applyMaterials(profile);
    this.render();
  }

  setVerticalCorrection(enabled) {
    this.verticalCorrection = enabled === true;
    this.applyVerticalCorrection();
    this.render();
  }

  applyVerticalCorrection() {
    if (!this.camera?.isPerspectiveCamera) return;
    const width = Math.max(1, this.renderer.domElement.width || this.container.clientWidth || 1);
    const height = Math.max(1, this.renderer.domElement.height || this.container.clientHeight || 1);
    if (!this.verticalCorrection || Math.abs(this.cameraElevation || 0) < 0.01) {
      this.camera.clearViewOffset?.();
      this.camera.updateProjectionMatrix();
      return;
    }
    // Shift the perspective centre instead of rotating the camera around its
    // viewing axis. This keeps carton edges vertical while retaining the
    // current heading/elevation and composition.
    const shift = Math.tan((this.cameraElevation || 0) * Math.PI / 180) * height * 0.12;
    this.camera.setViewOffset(width, height, 0, -shift, width, height);
    this.camera.updateProjectionMatrix();
  }

  setBoardAppearance(boardAppearance) {
    const next = sanitizeBoardAppearance(boardAppearance);
    if (JSON.stringify(next) === JSON.stringify(this.boardAppearance)) return;
    this.boardAppearance = next;
    if (this.geometryMode === 'solid') {
      const selectedPanelId = this.selectedPanelId;
      this.buildBox();
      this.applyFold(this.foldProgress, { render: false });
      this.setSelectedPanel(selectedPanelId, { notify: false, render: false });
    } else {
      this.applyMaterials(this.scenePreset);
    }
    this.render();
  }

  setExposure(exposure) {
    this.renderer.toneMappingExposure = Math.max(0.1, Math.min(3, Number(exposure) || 1));
    this.render();
  }

  setToneMapping(mode = 'neutral') {
    this.renderer.toneMapping = mode === 'none' ? NoToneMapping : NeutralToneMapping;
    this.render();
  }

  getCameraState() {
    const orientation = cameraHeadingElevation(this.camera.position, this.controls.target);
    return {
      preset: this.cameraPreset,
      projection: this.cameraProjection,
      fov: this.cameraFov,
      focalLength: this.cameraFocalLength || fovToFocalLength(this.cameraFov),
      lens: cameraLensLabel(this.cameraFov),
      heading: orientation.heading,
      elevation: orientation.elevation,
      horizontalPan: this.cameraHorizontalPan,
      verticalPan: this.cameraVerticalPan,
      cameraDistance: orientation.distance,
      frameHeight: this.orthographicHeight || visibleHeightForPerspective(this.perspectiveCamera, orientation.distance),
      orthographicHeight: this.orthographicHeight || 0,
      verticalCorrection: this.verticalCorrection,
      keepVerticalsParallel: this.verticalCorrection,
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
    };
  }

  /**
   * Creates an export-owned, static presentation scene in glTF meters.
   * Presentation-only helpers (floor, background, reflector, outlines and
   * post-processing) are intentionally excluded from the portable asset.
   */
  createPortableScene({ includeCamera = true, materialMode = 'full-pbr' } = {}) {
    if (!this.boxRoot) throw new Error('Render carton scene is not ready.');
    const scene = new Scene();
    scene.name = 'CartonBuilder GLB';
    scene.userData.cartonBuilder = {
      sourceUnit: 'mm',
      exportUnit: 'm',
      dimensions: { ...this.boxModel.dimensions },
      materialProfile: this.materialProfile,
      materialMode,
      foldProgress: this.foldProgress,
      static: true,
    };

    const cartonRoot = new Group();
    cartonRoot.name = 'Carton';
    cartonRoot.scale.setScalar(0.001);
    const sourceRoot = this.boxRoot.clone(true);
    sourceRoot.name = 'Carton';
    sourceRoot.traverse((object) => {
      if (object.isLine || object.isLineLoop) {
        object.visible = false;
        return;
      }
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
      if (object.geometry) object.geometry = object.geometry.clone();
      if (Array.isArray(object.material)) {
        object.material = object.material.map((material) => clonePortableMaterial(material, materialMode));
      } else {
        object.material = clonePortableMaterial(object.material, materialMode);
      }
    });
    cartonRoot.add(sourceRoot);
    scene.add(cartonRoot);

    if (includeCamera && this.camera) {
      const camera = this.camera.clone();
      camera.name = 'CartonBuilder Camera';
      const meterScale = 0.001;
      camera.position.multiplyScalar(meterScale);
      camera.near = Math.max(0.0001, camera.near * meterScale);
      camera.far = Math.max(camera.near + 1, camera.far * meterScale);
      if (camera.isOrthographicCamera) {
        camera.left *= meterScale;
        camera.right *= meterScale;
        camera.top *= meterScale;
        camera.bottom *= meterScale;
      }
      const target = this.controls?.target?.clone?.() || new Vector3();
      target.multiplyScalar(meterScale);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      scene.add(camera);
    }
    scene.updateMatrixWorld(true);
    return {
      scene,
      dispose() {
        disposeObject3D(scene, { disposeTextures: true });
      },
    };
  }

  setCameraState(state = {}) {
    this.suppressCameraChange += 1;
    try {
    if (state.preset === 'custom' || CAMERA_PRESETS[state.preset]) this.cameraPreset = state.preset;
    if (CAMERA_PROJECTIONS.has(state.projection) && state.projection !== this.cameraProjection) {
      this.setCameraProjection(state.projection);
    }
    if (Number.isFinite(Number(state.fov))) this.setFov(state.fov);
    if (Number.isFinite(Number(state.focalLength)) && !Number.isFinite(Number(state.fov))) {
      this.setFov(focalLengthToFov(state.focalLength));
    }
    if (Number.isFinite(Number(state.orthographicHeight)) && Number(state.orthographicHeight) > 0) {
      this.setOrthographicHeight(state.orthographicHeight);
    }
    if (Number.isFinite(Number(state.heading))) this.cameraHeading = Number(state.heading);
    if (Number.isFinite(Number(state.elevation))) this.cameraElevation = Number(state.elevation);
    this.cameraHorizontalPan = Number.isFinite(Number(state.horizontalPan)) ? Number(state.horizontalPan) : this.cameraHorizontalPan;
    this.cameraVerticalPan = Number.isFinite(Number(state.verticalPan)) ? Number(state.verticalPan) : this.cameraVerticalPan;
    this.verticalCorrection = state.verticalCorrection === true || state.keepVerticalsParallel === true;
    if (Array.isArray(state.position) && state.position.length === 3 && state.position.every(Number.isFinite)) {
      this.camera.position.fromArray(state.position);
    }
    if (Array.isArray(state.target) && state.target.length === 3 && state.target.every(Number.isFinite)) {
      this.controls.target.fromArray(state.target);
      this.camera.lookAt(this.controls.target);
    }
    this.camera.updateProjectionMatrix();
    this.applyVerticalCorrection();
    this.controls.update();
    this.render();
    } finally {
      this.suppressCameraChange -= 1;
    }
  }

  async renderToPixels({ width, height, backgroundMode = this.backgroundMode, backgroundColor = this.backgroundColor, includeShadow = true, includeReflection = true, signal, renderOverride = null }) {
    if (signal?.aborted) throw new DOMException('Render export aborted.', 'AbortError');
    const outputWidth = Math.max(1, Math.floor(width));
    const outputHeight = Math.max(1, Math.floor(height));
    const target = new WebGLRenderTarget(outputWidth, outputHeight, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.colorSpace = SRGBColorSpace;
    const previousSize = this.renderer.getSize(new Vector2());
    const previousTarget = this.renderer.getRenderTarget();
    const previousBackgroundMode = this.backgroundMode;
    const previousBackgroundColor = this.backgroundColor;
    const previousProjection = this.cameraProjection;
    const previousPerspectiveAspect = this.perspectiveCamera.aspect;
    const previousPerspectiveView = this.perspectiveCamera.view ? { ...this.perspectiveCamera.view } : null;
    const previousOrthographicHeight = this.orthographicHeight;
    const previousGroundVisible = this.ground.visible;
    const previousContactShadowVisible = this.contactShadow?.visible;
    const previousReflectionVisible = this.floorReflection?.visible;
    let overrideResult = null;
    let overrideRestored = false;
    try {
      this.setBackgroundMode(backgroundMode, backgroundColor, { render: false });
      if (!includeShadow) {
        this.ground.visible = false;
        if (this.contactShadow) this.contactShadow.visible = false;
      }
      if (this.floorReflection) {
        this.floorReflection.visible = Boolean(includeReflection)
          && this.floorReflectionSettings.enabled
          && (backgroundMode !== 'transparent' || this.floorReflectionSettings.includeInTransparentExport);
      }
      this.renderer.setSize(outputWidth, outputHeight, false);
      this.perspectiveCamera.aspect = outputWidth / outputHeight;
      this.perspectiveCamera.updateProjectionMatrix();
      this.applyVerticalCorrection();
      if (this.camera.isOrthographicCamera && previousOrthographicHeight) {
        this.setOrthographicHeight(previousOrthographicHeight, outputWidth / outputHeight);
      }
      this.renderer.setRenderTarget(target);
      this.renderer.clear(true, true, true);
      overrideResult = typeof renderOverride === 'function'
        ? await renderOverride({ target, width: outputWidth, height: outputHeight })
        : null;
      if (!overrideResult) this.renderer.render(this.scene, this.camera);
      const pixelsTarget = overrideResult?.target || overrideResult || target;
      const pixels = new Uint8Array(outputWidth * outputHeight * 4);
      if (typeof this.renderer.readRenderTargetPixelsAsync === 'function') {
        await this.renderer.readRenderTargetPixelsAsync(pixelsTarget, 0, 0, outputWidth, outputHeight, pixels);
      } else {
        this.renderer.readRenderTargetPixels(pixelsTarget, 0, 0, outputWidth, outputHeight, pixels);
      }
      overrideResult?.restore?.();
      overrideRestored = true;
      if (signal?.aborted) throw new DOMException('Render export aborted.', 'AbortError');
      return { pixels, width: outputWidth, height: outputHeight };
    } finally {
      if (!overrideRestored) overrideResult?.restore?.();
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setSize(previousSize.x, previousSize.y, false);
      this.perspectiveCamera.aspect = previousPerspectiveAspect;
      if (previousPerspectiveView?.enabled) {
        this.perspectiveCamera.setViewOffset(
          previousPerspectiveView.fullWidth,
          previousPerspectiveView.fullHeight,
          previousPerspectiveView.offsetX,
          previousPerspectiveView.offsetY,
          previousPerspectiveView.width,
          previousPerspectiveView.height,
        );
      } else {
        this.perspectiveCamera.clearViewOffset?.();
      }
      this.perspectiveCamera.updateProjectionMatrix();
      if (this.camera.isOrthographicCamera && previousOrthographicHeight) {
        this.setOrthographicHeight(previousOrthographicHeight);
      }
      this.backgroundMode = previousBackgroundMode;
      this.backgroundColor = previousBackgroundColor;
      this.setBackgroundMode(previousBackgroundMode, previousBackgroundColor, { render: false });
      this.ground.visible = previousGroundVisible;
      if (this.contactShadow) this.contactShadow.visible = previousContactShadowVisible;
      if (this.floorReflection) this.floorReflection.visible = previousReflectionVisible;
      target.dispose();
      if (previousProjection !== this.cameraProjection) this.setCameraProjection(previousProjection);
    }
  }

  setShadowBlur(blur) {
    this.shadowBlur = Math.max(0, Math.min(8, Number(blur) || 0));
    this.directionalLight.shadow.radius = this.shadowBlur;
    this.renderer.shadowMap.needsUpdate = true;
    this.render();
  }

  createContactShadow() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2,
    );
    gradient.addColorStop(0, 'rgba(15, 20, 24, 1)');
    gradient.addColorStop(0.35, 'rgba(15, 20, 24, 0.55)');
    gradient.addColorStop(1, 'rgba(15, 20, 24, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });
    const mesh = new Mesh(new PlaneGeometry(1, 1), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = -1;
    this.scene.add(mesh);
    return mesh;
  }

  setShadowIntensity(intensity) {
    this.shadowIntensity = Math.max(0, Math.min(1, Number(intensity) || 0));
    this.applyShadowIntensity();
    this.render();
  }

  applyShadowIntensity() {
    this.groundMaterial.opacity = this.shadowIntensity;
    if (this.contactShadow) {
      this.contactShadow.material.opacity = Math.min(1, this.shadowIntensity * 1.4);
    }
  }

  replaceTexture(textureCanvas) {
    const previousTexture = this.texture;
    this.texture = new CanvasTexture(textureCanvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    this.texture.needsUpdate = true;
    this.applyMaterials(this.scenePreset);
    previousTexture?.dispose();
    this.render();
  }

  resetView({ render = true } = {}) {
    this.boxRoot.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(this.boxRoot);
    const sphere = bounds.getBoundingSphere({ center: new Vector3(), radius: 1 });
    const radius = Math.max(1, sphere.radius);
    const visibleHeight = radius * 2 * CAMERA_MARGIN;
    let distance = radius * 4;
    if (this.camera.isPerspectiveCamera) {
      distance = distanceForPerspective(this.camera, visibleHeight);
      this.camera.near = Math.max(0.01, radius / 1000);
      this.camera.far = Math.max(1000, distance + radius * 10);
    } else {
      this.setOrthographicHeight(visibleHeight);
      this.camera.near = Math.max(0.01, radius / 1000);
      this.camera.far = Math.max(1000, distance + radius * 10);
      this.camera.zoom = 1;
    }
    const definition = CAMERA_PRESETS[this.cameraPreset] || CAMERA_PRESETS.isometric;
    this.camera.position.copy(sphere.center).addScaledVector(definition.direction, distance);
    this.camera.up.copy(definition.up);
    this.camera.lookAt(sphere.center);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.saveState();
    this.controls.update();
    const orientation = cameraHeadingElevation(this.camera.position, this.controls.target);
    this.cameraHeading = orientation.heading;
    this.cameraElevation = orientation.elevation;
    this.applyVerticalCorrection();
    if (render) this.render();
  }

  fitCameraToFrame({ margin = CAMERA_MARGIN, aspect = null, render = true } = {}) {
    this.boxRoot.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(this.boxRoot);
    const sphere = bounds.getBoundingSphere({ center: new Vector3(), radius: 1 });
    const radius = Math.max(0.001, sphere.radius);
    const target = sphere.center.clone();
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const safeDirection = direction.lengthSq() > 0.0001 ? direction : CAMERA_PRESETS.isometric.direction;
    const visibleHeight = radius * 2 * Math.max(1, Number(margin) || CAMERA_MARGIN);
    const frameAspect = Number.isFinite(Number(aspect)) ? Math.max(0.01, Number(aspect)) : null;
    if (this.camera.isPerspectiveCamera) {
      const previousAspect = this.perspectiveCamera.aspect;
      if (frameAspect) this.perspectiveCamera.aspect = frameAspect;
      const distance = distanceForPerspective(this.perspectiveCamera, visibleHeight);
      this.camera.position.copy(target).addScaledVector(safeDirection, distance);
      this.perspectiveCamera.near = Math.max(0.01, radius / 1000);
      this.perspectiveCamera.far = Math.max(1000, distance + radius * 10);
      this.perspectiveCamera.updateProjectionMatrix();
      this.perspectiveCamera.aspect = previousAspect;
    } else {
      this.setOrthographicHeight(visibleHeight, frameAspect);
      const distance = Math.max(radius * 4, this.camera.position.distanceTo(this.controls.target));
      this.camera.position.copy(target).addScaledVector(safeDirection, distance);
    }
    this.cameraHorizontalPan = 0;
    this.cameraVerticalPan = 0;
    this.controls.target.copy(target);
    this.camera.lookAt(target);
    this.controls.update();
    this.applyVerticalCorrection();
    if (render) this.render();
    return this.getCameraState();
  }

  resize({ render = true, width: requestedWidth, height: requestedHeight, pixelRatio } = {}) {
    if (this.disposed) return;
    const width = Math.max(1, Number(requestedWidth) || this.container.clientWidth);
    const height = Math.max(1, Number(requestedHeight) || this.container.clientHeight);
    if (Number.isFinite(pixelRatio) && pixelRatio > 0) this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
    if (this.orthographicHeight) this.setOrthographicHeight(this.orthographicHeight);
    this.applyVerticalCorrection();
    this.updateBackgroundBackplate();
    if (render) this.render();
  }

  render() {
    if (this.disposed) return;
    if (this.renderCallback) this.renderCallback();
    else this.renderer.render(this.scene, this.camera);
  }

  setRenderCallback(callback = null) {
    this.renderCallback = typeof callback === 'function' ? callback : null;
  }

  getResourceInfo() {
    const context = this.renderer.getContext?.();
    const maxRenderbufferSize = context?.getParameter?.(context.MAX_RENDERBUFFER_SIZE);
    return {
      panels: this.panelObjects.size,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      calls: this.renderer.info.render.calls,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      maxRenderbufferSize: Number.isFinite(maxRenderbufferSize)
        ? maxRenderbufferSize
        : this.renderer.capabilities.maxTextureSize,
      drawingBufferWidth: this.renderer.domElement.width,
      drawingBufferHeight: this.renderer.domElement.height,
      shadowMapSize: this.shadowMapSize,
      foldProgress: this.foldProgress,
      geometryMode: this.geometryMode,
      thicknessMm: this.boardAppearance.thicknessMm,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    if (!this.resizeObserver) this.windowRef.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLostEvent);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestoredEvent);
    this.controls?.stopListenToKeyEvents();
    this.controls?.dispose();
    disposeObject3D(this.boxRoot, { disposeTextures: false });
    this.ground.geometry.dispose();
    this.groundMaterial.dispose();
    if (this.contactShadow) {
      this.contactShadow.geometry.dispose();
      this.contactShadow.material.map?.dispose();
      this.contactShadow.material.dispose();
    }
    this.exteriorMaterial?.dispose();
    this.interiorMaterial?.dispose();
    this.edgeMaterial?.dispose();
    this.outlineMaterial?.dispose();
    this.texture?.dispose();
    for (const plane of this.backgroundPlanes?.values?.() || []) {
      plane.geometry?.dispose();
      plane.material?.dispose();
    }
    this.backgroundTexture?.dispose?.();
    if (this.backgroundObjectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(this.backgroundObjectUrl);
    }
    if (this.floorReflection) {
      this.floorReflection.geometry?.dispose();
      this.floorReflection.material?.dispose();
      this.floorReflection.getRenderTarget?.()?.dispose?.();
    }
    this.environmentTexture?.dispose();
    this.pmremGenerator?.dispose();
    this.renderer.dispose();
  }
}
