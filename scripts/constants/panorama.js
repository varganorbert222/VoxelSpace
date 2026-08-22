"use strict";

export const PANO_MIP_COUNT = 3;
export const PANO_MIP_KERNEL = 2;
export const PANO_MIP_MIN_SIZE = 2;
export const PANO_MIP_INV_SCALE = Object.freeze([1, 0.5, 0.25]);
export const PANO_MIP_T_FRACTIONS_BY_QUALITY = Object.freeze([
  Object.freeze([0, 0]),
  Object.freeze([0.26, 0.52]),
  Object.freeze([0.32, 0.58]),
  Object.freeze([0.38, 0.64]),
  Object.freeze([0.45, 0.72]),
  Object.freeze([0.52, 0.78]),
]);
export const PANO_MIP_STEP_SCALE = 2;
export const PANO_MIP_STEP_MAX_BY_QUALITY = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([4, 8, 13]),
  Object.freeze([3, 6, 10]),
  Object.freeze([2, 5, 8]),
  Object.freeze([1, 3, 6]),
  Object.freeze([1, 2, 4]),
]);
export const PANO_DIR_RESYNC = 32;
export const PANO_YHIT_LUT_SIZE = 4096;
export const PANO_YHIT_SLOPE_INF = 1e9;
export const FAR_PLANE_T_SCALE = 3;

export function farPlaneRayTMax(farClip, fovYDeg, aspect) {
  let a = aspect;
  if (!(a > 0)) {
    a = 16 / 9;
  }
  const tanHalfY = Math.tan((fovYDeg * Math.PI * 0.5) / 180);
  const tanHalfX = tanHalfY * a;
  const scale = Math.sqrt(1 + tanHalfX * tanHalfX + tanHalfY * tanHalfY);
  return farClip * (scale > 1 ? scale : 1);
}
