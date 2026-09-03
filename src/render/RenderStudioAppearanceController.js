import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PlaneGeometry,
  ShadowMaterial,
  NoToneMapping,
  NeutralToneMapping,
} from 'three';
import { getEnvironmentMapPreset, sanitizeEnvironmentMap } from './environmentAssets.js';

const ENVIRONMENT_PALETTES = Object.freeze({
  neutral: { key: 0xffffff, ground: 0x999999 },
  warm: { key: 0xffd9a8, ground: 0xffc08a },
  cool: { key: 0xbcd8ff, ground: 0x8fb8e8 },
  bright: { key: 0xffffff, ground: 0xe0e5ea },
  night: { key: 0x8fa8d8, ground: 0x10151f },
  studio: { key: 0xffffff, ground: 0x73777a },
});

const DEFAULT_BACKGROUND_COLOR = '#e8eaeb';
const DEFAULT_LIGHT_AZIMUTH = 63;
const DEFAULT_LIGHT_ELEVATION = 48;
const DEFAULT_LIGHT_INTENSITY = 2.6;
const DEFAULT_HEMISPHERE_INTENSITY = 1.7;
const DEFAULT_ENVIRONMENT_INTENSITY = 0.4;
const DEFAULT_SHADOW_INTENSITY = 0.25;
const DEFAULT_SHADOW_MAP_SIZE = 1024;
const DEFAULT_SHADOW_BLUR = 0;
const DEFAULT_FLOOR_REFLECTION = Object.freeze({
  enabled: false,
  strength: 0.08,
  blur: 0.65,
  fadeDistance: 0.65,
  includeInTransparentExport: false,
});
const VALID_TONE_MAPPINGS = new Set(['none', 'neutral']);
const VALID_BACKGROUND_MODES = new Set(['solid', 'transparent', 'image', 'environment']);
const VALID_SHADOW_MAP_SIZES = new Set([512, 1024, 2048]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function assertObject(name, value) {
  if (!isObjectLike(value)) {
    throw new TypeError(`RenderStudioAppearanceController requires ${name}.`);
  }
}

function assertMethod(name, owner, method) {
  if (typeof owner?.[method] !== 'function') {
    throw new TypeError(
      `RenderStudioAppearanceController ${name} must implement ${method}().`,
    );
  }
}

function assertAdapter(name, adapter, methods) {
  assertObject(name, adapter);
  for (const method of methods) assertMethod(name, adapter, method);
}

function assertSurface(surface) {
  assertObject('surface', surface);
  const renderSurface = surface.renderSurface;
  assertObject('surface.renderSurface', renderSurface);
  for (const key of ['scene', 'renderer']) {
    if (!isObjectLike(renderSurface[key])) {
      throw new TypeError(
        `RenderStudioAppearanceController surface.renderSurface must provide ${key}.`,
      );
    }
  }
  assertMethod('surface.renderSurface.scene', renderSurface.scene, 'add');
  assertMethod('surface.renderSurface.scene', renderSurface.scene, 'remove');
  assertMethod('surface.renderSurface.renderer', renderSurface.renderer, 'setClearColor');
  if (!isObjectLike(renderSurface.renderer.shadowMap)) {
    throw new TypeError(
      'RenderStudioAppearanceController surface.renderSurface.renderer must provide shadowMap.',
    );
  }
}

function assertMaterialProfileSetter(materialProfileSetter) {
  if (typeof materialProfileSetter === 'function') return;
  assertMethod('materialProfileSetter', materialProfileSetter, 'setMaterialProfile');
}

function assertFactory(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`RenderStudioAppearanceController ${name} must be a function.`);
  }
}

function firstError(current, callback) {
  try {
    callback();
  } catch (error) {
    return current || error;
  }
  return current;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeAzimuth(value) {
  return ((value % 360) + 360) % 360;
}

function validateColor(color) {
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
    throw new TypeError('RenderStudioAppearanceController color must be a #rrggbb value.');
  }
  return color;
}

