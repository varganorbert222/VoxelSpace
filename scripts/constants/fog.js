"use strict";

import { FOG_SATURATED } from "./quality.js";

export const FOG_RANGE_MIN = 0;
export const FOG_RANGE_STEP = 100;
export const FOG_RANGE_DEFAULT_START = 0;

function snapToStep(value, min, step) {
  if (!(step > 0)) {
    return value;
  }
  return min + Math.round((value - min) / step) * step;
}

export function clampFogRange(start, end, farClip, bounds) {
  const min =
    bounds && Number.isFinite(bounds.min) ? bounds.min : FOG_RANGE_MIN;
  const step =
    bounds && Number.isFinite(bounds.step) && bounds.step > 0
      ? bounds.step
      : FOG_RANGE_STEP;
  const far = Number.isFinite(farClip) ? farClip : min + step;
  let fogEnd = Number.isFinite(end) ? end : far;
  let fogStart = Number.isFinite(start) ? start : min;
  fogEnd = snapToStep(fogEnd, min, step);
  fogStart = snapToStep(fogStart, min, step);
  if (fogEnd > far) {
    fogEnd = far;
  }
  if (fogEnd < min) {
    fogEnd = min;
  }
  if (fogStart < min) {
    fogStart = min;
  }
  if (fogStart > fogEnd - step) {
    fogStart = fogEnd - step;
  }
  if (fogStart < min) {
    fogStart = min;
    if (fogEnd < fogStart + step && far >= fogStart + step) {
      fogEnd = fogStart + step;
    }
  }
  if (fogEnd > far) {
    fogEnd = far;
  }
  return { fogStart, fogEnd };
}

export function effectiveFarClip(farClip, applyFog, fogEnd) {
  if (!applyFog) {
    return farClip;
  }
  return fogEnd < farClip ? fogEnd : farClip;
}

export function fogT(z, fogStart, fogEnd) {
  const span = fogEnd - fogStart;
  if (span === 0) {
    return FOG_SATURATED;
  }
  const t = (z - fogStart) / span;
  if (t < 0) {
    return 0;
  }
  if (t > FOG_SATURATED) {
    return FOG_SATURATED;
  }
  return t;
}

export function wasFogEndAtFar(fogEnd, farClip, step) {
  const s = step > 0 ? step : FOG_RANGE_STEP;
  return Math.abs(fogEnd - farClip) <= s * 0.5;
}

export function syncFogEndToFarClip(fogStart, fogEnd, prevFar, nextFar, bounds) {
  const step =
    bounds && Number.isFinite(bounds.step) && bounds.step > 0
      ? bounds.step
      : FOG_RANGE_STEP;
  let end = fogEnd;
  if (wasFogEndAtFar(fogEnd, prevFar, step)) {
    end = nextFar;
  }
  return clampFogRange(fogStart, end, nextFar, bounds);
}
