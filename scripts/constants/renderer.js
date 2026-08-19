"use strict";

export const ALGORITHM_CLASSIC = "classic";
export const ALGORITHM_PANORAMA = "panorama";

export const PANO_SIZE_BY_QUALITY = Object.freeze([
  Object.freeze({ width: 0, height: 0 }),
  Object.freeze({ width: 512, height: 256 }),
  Object.freeze({ width: 1024, height: 512 }),
  Object.freeze({ width: 1536, height: 768 }),
  Object.freeze({ width: 2048, height: 1024 }),
]);

export const PANO_QUALITY_MAX = PANO_SIZE_BY_QUALITY.length - 1;
export const PANO_WIDTH = PANO_SIZE_BY_QUALITY[PANO_QUALITY_MAX].width;
export const PANO_HEIGHT = PANO_SIZE_BY_QUALITY[PANO_QUALITY_MAX].height;

export const PANO_RENDER_SCALE_MIN = 0.1;
export const PANO_RENDER_SCALE_MAX = 1;
export const PANO_RENDER_SCALE_SCREEN_MIN = 1;

export const PANO_RENDER_SCALE_K_BY_QUALITY = Object.freeze([
  0,
  0.8,
  0.9,
  1.0,
  1.0,
]);

export function panoRenderScaleForQuality(quality, screenW, screenH) {
  let q = quality | 0;
  if ((q < 1) | 0) {
    q = 1;
  }
  if ((q > PANO_QUALITY_MAX) | 0) {
    q = PANO_QUALITY_MAX;
  }
  const pano = PANO_SIZE_BY_QUALITY[q];
  const k = PANO_RENDER_SCALE_K_BY_QUALITY[q];
  const w =
    screenW < PANO_RENDER_SCALE_SCREEN_MIN
      ? PANO_RENDER_SCALE_SCREEN_MIN
      : screenW;
  const h =
    screenH < PANO_RENDER_SCALE_SCREEN_MIN
      ? PANO_RENDER_SCALE_SCREEN_MIN
      : screenH;
  const scaleW = pano.width / w;
  const scaleH = pano.height / h;
  const base = scaleW < scaleH ? scaleW : scaleH;
  let s = k * base;
  if (s > PANO_RENDER_SCALE_MAX) {
    s = PANO_RENDER_SCALE_MAX;
  }
  if (s < PANO_RENDER_SCALE_MIN) {
    s = PANO_RENDER_SCALE_MIN;
  }
  return s;
}

export const LOD_BAND_COUNT = 7;
export const PIXEL_OFFSETS = Object.freeze([1, 2, 2, 4, 4, 8, 8]);
export const PIXEL_OFFSET_ALIGN = PIXEL_OFFSETS[PIXEL_OFFSETS.length - 1];
export const LOD_FAR_DELTAS = Object.freeze([1, 2, 4, 8, 16, 32]);
export const LOD_DISTANCE_FRACTIONS = Object.freeze([
  0.01, 0.15, 0.25, 0.35, 0.45, 0.55,
]);

export const STEP_GROWTH = 0.005;
export const MIN_SAMPLE_DISTANCE = 1;
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