function validateBounds(bounds) {
  if (!isObjectLike(bounds)
    || !finiteNumber(bounds.centerX)
    || !finiteNumber(bounds.centerY)
    || !finiteNumber(bounds.centerZ)
    || !finiteNumber(bounds.radius)
    || !(bounds.radius > 0)) {
    throw new TypeError(
      'RenderStudioAppearanceController boundsProvider() must return finite meter bounds with radius > 0.',
    );
  }

  const minX = bounds.minX === undefined ? bounds.centerX - bounds.radius : bounds.minX;
  const maxX = bounds.maxX === undefined ? bounds.centerX + bounds.radius : bounds.maxX;
  const minY = bounds.minY === undefined ? bounds.centerY - bounds.radius : bounds.minY;
  const maxY = bounds.maxY === undefined ? bounds.centerY + bounds.radius : bounds.maxY;
  const minZ = bounds.minZ === undefined ? bounds.centerZ - bounds.radius : bounds.minZ;
  const maxZ = bounds.maxZ === undefined ? bounds.centerZ + bounds.radius : bounds.maxZ;
  if (![minX, maxX, minY, maxY, minZ, maxZ].every(finiteNumber)
    || !(maxX >= minX)
    || !(maxY >= minY)
    || !(maxZ >= minZ)) {
    throw new TypeError(
      'RenderStudioAppearanceController boundsProvider() must return finite ordered bounds.',
    );
  }
  return {
    centerX: bounds.centerX,
    centerY: bounds.centerY,
    centerZ: bounds.centerZ,
    radius: bounds.radius,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
  };
}

function pickFactory(factories, keys, fallback) {
  for (const key of keys) {
    if (Object.hasOwn(factories, key)) return factories[key];
  }
  return fallback;
}

function resolveTexture(value) {
  if (value?.isTexture || value?.isDataTexture || value?.isCompressedTexture) return value;
  if (value?.texture?.isTexture || value?.texture?.isDataTexture || value?.texture?.isCompressedTexture) {
    return value.texture;
  }
  if (value?.environmentTexture?.isTexture) return value.environmentTexture;
  return null;
}

function applyAsyncResult(result, apply, isCurrent = () => true) {
  if (result && typeof result.then === 'function') {
    result.then((value) => {
      if (!isCurrent()) return;
      try {
        apply(value);
      } catch {
        // Preserve the adapter's original Promise identity and rejection path.
      }
    }, () => {
      // The caller owns the original rejection; this side effect must not add
      // an unhandled rejection while waiting to apply a resolved texture.
    });
    return result;
  }
  if (isCurrent()) apply(result);
  return result;
}

function cloneEnvironmentMap(value) {
  if (!value || typeof value !== 'object') return sanitizeEnvironmentMap(value);
  return { ...value };
}

