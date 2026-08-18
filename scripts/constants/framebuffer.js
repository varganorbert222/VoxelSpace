"use strict";

export const SKY_PALETTE_STEPS = 24;
export const SKY_PALETTE_T_MAX = (SKY_PALETTE_STEPS - 1) / SKY_PALETTE_STEPS;
export const SKY_ZENITH_POWER = 2.75;
export const UNFILLED_PIXEL = 0;

export function skyPaletteT(linearT) {
  let t = linearT;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  t = Math.pow(t, SKY_ZENITH_POWER);
  if (t > SKY_PALETTE_T_MAX) t = SKY_PALETTE_T_MAX;
  return t;
}
