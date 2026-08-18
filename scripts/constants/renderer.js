"use strict";

export const ALGORITHM_CLASSIC = "classic";
export const ALGORITHM_PANORAMA = "panorama";

export const PANO_WIDTH = 2048;
export const PANO_HEIGHT = 1024;

export const LOD_BAND_COUNT = 7;
export const PIXEL_OFFSETS = Object.freeze([1, 2, 2, 4, 4, 8, 8]);
export const LOD_FAR_DELTAS = Object.freeze([1, 2, 4, 8, 16, 32]);
export const LOD_DISTANCE_FRACTIONS = Object.freeze([
  0.01, 0.15, 0.25, 0.35, 0.45, 0.55,
]);

export const STEP_GROWTH = 0.005;
export const MIN_SAMPLE_DISTANCE = 1;
export const NON_REPEAT_GROUND_OFFSET = 20;
