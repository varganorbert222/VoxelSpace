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

export const MIN_SAMPLE_DISTANCE = 0.5;
export const FOG_SATURATED = 1;
