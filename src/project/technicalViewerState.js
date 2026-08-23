import { normalizeCameraPresetState } from '../render/cameraState.js';

export const TECHNICAL_VIEWER_STATE_VERSION = 1;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteOrThrow(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`);
  return number;
}

export function createDefaultTechnicalViewerState() {
  return {
    version: TECHNICAL_VIEWER_STATE_VERSION,
    animationName: null,
    foldProgress: 0,
    camera: normalizeCameraPresetState(),
  };
}

export function normalizeTechnicalViewerState(value, { allowNull = true, bounds = null } = {}) {
  if (value == null) {
    if (allowNull) return null;
    return createDefaultTechnicalViewerState();
  }
  if (!isRecord(value)) throw new Error('technicalViewer must be an object.');
  if (value.version !== undefined && value.version !== TECHNICAL_VIEWER_STATE_VERSION) {
    throw new Error(`Unsupported technicalViewer state version: ${value.version}.`);
  }
  const animationName = value.animationName == null ? null : value.animationName;
  if (animationName !== null && (typeof animationName !== 'string' || animationName.length > 256)) {
    throw new Error('technicalViewer.animationName is invalid.');
  }
  const foldProgress = value.foldProgress === undefined
    ? 0
    : finiteOrThrow(value.foldProgress, 'technicalViewer.foldProgress');
  if (foldProgress < 0 || foldProgress > 1) {
    throw new Error('technicalViewer.foldProgress must be between 0 and 1.');
  }
  const cameraInput = value.camera == null ? {} : value.camera;
  if (!isRecord(cameraInput)) throw new Error('technicalViewer.camera must be an object.');
  for (const key of ['heading', 'elevation', 'horizontalPan', 'verticalPan', 'distanceFactor', 'frameHeightFactor', 'fov']) {
    if (cameraInput[key] !== undefined) finiteOrThrow(cameraInput[key], `technicalViewer.camera.${key}`);
  }
  if (cameraInput.distanceFactor !== undefined && Number(cameraInput.distanceFactor) <= 0) {
    throw new Error('technicalViewer.camera.distanceFactor must be positive.');
  }
  if (cameraInput.frameHeightFactor !== undefined && Number(cameraInput.frameHeightFactor) < 0) {
    throw new Error('technicalViewer.camera.frameHeightFactor must not be negative.');
  }
  const camera = normalizeCameraPresetState(cameraInput, bounds);
  return {
    version: TECHNICAL_VIEWER_STATE_VERSION,
    animationName,
    foldProgress,
    camera,
  };
}
