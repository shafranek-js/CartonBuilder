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
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Raycaster,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { buildFoldGraph } from './foldGraph.js';
import {
  createPanelGeometry,
  getPanelOutlinePoints,
} from './panelGeometry.js';
import { disposeObject3D } from './disposeScene.js';

const CAMERA_DIRECTION = new Vector3(1, 1, 1).normalize();
const PERSPECTIVE_FOV = 35;
const CAMERA_MARGIN = 1.25;
const OUTLINE_COLOR = 0xb2d235;

const LIGHT_DEFAULT_AZIMUTH = 63;
const LIGHT_DEFAULT_ELEVATION = 48;
const LIGHT_ELEVATION_MIN = 5;
const LIGHT_ELEVATION_MAX = 85;

const SCENE_PRESETS = new Set(['technical', 'studio', 'photorealistic']);
const CAMERA_PROJECTIONS = new Set(['perspective', 'orthographic']);
const CAMERA_PRESETS = Object.freeze({
  isometric: new Vector3(1, 1, 1).normalize(),
  front: new Vector3(0, 0, 1),
  'front-right': new Vector3(1, 0.65, 1).normalize(),
  'front-left': new Vector3(-1, 0.65, 1).normalize(),
  'top-front': new Vector3(0.45, 1, 1).normalize(),
  top: new Vector3(0, 1, 0),
  right: new Vector3(1, 0, 0),
});
const ENVIRONMENT_PRESETS = new Set(['none', 'studio', 'neutral', 'warm', 'cool', 'bright', 'night']);

const ENVIRONMENT_PALETTES = Object.freeze({
  neutral: { base: 0xcccccc, key: 0xffffff, keyIntensity: 50, fill: 0x999999 },
  warm: { base: 0xf5e0c8, key: 0xffd9a8, keyIntensity: 70, fill: 0xffc08a },
  cool: { base: 0xdce8f5, key: 0xbcd8ff, keyIntensity: 70, fill: 0x8fb8e8 },
  bright: { base: 0xffffff, key: 0xffffff, keyIntensity: 120, fill: 0xffffff },
  night: { base: 0x10151f, key: 0x8fa8d8, keyIntensity: 25, fill: 0x3a4a66 },
});

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