export class RenderStudioAppearanceController {
  constructor({
    surface,
    boundsProvider,
    materialProfileSetter,
    environmentAdapter,
    backgroundAdapter,
    reflectionAdapter,
    threeFactories = {},
  } = {}) {
    // All dependency checks happen before a Three.js resource is created.
    assertSurface(surface);
    if (typeof boundsProvider !== 'function') {
      throw new TypeError('RenderStudioAppearanceController requires boundsProvider().');
    }
    assertMaterialProfileSetter(materialProfileSetter);
    assertAdapter('environmentAdapter', environmentAdapter, [
      'setEnvironment',
      'setEnvironmentMap',
      'setEnvironmentAsset',
      'dispose',
    ]);
    assertAdapter('backgroundAdapter', backgroundAdapter, [
      'setBackgroundImage',
      'setBackgroundAsset',
      'dispose',
    ]);
    assertAdapter('reflectionAdapter', reflectionAdapter, ['setFloorReflection', 'dispose']);
    assertObject('threeFactories', threeFactories);

    const factories = {
      createGroup: pickFactory(threeFactories, ['createGroup', 'groupFactory', 'Group'], () => new Group()),
      createHemisphereLight: pickFactory(
        threeFactories,
        ['createHemisphereLight', 'hemisphereLightFactory', 'HemisphereLight'],
        (skyColor, groundColor, intensity) => new HemisphereLight(skyColor, groundColor, intensity),
      ),
      createDirectionalLight: pickFactory(
        threeFactories,
        ['createDirectionalLight', 'directionalLightFactory', 'DirectionalLight'],
        (color, intensity) => new DirectionalLight(color, intensity),
      ),
      createPlaneGeometry: pickFactory(
        threeFactories,
        ['createPlaneGeometry', 'planeGeometryFactory', 'PlaneGeometry'],
        (width, height) => new PlaneGeometry(width, height),
      ),
      createShadowMaterial: pickFactory(
        threeFactories,
        ['createShadowMaterial', 'shadowMaterialFactory', 'ShadowMaterial'],
        (options) => new ShadowMaterial(options),
      ),
      createMesh: pickFactory(
        threeFactories,
        ['createMesh', 'meshFactory', 'Mesh'],
        (geometry, material) => new Mesh(geometry, material),
      ),
      createColor: pickFactory(
        threeFactories,
        ['createColor', 'colorFactory', 'Color'],
        (value) => new Color(value),
      ),
    };
    for (const [name, factory] of Object.entries(factories)) assertFactory(name, factory);

    this.surface = surface;
    this.boundsProvider = boundsProvider;
    this.materialProfileSetter = materialProfileSetter;
    this.environmentAdapter = environmentAdapter;
    this.backgroundAdapter = backgroundAdapter;
    this.reflectionAdapter = reflectionAdapter;
    this.disposed = false;
    this._group = null;
    this._floor = null;
    this._floorGeometry = null;
    this._floorMaterial = null;
    this._environmentTexture = null;
    this._backgroundTexture = null;
    this._environmentGeneration = 0;
    this._backgroundGeneration = 0;
    this._environmentAsset = null;
    this._backgroundAsset = null;
    this._backgroundImage = null;
    this._environmentMap = sanitizeEnvironmentMap();
    this._environmentPreset = 'studio';
    this._backgroundMode = 'solid';
    this._backgroundColor = DEFAULT_BACKGROUND_COLOR;
    this._environmentIntensity = DEFAULT_ENVIRONMENT_INTENSITY;
    this._lightAzimuth = DEFAULT_LIGHT_AZIMUTH;
    this._lightElevation = DEFAULT_LIGHT_ELEVATION;
    this._shadowEnabled = true;
    this._shadowMapSize = DEFAULT_SHADOW_MAP_SIZE;
    this._shadowBlur = DEFAULT_SHADOW_BLUR;
    this._shadowIntensity = DEFAULT_SHADOW_INTENSITY;
    this._floorReflectionSettings = { ...DEFAULT_FLOOR_REFLECTION };
    this._createColor = factories.createColor;

    try {
      this._group = factories.createGroup();
      if (!isObjectLike(this._group)
        || typeof this._group.add !== 'function'
        || typeof this._group.remove !== 'function') {
        throw new TypeError(
          'RenderStudioAppearanceController createGroup() must return a Group.',
        );
      }
      this._group.name = 'RenderStudioAppearance';

      this.hemisphereLight = factories.createHemisphereLight(0xffffff, 0x73777a, DEFAULT_HEMISPHERE_INTENSITY);
      this.directionalLight = factories.createDirectionalLight(0xffffff, DEFAULT_LIGHT_INTENSITY);
      this._floorGeometry = factories.createPlaneGeometry(1, 1);
      this._floorMaterial = factories.createShadowMaterial({
        color: 0x1d2428,
        opacity: DEFAULT_SHADOW_INTENSITY,
      });
      this._floor = factories.createMesh(this._floorGeometry, this._floorMaterial);
      if (!isObjectLike(this.hemisphereLight)
        || !isObjectLike(this.directionalLight)
        || !isObjectLike(this.directionalLight.target)
        || typeof this.directionalLight.target.position?.set !== 'function'
        || !isObjectLike(this._floor)
        || !isObjectLike(this._floorGeometry)
        || !isObjectLike(this._floorMaterial)) {
        throw new TypeError(
          'RenderStudioAppearanceController Three.js factories returned an invalid resource.',
        );
      }
      this._floor.name = 'RenderStudioShadowFloor';
      this._floor.rotation.x = -Math.PI / 2;
      this._floor.receiveShadow = true;
      this._floor.castShadow = false;
      this.directionalLight.castShadow = true;
      this.directionalLight.shadow.mapSize.set(DEFAULT_SHADOW_MAP_SIZE, DEFAULT_SHADOW_MAP_SIZE);
      this.directionalLight.shadow.radius = DEFAULT_SHADOW_BLUR;
      this._group.add(
        this.hemisphereLight,
        this.directionalLight,
        this.directionalLight.target,
        this._floor,
      );
      surface.renderSurface.scene.add(this._group);
      this._applyShadowState();
    } catch (error) {
      this.disposed = true;
      const cleanupError = this._cleanupOwnedResources();
      if (cleanupError && !error) throw cleanupError;
      throw error;
    }
  }

