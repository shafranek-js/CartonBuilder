const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export const CAMERA_SENSOR_HEIGHT_MM = 24;
export const CAMERA_LENS_PRESETS = Object.freeze([35, 50, 85]);

export function clampCameraFov(value, fallback = 35) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(120, Math.max(10, number));
}

export function focalLengthToFov(focalLength, sensorHeight = CAMERA_SENSOR_HEIGHT_MM) {
  const focal = Math.max(1, Number(focalLength) || 35);
  const sensor = Math.max(1, Number(sensorHeight) || CAMERA_SENSOR_HEIGHT_MM);
  return 2 * Math.atan(sensor / (2 * focal)) * RAD_TO_DEG;
}

export function fovToFocalLength(fov, sensorHeight = CAMERA_SENSOR_HEIGHT_MM) {
  const angle = clampCameraFov(fov) * DEG_TO_RAD;
  const sensor = Math.max(1, Number(sensorHeight) || CAMERA_SENSOR_HEIGHT_MM);
  return sensor / (2 * Math.tan(angle / 2));
}

export function normalizeDegrees(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return ((number % 360) + 360) % 360;
}

export function cameraLensLabel(fov) {
  const focalLength = fovToFocalLength(fov);
  const preset = CAMERA_LENS_PRESETS.find((value) => Math.abs(value - focalLength) < 0.5);
  return preset ? String(preset) : 'custom';
}

function vectorComponent(value, index) {
  if (value == null) return NaN;
  const axis = ['x', 'y', 'z'][index];
  const direct = Array.isArray(value) ? undefined : value[axis];
  return Number(direct ?? value[index]);
}

export function cameraHeadingElevation(position, target = [0, 0, 0]) {
  const dx = vectorComponent(position, 0) - vectorComponent(target, 0);
  const dy = vectorComponent(position, 1) - vectorComponent(target, 1);
  const dz = vectorComponent(position, 2) - vectorComponent(target, 2);
  const horizontal = Math.hypot(dx, dz);
  return {
    heading: normalizeDegrees(Math.atan2(dx, dz) * RAD_TO_DEG),
    elevation: Math.atan2(dy, horizontal) * RAD_TO_DEG,
    distance: Math.hypot(dx, dy, dz),
  };
}

export function cameraPositionFromHeading({ heading = 45, elevation = 35.264, distance = 4, target = [0, 0, 0] } = {}) {
  const headingRadians = Number(heading) * DEG_TO_RAD;
  const elevationRadians = Number(elevation) * DEG_TO_RAD;
  const horizontal = Math.cos(elevationRadians) * Math.max(0.001, Number(distance) || 4);
  const targetVector = Array.isArray(target) && target.length === 3 ? target.map(Number) : [0, 0, 0];
  return [
    targetVector[0] + Math.sin(headingRadians) * horizontal,
    targetVector[1] + Math.sin(elevationRadians) * Math.max(0.001, Number(distance) || 4),
    targetVector[2] + Math.cos(headingRadians) * horizontal,
  ];
}

export function normalizeCameraPresetState(state = {}, bounds = null) {
  const source = state && typeof state === 'object' ? state : {};
  const target = Array.isArray(source.target) && source.target.length === 3
    ? source.target.map(Number)
    : [0, 0, 0];
  const position = Array.isArray(source.position) && source.position.length === 3
    ? source.position.map(Number)
    : cameraPositionFromHeading({ target });
  const derived = cameraHeadingElevation(position, target);
  const radius = Math.max(0.001, Number(bounds?.radius) || 1);
  return {
    projection: source.projection === 'orthographic' ? 'orthographic' : 'perspective',
    heading: Number.isFinite(Number(source.heading)) ? Number(source.heading) : derived.heading,
    elevation: Number.isFinite(Number(source.elevation)) ? Number(source.elevation) : derived.elevation,
    horizontalPan: Number.isFinite(Number(source.horizontalPan)) ? Number(source.horizontalPan) / radius : 0,
    verticalPan: Number.isFinite(Number(source.verticalPan)) ? Number(source.verticalPan) / radius : 0,
    distanceFactor: Number.isFinite(Number(source.distanceFactor))
      ? Number(source.distanceFactor)
      : derived.distance / radius,
    frameHeightFactor: Number.isFinite(Number(source.frameHeightFactor))
      ? Number(source.frameHeightFactor)
      : Number(source.orthographicHeight || 0) / radius,
    fov: clampCameraFov(source.fov),
    verticalCorrection: source.verticalCorrection === true || source.keepVerticalsParallel === true,
  };
}

