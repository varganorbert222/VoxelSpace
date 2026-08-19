"use strict";

export const ALGORITHM_CLASSIC = "classic";
export const ALGORITHM_PANORAMA = "panorama";

export const PANO_SIZE_BY_QUALITY = Object.freeze([
  Object.freeze({ width: 0, height: 0 }),
  Object.freeze({ width: 1024, height: 512 }),
  Object.freeze({ width: 1536, height: 768 }),
  Object.freeze({ width: 2048, height: 1024 }),
  Object.freeze({ width: 3072, height: 1536 }),
]);

export const PANO_QUALITY_MAX = PANO_SIZE_BY_QUALITY.length - 1;
export const PANO_WIDTH = PANO_SIZE_BY_QUALITY[PANO_QUALITY_MAX].width;
export const PANO_HEIGHT = PANO_SIZE_BY_QUALITY[PANO_QUALITY_MAX].height;

export function qualityIndex(quality) {
  let q = quality | 0;
  if ((q < 1) | 0) {
    q = 1;
  }
  if ((q > PANO_QUALITY_MAX) | 0) {
    q = PANO_QUALITY_MAX;
  }
  return q;
}

export const RENDER_SCALE_MIN = 0.1;
export const RENDER_SCALE_MAX = 1;
export const RENDER_SCALE_SCREEN_MIN = 1;

export const RENDER_SCALE_K_BY_QUALITY = Object.freeze([
  0,
  0.88,
  0.92,
  0.96,
  1.0,
]);

export function renderScaleForQuality(quality, screenW, screenH) {
  const q = qualityIndex(quality);
  const pano = PANO_SIZE_BY_QUALITY[q];
  const k = RENDER_SCALE_K_BY_QUALITY[q];
  const w =
    screenW < RENDER_SCALE_SCREEN_MIN
      ? RENDER_SCALE_SCREEN_MIN
      : screenW;
  const h =
    screenH < RENDER_SCALE_SCREEN_MIN
      ? RENDER_SCALE_SCREEN_MIN
      : screenH;
  const scaleW = pano.width / w;
  const scaleH = pano.height / h;
  const base = scaleW < scaleH ? scaleW : scaleH;
  let s = k * base;
  if (s > RENDER_SCALE_MAX) {
    s = RENDER_SCALE_MAX;
  }
  if (s < RENDER_SCALE_MIN) {
    s = RENDER_SCALE_MIN;
  }
  return s;
}

export const LOD_BAND_COUNT = 7;
export const PIXEL_OFFSETS = Object.freeze([1, 2, 2, 4, 4, 8, 8]);
export const PIXEL_OFFSET_ALIGN = PIXEL_OFFSETS[PIXEL_OFFSETS.length - 1];
export const LOD_FAR_DELTAS = Object.freeze([1, 2, 3, 5, 8, 14]);
export const LOD_DISTANCE_FRACTIONS = Object.freeze([
  0.12, 0.28, 0.44, 0.58, 0.72, 0.86,
]);

export const STEP_GROWTH_BY_QUALITY = Object.freeze([
  0,
  0.0038,
  0.0031,
  0.0025,
  0.002,
]);
export const INITIAL_STEP_SCALE_BY_QUALITY = Object.freeze([
  0,
  1,
  0.94,
  0.88,
  0.82,
]);
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
]);
export const PANO_MIP_STEP_SCALE = 2;
export const PANO_MIP_STEP_MAX_BY_QUALITY = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([4, 8, 13]),
  Object.freeze([3, 6, 10]),
  Object.freeze([2, 5, 8]),
  Object.freeze([1, 3, 6]),
]);
export const PANO_DIR_RESYNC = 32;
export const PANO_YHIT_LUT_SIZE = 4096;
export const PANO_YHIT_SLOPE_INF = 1e9;
export const MIN_SAMPLE_DISTANCE = 0.5;
export const NON_REPEAT_GROUND_OFFSET = 20;
export const FOG_SATURATED = 1;
export const FAR_PLANE_T_SCALE = 3;

export function farPlaneRayTMax(farClip, fovYDeg, aspect) {
  let a = aspect;
  if (!(a > 0)) {
    a = 16 / 9;
  }
  const tanHalfY = Math.tan(fovYDeg * Math.PI * 0.5 / 180);
  const tanHalfX = tanHalfY * a;
  const scale = Math.hypot(1, tanHalfX, tanHalfY);
  return farClip * (scale > 1 ? scale : 1);
}
