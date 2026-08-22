"use strict";

export const LOD_BAND_COUNT = 7;
export const PIXEL_OFFSETS = Object.freeze([1, 2, 2, 4, 4, 8, 8]);
export const ULTRA_PIXEL_OFFSETS = Object.freeze([1, 1, 1, 1, 1, 1, 1]);
export const PIXEL_OFFSET_ALIGN = PIXEL_OFFSETS[PIXEL_OFFSETS.length - 1];
export const LOD_FAR_DELTAS = Object.freeze([1, 2, 3, 5, 8, 14]);
export const ULTRA_LOD_FAR_DELTAS = Object.freeze([0.5, 1, 1.5, 2.5, 4, 7]);
export const LOD_DISTANCE_FRACTIONS = Object.freeze([
  0.12, 0.28, 0.44, 0.58, 0.72, 0.86,
]);
export const NON_REPEAT_GROUND_OFFSET = 20;
