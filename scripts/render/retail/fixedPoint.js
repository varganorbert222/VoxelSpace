"use strict";

import {
  RETAIL_ANGLE_UNITS_PER_RAD,
  RETAIL_COS_OFFSET,
  RETAIL_Q20_ONE,
  RETAIL_Q22_ONE,
  RETAIL_TRIG_FRAC_DEN,
  RETAIL_TRIG_FRAC_MASK,
  RETAIL_TRIG_TABLE_LEN,
  RETAIL_TRIG_TABLE_STEP,
} from "./constants.js";

let sineTableQ22 = null;

function truncTowardZero(value) {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

export function ensureRetailSineTableQ22() {
  if (sineTableQ22) {
    return sineTableQ22;
  }
  const table = new Int32Array(RETAIL_TRIG_TABLE_LEN);
  let angle = 0;
  for (let index = 0; index < RETAIL_TRIG_TABLE_LEN; index++) {
    table[index] = Math.trunc(Math.sin(angle) * RETAIL_Q22_ONE) | 0;
    angle += RETAIL_TRIG_TABLE_STEP;
  }
  sineTableQ22 = table;
  return table;
}

export function radiansToRetailAngleU32(radians) {
  return Math.trunc(radians * RETAIL_ANGLE_UNITS_PER_RAD) >>> 0;
}

export function retailSinCosQ22(radians) {
  const table = ensureRetailSineTableQ22();
  const angle = radiansToRetailAngleU32(radians);
  const index = angle >>> 21;
  const fraction = angle & RETAIL_TRIG_FRAC_MASK;
  const sine0 = table[index] | 0;
  const sine1 = table[index + 1] | 0;
  const cosine0 = table[index + RETAIL_COS_OFFSET] | 0;
  const cosine1 = table[index + RETAIL_COS_OFFSET + 1] | 0;
  const sine = (sine0 + Math.floor((fraction * (sine1 - sine0)) / RETAIL_TRIG_FRAC_DEN)) | 0;
  const cosine = (cosine0 + Math.floor((fraction * (cosine1 - cosine0)) / RETAIL_TRIG_FRAC_DEN)) | 0;
  return [sine, cosine];
}

export function retailSinCosQ20(radians) {
  const pair = retailSinCosQ22(radians);
  return [pair[0] >> 2, pair[1] >> 2];
}

// Signed fixed multiply matching the recovered x86 shift, used for camera basis and sky rows.
export function fixedMulShiftSigned32(left, right, shift) {
  const a = left | 0;
  const b = right | 0;
  const product = a * b;
  if (Number.isSafeInteger(product)) {
    return Math.floor(product / 2 ** shift) | 0;
  }
  return Number((BigInt(a) * BigInt(b)) >> BigInt(shift)) | 0;
}

export function fixedMulQ20(left, right) {
  return fixedMulShiftSigned32(left, right, 20);
}

// WGSL scanline multiply. The GPU init and terrain passes use this form, so the CPU oracle does too.
export function fixedMulQ20Scan(left, right) {
  const valueA = left | 0;
  const valueB = right | 0;
  const highA = valueA >> 16;
  const highB = valueB >> 16;
  const lowA = valueA & 65535;
  const lowB = valueB & 65535;
  const lowHi = (Math.imul(lowA, lowB) >>> 16) | 0;
  const cross = (Math.imul(highA, lowB) + Math.imul(lowA, highB)) | 0;
  return ((Math.imul(highA, highB) << 12) + ((cross + lowHi) >> 4)) | 0;
}

export function fixedMulQ16Scan(left, right) {
  const valueA = left | 0;
  const valueB = right | 0;
  const lowA = valueA & 65535;
  const highA = valueA >> 16;
  const lowB = valueB & 65535;
  const highB = valueB >> 16;
  const low = (Math.imul(lowA, lowB) >>> 16) | 0;
  return (low + Math.imul(highA, lowB) + Math.imul(lowA, highB) + (Math.imul(highA, highB) << 16)) | 0;
}

export function scanStoreSar2(q20) {
  return ((q20 + 2) >> 2) | 0;
}

export function scaledScanStep(q20, scale) {
  const stored = scanStoreSar2(q20 | 0);
  if (Math.abs(scale - 1) < 1e-7) {
    return stored;
  }
  return truncTowardZero(stored * scale) | 0;
}

export function worldToQ22(world) {
  return (Math.trunc(world * 65536) << 6) | 0;
}

export function worldZToRawQ20(retailWorldZ) {
  return Math.trunc((retailWorldZ / 0.25) * RETAIL_Q20_ONE) | 0;
}

export function projectZToRetailWorld(projectZ, altitude) {
  const span = altitude > 0 ? altitude : 1;
  return (projectZ / span) * 255 * 0.25;
}

// Project yaw 0 looks down -Y and positive pitch looks down.
// Retail yaw 0 looks down +X and positive pitch looks up.
export function projectAnglesToRetail(yawRadians, pitchDegrees) {
  const pitchRadians = (pitchDegrees * Math.PI) / 180;
  return {
    yaw: -yawRadians - Math.PI / 2,
    pitch: -pitchRadians,
  };
}