  get appearanceGroup() {
    return this._group;
  }

  get floor() {
    return this._floor;
  }

  get environmentAsset() {
    return this._environmentAsset;
  }

  get environmentMap() {
    return { ...this._environmentMap };
  }

  getDiagnostics() {
    return {
      disposed: this.disposed,
      backgroundMode: this._backgroundMode,
      backgroundColor: this._backgroundColor,
      environmentPreset: this._environmentPreset,
      environmentAsset: this._environmentAsset,
      environmentMap: { ...this._environmentMap },
      environmentIntensity: this._environmentIntensity,
      shadowEnabled: this._shadowEnabled,
      shadowMapSize: this._shadowMapSize,
      shadowBlur: this._shadowBlur,
      shadowIntensity: this._shadowIntensity,
      floorReflection: { ...this._floorReflectionSettings },
      environmentAdapter: this.environmentAdapter.getDiagnostics?.() || null,
      backgroundAdapter: this.backgroundAdapter.getDiagnostics?.() || null,
      reflectionAdapter: this.reflectionAdapter.getDiagnostics?.() || null,
    };
  }

  _resolveBounds() {
    return validateBounds(this.boundsProvider());
  }

  _positionAppearance(bounds, azimuth = this._lightAzimuth, elevation = this._lightElevation) {
    const distance = Math.max(bounds.radius * 4, 0.1);
    const elevationRadians = elevation * Math.PI / 180;
    const azimuthRadians = azimuth * Math.PI / 180;
    const lightPosition = {
      x: bounds.centerX + Math.sin(elevationRadians) * Math.cos(azimuthRadians) * distance,
      y: bounds.centerY + Math.cos(elevationRadians) * distance,
      z: bounds.centerZ + Math.sin(elevationRadians) * Math.sin(azimuthRadians) * distance,
    };
    const extent = Math.max(
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
      bounds.maxZ - bounds.minZ,
      bounds.radius * 2,
      0.01,
    ) * 2.5;
    const floorPosition = {
      x: bounds.centerX,
      y: bounds.minY - 0.01,
      z: bounds.centerZ,
    };

    this.directionalLight.position.set(lightPosition.x, lightPosition.y, lightPosition.z);
    this.directionalLight.target.position.set(bounds.centerX, bounds.centerY, bounds.centerZ);
    this.directionalLight.target.updateMatrixWorld?.(true);
    this.directionalLight.updateMatrixWorld?.(true);
    this._floor.scale.set(extent, extent, 1);
    this._floor.position.set(floorPosition.x, floorPosition.y, floorPosition.z);

    const shadowCamera = this.directionalLight.shadow?.camera;
    if (shadowCamera) {
      const halfExtent = extent / 2;
      shadowCamera.left = -halfExtent;
      shadowCamera.right = halfExtent;
      shadowCamera.top = halfExtent;
      shadowCamera.bottom = -halfExtent;
      shadowCamera.near = 0.1;
      shadowCamera.far = extent * 4;
      shadowCamera.updateProjectionMatrix();
    }
  }

  _applyShadowState() {
    const enabled = this._shadowEnabled;
    const rendererShadowMap = this.surface.renderSurface.renderer.shadowMap;
    rendererShadowMap.enabled = enabled;
    rendererShadowMap.needsUpdate = true;
    this.directionalLight.castShadow = enabled;
    this._floor.visible = enabled || this._shadowIntensity > 0;
  }

  _applyEnvironmentTexture(texture) {
    if (texture === null) this._environmentTexture = null;
    else if (texture) this._environmentTexture = texture;
    this.surface.renderSurface.scene.environment = this._environmentTexture;
    if (this._backgroundMode === 'environment') {
      this.surface.renderSurface.scene.background = this._environmentTexture;
    }
    this.surface.render?.();
  }

