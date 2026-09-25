"use strict";

// Retail descriptor distances. Scan Quality divides the step. LOD Bias stays 0.
// Low matches retail q = 1. Higher project qualities are denser.

const FOV_DEG_RAD = 0.01745329;
const DIVISOR = Math.fround(2.2);
const NEAR_FACTORS = Object.freeze([0.5, 1, 2, 4, 8]);
const NEAR_STEPS = Object.freeze([1, 1, 2, 4, 8]);
const NEAR_SUBDIV = Object.freeze([16, 16, 8, 4, 2]);
const DIRECT_COUNT = 6;

const QUALITY_Q = Object.freeze([0, 1, 1.25, 1.5, 2, 2.5]);

const SAMPLES_PER_BAND = 32;

let frame = {
  width: 1024,
  fovDeg: 90,
  quality: 1,
  farClip: 2000,
  showDetails: 0,
  nearRefine: 0,
};

export function retailQualityQ(quality) {
  let q = quality | 0;
  if (q < 1) {
    q = 1;
  }
  if (q >= QUALITY_Q.length) {
    q = QUALITY_Q.length - 1;
  }
  return QUALITY_Q[q];
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
    nearRefine: params.nearRefine || params.lod0Refine ? 1 : 0,
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

export function retailNearSwitches(farClip) {
  const { raw, scale } = retailDistanceScale(farClip);
  return [
    scaledEnd(raw, 1, scale),
    scaledEnd(raw, 2, scale),
    scaledEnd(raw, 3, scale),
    scaledEnd(raw, 4, scale),
  ];
}

export function retailMipSwitches(bandCount, farClip, out) {
  const n = Math.max(0, (bandCount | 0) - 1);
  const dest = out || new Float64Array(n);
  const { raw, scale, far } = retailDistanceScale(farClip);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let t = scaledEnd(raw, 4 + i, scale);
    if (!(t > prev)) {
      t = prev + far / (n + 1);
    }
    if (t >= far) {
      t = far * ((i + 1) / (n + 1));
    }
    if (!(t > prev)) {
      t = prev + far / (n + 1);
    }
    dest[i] = t;
    prev = t;
  }
  return dest;
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
