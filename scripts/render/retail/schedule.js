"use strict";

// Retail descriptor distances. Scan Quality divides the step. LOD Bias stays 0.
// The step divisor is the shared quality ladder.

import { qualityStepDivisor } from "../../constants/quality.js";

const FOV_DEG_RAD = 0.01745329;
const DIVISOR = Math.fround(2.2);
const NEAR_FACTORS = Object.freeze([0.5, 1, 2, 4, 8]);
const NEAR_STEPS = Object.freeze([1, 1, 2, 4, 8]);
const NEAR_SUBDIV = Object.freeze([16, 16, 8, 4, 2]);
const DIRECT_COUNT = 6;

const SAMPLES_PER_BAND = 32;

let frame = {
  width: 1024,
  fovDeg: 90,
  quality: 1,
  farClip: 2000,
  showDetails: 0,
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
    showDetails: params.showDetails ? 1 : 0,
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

export function retailDistanceScale(farClip) {
  const raw = buildRetailBands(frame.width, frame.fovDeg, frame.quality);
  const span = raw[raw.length - 1].end || 1;
  const requested = Number(farClip);
  const far = requested > 1 ? requested : frame.farClip > 1 ? frame.farClip : span;
  frame = { ...frame, farClip: far };
  return { raw, scale: far / span, far };
}

export function retailBands() {
  const { raw, scale } = retailDistanceScale(frame.farClip);
  return raw.map((band) => ({
    ...band,
    end: band.end * scale,
    step: band.step * scale,
  }));
}

function scaledEnd(raw, index, scale) {
  return raw[Math.min(index, raw.length - 1)].end * scale;
}

// Mip switch i is u * farClip, u = 2^(i-6), while u < 1.
// Extra levels past 1/2 sit on the last mip out to farClip.
export function retailMipSwitches(bandCount, farClip, out) {
  const levels = Math.max(1, bandCount | 0);
  const switchN = (levels - 1) | 0;
  const dest = out && out.length >= switchN ? out : new Float64Array(switchN);
  const far = Number(farClip);
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

export function retailLodSteps(bandCount, farClip, out) {
  const n = Math.max(1, bandCount | 0);
  const dest = out || new Float64Array(n);
  const { raw, scale, far } = retailDistanceScale(farClip);
  const q = retailQualityQ(frame.quality);
  const budget = SAMPLES_PER_BAND * q;
  for (let i = 0; i < n; i++) {
    const bandIndex = i === 0 ? 0 : Math.min(4 + i - 1, raw.length - 1);
    const start = i === 0 ? 0 : scaledEnd(raw, 4 + i - 1, scale);
    const end =
      i === n - 1 ? far : Math.min(far, scaledEnd(raw, 4 + i, scale));
    const width = Math.max(end - start, 1e-3);
    const scaled = raw[bandIndex].step * scale;
    const floor = width / budget;
    let step = scaled > floor ? scaled : floor;
    if (step > width) {
      step = width;
    }
    dest[i] = step;
  }
  return dest;
}

export function retailStepScale() {
  return retailQualityQ(frame.quality);
}
