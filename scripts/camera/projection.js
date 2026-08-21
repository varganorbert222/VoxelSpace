"use strict";

import VMath from "../math/vmath.js";
import { HALF } from "../constants/vmath.js";

export function calculateFov(camera) {
  if (!camera._fovDirty) {
    return camera._cachedFov;
  }
  camera._fovDirty = false;

  const halfFovY = camera.fov * VMath.DEG_TO_RAD * HALF;
  const tanHalfY = Math.tan(halfFovY);
  const aspect = camera.width / camera.height;
  const halfFovX = Math.atan(tanHalfY * aspect);

  camera._cachedFov = {
    fovX: halfFovX * 2 * VMath.RAD_TO_DEG,
    fovY: camera.fov,
    halfFovX: halfFovX,
    halfFovY: halfFovY,
    tanHalfY: tanHalfY,
    tanHalfX: tanHalfY * aspect,
  };

  return camera._cachedFov;
}

export function calculateProjPlane(camera) {
  if (!camera._projPlaneDirty) {
    return camera._cachedProjPlane;
  }
  camera._projPlaneDirty = false;

  const fov = calculateFov(camera);
  camera._cachedProjPlane = camera._height2 / fov.tanHalfY;

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