  _applyBackgroundTexture(texture) {
    if (texture === null) this._backgroundTexture = null;
    else if (texture) this._backgroundTexture = texture;
    if (this._backgroundMode === 'image') {
      this.surface.renderSurface.scene.background = this._backgroundTexture;
    }
    this.surface.render?.();
  }

  _updateHemisphereForEnvironment(preset) {
    if (!this.hemisphereLight) return;
    if (preset === 'none') {
      this.hemisphereLight.visible = false;
    } else {
      this.hemisphereLight.visible = true;
      const palette = ENVIRONMENT_PALETTES[preset] || ENVIRONMENT_PALETTES.studio;
      this.hemisphereLight.color?.set?.(palette.key);
      this.hemisphereLight.groundColor?.set?.(palette.ground);
    }
    this.surface.render?.();
  }

  _applyToneMapping(mode) {
    this.surface.renderSurface.renderer.toneMapping = mode === 'none'
      ? NoToneMapping
      : NeutralToneMapping;
  }

  setToneMapping(mode = 'neutral') {
    if (this.disposed || !VALID_TONE_MAPPINGS.has(mode)) return false;
    this._applyToneMapping(mode);
    return true;
  }

  setMaterialProfile(...args) {
    if (this.disposed) return false;
    if (typeof this.materialProfileSetter === 'function') {
      return this.materialProfileSetter(...args);
    }
    return this.materialProfileSetter.setMaterialProfile(...args);
  }

  setLightDirection(azimuth, elevation) {
    if (this.disposed || !finiteNumber(azimuth) || !finiteNumber(elevation)
      || elevation < 5 || elevation > 85) return false;
    const bounds = this._resolveBounds();
    const nextAzimuth = normalizeAzimuth(azimuth);
    this._positionAppearance(bounds, nextAzimuth, elevation);
    this._lightAzimuth = nextAzimuth;
    this._lightElevation = elevation;
    return true;
  }

  setLightIntensity(intensity) {
    if (this.disposed || !finiteNumber(intensity) || intensity < 0 || intensity > 10) return false;
    this.directionalLight.intensity = intensity;
    return true;
  }

  setHemisphereIntensity(intensity) {
    if (this.disposed || !finiteNumber(intensity) || intensity < 0 || intensity > 5) return false;
    this.hemisphereLight.intensity = intensity;
    return true;
  }

  setEnvironmentIntensity(intensity) {
    if (this.disposed || !finiteNumber(intensity) || intensity < 0 || intensity > 5) return false;
    this._environmentIntensity = intensity;
    this.surface.renderSurface.scene.environmentIntensity = intensity;
    return true;
  }

  setEnvironment(...args) {
    if (this.disposed) return false;
    const generation = ++this._environmentGeneration;
    this._environmentPreset = args[0];
    this._updateHemisphereForEnvironment(this._environmentPreset);
    return applyAsyncResult(
      this.environmentAdapter.setEnvironment(...args),
      (value) => this._applyEnvironmentTexture(resolveTexture(value) || (value === null ? null : undefined)),
      () => !this.disposed && generation === this._environmentGeneration,
    );
  }

  setEnvironmentMap(environmentMap, ...args) {
    if (this.disposed) return false;
    const generation = ++this._environmentGeneration;
    this._environmentMap = cloneEnvironmentMap(environmentMap);
    const map = this._environmentMap;
    const legacyPreset = getEnvironmentMapPreset(map?.presetId)?.legacyPreset;
    if (legacyPreset) this._updateHemisphereForEnvironment(legacyPreset);
    const scene = this.surface.renderSurface.scene;
    scene.environmentIntensity = map.intensity;
    scene.backgroundIntensity = map.backgroundIntensity;
    scene.backgroundBlurriness = map.backgroundBlur;
    if (scene.environmentRotation?.set) scene.environmentRotation.set(0, map.rotation * Math.PI / 180, 0);
    if (scene.backgroundRotation?.set) scene.backgroundRotation.set(0, map.rotation * Math.PI / 180, 0);
    return applyAsyncResult(
      this.environmentAdapter.setEnvironmentMap(environmentMap, ...args),
      (value) => this._applyEnvironmentTexture(resolveTexture(value) || (value === null ? null : undefined)),
      () => !this.disposed && generation === this._environmentGeneration,
    );
  }

