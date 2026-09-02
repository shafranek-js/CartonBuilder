import {
  SRGBColorSpace,
  Vector2,
  WebGLRenderTarget,
} from 'three';

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function assertObject(name, value) {
  if (!isObjectLike(value)) {
    throw new TypeError(`RenderStudioRenderTargetService requires ${name}.`);
  }
}

function assertMethod(name, owner, method) {
  if (typeof owner?.[method] !== 'function') {
    throw new TypeError(`RenderStudioRenderTargetService ${name} must implement ${method}().`);
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

function abortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('Render export aborted.', 'AbortError');
  }
  const error = new Error('Render export aborted.');
  error.name = 'AbortError';
  return error;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function assertSignal(signal) {
  if (signal === undefined || signal === null) return;
  if (!isObjectLike(signal)
    || typeof signal.aborted !== 'boolean'
    || typeof signal.addEventListener !== 'function') {
    throw new TypeError('RenderStudioRenderTargetService signal must be an AbortSignal.');
  }
}

function normalizeDimension(name, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`RenderStudioRenderTargetService ${name} must be finite.`);
  }
  return Math.max(1, Math.floor(numeric));
}

function assertSurface(surface) {
  assertObject('surface', surface);
  const renderSurface = surface.renderSurface;
  assertObject('surface.renderSurface', renderSurface);
  for (const key of ['scene', 'camera', 'renderer']) {
    assertObject(`surface.renderSurface.${key}`, renderSurface[key]);
  }
  for (const method of [
    'resize',
    'getCameraOptics',
    'setCameraProjection',
    'setPerspectiveFov',
    'setOrthographicHeight',
  ]) {
    assertMethod('surface', surface, method);
  }

  const renderer = renderSurface.renderer;
  for (const method of [
    'getRenderTarget',
    'setRenderTarget',
    'getSize',
    'getPixelRatio',
    'setPixelRatio',
    'setSize',
    'clear',
    'render',
  ]) {
    assertMethod('surface.renderSurface.renderer', renderer, method);
  }
  if (typeof renderer.readRenderTargetPixelsAsync !== 'function'
    && typeof renderer.readRenderTargetPixels !== 'function') {
    throw new TypeError(
      'RenderStudioRenderTargetService surface.renderSurface.renderer must implement readRenderTargetPixels() or readRenderTargetPixelsAsync().',
    );
  }
}

function assertAppearanceController(appearanceController) {
  assertObject('appearanceController', appearanceController);
  assertMethod('appearanceController', appearanceController, 'beginRenderStateTransaction');
}

function assertTarget(target) {
  assertObject('render target', target);
  assertMethod('render target', target, 'dispose');
  assertObject('render target.texture', target.texture);
}

function readCameraOptics(surface) {
  const optics = surface.getCameraOptics();
  if (!isObjectLike(optics)
    || (optics.projection !== 'perspective' && optics.projection !== 'orthographic')
    || !Number.isFinite(optics.perspectiveFov)
    || !Number.isFinite(optics.orthographicHeight)
    || !(optics.orthographicHeight > 0)
    || !Number.isFinite(optics.aspect)
    || !(optics.aspect > 0)) {
    throw new TypeError('RenderStudioRenderTargetService surface returned invalid camera optics.');
  }
  return { ...optics };
}

function readViewport(renderer) {
  const size = renderer.getSize(new Vector2());
  const pixelRatio = renderer.getPixelRatio();
  if (!isObjectLike(size)
    || !Number.isFinite(size.x)
    || !Number.isFinite(size.y)
    || !(size.x > 0)
    || !(size.y > 0)
    || !Number.isFinite(pixelRatio)
    || !(pixelRatio > 0)) {
    throw new TypeError('RenderStudioRenderTargetService renderer returned invalid viewport state.');
  }
  return {
    width: size.x,
    height: size.y,
    pixelRatio,
  };
}

