"use strict";

// Retail scan quality. The raw band step is divided by this value.
// 1 is the retail step. Below 1 the step grows. Above 1 it shrinks.
export const SCAN_QUALITY_MIN = 0.55;
export const SCAN_QUALITY_MAX = 4;
export const SCAN_QUALITY_STEP = 0.05;
export const SCAN_QUALITY_DEFAULT = 1;
export const QUALITY_LOW = SCAN_QUALITY_MIN;

export function clampScanQuality(value) {
  let n = Number(value);
  if (!Number.isFinite(n)) {
    n = SCAN_QUALITY_DEFAULT;
  }
  if (n < SCAN_QUALITY_MIN) {
    n = SCAN_QUALITY_MIN;
  }
  if (n > SCAN_QUALITY_MAX) {
    n = SCAN_QUALITY_MAX;
  }
  const steps = Math.round((n - SCAN_QUALITY_MIN) / SCAN_QUALITY_STEP);
  const snapped = SCAN_QUALITY_MIN + steps * SCAN_QUALITY_STEP;
  return Math.round(snapped * 100) / 100;
}

export function clampQualityForContext(quality, _backend) {
  return clampScanQuality(quality);
}

export const STEP_GROWTH_BY_QUALITY = Object.freeze([
  0, 0.0038, 0.0031, 0.0025, 0.002, 0.0014,
]);

export function qualityIndex(quality) {
  let i = Math.round(clampScanQuality(quality));
  if (i < 1) {
    i = 1;
  }
  if (i > 5) {
    i = 5;
  }
  return i;
}

export function qualityStepDivisor(quality) {
  return clampScanQuality(quality);
}

export const MIN_SAMPLE_DISTANCE = 0.5;
export const FOG_SATURATED = 1;