  setShadowsEnabled(enabled) {
    if (this.disposed || typeof enabled !== 'boolean') return false;
    this._shadowEnabled = enabled;
    this._applyShadowState();
    return true;
  }

  setShadowMapSize(size) {
    if (this.disposed || !finiteNumber(size) || !VALID_SHADOW_MAP_SIZES.has(size)) return false;
    const cleanupError = this._disposeShadowMap();
    if (cleanupError) throw cleanupError;
    this._shadowMapSize = size;
    this.directionalLight.shadow.mapSize.set(size, size);
    this._applyShadowState();
    return true;
  }

  setShadowBlur(blur) {
    if (this.disposed || !finiteNumber(blur) || blur < 0 || blur > 8) return false;
    this._shadowBlur = blur;
    this.directionalLight.shadow.radius = blur;
    this.surface.renderSurface.renderer.shadowMap.needsUpdate = true;
    return true;
  }

  setShadowIntensity(intensity) {
    if (this.disposed || !finiteNumber(intensity) || intensity < 0 || intensity > 1) return false;
    this._shadowIntensity = intensity;
    this._floorMaterial.opacity = intensity;
    this._floor.visible = this._shadowEnabled || intensity > 0;
    return true;
  }

  setBackgroundMode(mode, color = this._backgroundColor) {
    if (this.disposed || !VALID_BACKGROUND_MODES.has(mode)) return false;
    const nextColor = color === undefined || color === null
      ? this._backgroundColor
      : validateColor(color);
    let nextBackground;
    if (mode === 'solid') {
      nextBackground = this._createColor(nextColor);
      if (!isObjectLike(nextBackground)) {
        throw new TypeError(
          'RenderStudioAppearanceController createColor() must return a Color.',
        );
      }
    } else if (mode === 'transparent') {
      nextBackground = null;
    } else if (mode === 'image') {
      nextBackground = this._backgroundTexture;
    } else {
      nextBackground = this._environmentTexture;
    }

    const scene = this.surface.renderSurface.scene;
    const renderer = this.surface.renderSurface.renderer;
    scene.background = nextBackground;
    if (mode === 'transparent') renderer.setClearColor(0x000000, 0);
    else if (mode === 'solid') renderer.setClearColor(nextColor, 1);
    else renderer.setClearColor(0x000000, 1);
    this._backgroundMode = mode;
    this._backgroundColor = nextColor;
    this.reflectionAdapter.setBackgroundMode?.(mode);
    return true;
  }

  setBackgroundImage(...args) {
    if (this.disposed) return false;
    const generation = ++this._backgroundGeneration;
    this._backgroundImage = args[0];
    return applyAsyncResult(
      this.backgroundAdapter.setBackgroundImage(...args),
      (value) => this._applyBackgroundTexture(resolveTexture(value) || (value === null ? null : undefined)),
      () => !this.disposed && generation === this._backgroundGeneration,
    );
  }

  setBackgroundAsset(...args) {
    if (this.disposed) return false;
    const generation = ++this._backgroundGeneration;
    this._backgroundAsset = args[0];
    return applyAsyncResult(
      this.backgroundAdapter.setBackgroundAsset(...args),
      (value) => this._applyBackgroundTexture(resolveTexture(value) || (value === null ? null : undefined)),
      () => !this.disposed && generation === this._backgroundGeneration,
    );
  }

  setEnvironmentAsset(...args) {
    if (this.disposed) return false;
    const generation = ++this._environmentGeneration;
    this._environmentAsset = args[0] || null;
    return applyAsyncResult(
      this.environmentAdapter.setEnvironmentAsset(...args),
      (value) => this._applyEnvironmentTexture(resolveTexture(value) || (value === null ? null : undefined)),
      () => !this.disposed && generation === this._environmentGeneration,
    );
  }

  setFloorReflection(...args) {
    if (this.disposed) return false;
    const settings = args[0];
    if (settings && typeof settings === 'object') {
      this._floorReflectionSettings = {
        ...this._floorReflectionSettings,
        ...(Object.hasOwn(settings, 'enabled') ? { enabled: settings.enabled === true } : {}),
        ...(Object.hasOwn(settings, 'strength') ? { strength: settings.strength } : {}),
        ...(Object.hasOwn(settings, 'blur') ? { blur: settings.blur } : {}),
        ...(Object.hasOwn(settings, 'fadeDistance') ? { fadeDistance: settings.fadeDistance } : {}),
        ...(Object.hasOwn(settings, 'includeInTransparentExport')
          ? { includeInTransparentExport: settings.includeInTransparentExport === true }
          : {}),
      };
    }
    return this.reflectionAdapter.setFloorReflection(...args);
  }

