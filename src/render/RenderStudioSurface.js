import {
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';

const DEFAULT_PERSPECTIVE_FOV = 45;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 10_000;
const DEFAULT_ORTHOGRAPHIC_HEIGHT = 2;

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function assertFunction(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`RenderStudioSurface requires ${name} to be a function.`);
  }
}

function assertProjection(projection) {
  if (projection !== 'perspective' && projection !== 'orthographic') {
    throw new TypeError('RenderStudioSurface projection must be "perspective" or "orthographic".');
  }
  return projection;
}

function assertCanvas(canvas) {
  if (!isObjectLike(canvas)
    || typeof canvas.addEventListener !== 'function'
    || typeof canvas.removeEventListener !== 'function') {
    throw new TypeError('RenderStudioSurface requires a canvas event target.');
  }
}

function assertScene(scene) {
  if (!isObjectLike(scene)
    || typeof scene.add !== 'function'
    || typeof scene.remove !== 'function') {
    throw new TypeError('RenderStudioSurface scene factory must return a Three.js scene.');
  }
}

function assertCamera(name, camera) {
  if (!isObjectLike(camera)
    || typeof camera.updateProjectionMatrix !== 'function') {
    throw new TypeError(`RenderStudioSurface ${name} camera factory must return a camera.`);
  }
}

