"use strict";

export const FILTER_DISTANCE_MIN = 10;
export const FILTER_DISTANCE_MAX = 1000;
export const FILTER_DISTANCE_DEFAULT = 500;

export function clampFilterDistance(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return FILTER_DISTANCE_DEFAULT;
  }
  if (n < FILTER_DISTANCE_MIN) {
    return FILTER_DISTANCE_MIN;
  }
  if (n > FILTER_DISTANCE_MAX) {
    return FILTER_DISTANCE_MAX;
  }
  return n;
}

export function xyClipDistance(t, dirX, dirY, fwdX, fwdY) {
  return t * (dirX * fwdX + dirY * fwdY);
}