  /**
   * Apply temporary output-only appearance state and return an idempotent
   * restore function. RenderTargetService uses this public seam instead of
   * reaching into appearance state owned by this controller.
   */
  beginRenderStateTransaction({
    backgroundMode = this._backgroundMode,
    backgroundColor = this._backgroundColor,
    includeShadow = true,
    includeReflection = true,
  } = {}) {
    if (this.disposed) return false;
    const snapshot = {
      backgroundMode: this._backgroundMode,
      backgroundColor: this._backgroundColor,
      shadowEnabled: this._shadowEnabled,
      shadowIntensity: this._shadowIntensity,
      floorReflection: { ...this._floorReflectionSettings },
    };
    let restored = false;
    const restore = () => {
      if (restored) return false;
      restored = true;
      let restoreError = null;
      restoreError = firstError(restoreError, () => (
        this.setBackgroundMode(snapshot.backgroundMode, snapshot.backgroundColor)
      ));
      restoreError = firstError(restoreError, () => this.setShadowsEnabled(snapshot.shadowEnabled));
      restoreError = firstError(restoreError, () => this.setShadowIntensity(snapshot.shadowIntensity));
      restoreError = firstError(restoreError, () => this.setFloorReflection(snapshot.floorReflection));
      if (restoreError) throw restoreError;
      return true;
    };

    try {
      this.setBackgroundMode(backgroundMode, backgroundColor);
      if (!includeShadow) {
        this.setShadowsEnabled(false);
        this.setShadowIntensity(0);
      }
      if (!includeReflection) {
        this.setFloorReflection({ enabled: false });
      }
    } catch (error) {
      try {
        restore();
      } catch {
        // Keep the original transaction error observable.
      }
      throw error;
    }
    return restore;
  }

  setExposure(exposure) {
    if (this.disposed || !finiteNumber(exposure) || exposure < 0.1 || exposure > 3) return false;
    this.surface.renderSurface.renderer.toneMappingExposure = exposure;
    return true;
  }

  _disposeShadowMap() {
    const shadow = this.directionalLight?.shadow;
    const shadowMap = shadow?.map;
    if (!shadowMap) return null;

    shadow.map = null;
    let cleanupError = null;
    if (shadowMap.depthTexture && typeof shadowMap.depthTexture.dispose === 'function') {
      const depthTexture = shadowMap.depthTexture;
      shadowMap.depthTexture = null;
      cleanupError = firstError(cleanupError, () => depthTexture.dispose());
    }
    if (typeof shadowMap.dispose === 'function') {
      cleanupError = firstError(cleanupError, () => shadowMap.dispose());
    }
    return cleanupError;
  }

  _cleanupOwnedResources() {
    let cleanupError = null;
    const scene = this.surface?.renderSurface?.scene;
    if (scene && this._group) {
      cleanupError = firstError(cleanupError, () => scene.remove(this._group));
    }
    const shadowMapError = this._disposeShadowMap();
    cleanupError ||= shadowMapError;
    if (this._floorGeometry && typeof this._floorGeometry.dispose === 'function') {
      cleanupError = firstError(cleanupError, () => this._floorGeometry.dispose());
    }
    if (this._floorMaterial && typeof this._floorMaterial.dispose === 'function') {
      cleanupError = firstError(cleanupError, () => this._floorMaterial.dispose());
    }

    const adapters = [this.reflectionAdapter, this.backgroundAdapter, this.environmentAdapter];
    const disposedAdapters = new Set();
    for (const adapter of adapters) {
      if (!adapter || disposedAdapters.has(adapter)) continue;
      disposedAdapters.add(adapter);
      cleanupError = firstError(cleanupError, () => adapter.dispose());
    }
    return cleanupError;
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    this._environmentGeneration += 1;
    this._backgroundGeneration += 1;
    const cleanupError = this._cleanupOwnedResources();
    if (cleanupError) throw cleanupError;
    return true;
  }
}
