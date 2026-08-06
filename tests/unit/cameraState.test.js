import { describe, expect, it } from 'vitest';
import {
  cameraHeadingElevation,
  cameraPositionFromHeading,
  focalLengthToFov,
  fovToFocalLength,
  normalizeCameraPresetState,
} from '../../src/render/cameraState.js';

describe('render camera state', () => {
  it('round-trips focal length and vertical FOV using the fixed sensor', () => {
    expect(fovToFocalLength(focalLengthToFov(50))).toBeCloseTo(50, 6);
  });

  it('derives stable heading, elevation and distance', () => {
    const position = cameraPositionFromHeading({ heading: 90, elevation: 0, distance: 4 });
    const state = cameraHeadingElevation(position, [0, 0, 0]);
    expect(state.heading).toBeCloseTo(90, 6);
    expect(state.elevation).toBeCloseTo(0, 6);
    expect(state.distance).toBeCloseTo(4, 6);
  });

  it('accepts Vector3-like objects with x/y/z components', () => {
    const position = { x: 2.8284271247461903, y: 0, z: 2.8284271247461903 };
    const target = { x: 0, y: 0, z: 0 };
    const state = cameraHeadingElevation(position, target);
    expect(state.heading).toBeCloseTo(45, 6);
    expect(state.distance).toBeCloseTo(4, 6);
  });

  it('normalizes a view preset relative to carton bounds', () => {
    const normalized = normalizeCameraPresetState({
      position: [0, 0, 6],
      target: [0, 0, 0],
      projection: 'orthographic',
      orthographicHeight: 3,
      verticalCorrection: true,
    }, { radius: 2 });
    expect(normalized.distanceFactor).toBeCloseTo(3, 6);
    expect(normalized.frameHeightFactor).toBeCloseTo(1.5, 6);
    expect(normalized.projection).toBe('orthographic');
    expect(normalized.verticalCorrection).toBe(true);
  });
});

