import { PlaneGeometry, Vector2 } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  strength: 0.08,
  blur: 0.65,
  fadeDistance: 0.65,
  includeInTransparentExport: false,
});

// Reflector's stock shader always emits an opaque pixel. Keep its reflection
// camera and render target, but composite the result with the Render Studio
// strength, blur and edge-fade controls.
const FLOOR_REFLECTION_SHADER = {
  name: 'CartonBuilderRenderStudioFloorReflectionShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    strength: { value: 0 },
    blur: { value: 0 },
    fadeDistance: { value: 0.65 },
    texelSize: { value: new Vector2(1 / 512, 1 / 512) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vPlaneUv;

    #include <common>
    #include <logdepthbuf_pars_vertex>

    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vPlaneUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float blur;
    uniform float fadeDistance;
    uniform vec2 texelSize;
    varying vec4 vUv;
    varying vec2 vPlaneUv;

    #include <logdepthbuf_pars_fragment>

    float blendOverlay(float base, float blend) {
      return base < 0.5
        ? 2.0 * base * blend
        : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
    }

    vec3 blendOverlay(vec3 base, vec3 blend) {
      return vec3(
        blendOverlay(base.r, blend.r),
        blendOverlay(base.g, blend.g),
        blendOverlay(base.b, blend.b)
      );
    }

    vec4 sampleReflection(vec2 uv) {
      return texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999)));
    }

    void main() {
      #include <logdepthbuf_fragment>

      vec2 projectedUv = vUv.xy / max(vUv.w, 0.0001);
      vec2 offset = texelSize * (0.75 + blur * 3.25);
      vec4 center = sampleReflection(projectedUv);
      vec4 blurred = center;
      blurred += sampleReflection(projectedUv + vec2(offset.x, 0.0));
      blurred += sampleReflection(projectedUv - vec2(offset.x, 0.0));
      blurred += sampleReflection(projectedUv + vec2(0.0, offset.y));
      blurred += sampleReflection(projectedUv - vec2(0.0, offset.y));
      blurred += sampleReflection(projectedUv + offset);
      blurred += sampleReflection(projectedUv - offset);
      blurred += sampleReflection(projectedUv + vec2(offset.x, -offset.y));
      blurred += sampleReflection(projectedUv + vec2(-offset.x, offset.y));
      blurred /= 9.0;
      vec3 reflection = mix(center.rgb, blurred.rgb, clamp(blur, 0.0, 1.0));

      float radial = length((vPlaneUv - vec2(0.5)) * 2.0);
      float fadeEnd = clamp(0.45 + fadeDistance * 0.1, 0.45, 0.95);
      float fadeStart = fadeEnd * 0.35;
      float fade = 1.0 - smoothstep(fadeStart, fadeEnd, radial);
      float alpha = clamp(strength, 0.0, 1.0) * fade;

      gl_FragColor = vec4(blendOverlay(reflection, color), alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function firstError(current, callback) {
  try {
    callback();
  } catch (error) {
    return current || error;
  }
  return current;
}

function assertSurface(renderSurface) {
  if (!isObjectLike(renderSurface)
    || !isObjectLike(renderSurface.scene)
    || typeof renderSurface.scene.add !== 'function'
    || typeof renderSurface.scene.remove !== 'function'
    || !isObjectLike(renderSurface.renderer)) {
    throw new TypeError(
      'RenderStudioReflectionAdapter requires a renderSurface with scene and renderer.',
    );
  }
}

function normalizeSettings(input, previous = DEFAULT_SETTINGS) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    enabled: Object.hasOwn(value, 'enabled') ? value.enabled === true : previous.enabled,
    strength: numberInRange(value.strength, previous.strength, 0, 1),
    blur: numberInRange(value.blur, previous.blur, 0, 1),
    fadeDistance: numberInRange(value.fadeDistance, previous.fadeDistance, 0.05, 5),
    includeInTransparentExport: Object.hasOwn(value, 'includeInTransparentExport')
      ? value.includeInTransparentExport === true
      : previous.includeInTransparentExport,
  };
}

