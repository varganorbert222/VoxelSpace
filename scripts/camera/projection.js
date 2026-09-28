"use strict";

import VMath from "../math/vmath.js";
import { HALF } from "../constants/vmath.js";

export function calculateFov(camera) {
  if (!camera._fovDirty) {
    return camera._cachedFov;
  }
  camera._fovDirty = false;

  const halfFovX = camera.fov * VMath.DEG_TO_RAD * HALF;
  const tanHalfX = Math.tan(halfFovX);
  const aspect = camera.width / camera.height;
  const tanHalfY = aspect > 0 ? tanHalfX / aspect : tanHalfX;
  const halfFovY = Math.atan(tanHalfY);

  camera._cachedFov = {
    fovX: camera.fov,
    fovY: halfFovY * 2 * VMath.RAD_TO_DEG,
    halfFovX: halfFovX,
    halfFovY: halfFovY,
    tanHalfY: tanHalfY,
    tanHalfX: tanHalfX,
  };

  return camera._cachedFov;
}

// Projection distance in pixels. The FOV slider is the horizontal angle,
// matching retail's focalFor(width, fov).
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

  camera._cachedProjPlane = horizontalProjPlane(camera.width, camera.fov);

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
