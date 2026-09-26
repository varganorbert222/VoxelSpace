"use strict";

export const NON_REPEAT_GROUND_OFFSET = 20;

// Screen rows one depth sample may cover. Coarser at low quality.
const CLASSIC_PIXEL_BUDGET = Object.freeze([0, 48, 32, 24, 16, 8]);

export function classicPixelBudget(quality) {
  let q = quality | 0;
  if (q < 1) {
    q = 1;
  }
  if (q >= CLASSIC_PIXEL_BUDGET.length) {
    q = CLASSIC_PIXEL_BUDGET.length - 1;
  }
  return CLASSIC_PIXEL_BUDGET[q];
}