function assertRenderer(renderer) {
  if (!isObjectLike(renderer)
    || typeof renderer.setSize !== 'function'
    || typeof renderer.setPixelRatio !== 'function'
    || typeof renderer.render !== 'function'
    || typeof renderer.dispose !== 'function') {
    throw new TypeError('RenderStudioSurface renderer factory must return a WebGL renderer.');
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

/**
 * Geometry-free owner of the shared Render surface.
 *
 * This class intentionally knows nothing about carton geometry, materials,
 * lighting, backgrounds, controls or Render UI state. It only owns the
 * Three.js surface and its lifecycle.
 */
export class RenderStudioSurface {
  constructor({
    canvas,
    container,
    windowRef = globalThis.window || globalThis,
    projection = 'perspective',
    alpha = true,
    onContextLost = () => {},
    onContextRestored = () => {},
    sceneFactory = () => new Scene(),
    perspectiveCameraFactory = (fov, aspect, near, far) => (
      new PerspectiveCamera(fov, aspect, near, far)
    ),
    orthographicCameraFactory = (left, right, top, bottom, near, far) => (
      new OrthographicCamera(left, right, top, bottom, near, far)
    ),
    rendererFactory = (options) => new WebGLRenderer(options),
    resizeObserverFactory = null,
    orthographicHeight = DEFAULT_ORTHOGRAPHIC_HEIGHT,
  } = {}) {
    this.disposed = false;
    this.scene = null;
    this.renderer = null;
    this.perspectiveCamera = null;
    this.orthographicCamera = null;
    this._activeCamera = null;
    this._renderCallback = null;
    this._resizeObserver = null;
    this._usingWindowResize = false;
    this._contextLostListenerAttached = false;
    this._contextRestoredListenerAttached = false;
    this._lastViewport = null;
    this._rendererDisposed = false;
    this._canvas = canvas;
    this._container = container;
    this._windowRef = windowRef;
    this._onContextLost = typeof onContextLost === 'function' ? onContextLost : () => {};
    this._onContextRestored = typeof onContextRestored === 'function' ? onContextRestored : () => {};
    this._orthographicHeight = Number(orthographicHeight) > 0
      ? Number(orthographicHeight)
      : DEFAULT_ORTHOGRAPHIC_HEIGHT;
    this._onContextLostEvent = (event) => {
      if (this.disposed) return;
      event?.preventDefault?.();
      this._onContextLost(event);
    };
    this._onContextRestoredEvent = (event) => {
      if (this.disposed) return;
      this._onContextRestored(event);
    };
    this._onResize = () => this.resize();

    try {
      assertCanvas(canvas);
      if (!isObjectLike(windowRef)) {
        throw new TypeError('RenderStudioSurface requires a windowRef object.');
      }
      const initialProjection = assertProjection(projection);
      assertFunction('sceneFactory', sceneFactory);
      assertFunction('perspectiveCameraFactory', perspectiveCameraFactory);
      assertFunction('orthographicCameraFactory', orthographicCameraFactory);
      assertFunction('rendererFactory', rendererFactory);
      if (resizeObserverFactory !== null) assertFunction('resizeObserverFactory', resizeObserverFactory);

      const hasResizeObserver = typeof resizeObserverFactory === 'function'
        || typeof windowRef.ResizeObserver === 'function';
      if (!hasResizeObserver
        && (typeof windowRef.addEventListener !== 'function'
          || typeof windowRef.removeEventListener !== 'function')) {
        throw new TypeError('RenderStudioSurface requires ResizeObserver or window resize events.');
      }

      this.scene = sceneFactory();
      assertScene(this.scene);
      this.perspectiveCamera = perspectiveCameraFactory(
        DEFAULT_PERSPECTIVE_FOV,
        1,
        DEFAULT_NEAR,
        DEFAULT_FAR,
      );
      this.orthographicCamera = orthographicCameraFactory(
        -1,
        1,
        1,
        -1,
        DEFAULT_NEAR,
        DEFAULT_FAR,
      );
      assertCamera('perspective', this.perspectiveCamera);
      assertCamera('orthographic', this.orthographicCamera);
      this._perspectiveFov = Number.isFinite(this.perspectiveCamera.fov)
        ? this.perspectiveCamera.fov
        : DEFAULT_PERSPECTIVE_FOV;
      this.perspectiveCamera.fov = this._perspectiveFov;
      this.scene.add(this.perspectiveCamera, this.orthographicCamera);
      this._updateOrthographicFrame(1, 1);
      this._activeCamera = initialProjection === 'orthographic'
        ? this.orthographicCamera
        : this.perspectiveCamera;

      this.renderer = rendererFactory({
        canvas,
        antialias: true,
        alpha: Boolean(alpha),
        powerPreference: 'high-performance',
      });
      assertRenderer(this.renderer);

      canvas.addEventListener('webglcontextlost', this._onContextLostEvent);
      this._contextLostListenerAttached = true;
      canvas.addEventListener('webglcontextrestored', this._onContextRestoredEvent);
      this._contextRestoredListenerAttached = true;

      if (resizeObserverFactory) {
        this._resizeObserver = resizeObserverFactory(this._onResize);
        if (!isObjectLike(this._resizeObserver)
          || typeof this._resizeObserver.observe !== 'function'
          || typeof this._resizeObserver.disconnect !== 'function') {
          throw new TypeError('RenderStudioSurface resizeObserverFactory must return an observer.');
        }
        this._resizeObserver.observe(container);
      } else if (typeof windowRef.ResizeObserver === 'function') {
        this._resizeObserver = new windowRef.ResizeObserver(this._onResize);
        if (!isObjectLike(this._resizeObserver)
          || typeof this._resizeObserver.observe !== 'function'
          || typeof this._resizeObserver.disconnect !== 'function') {
          throw new TypeError('RenderStudioSurface ResizeObserver must return an observer.');
        }
        this._resizeObserver.observe(container);
      } else {
        windowRef.addEventListener('resize', this._onResize);
        this._usingWindowResize = true;
      }

      this.resize({ render: false });
    } catch (error) {
      this.disposed = true;
      this._cleanupResources();
      throw error;
    }

    const owner = this;
    this._renderSurface = Object.freeze({
      get scene() { return owner.scene; },
      get camera() { return owner._activeCamera; },
      get renderer() { return owner.renderer; },
    });
  }

  get renderSurface() {
    return this._renderSurface;
  }

  get canvas() {
    return this._canvas;
  }

  get camera() {
    return this._activeCamera;
  }

  setCameraProjection(projection) {
    if (this.disposed) return false;
    const nextProjection = assertProjection(projection);
    const nextCamera = nextProjection === 'orthographic'
      ? this.orthographicCamera
      : this.perspectiveCamera;
    if (nextCamera === this._activeCamera) return false;
    this._activeCamera = nextCamera;
    return true;
  }

  setProjection(projection) {
    return this.setCameraProjection(projection);
  }

  setPerspectiveFov(fov) {
    if (this.disposed || !Number.isFinite(fov)) return false;
    const nextFov = Math.max(10, Math.min(120, fov));
    if (nextFov === this._perspectiveFov) return false;
    this._perspectiveFov = nextFov;
    this.perspectiveCamera.fov = nextFov;
    this.perspectiveCamera.updateProjectionMatrix();
    return true;
  }

  setOrthographicHeight(height) {
    if (this.disposed || !Number.isFinite(height) || !(height > 0)) return false;
    if (height === this._orthographicHeight) return false;
    this._orthographicHeight = height;
    this._applyOrthographicFrame(this._getViewportAspect());
    return true;
  }

  getCameraOptics() {
    return {
      projection: this._activeCamera === this.orthographicCamera
        ? 'orthographic'
        : 'perspective',
      perspectiveFov: this._perspectiveFov,
      orthographicHeight: this._orthographicHeight,
      aspect: this._getViewportAspect(),
    };
  }

  setRenderCallback(callback = null) {
    if (this.disposed) return false;
    this._renderCallback = typeof callback === 'function' ? callback : null;
    return true;
  }

  resize(options = {}, height, pixelRatio) {
    if (this.disposed) return false;

    let requestedWidth;
    let requestedHeight;
    let requestedPixelRatio;
    let render = true;
    if (typeof options === 'number') {
      requestedWidth = options;
      requestedHeight = height;
      requestedPixelRatio = pixelRatio;
    } else {
      ({
        width: requestedWidth,
        height: requestedHeight,
        pixelRatio: requestedPixelRatio,
        render = true,
      } = options || {});
    }

    const width = requestedWidth !== undefined && requestedWidth !== null
      ? Number(requestedWidth)
      : Number(this._container?.clientWidth);
    const nextHeight = requestedHeight !== undefined && requestedHeight !== null
      ? Number(requestedHeight)
      : Number(this._container?.clientHeight);
    if (!(width > 0) || !(nextHeight > 0)) return false;

    if (Number.isFinite(Number(requestedPixelRatio)) && Number(requestedPixelRatio) > 0) {
      this.renderer.setPixelRatio(Number(requestedPixelRatio));
    }
    this.renderer.setSize(width, nextHeight, false);
    this.perspectiveCamera.aspect = width / nextHeight;
    this.perspectiveCamera.updateProjectionMatrix();
    this._updateOrthographicFrame(width, nextHeight);
    this._lastViewport = {
      width,
      height: nextHeight,
      pixelRatio: Number.isFinite(Number(requestedPixelRatio)) && Number(requestedPixelRatio) > 0
        ? Number(requestedPixelRatio)
        : this._lastViewport?.pixelRatio || null,
    };
    if (render) this.render();
    return true;
  }

  render() {
    if (this.disposed) return false;
    if (this._renderCallback) this._renderCallback();
    else this.renderer.render(this.scene, this._activeCamera);
    return true;
  }

  getLastViewport() {
    return this._lastViewport ? { ...this._lastViewport } : null;
  }

  _getViewportAspect() {
    if (this._lastViewport
      && this._lastViewport.width > 0
      && this._lastViewport.height > 0) {
      return this._lastViewport.width / this._lastViewport.height;
    }
    const width = Number(this._container?.clientWidth);
    const height = Number(this._container?.clientHeight);
    return width > 0 && height > 0 ? width / height : 1;
  }

  _updateOrthographicFrame(width, height) {
    this._applyOrthographicFrame(width / height);
  }

  _applyOrthographicFrame(aspect) {
    const halfHeight = this._orthographicHeight / 2;
    const halfWidth = halfHeight * aspect;
    this.orthographicCamera.left = -halfWidth;
    this.orthographicCamera.right = halfWidth;
    this.orthographicCamera.top = halfHeight;
    this.orthographicCamera.bottom = -halfHeight;
    this.orthographicCamera.updateProjectionMatrix();
  }

  _cleanupResources() {
    let cleanupError = null;

    if (this._resizeObserver) {
      cleanupError = firstError(cleanupError, () => this._resizeObserver.disconnect());
      this._resizeObserver = null;
    }
    if (this._usingWindowResize) {
      cleanupError = firstError(cleanupError, () => (
        this._windowRef.removeEventListener('resize', this._onResize)
      ));
      this._usingWindowResize = false;
    }
    if (this._contextLostListenerAttached) {
      cleanupError = firstError(cleanupError, () => (
        this._canvas.removeEventListener('webglcontextlost', this._onContextLostEvent)
      ));
      this._contextLostListenerAttached = false;
    }
    if (this._contextRestoredListenerAttached) {
      cleanupError = firstError(cleanupError, () => (
        this._canvas.removeEventListener('webglcontextrestored', this._onContextRestoredEvent)
      ));
      this._contextRestoredListenerAttached = false;
    }
    this._renderCallback = null;
    if (this.scene) {
      cleanupError = firstError(cleanupError, () => {
        this.scene.remove(this.perspectiveCamera, this.orthographicCamera);
      });
    }
    if (this.renderer && !this._rendererDisposed) {
      this._rendererDisposed = true;
      cleanupError = firstError(cleanupError, () => this.renderer.dispose());
    }
    return cleanupError;
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    const cleanupError = this._cleanupResources();
    if (cleanupError) throw cleanupError;
    return true;
  }
}