function makeInteriorMaterial(preset) {
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
    color: 0xf4f2ec,
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
    backgroundColor = null,
    backgroundMode = 'solid',
    alpha = false,
    materialProfile = null,
    windowRef = window,
    onSelection = () => {},
    onContextLost = () => {},
    onContextRestored = () => {},
  }) {
    this.canvas = canvas;
    this.container = container;
    this.boxModel = boxModel;
    this.windowRef = windowRef;
    this.onSelection = onSelection;
    this.onContextLost = onContextLost;
    this.onContextRestored = onContextRestored;
    this.disposed = false;
    this.foldProgress = foldProgress;
    this.cameraProjection = CAMERA_PROJECTIONS.has(cameraProjection)
      ? cameraProjection
      : 'perspective';
    this.scenePreset = SCENE_PRESETS.has(scenePreset) ? scenePreset : 'studio';
    this.materialProfile = materialProfile || this.scenePreset;
    this.backgroundMode = backgroundMode === 'transparent' ? 'transparent' : 'solid';
    this.backgroundColor = backgroundColor || '#e8eaeb';
    this.selectedPanelId = selectedPanelId;
    this.panelObjects = new Map();
    this.pickMeshes = [];
    this.pointerStart = null;
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
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene = new Scene();
    this.scene.background = this.backgroundMode === 'transparent'
      ? null
      : new Color(this.backgroundColor);
    this.renderer.setClearColor(this.backgroundMode === 'transparent' ? 0x000000 : this.backgroundColor, this.backgroundMode === 'transparent' ? 0 : 1);
    this.perspectiveCamera = new PerspectiveCamera(PERSPECTIVE_FOV, 1, 0.1, 10_000);
    this.orthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000);
    this.camera = this.cameraProjection === 'orthographic'
      ? this.orthographicCamera
      : this.perspectiveCamera;

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
    this.perspectiveCamera.fov = this.cameraFov;
    if (backgroundColor) this.scene.background.set(backgroundColor);

    this.groundMaterial = new ShadowMaterial({ color: 0x1d2428, opacity: 0.25 });
    this.ground = new Mesh(new PlaneGeometry(1, 1), this.groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

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

    this.buildBox();
    this.createControls();
    this.setScenePreset(this.scenePreset, { render: false });
    this.applyFold(foldProgress, { render: false });
    this.setSelectedPanel(selectedPanelId, { notify: false, render: false });
    this.resetView({ render: false });

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
    const geometry = createPanelGeometry(node.panel, this.boxModel.getBounds());
    const exterior = new Mesh(geometry, this.exteriorMaterial);
    exterior.name = `${node.id}-exterior`;
    exterior.userData.panelId = node.id;
    exterior.castShadow = true;
    exterior.receiveShadow = true;
    const interior = new Mesh(geometry, this.interiorMaterial);
    interior.name = `${node.id}-interior`;
    interior.userData.panelId = node.id;
    interior.castShadow = false;
    interior.receiveShadow = true;

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
    frame.add(exterior, interior, frontOutline, backOutline);
    this.pickMeshes.push(exterior, interior);
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
    this.materialProfile = preset;
    this.exteriorMaterial = makeExteriorMaterial(preset, this.texture);
    this.interiorMaterial = makeInteriorMaterial(preset);
    for (const entry of this.panelObjects.values()) {
      entry.exterior.material = this.exteriorMaterial;
      entry.interior.material = this.interiorMaterial;
    }
    previousExterior?.dispose();
    previousInterior?.dispose();
  }

  createControls() {
    this.controls?.stopListenToKeyEvents();
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.listenToKeyEvents(this.canvas);
    this.controls.addEventListener('change', () => this.render());
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
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.createControls();
    this.controls.target.copy(target);
    this.controls.update();
    this.render();
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
    this.perspectiveCamera.fov = this.cameraFov;
    this.perspectiveCamera.updateProjectionMatrix();
    this.render();
  }

  setCameraPreset(preset) {
    const direction = CAMERA_PRESETS[preset];
    if (!direction) return;
    this.cameraPreset = preset;
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.controls.update();
    this.render();
  }

  setBackgroundColor(color) {
    if (!color) return;
    this.setBackgroundMode('solid', color, { render: false });
    this.render();
  }

  setBackgroundMode(mode, color = this.backgroundColor, { render = true } = {}) {
    this.backgroundMode = mode === 'transparent' ? 'transparent' : 'solid';
    this.backgroundColor = color || this.backgroundColor || '#e8eaeb';
    if (this.backgroundMode === 'transparent') {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      if (!this.scene.background) this.scene.background = new Color(this.backgroundColor);
      else this.scene.background.set(this.backgroundColor);
      this.renderer.setClearColor(this.backgroundColor, 1);
    }
    if (render) this.render();
  }

  setMaterialProfile(profile) {
    const allowed = ['technical', 'studio', 'photorealistic', 'uncoated', 'matte', 'gloss'];
    if (!allowed.includes(profile)) return;
    this.applyMaterials(profile);
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
    return {
      preset: this.cameraPreset,
      projection: this.cameraProjection,
      fov: this.cameraFov,
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
    };
  }

  setCameraState(state = {}) {
    if (CAMERA_PROJECTIONS.has(state.projection) && state.projection !== this.cameraProjection) {
      this.setCameraProjection(state.projection);
    }
    if (Number.isFinite(Number(state.fov))) this.setFov(state.fov);
    if (Array.isArray(state.position) && state.position.length === 3 && state.position.every(Number.isFinite)) {
      this.camera.position.fromArray(state.position);
    }
    if (Array.isArray(state.target) && state.target.length === 3 && state.target.every(Number.isFinite)) {
      this.controls.target.fromArray(state.target);
      this.camera.lookAt(this.controls.target);
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  async renderToPixels({ width, height, backgroundMode = this.backgroundMode, backgroundColor = this.backgroundColor, includeShadow = true, signal }) {
    if (signal?.aborted) throw new DOMException('Render export aborted.', 'AbortError');
    const outputWidth = Math.max(1, Math.floor(width));
    const outputHeight = Math.max(1, Math.floor(height));
    const target = new WebGLRenderTarget(outputWidth, outputHeight, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    const previousSize = this.renderer.getSize(new Vector2());
    const previousTarget = this.renderer.getRenderTarget();
    const previousBackgroundMode = this.backgroundMode;
    const previousBackgroundColor = this.backgroundColor;
    const previousProjection = this.cameraProjection;
    const previousPerspectiveAspect = this.perspectiveCamera.aspect;
    const previousOrthographicHeight = this.orthographicHeight;
    const previousGroundVisible = this.ground.visible;
    const previousContactShadowVisible = this.contactShadow?.visible;
    try {
      this.setBackgroundMode(backgroundMode, backgroundColor, { render: false });
      if (!includeShadow) {
        this.ground.visible = false;
        if (this.contactShadow) this.contactShadow.visible = false;
      }
      this.renderer.setSize(outputWidth, outputHeight, false);
      this.perspectiveCamera.aspect = outputWidth / outputHeight;
      this.perspectiveCamera.updateProjectionMatrix();
      if (this.camera.isOrthographicCamera && previousOrthographicHeight) {
        this.setOrthographicHeight(previousOrthographicHeight, outputWidth / outputHeight);
      }
      this.renderer.setRenderTarget(target);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);
      const pixels = new Uint8Array(outputWidth * outputHeight * 4);
      if (typeof this.renderer.readRenderTargetPixelsAsync === 'function') {
        await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, outputWidth, outputHeight, pixels);
      } else {
        this.renderer.readRenderTargetPixels(target, 0, 0, outputWidth, outputHeight, pixels);
      }
      if (signal?.aborted) throw new DOMException('Render export aborted.', 'AbortError');
      return { pixels, width: outputWidth, height: outputHeight };
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.setSize(previousSize.x, previousSize.y, false);
      this.perspectiveCamera.aspect = previousPerspectiveAspect;
      this.perspectiveCamera.updateProjectionMatrix();
      if (this.camera.isOrthographicCamera && previousOrthographicHeight) {
        this.setOrthographicHeight(previousOrthographicHeight);
      }
      this.backgroundMode = previousBackgroundMode;
      this.backgroundColor = previousBackgroundColor;
      this.setBackgroundMode(previousBackgroundMode, previousBackgroundColor, { render: false });
      this.ground.visible = previousGroundVisible;
      if (this.contactShadow) this.contactShadow.visible = previousContactShadowVisible;
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
    this.camera.position.copy(sphere.center).addScaledVector(CAMERA_DIRECTION, distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(sphere.center);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.saveState();
    this.controls.update();
    if (render) this.render();
  }

  resize({ render = true } = {}) {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
    if (this.orthographicHeight) this.setOrthographicHeight(this.orthographicHeight);
    if (render) this.render();
  }

  render() {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
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
    this.outlineMaterial?.dispose();
    this.texture?.dispose();
    this.environmentTexture?.dispose();
    this.pmremGenerator?.dispose();
    this.renderer.dispose();
  }
}
