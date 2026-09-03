import {
  cameraHeadingElevation,
  cameraPositionFromHeading,
  clampCameraFov,
  focalLengthToFov,
  fovToFocalLength,
} from './cameraState.js';
import { Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CAMERA_PRESETS = Object.freeze({
  front: Object.freeze({ direction: Object.freeze([0, 0, 1]), up: Object.freeze([0, 1, 0]) }),
  back: Object.freeze({ direction: Object.freeze([0, 0, -1]), up: Object.freeze([0, 1, 0]) }),
  left: Object.freeze({ direction: Object.freeze([-1, 0, 0]), up: Object.freeze([0, 1, 0]) }),
  right: Object.freeze({ direction: Object.freeze([1, 0, 0]), up: Object.freeze([0, 1, 0]) }),
  top: Object.freeze({ direction: Object.freeze([0, 1, 0]), up: Object.freeze([0, 0, -1]) }),
  bottom: Object.freeze({ direction: Object.freeze([0, -1, 0]), up: Object.freeze([0, 0, 1]) }),
  'front-left': Object.freeze({ direction: Object.freeze([-1, 0.65, 1]), up: Object.freeze([0, 1, 0]) }),
  'front-right': Object.freeze({ direction: Object.freeze([1, 0.65, 1]), up: Object.freeze([0, 1, 0]) }),
  'top-front': Object.freeze({ direction: Object.freeze([0.45, 1, 1]), up: Object.freeze([0, 1, 0]) }),
  isometric: Object.freeze({ direction: Object.freeze([1, 1, 1]), up: Object.freeze([0, 1, 0]) }),
});

const VALID_PROJECTIONS = new Set(['perspective', 'orthographic']);
const VALID_PRESETS = new Set([...Object.keys(CAMERA_PRESETS), 'custom']);
const DEFAULT_PRESET = 'isometric';
const DEFAULT_DISTANCE = 4;
const DEFAULT_MARGIN = 1.2;

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finitePositive(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function isVectorArray(value) {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function cloneVector(value) {
  return [...value];
}

function cloneState(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    ...state,
    position: isVectorArray(state.position) ? cloneVector(state.position) : state.position,
    target: isVectorArray(state.target) ? cloneVector(state.target) : state.target,
  };
}

function vectorFromArray(value) {
  return new Vector3(value[0], value[1], value[2]);
}

function vectorFromCamera(camera, fallback = [0, 0, 0]) {
  if (isVectorArray(camera?.position?.toArray?.())) return camera.position.clone();
  if (isVectorArray(camera?.position)) return vectorFromArray(camera.position);
  return vectorFromArray(fallback);
}

function copyVectorToCamera(camera, value) {
  if (typeof camera.position?.copy === 'function') camera.position.copy(value);
  else if (typeof camera.position?.fromArray === 'function') camera.position.fromArray(value.toArray());
  else camera.position = value.toArray();
}

function copyUpToCamera(camera, value) {
  if (typeof camera.up?.copy === 'function') camera.up.copy(value);
  else if (typeof camera.up?.fromArray === 'function') camera.up.fromArray(value.toArray());
  else camera.up = value.toArray();
}

function cameraIsOrthographic(camera) {
  return camera?.isOrthographicCamera === true || camera?.type === 'OrthographicCamera';
}

function cameraIsPerspective(camera) {
  return camera?.isPerspectiveCamera === true || camera?.type === 'PerspectiveCamera';
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function statesEqual(left, right) {
  return left?.preset === right?.preset
    && left?.projection === right?.projection
    && left?.fov === right?.fov
    && left?.focalLength === right?.focalLength
    && left?.heading === right?.heading
    && left?.elevation === right?.elevation
    && left?.cameraDistance === right?.cameraDistance
    && left?.orthographicHeight === right?.orthographicHeight
    && arraysEqual(left?.position, right?.position)
    && arraysEqual(left?.target, right?.target);
}

function assertSurface(surface) {
  if (!isObjectLike(surface) || !isObjectLike(surface.renderSurface)) {
    throw new TypeError('RenderStudioCameraRig requires a RenderStudioSurface.');
  }
  const renderSurface = surface.renderSurface;
  if (!isObjectLike(renderSurface.scene)
    || !isObjectLike(renderSurface.camera)
    || !isObjectLike(renderSurface.renderer)) {
    throw new TypeError('RenderStudioCameraRig requires a complete renderSurface.');
  }
  for (const method of [
    'setCameraProjection',
    'setPerspectiveFov',
    'setOrthographicHeight',
    'getCameraOptics',
    'render',
  ]) {
    if (typeof surface[method] !== 'function') {
      throw new TypeError(`RenderStudioCameraRig surface must implement ${method}().`);
    }
  }
  const camera = renderSurface.camera;
  if (!isObjectLike(camera.position)
    || !isObjectLike(camera.up)
    || typeof camera.lookAt !== 'function'
    || typeof camera.updateMatrixWorld !== 'function') {
    throw new TypeError('RenderStudioCameraRig requires a transformable active camera.');
  }
}

function assertBounds(bounds) {
  if (!isObjectLike(bounds)
    || !isFiniteNumber(bounds.centerX)
    || !isFiniteNumber(bounds.centerY)
    || !isFiniteNumber(bounds.centerZ)
    || !isFiniteNumber(bounds.radius)
    || !(bounds.radius > 0)) {
    throw new TypeError(
      'RenderStudioCameraRig boundsProvider() must return finite normalized meter bounds with radius > 0.',
    );
  }
  return bounds;
}

function visibleHeightForPerspective(fov, distance) {
  return 2 * distance * Math.tan(clampCameraFov(fov) * Math.PI / 360);
}

function distanceForPerspective(fov, visibleHeight) {
  return visibleHeight / (2 * Math.tan(clampCameraFov(fov) * Math.PI / 360));
}

function normalizedDirection(position, target) {
  const direction = position.clone().sub(target);
  if (direction.lengthSq() > 1e-10) return direction.normalize();
  return vectorFromArray(CAMERA_PRESETS.isometric.direction).normalize();
}

function presetDirection(preset) {
  return vectorFromArray(CAMERA_PRESETS[preset].direction).normalize();
}

function presetUp(preset) {
  return vectorFromArray(CAMERA_PRESETS[preset].up).normalize();
}

function safeCameraOptics(surface) {
  const optics = surface.getCameraOptics();
  return {
    projection: VALID_PROJECTIONS.has(optics?.projection)
      ? optics.projection
      : cameraIsOrthographic(surface.renderSurface.camera) ? 'orthographic' : 'perspective',
    perspectiveFov: Number.isFinite(optics?.perspectiveFov)
      ? clampCameraFov(optics.perspectiveFov)
      : clampCameraFov(surface.renderSurface.camera.fov),
    orthographicHeight: finitePositive(optics?.orthographicHeight) || 1,
    aspect: finitePositive(optics?.aspect) || 1,
  };
}

/**
 * Headless Render Studio camera rig. It owns camera state only and never owns
 * or disposes the RenderStudioSurface supplied by its caller.
 */
export class RenderStudioCameraRig {
  constructor({
    surface,
    boundsProvider,
    initialState = null,
    onCameraChange = () => {},
  } = {}) {
    assertSurface(surface);
    if (typeof boundsProvider !== 'function') {
      throw new TypeError('RenderStudioCameraRig requires boundsProvider().');
    }

    this.surface = surface;
    this.boundsProvider = boundsProvider;
    this.onCameraChange = typeof onCameraChange === 'function' ? onCameraChange : () => {};
    this.disposed = false;
    this._initialState = cloneState(initialState);
    this._target = new Vector3(0, 0, 0);
    this._preset = DEFAULT_PRESET;

    const optics = safeCameraOptics(surface);
    const camera = surface.renderSurface.camera;
    const initial = initialState && typeof initialState === 'object' ? initialState : {};
    const initialTarget = isVectorArray(initial.target)
      ? vectorFromArray(initial.target)
      : new Vector3(0, 0, 0);
    const currentPosition = vectorFromCamera(camera, cameraPositionFromHeading({ target: initialTarget.toArray() }));
    const initialPosition = isVectorArray(initial.position)
      ? vectorFromArray(initial.position)
      : this._positionFromInitialState(initial, currentPosition, initialTarget);
    const initialFov = this._resolveFov(initial, optics.perspectiveFov);
    const initialOrthographicHeight = finitePositive(initial.orthographicHeight)
      || optics.orthographicHeight;
    this._target.copy(initialTarget);
    this._preset = VALID_PRESETS.has(initial.preset) ? initial.preset : DEFAULT_PRESET;

    this._applyState({
      ...initial,
      projection: VALID_PROJECTIONS.has(initial.projection) ? initial.projection : optics.projection,
      fov: initialFov,
      orthographicHeight: initialOrthographicHeight,
      position: initialPosition.toArray(),
      target: initialTarget.toArray(),
    }, { preferredUp: CAMERA_PRESETS[this._preset]?.up });
    this._lastSnapshot = cloneState(this._readCameraState());

    this.controls = null;
    const canvas = surface.renderSurface?.renderer?.domElement
      || surface.canvas
      || surface._canvas;
    if (canvas && typeof canvas.getBoundingClientRect === 'function' && typeof canvas.addEventListener === 'function') {
      try {
        this.controls = new OrbitControls(camera, canvas);
        this.controls.enableDamping = false;
        this.controls.screenSpacePanning = true;
        this.controls.zoomToCursor = true;
        this.controls.target.copy(this._target);
        if (typeof this.controls.listenToKeyEvents === 'function') {
          this.controls.listenToKeyEvents(canvas);
        }
        this.controls.addEventListener('change', () => {
          if (this.disposed) return;
          this._target.copy(this.controls.target);
          this._preset = 'custom';
          this.surface.render();
          const snapshot = this._readCameraState();
          this._lastSnapshot = cloneState(snapshot);
          this.onCameraChange(cloneState(snapshot));
        });
      } catch {
        // Safe for non-DOM or unit-test environments
      }
    }
  }

  _positionFromInitialState(state, fallbackPosition, target) {
    const heading = finiteNumber(state.heading);
    const elevation = finiteNumber(state.elevation);
    const distance = finitePositive(state.cameraDistance);
    if (heading !== null || elevation !== null || distance !== null) {
      const derived = cameraHeadingElevation(fallbackPosition, target);
      return vectorFromArray(cameraPositionFromHeading({
        heading: heading ?? derived.heading,
        elevation: elevation ?? derived.elevation,
        distance: distance ?? Math.max(0.001, derived.distance),
        target: target.toArray(),
      }));
    }
    return fallbackPosition;
  }

  _resolveFov(state, fallback) {
    if (finiteNumber(state.fov) !== null) return clampCameraFov(Number(state.fov));
    const focalLength = finitePositive(state.focalLength);
    return focalLength === null ? fallback : clampCameraFov(focalLengthToFov(focalLength));
  }

  _readCameraState() {
    const camera = this.surface.renderSurface.camera;
    const optics = safeCameraOptics(this.surface);
    const position = vectorFromCamera(camera).toArray();
    const target = this._target.toArray();
    const orientation = cameraHeadingElevation(position, target);
    const fov = this._fov ?? optics.perspectiveFov;
    return {
      preset: this._preset,
      projection: optics.projection,
      fov,
      focalLength: fovToFocalLength(fov),
      position,
      target,
      heading: orientation.heading,
      elevation: orientation.elevation,
      cameraDistance: orientation.distance,
      orthographicHeight: this._orthographicHeight ?? optics.orthographicHeight,
    };
  }

  getCameraState() {
    if (this.disposed) return cloneState(this._lastSnapshot);
    return cloneState(this._readCameraState());
  }

  _finalizeMutation(before, { render, notify }) {
    const snapshot = this._readCameraState();
    const changed = !statesEqual(before, snapshot);
    this._lastSnapshot = cloneState(snapshot);
    if (!changed) return false;
    if (render) this.surface.render();
    if (notify) this.onCameraChange(cloneState(snapshot));
    return true;
  }

  _applyCameraTransform(position, target, up = null) {
    const camera = this.surface.renderSurface.camera;
    copyVectorToCamera(camera, position);
    this._target.copy(target);
    if (up) copyUpToCamera(camera, up);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  _setOrthographicFrameForAspect(height, aspect, camera) {
    const halfHeight = height / 2;
    const halfWidth = halfHeight * aspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  _transitionProjection({
    projection,
    target,
    desiredPosition,
    desiredFov,
    desiredOrthographicHeight,
    preferredUp,
  }) {
    const previousCamera = this.surface.renderSurface.camera;
    const previousOptics = safeCameraOptics(this.surface);
    const previousPosition = vectorFromCamera(previousCamera);
    const direction = normalizedDirection(previousPosition, this._target);
    const previousTarget = this._target.clone();
    const previousDistance = Math.max(0.001, previousPosition.distanceTo(previousTarget));
    const visibleHeight = cameraIsOrthographic(previousCamera)
      ? previousOptics.orthographicHeight
      : visibleHeightForPerspective(previousOptics.perspectiveFov, previousDistance);

    if (projection === 'orthographic') {
      this.surface.setPerspectiveFov(desiredFov);
      this.surface.setCameraProjection('orthographic');
      const height = desiredOrthographicHeight || visibleHeight;
      this.surface.setOrthographicHeight(height);
      this._orthographicHeight = height;
      const position = desiredPosition || target.clone().addScaledVector(direction, previousDistance);
      this._applyCameraTransform(position, target, preferredUp || previousCamera.up);
      if (this.controls) {
        this.controls.object = this.surface.renderSurface.camera;
        this.controls.update();
      }
      return;
    }

    const height = desiredOrthographicHeight || visibleHeight;
    if (desiredOrthographicHeight) {
      this.surface.setOrthographicHeight(height);
      this._orthographicHeight = height;
    }
    this.surface.setCameraProjection('perspective');
    this.surface.setPerspectiveFov(desiredFov);
    const distance = desiredPosition
      ? desiredPosition.distanceTo(target)
      : distanceForPerspective(desiredFov, height);
    const position = desiredPosition || target.clone().addScaledVector(direction, Math.max(0.001, distance));
    this._applyCameraTransform(position, target, preferredUp || previousCamera.up);
    if (this.controls) {
      this.controls.object = this.surface.renderSurface.camera;
      this.controls.update();
    }
  }

  _applyState(state = {}, { preferredUp = null } = {}) {
    const current = this._readCameraState();
    const camera = this.surface.renderSurface.camera;
    const source = state && typeof state === 'object' ? state : {};
    const projection = VALID_PROJECTIONS.has(source.projection)
      ? source.projection
      : current.projection;
    const hasExplicitPreset = VALID_PRESETS.has(source.preset);
    const preset = VALID_PRESETS.has(source.preset) ? source.preset : current.preset;
    const target = isVectorArray(source.target)
      ? vectorFromArray(source.target)
      : vectorFromArray(current.target);
    const explicitPosition = isVectorArray(source.position)
      ? vectorFromArray(source.position)
      : null;
    const hasDirectionalInput = finiteNumber(source.heading) !== null
      || finiteNumber(source.elevation) !== null
      || finitePositive(source.cameraDistance) !== null;
    const preferredPresetUp = preferredUp
      ? vectorFromArray(preferredUp)
      : (hasExplicitPreset && CAMERA_PRESETS[preset] ? presetUp(preset) : null);
    let position = null;

    if (hasExplicitPreset && preset !== 'custom') {
      const distance = Math.max(0.001, current.cameraDistance || DEFAULT_DISTANCE);
      position = target.clone().addScaledVector(presetDirection(preset), distance);
    } else if (hasDirectionalInput) {
      const currentPosition = vectorFromCamera(camera, current.position);
      const derived = cameraHeadingElevation(currentPosition, current.target);
      position = vectorFromArray(cameraPositionFromHeading({
        heading: finiteNumber(source.heading) ?? derived.heading,
        elevation: finiteNumber(source.elevation) ?? derived.elevation,
        distance: finitePositive(source.cameraDistance) ?? Math.max(0.001, derived.distance),
        target: target.toArray(),
      }));
    } else if (explicitPosition) {
      position = explicitPosition;
    } else if (!arraysEqual(current.target, target.toArray())) {
      const currentPosition = vectorFromArray(current.position);
      position = target.clone().add(currentPosition.sub(vectorFromArray(current.target)));
    }

    const desiredFov = this._resolveFov(source, current.fov);
    const desiredOrthographicHeight = finitePositive(source.orthographicHeight);
    this._preset = preset;
    this._fov = desiredFov;

    if (projection !== current.projection) {
      this._transitionProjection({
        projection,
        target,
        desiredPosition: position,
        desiredFov,
        desiredOrthographicHeight,
        preferredUp: preferredPresetUp,
      });
      return;
    }

    this.surface.setPerspectiveFov(desiredFov);
    const nextOrthographicHeight = desiredOrthographicHeight || current.orthographicHeight;
    this.surface.setOrthographicHeight(nextOrthographicHeight);
    this._orthographicHeight = nextOrthographicHeight;
    const transformChanged = position
      || !arraysEqual(current.target, target.toArray())
      || preferredPresetUp;
    if (transformChanged) {
      const nextPosition = position || vectorFromArray(current.position);
      this._applyCameraTransform(nextPosition, target, preferredPresetUp || camera.up);
    }
    const verticalCorrection = source.verticalCorrection === true || source.keepVerticalsParallel === true;
    const finalPosition = position || vectorFromArray(current.position);
    const orientation = cameraHeadingElevation(finalPosition, target.toArray());
    this._applyVerticalCorrection(verticalCorrection, orientation.elevation);
  }

  _applyVerticalCorrection(verticalCorrection, elevation) {
    const camera = this.surface.renderSurface.camera;
    if (!camera?.isPerspectiveCamera) return;
    const size = this.surface.renderSurface.renderer?.getSize?.(new Vector2()) || { x: 800, y: 600 };
    const width = Math.max(1, size.x || this.surface.container?.clientWidth || 1);
    const height = Math.max(1, size.y || this.surface.container?.clientHeight || 1);
    if (!verticalCorrection || Math.abs(elevation || 0) < 0.01) {
      camera.clearViewOffset?.();
      camera.updateProjectionMatrix();
      return;
    }
    const shift = Math.tan((elevation || 0) * Math.PI / 180) * height * 0.12;
    camera.setViewOffset(width, height, 0, -shift, width, height);
    camera.updateProjectionMatrix();
  }

  setCameraState(state, { render = true, notify = true } = {}) {
    if (this.disposed) return false;
    const before = this._readCameraState();
    this._applyState(state);
    return this._finalizeMutation(before, { render, notify });
  }

  setCameraPreset(preset, { render = true, notify = true } = {}) {
    if (this.disposed || !VALID_PRESETS.has(preset)) return false;
    const before = this._readCameraState();
    if (preset === 'custom') {
      this._applyState({ preset });
    } else {
      const current = this._readCameraState();
      const target = vectorFromArray(current.target);
      const position = target.clone().addScaledVector(
        presetDirection(preset),
        Math.max(0.001, current.cameraDistance || DEFAULT_DISTANCE),
      );
      this._applyState({
        preset,
        position: position.toArray(),
        target: target.toArray(),
      }, { preferredUp: CAMERA_PRESETS[preset].up });
    }
    return this._finalizeMutation(before, { render, notify });
  }

  _getValidatedBounds() {
    return assertBounds(this.boundsProvider());
  }

  _validateFitOptions({ margin = DEFAULT_MARGIN, aspect = null } = {}) {
    if (aspect !== null && (!isFiniteNumber(aspect) || !(aspect > 0))) {
      throw new TypeError('RenderStudioCameraRig fit aspect must be finite and greater than zero.');
    }
    const numericMargin = finitePositive(margin);
    return {
      margin: numericMargin || DEFAULT_MARGIN,
      aspect,
    };
  }

  _fitValidatedBounds(bounds, { margin, aspect }) {
    const current = this._readCameraState();
    const camera = this.surface.renderSurface.camera;
    const target = new Vector3(bounds.centerX, bounds.centerY, bounds.centerZ);
    const currentPosition = vectorFromArray(current.position);
    const currentTarget = vectorFromArray(current.target);
    const direction = normalizedDirection(currentPosition, currentTarget);
    const frameAspect = aspect ?? safeCameraOptics(this.surface).aspect;
    const visibleHeight = bounds.radius * 2 * margin * Math.max(1, 1 / frameAspect);
    const fov = current.fov;

    if (current.projection === 'perspective') {
      camera.aspect = frameAspect;
      const distance = distanceForPerspective(fov, visibleHeight);
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.near = Math.max(0.01, bounds.radius / 1000);
      camera.far = Math.max(1000, distance + bounds.radius * 10);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      this._target.copy(target);
      if (this.controls) {
        this.controls.target.copy(target);
        this.controls.update();
      }
      return;
    }

    this.surface.setOrthographicHeight(visibleHeight);
    this._orthographicHeight = visibleHeight;
    if (aspect !== null) this._setOrthographicFrameForAspect(visibleHeight, aspect, camera);
    const distance = Math.max(bounds.radius * 4, currentPosition.distanceTo(currentTarget));
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.near = Math.max(0.01, bounds.radius / 1000);
    camera.far = Math.max(1000, distance + bounds.radius * 10);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    this._target.copy(target);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  fitCameraToFrame({ margin = DEFAULT_MARGIN, aspect = null, render = true } = {}) {
    if (this.disposed) return false;
    const fitOptions = this._validateFitOptions({ margin, aspect });
    const bounds = this._getValidatedBounds();
    const before = this._readCameraState();
    this._fitValidatedBounds(bounds, fitOptions);
    return this._finalizeMutation(before, { render, notify: true });
  }

  resetView({ render = true } = {}) {
    if (this.disposed) return false;
    const bounds = this._getValidatedBounds();
    const before = this._readCameraState();
    if (this._initialState) this._applyState(this._initialState);
    const fitOptions = this._validateFitOptions({});
    this._fitValidatedBounds(bounds, fitOptions);
    return this._finalizeMutation(before, { render, notify: true });
  }

  dispose() {
    if (this.disposed) return false;
    this._lastSnapshot = cloneState(this._readCameraState());
    if (this.controls) {
      try {
        this.controls.stopListenToKeyEvents?.();
        this.controls.dispose();
      } catch {}
      this.controls = null;
    }
    this.disposed = true;
    return true;
  }
}
