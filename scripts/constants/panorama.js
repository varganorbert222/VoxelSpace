"use strict";

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
