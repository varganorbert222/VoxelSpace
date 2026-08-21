"use strict";

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

export const MIN_SAMPLE_DISTANCE = 0.5;
export const FOG_SATURATED = 1;