function validateBounds(bounds) {
  if (!isObjectLike(bounds)) throw new Error('Render reflection requires finite Technical bounds.');
  const values = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ', 'centerX', 'centerY', 'centerZ'];
  if (!values.every((key) => Number.isFinite(Number(bounds[key])))) {
    throw new Error('Render reflection requires finite Technical bounds.');
  }
  const width = Number.isFinite(Number(bounds.width))
    ? Number(bounds.width)
    : Number(bounds.maxX) - Number(bounds.minX);
  const depth = Number.isFinite(Number(bounds.depth))
    ? Number(bounds.depth)
    : Number(bounds.maxZ) - Number(bounds.minZ);
  if (!(width > 0) || !(depth > 0)) throw new Error('Render reflection requires non-empty Technical bounds.');
  return {
    minY: Number(bounds.minY),
    centerX: Number(bounds.centerX),
    centerZ: Number(bounds.centerZ),
    width,
    depth,
  };
}

function setMaterialPresentation(material, settings, size = null) {
  if (!material) return;
  const uniforms = material.uniforms || {};
  if (uniforms.strength) uniforms.strength.value = settings.strength;
  if (uniforms.blur) uniforms.blur.value = settings.blur;
  if (uniforms.fadeDistance) uniforms.fadeDistance.value = settings.fadeDistance;
  if (size && uniforms.texelSize?.value?.set) {
    uniforms.texelSize.value.set(1 / size.width, 1 / size.height);
  }
  if ('opacity' in material) material.opacity = 1;
  if ('transparent' in material) material.transparent = true;
  if ('depthWrite' in material) material.depthWrite = false;
  material.userData = {
    ...(material.userData || {}),
    cartonBuilderReflection: {
      blur: settings.blur,
      fadeDistance: settings.fadeDistance,
    },
  };
  material.needsUpdate = true;
}

/** Production-owned floor reflection resource for a shared Render surface. */
export class RenderStudioReflectionAdapter {
  constructor({
    renderSurface,
    surface = null,
    boundsProvider,
    planeGeometryFactory = (width, height) => new PlaneGeometry(width, height),
    reflectorFactory = (geometry, options) => new Reflector(geometry, options),
    reflectionFactory = null,
    transparent = false,
  } = {}) {
    const resolvedSurface = renderSurface || surface?.renderSurface;
    assertSurface(resolvedSurface);
    if (typeof boundsProvider !== 'function') {
      throw new TypeError('RenderStudioReflectionAdapter requires boundsProvider().');
    }
    if (typeof planeGeometryFactory !== 'function') {
      throw new TypeError('RenderStudioReflectionAdapter requires planeGeometryFactory().');
    }
    if (typeof (reflectionFactory || reflectorFactory) !== 'function') {
      throw new TypeError('RenderStudioReflectionAdapter requires reflectorFactory().');
    }

    this.renderSurface = resolvedSurface;
    this.surface = surface;
    this.boundsProvider = boundsProvider;
    this.planeGeometryFactory = planeGeometryFactory;
    this.reflectorFactory = reflectionFactory || reflectorFactory;
    this.disposed = false;
    this._transparent = transparent === true;
    this._settings = { ...DEFAULT_SETTINGS };
    this._reflector = null;
    this._geometry = null;
    this._contextLost = false;
  }

  get reflector() {
    return this._reflector;
  }

  _rendererSize() {
    const renderer = this.renderSurface.renderer;
    const size = { x: 512, y: 512 };
    if (typeof renderer.getSize === 'function') {
      try {
        renderer.getSize(size);
      } catch {
        // Keep the conservative default when a headless renderer has no size.
      }
    }
    return {
      width: Math.max(1, Math.round(Number(size.x) || 512)),
      height: Math.max(1, Math.round(Number(size.y) || 512)),
    };
  }

