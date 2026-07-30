import {
  BackSide,
  Box3,
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
  Raycaster,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
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

const SCENE_PRESETS = new Set(['technical', 'studio', 'photorealistic']);
const CAMERA_PROJECTIONS = new Set(['perspective', 'orthographic']);

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
  if (preset === 'photorealistic') {
    return new MeshPhysicalMaterial({
      map: texture,
      side: FrontSide,
      roughness: 0.68,
      metalness: 0,
      clearcoat: 0.05,
      clearcoatRoughness: 0.85,
    });
  }
  return new MeshStandardMaterial({
    map: texture,
    side: FrontSide,
    roughness: 0.86,
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
  const Material = preset === 'photorealistic'
    ? MeshPhysicalMaterial
    : MeshStandardMaterial;
  return new Material({
    color: 0xf4f2ec,
    side: BackSide,
    roughness: 0.95,
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
    this.selectedPanelId = selectedPanelId;
    this.panelObjects = new Map();
    this.pickMeshes = [];
    this.pointerStart = null;
    this.environmentTexture = null;
    this.pmremGenerator = null;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(windowRef.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene = new Scene();
    this.scene.background = new Color(0xe8eaeb);
    this.perspectiveCamera = new PerspectiveCamera(PERSPECTIVE_FOV, 1, 0.1, 10_000);
    this.orthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000);
    this.camera = this.cameraProjection === 'orthographic'
      ? this.orthographicCamera
      : this.perspectiveCamera;

    this.hemisphereLight = new HemisphereLight(0xffffff, 0x73777a, 1.7);
    this.directionalLight = new DirectionalLight(0xffffff, 2.6);
    this.directionalLight.position.set(1, 2, 2);
    this.directionalLight.castShadow = true;
    this.directionalLight.shadow.mapSize.set(1024, 1024);
    this.directionalLight.shadow.bias = -0.0002;
    this.directionalLight.shadow.normalBias = 0.2;
    this.scene.add(this.hemisphereLight, this.directionalLight);

    this.groundMaterial = new ShadowMaterial({ color: 0x1d2428, opacity: 0.18 });
    this.ground = new Mesh(new PlaneGeometry(1, 1), this.groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

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
      bounds.min.y - Math.max(0.5, maxDimension * 0.01),
      center.z,
    );
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

  setOrthographicHeight(height) {
    const aspect = Math.max(0.01, this.container.clientWidth / Math.max(1, this.container.clientHeight));
    this.orthographicHeight = Math.max(1, height);
    this.orthographicCamera.top = this.orthographicHeight / 2;
    this.orthographicCamera.bottom = -this.orthographicHeight / 2;
    this.orthographicCamera.left = -this.orthographicHeight * aspect / 2;
    this.orthographicCamera.right = this.orthographicHeight * aspect / 2;
    this.orthographicCamera.updateProjectionMatrix();
  }

  ensureEnvironment() {
    if (this.environmentTexture) return;
    this.pmremGenerator = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environmentTexture = this.pmremGenerator.fromScene(room, 0.04).texture;
    room.dispose();
  }

  setScenePreset(preset, { render = true } = {}) {
    if (!SCENE_PRESETS.has(preset)) return;
    this.scenePreset = preset;
    this.applyMaterials(preset);

    if (preset === 'technical') {
      this.scene.background.set(0xf2f3f3);
      this.hemisphereLight.visible = false;
      this.directionalLight.visible = false;
      this.ground.visible = false;
      this.scene.environment = null;
      this.renderer.shadowMap.enabled = false;
      this.renderer.toneMapping = NoToneMapping;
    } else if (preset === 'photorealistic') {
      this.ensureEnvironment();
      this.scene.background.set(0xd9dcde);
      this.hemisphereLight.visible = true;
      this.hemisphereLight.intensity = 0.4;
      this.directionalLight.visible = true;
      this.directionalLight.intensity = 1.1;
      this.ground.visible = true;
      this.groundMaterial.opacity = 0.18;
      this.scene.environment = this.environmentTexture;
      this.scene.environmentIntensity = 0.65;
      this.renderer.shadowMap.enabled = true;
      this.renderer.toneMapping = NeutralToneMapping;
      this.renderer.toneMappingExposure = 0.85;
    } else {
      this.scene.background.set(0xe8eaeb);
      this.hemisphereLight.visible = true;
      this.hemisphereLight.intensity = 1.7;
      this.directionalLight.visible = true;
      this.directionalLight.intensity = 2.6;
      this.ground.visible = true;
      this.groundMaterial.opacity = 0.1;
      this.scene.environment = null;
      this.renderer.shadowMap.enabled = true;
      this.renderer.toneMapping = NoToneMapping;
      this.renderer.toneMappingExposure = 1;
    }
    this.renderer.shadowMap.needsUpdate = true;
    if (render) this.render();
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
    return {
      panels: this.panelObjects.size,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      calls: this.renderer.info.render.calls,
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
    this.exteriorMaterial?.dispose();
    this.interiorMaterial?.dispose();
    this.outlineMaterial?.dispose();
    this.texture?.dispose();
    this.environmentTexture?.dispose();
    this.pmremGenerator?.dispose();
    this.renderer.dispose();
  }
}
