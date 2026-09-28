"use strict";

import VMath from "../math/vmath.js";
import { HALF } from "../constants/vmath.js";

// The slider is the angle across the shorter screen axis. A wide view keeps
// that vertical angle and opens the horizontal one with the aspect ratio, so
// the extra width shows more terrain instead of magnifying the same span.
export function viewAngles(fovDeg, width, height) {
  const fov = Number(fovDeg) || 0;
  const half = fov * VMath.DEG_TO_RAD * HALF;
  const tanHalf = Math.tan(half);
  const w = width | 0;
  const h = height | 0;
  const aspect = h > 0 ? w / h : 1;
  let tanHalfX = tanHalf;
  let tanHalfY = tanHalf;
  let fovX = fov;
  let fovY = fov;
  if (w > h && h > 0) {
    tanHalfY = tanHalf;
    tanHalfX = tanHalfY * aspect;
    fovY = fov;
    fovX = Math.atan(tanHalfX) * 2 * VMath.RAD_TO_DEG;
  } else if (aspect > 0) {
    tanHalfX = tanHalf;
    tanHalfY = tanHalfX / aspect;
    fovX = fov;
    fovY = Math.atan(tanHalfY) * 2 * VMath.RAD_TO_DEG;
  }
  return {
    fovX: fovX,
    fovY: fovY,
    halfFovX: Math.atan(tanHalfX),
    halfFovY: Math.atan(tanHalfY),
    tanHalfY: tanHalfY,
    tanHalfX: tanHalfX,
  };
}

export function calculateFov(camera) {
  if (!camera._fovDirty) {
    return camera._cachedFov;
  }
  camera._fovDirty = false;
  camera._cachedFov = viewAngles(camera.fov, camera.width, camera.height);
  return camera._cachedFov;
}

// Projection distance in pixels for a horizontal angle.
export function horizontalProjPlane(width, fovDeg) {
  const halfFovX = (Number(fovDeg) || 0) * VMath.DEG_TO_RAD * HALF;
  const tanHalfX = Math.tan(halfFovX);
  const w2 = Math.max(1, width | 0) * HALF;
  if (!(tanHalfX > 1e-8)) {
    return w2;
  }
  return w2 / tanHalfX;
}

export function calculateProjPlane(camera) {
  if (!camera._projPlaneDirty) {
    return camera._cachedProjPlane;
  }
  camera._projPlaneDirty = false;

  const fov = calculateFov(camera);
  camera._cachedProjPlane = horizontalProjPlane(camera.width, fov.fovX);

  return camera._cachedProjPlane;
}

export function calculateHorizon(camera, dstToProjPlane) {
  if (!camera._horizonDirty) {
    return camera._cachedHorizon;
  }
  camera._horizonDirty = false;

  camera._cachedHorizon =
    Math.tan(-camera.pitch * VMath.DEG_TO_RAD) * dstToProjPlane +
    camera._height2;

  return camera._cachedHorizon;
}
