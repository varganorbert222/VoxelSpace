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

export function skyLinearFromHat(hat) {
  let h = hat;
  if (h > 1) h = 1;
  if (h < -1) h = -1;
  return (2 * Math.acos(h)) / Math.PI;
}

export function skyLutIndexFromHat(hat, height) {
  const last = (height - 1) | 0;
  let idx = (skyLinearFromHat(hat) * height * 0.5) | 0;
  if (idx < 0) idx = 0;
  if (idx > last) idx = last;
  return idx;
}