  _createResource() {
    if (this._reflector || this._contextLost || !this._settings.enabled) return;
    const bounds = validateBounds(this.boundsProvider());
    const geometry = this.planeGeometryFactory(1, 1);
    let reflector = null;
    try {
      const size = this._rendererSize();
      reflector = this.reflectorFactory(geometry, {
        textureWidth: size.width,
        textureHeight: size.height,
        clipBias: 0.002,
        color: 0xffffff,
        shader: FLOOR_REFLECTION_SHADER,
        renderSurface: this.renderSurface,
      });
      if (!isObjectLike(reflector) || typeof reflector.dispose !== 'function') {
        throw new TypeError('RenderStudioReflectionAdapter reflectorFactory must return a disposable reflector.');
      }
      reflector.name = 'RenderStudioFloorReflection';
      reflector.renderOrder = -10;
      if (reflector.position?.set) reflector.position.set(
        bounds.centerX,
        bounds.minY - 0.0005,
        bounds.centerZ,
      );
      if (reflector.rotation) reflector.rotation.x = -Math.PI / 2;
      const extent = this._settings.fadeDistance * 2;
      if (reflector.scale?.set) reflector.scale.set(
        bounds.width + extent,
        bounds.depth + extent,
        1,
      );
      setMaterialPresentation(reflector.material, this._settings, size);
      reflector.visible = this._isVisible();
      this.renderSurface.scene.add(reflector);
      this._geometry = geometry;
      this._reflector = reflector;
    } catch (error) {
      try { reflector?.dispose?.(); } catch { /* preserve construction error */ }
      try { geometry?.dispose?.(); } catch { /* preserve construction error */ }
      throw error;
    }
  }

  _isVisible() {
    return this._settings.enabled
      && (!this._transparent || this._settings.includeInTransparentExport);
  }

  _applySettings() {
    if (!this._reflector) {
      this._createResource();
      return;
    }
    this._reflector.visible = this._isVisible();
    setMaterialPresentation(this._reflector.material, this._settings);
  }

  setFloorReflection(settings = {}) {
    if (this.disposed) return false;
    const next = normalizeSettings(settings, this._settings);
    const changed = JSON.stringify(next) !== JSON.stringify(this._settings);
    this._settings = next;
    if (next.enabled && !this._contextLost) this._applySettings();
    else if (this._reflector) this._reflector.visible = false;
    return changed;
  }

  setBackgroundMode(mode) {
    if (this.disposed) return false;
    const nextTransparent = mode === 'transparent';
    if (nextTransparent === this._transparent) return false;
    this._transparent = nextTransparent;
    if (this._reflector) this._reflector.visible = this._isVisible();
    return true;
  }

  getDiagnostics() {
    return {
      enabled: this._settings.enabled,
      visible: Boolean(this._reflector?.visible),
      strength: this._settings.strength,
      blur: this._settings.blur,
      fadeDistance: this._settings.fadeDistance,
      includeInTransparentExport: this._settings.includeInTransparentExport,
      contextLost: this._contextLost,
    };
  }

  handleContextLost() {
    if (this.disposed || this._contextLost) return false;
    this._contextLost = true;
    return this._disposeResource() === null;
  }

  handleContextRestored() {
    if (this.disposed || !this._contextLost) return false;
    this._contextLost = false;
    if (this._settings.enabled) this._createResource();
    return true;
  }

  _disposeResource() {
    let firstDisposalError = null;
    if (this._reflector) {
      firstDisposalError = firstError(firstDisposalError, () => (
        this.renderSurface.scene.remove(this._reflector)
      ));
      firstDisposalError = firstError(firstDisposalError, () => this._reflector.dispose());
      this._reflector = null;
    }
    if (this._geometry) {
      firstDisposalError = firstError(firstDisposalError, () => this._geometry.dispose());
      this._geometry = null;
    }
    return firstDisposalError;
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    const error = this._disposeResource();
    if (error) throw error;
    return true;
  }
}
