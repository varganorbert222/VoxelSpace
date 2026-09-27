"use strict";

// Retail descriptor distances, in meters.
// XY is stored at Q22 and the scan step comes from a Q20 ray shifted down by
// 2, so one raw step of 1 is 1/16 world unit. One world unit is one meter.
// Scan Quality divides the step. LOD Bias scales the finished endpoints by
// 2^(-bias). Bias 0 leaves them put. Render distance does not move them.

import { qualityStepDivisor } from "../../constants/quality.js";

const FOV_DEG_RAD = 0.01745329;
const DIVISOR = Math.fround(2.2);
// Direct5 is factor 512. That endpoint is the 1 of the LOD ladder.
const DIRECT5_FACTOR = 512;
// Q22 / (Q20 >> 2) = 16 scan steps per meter.
const SCAN_STEPS_PER_METER = 16;
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
      end: ((focal * NEAR_FACTORS[i]) / DIVISOR) / SCAN_STEPS_PER_METER,
      step: NEAR_STEPS[i] / q / SCAN_STEPS_PER_METER,
    });
  }
  for (let j = 0; j < DIRECT_COUNT; j++) {
    const pow = 1 << j;
    bands.push({
      near: 0,
      subdiv: 1,
      mip: j,
      end: ((focal * 16) * pow) / DIVISOR / SCAN_STEPS_PER_METER,
      step: (16 * pow) / q / SCAN_STEPS_PER_METER,
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

// Direct5 end in meters: (focal * 512 / 2.2) / 16 * 2^(-bias).
export function retailLodSpan(lodBias) {
  const focal = retailFocal(frame.width, frame.fovDeg);
  const direct5 = (focal * DIRECT5_FACTOR) / DIVISOR / SCAN_STEPS_PER_METER;
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

// Near passes end at factor 8. Direct0 stays on mip 0 until factor 16.
export function retailNearEnd(lodBias) {
  return retailLodSpan(lodBias) * (8 / DIRECT5_FACTOR);
}

// Mip switch i ends Direct mip i: factor (16 << i) = span * 2^(i-5), while that
// fraction is still inside Direct5. The span is the retail endpoint, not Distance.
export function retailMipSwitches(bandCount, spanMeters, out) {
  const levels = Math.max(1, bandCount | 0);
  const switchN = (levels - 1) | 0;
  const dest = out && out.length >= switchN ? out : new Float64Array(switchN);
  const far = Number(spanMeters);
  for (let i = 0; i < switchN; i++) {
    const u = Math.pow(2, i - 5);
    if (!(far > 1) || !(u > 0) || !(u < 1)) {
      dest[i] = far;
      continue;
    }
    const t = u * far;
    dest[i] = t > 0 && t < far ? t : far;
  }
  return dest.subarray(0, switchN);
}

// Direct mip i walks (1 << i) meters at Low. That is the retail raw step
// (16 << i) divided by 16 scan steps per meter, then by q. Mip 0 is Direct0's
// 1 m; the five Near passes divide it by 16, 16, 8, 4, 2 until factor 8.
// The tail keeps its own step. Distance does not stretch it.
export function qualityBandSteps(bandCount, farClip, quality, switches, out) {
  const n = Math.max(1, bandCount | 0);
  const dest = out || new Float64Array(n);
  void farClip;
  void switches;
  const q = retailQualityQ(quality);
  const div = q > 0 ? q : 1;
  for (let i = 0; i < n; i++) {
    const raw = Math.pow(2, i);
    dest[i] = raw / div;
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