function applyCameraFrame(surface, projection, aspect, orthographicHeight) {
  const camera = surface.renderSurface.camera;
  if (projection === 'perspective') {
    if (!Number.isFinite(aspect) || !(aspect > 0)) {
      throw new TypeError('RenderStudioRenderTargetService perspective aspect must be positive.');
    }
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    return;
  }

  if (!Number.isFinite(orthographicHeight) || !(orthographicHeight > 0)) {
    throw new TypeError('RenderStudioRenderTargetService orthographic height must be positive.');
  }
  const halfHeight = orthographicHeight / 2;
  const halfWidth = halfHeight * aspect;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

function restoreViewport(surface, renderer, viewport, optics) {
  let restoreError = null;
  restoreError = firstError(restoreError, () => renderer.setPixelRatio(viewport.pixelRatio));
  restoreError = firstError(restoreError, () => renderer.setSize(viewport.width, viewport.height, false));
  restoreError = firstError(restoreError, () => surface.resize({
    width: viewport.width,
    height: viewport.height,
    pixelRatio: viewport.pixelRatio,
    render: false,
  }));
  restoreError = firstError(restoreError, () => {
    const currentProjection = surface.getCameraOptics().projection;
    if (currentProjection !== optics.projection) surface.setCameraProjection(optics.projection);
  });
  restoreError = firstError(restoreError, () => surface.setPerspectiveFov(optics.perspectiveFov));
  restoreError = firstError(restoreError, () => surface.setOrthographicHeight(optics.orthographicHeight));
  restoreError = firstError(restoreError, () => applyCameraFrame(
    surface,
    optics.projection,
    viewport.width / viewport.height,
    optics.orthographicHeight,
  ));
  return restoreError;
}

function resolveOverrideTarget(overrideResult, fallback) {
  if (!overrideResult) return fallback;
  if (isObjectLike(overrideResult) && overrideResult.target) return overrideResult.target;
  if (isObjectLike(overrideResult)) return overrideResult;
  throw new TypeError(
    'RenderStudioRenderTargetService renderOverride must return a target or { target, restore }.',
  );
}

/**
 * Owns short-lived offscreen render targets for Render Studio stills and
 * turntable frames. Surface and appearance controller remain caller-owned.
 */
export class RenderStudioRenderTargetService {
  constructor({
    surface,
    appearanceController,
    renderTargetFactory = (width, height, options) => new WebGLRenderTarget(width, height, options),
  } = {}) {
    assertSurface(surface);
    assertAppearanceController(appearanceController);
    if (typeof renderTargetFactory !== 'function') {
      throw new TypeError('RenderStudioRenderTargetService renderTargetFactory must be a function.');
    }
    this.surface = surface;
    this.appearanceController = appearanceController;
    this.renderTargetFactory = renderTargetFactory;
    this.disposed = false;
  }

  async renderToPixels({
    width,
    height,
    backgroundMode,
    backgroundColor,
    includeShadow = true,
    includeReflection = true,
    signal,
    renderOverride = null,
  } = {}) {
    if (this.disposed) throw new Error('RenderStudioRenderTargetService is disposed.');
    const outputWidth = normalizeDimension('width', width);
    const outputHeight = normalizeDimension('height', height);
    assertSignal(signal);
    if (renderOverride !== null && typeof renderOverride !== 'function') {
      throw new TypeError('RenderStudioRenderTargetService renderOverride must be a function.');
    }
    assertNotAborted(signal);

    const renderSurface = this.surface.renderSurface;
    const renderer = renderSurface.renderer;
    const viewport = readViewport(renderer);
    const optics = readCameraOptics(this.surface);
    const previousTarget = renderer.getRenderTarget();
    let target = null;
    let appearanceRestore = null;
    let appearanceRestoreCalled = false;
    let overrideResult = null;
    let overrideRestoreCalled = false;
    let operationError = null;

    const callOverrideRestore = () => {
      if (overrideRestoreCalled || typeof overrideResult?.restore !== 'function') return false;
      overrideRestoreCalled = true;
      overrideResult.restore();
      return true;
    };

    const callAppearanceRestore = () => {
      if (appearanceRestoreCalled || typeof appearanceRestore !== 'function') return false;
      appearanceRestoreCalled = true;
      appearanceRestore();
      return true;
    };

    try {
      target = this.renderTargetFactory(outputWidth, outputHeight, {
        depthBuffer: true,
        stencilBuffer: false,
      });
      assertTarget(target);
      target.texture.colorSpace = SRGBColorSpace;

      const transactionResult = this.appearanceController.beginRenderStateTransaction({
        backgroundMode,
        backgroundColor,
        includeShadow,
        includeReflection,
      });
      if (typeof transactionResult !== 'function') {
        throw new TypeError(
          'RenderStudioRenderTargetService appearance transaction must return restore().',
        );
      }
      appearanceRestore = transactionResult;

      const outputAspect = outputWidth / outputHeight;
      const resizeResult = this.surface.resize({
        width: outputWidth,
        height: outputHeight,
        pixelRatio: 1,
        render: false,
      });
      if (resizeResult === false) {
        throw new Error('RenderStudioRenderTargetService could not set output viewport.');
      }
      applyCameraFrame(this.surface, optics.projection, outputAspect, optics.orthographicHeight);
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);

      overrideResult = renderOverride
        ? await renderOverride({ target, width: outputWidth, height: outputHeight })
        : null;
      if (!overrideResult) renderer.render(renderSurface.scene, this.surface.renderSurface.camera);

      const pixelsTarget = resolveOverrideTarget(overrideResult, target);
      const pixels = new Uint8Array(outputWidth * outputHeight * 4);
      if (typeof renderer.readRenderTargetPixelsAsync === 'function') {
        await renderer.readRenderTargetPixelsAsync(
          pixelsTarget,
          0,
          0,
          outputWidth,
          outputHeight,
          pixels,
        );
      } else {
        renderer.readRenderTargetPixels(
          pixelsTarget,
          0,
          0,
          outputWidth,
          outputHeight,
          pixels,
        );
      }
      assertNotAborted(signal);
      return {
        pixels,
        width: outputWidth,
        height: outputHeight,
      };
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      let cleanupError = null;
      cleanupError = firstError(cleanupError, callOverrideRestore);
      cleanupError = firstError(cleanupError, () => renderer.setRenderTarget(previousTarget));
      cleanupError = firstError(cleanupError, () => {
        const viewportRestoreError = restoreViewport(this.surface, renderer, viewport, optics);
        if (viewportRestoreError) throw viewportRestoreError;
      });
      cleanupError = firstError(cleanupError, callAppearanceRestore);
      if (target) cleanupError = firstError(cleanupError, () => target.dispose());
      if (cleanupError && !operationError) throw cleanupError;
    }
  }

  dispose() {
    if (this.disposed) return false;
    this.disposed = true;
    return true;
  }
}
