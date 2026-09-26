"use strict";

// Retail descriptor distances. Scan Quality divides the step.
// LOD Bias scales the finished endpoints by 2^(-bias). Bias 0 leaves them put.
// Render distance does not move the endpoints.

import { qualityStepDivisor } from "../../constants/quality.js";

const FOV_DEG_RAD = 0.01745329;
const DIVISOR = Math.fround(2.2);
// Direct5 is factor 512. That endpoint is the 1 of the LOD ladder.
const DIRECT5_FACTOR = 512;
export const LOD_BIAS_DEFAULT = 0;
const NEAR_FACTORS = Object.freeze([0.5, 1, 2, 4, 8]);
const NEAR_STEPS = Object.freeze([1, 1, 2, 4, 8]);
const NEAR_SUBDIV = Object.freeze([16, 16, 8, 4, 2]);
const DIRECT_COUNT = 6;

let frame = {
  width: 1024,
  fovDeg: 90,
  quality: 1,
  farClip: 2000,
  lodBias: LOD_BIAS_DEFAULT,
  showDetails: 0,
  lodSpacingMode: "retail",
  lodSpacing: 100,
};

export function retailQualityQ(quality) {
  return qualityStepDivisor(quality);
}

export function retailFocal(width, fovDeg) {
  const fov = Math.max(1, fovDeg | 0);
  const halfAngle = ((fov + 1) >> 1) * FOV_DEG_RAD;
  const w = Math.max(1, width | 0);
  return Math.max(1, Math.trunc(w * 0.5 / Math.tan(halfAngle) + 0.5));
}

export function fovDegFromTanHalf(tanHalf) {
  if (!(tanHalf > 0)) {
    return 90;
  }
  return Math.max(1, Math.round((Math.atan(tanHalf) * 360) / Math.PI));
}

export function useRetailFrame(params) {
  if (!params) {
    return frame;
  }
  const width = params.screenWidth || params.width || frame.width;
  const fovDeg = params.fov || fovDegFromTanHalf(params.tanHalfFovX);
  const farClip = Number(params.farClip);
  frame = {
    width: width | 0,
    fovDeg: fovDeg | 0,
    quality: params.quality | 0,
    farClip: farClip > 1 ? farClip : frame.farClip,
    lodBias: Number.isFinite(Number(params.lodBias))
      ? Number(params.lodBias)
      : frame.lodBias,
    showDetails: params.showDetails ? 1 : 0,
    lodSpacingMode: "retail",
    lodSpacing:
      params.lodSpacing != null ? Number(params.lodSpacing) : frame.lodSpacing,
  };
  return frame;
}

export function retailFrame() {
  return frame;
}

export function buildRetailBands(width, fovDeg, quality) {
  const focal = retailFocal(width, fovDeg);
  const q = retailQualityQ(quality);
  const bands = [];
  for (let i = 0; i < NEAR_FACTORS.length; i++) {
    bands.push({
      near: 1,
      subdiv: NEAR_SUBDIV[i],
      mip: 0,
      end: (focal * NEAR_FACTORS[i]) / DIVISOR,
      step: NEAR_STEPS[i] / q,
    });
  }
  for (let j = 0; j < DIRECT_COUNT; j++) {
    const pow = 1 << j;
    bands.push({
      near: 0,
      subdiv: 1,
      mip: j,
      end: ((focal * 16) * pow) / DIVISOR,
      step: (16 * pow) / q,
    });
  }
  return bands;
}

// 2^(-bias). Bias 0 is the recovered descriptor scale. Positive bias pulls
// every endpoint closer. It does not change the step divisor.
export function retailLodBiasScale(lodBias) {
  const bias = Number(lodBias);
  const b = Number.isFinite(bias) ? bias : LOD_BIAS_DEFAULT;
  return Math.pow(2, -b);
}

// Direct5 end in meters: (focal * 512 / 2.2) * 2^(-bias).
export function retailLodSpan(lodBias) {
  const focal = retailFocal(frame.width, frame.fovDeg);
  const direct5 = (focal * DIRECT5_FACTOR) / DIVISOR;
  const bias = lodBias == null ? frame.lodBias : lodBias;
  return direct5 * retailLodBiasScale(bias);
}

export function retailBands() {
  const raw = buildRetailBands(frame.width, frame.fovDeg, frame.quality);
  const scale = retailLodBiasScale(frame.lodBias);
  return raw.map((band) => ({
    ...band,
    end: band.end * scale,
  }));
}

// Mip switch i is u * Direct5, u = 2^(i-6), while u < 1.
// The span is the retail endpoint, not the render distance.
export function retailMipSwitches(bandCount, spanMeters, out) {
  const levels = Math.max(1, bandCount | 0);
  const switchN = (levels - 1) | 0;
  const dest = out && out.length >= switchN ? out : new Float64Array(switchN);
  const far = Number(spanMeters);
  for (let i = 0; i < switchN; i++) {
    const u = Math.pow(2, i - 6);
    if (!(far > 1) || !(u > 0) || !(u < 1)) {
      dest[i] = far;
      continue;
    }
    const t = u * far;
    dest[i] = t > 0 && t < far ? t : far;
  }
  return dest.subarray(0, switchN);
}

// Retail walks each doubling band with rawStep / q. That is focal / (2 * 2.2)
// samples at Low, not a fixed 32. 32 was the count while bands were squeezed
// into Distance, and it left every band about 3.6× sparser than the retail step.
export function retailSamplesPerBand(quality) {
  const focal = retailFocal(frame.width, frame.fovDeg);
  const perLow = focal / (2 * DIVISOR);
  let samples = perLow * retailQualityQ(quality) * retailLodBiasScale(frame.lodBias);
  if (!(samples > 0)) {
    samples = 1;
  }
  return samples;
}

// Step is the retail raw step divided by q. Band edges stay on the descriptor span.
export function qualityBandSteps(bandCount, farClip, quality, switches, out) {
  const n = Math.max(1, bandCount | 0);
  const dest = out || new Float64Array(n);
  void farClip;
  const far = retailLodSpan();
  const samples = retailSamplesPerBand(quality);
  const swN = switches ? switches.length : 0;
  let start = 0;
  for (let i = 0; i < n; i++) {
    let end = far;
    if (i < n - 1) {
      const edge = i < swN ? Number(switches[i]) : far;
      end = edge > start && edge < far ? edge : far;
    }
    const width = end > start ? end - start : 0;
    let step = samples > 0 ? width / samples : width;
    if (!(step > 0)) {
      step = width > 0 ? width : 1e-3;
    }
    if (width > 0 && step > width) {
      step = width;
    }
    dest[i] = step;
    start = end;
  }
  if (dest.length === n) {
    return dest;
  }
  return dest.subarray(0, n);
}

export function retailLodSteps(bandCount, farClip, out) {
  void farClip;
  const span = retailLodSpan();
  const switches = retailMipSwitches(bandCount, span);
  return qualityBandSteps(bandCount, span, frame.quality, switches, out);
}

export function retailStepScale() {
  return retailQualityQ(frame.quality);
}
