"use strict";

import { BACKEND_WEBGPU } from "./backend.js";

export const QUALITY_LOW = 1;
export const QUALITY_MEDIUM = 2;
export const QUALITY_HIGH = 3;
export const QUALITY_VERY_HIGH = 4;
export const QUALITY_ULTRA = 5;

export const QUALITY_LABEL = Object.freeze({
  [QUALITY_LOW]: "Low",
  [QUALITY_MEDIUM]: "Medium",
  [QUALITY_HIGH]: "High",
  [QUALITY_VERY_HIGH]: "Very-high",
  [QUALITY_ULTRA]: "Ultra",
});

export function isMobileClient() {
  if (typeof navigator === "undefined") {
    return false;
  }
  if (navigator.userAgentData && navigator.userAgentData.mobile === true) {
    return true;
  }
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod/i.test(ua)) {
    return true;
  }
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function isUltraQualityAllowed(backend) {
  return backend === BACKEND_WEBGPU && !isMobileClient();
}

export function clampQualityForContext(quality, backend) {
  const q = qualityIndex(quality);
  if (q === QUALITY_ULTRA && !isUltraQualityAllowed(backend)) {
    return QUALITY_VERY_HIGH;
  }
  return q;
}

export const STEP_GROWTH_BY_QUALITY = Object.freeze([
  0, 0.0038, 0.0031, 0.0025, 0.002, 0.0014,
]);

// March step is the mip cell divided by this factor. Low is one sample per
// cell. The same ladder is used by JS, WASM, and WebGPU.
export const QUALITY_STEP_DIVISOR = Object.freeze([
  0, 1, 1.25, 1.5, 2, 2.5,
]);

export function qualityIndex(quality) {
  let q = quality | 0;
  if ((q < 1) | 0) {
    q = 1;
  }
  if ((q > QUALITY_ULTRA) | 0) {
    q = QUALITY_ULTRA;
  }
  return q;
}

export function qualityStepDivisor(quality) {
  return QUALITY_STEP_DIVISOR[qualityIndex(quality)];
}

export const MIN_SAMPLE_DISTANCE = 0.5;
export const FOG_SATURATED = 1;
