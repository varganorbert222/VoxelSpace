"use strict";

import { MIN_SAMPLE_DISTANCE, qualityStepDivisor } from "./quality.js";
import {
  retailLodSpan,
  retailMipSwitches,
  retailNearEnd,
} from "../render/retail/schedule.js";

export const TERRAIN_MIP_KERNEL = 2;
export const TERRAIN_MIP_MIN_SIZE = 1;
export const TERRAIN_MIP_COUNT_MIN = 1;
export const TERRAIN_MIP_MAX_COUNT = 16;
export const TERRAIN_MIP_DEFAULT_COUNT = 10;
export const TERRAIN_MIP_DDA_EPS = 1e-4;
export const LOD0_REFINE_SUBDIV = 16;
export const LOD0_REFINE_SUBDIV_MIN = 2;
export const LOD0_REFINE_MIP_COUNT = 5;
// Retail near bands: 16, 16, 8, 4, 2 times the mip-0 band step.
const LOD0_NEAR_SUBDIV = Object.freeze([16, 16, 8, 4, 2]);
export const LOD0_REFINE_SWITCH_COUNT = LOD0_REFINE_MIP_COUNT - 1;
export const MARCH_MAX_STEPS = 16384;
export const LOD0_REFINE_MAX_STEPS = 65536;

export const LOD_SPACING_RETAIL = "retail";
export const LOD_SPACING_DEFAULT_MODE = LOD_SPACING_RETAIL;
export const LOD_SPACING_DEFAULT_METERS = 100;
export const LOD0_MAX_FAR_FRACTION = 0.1;
export const LOD_SPACING_UNUSED = 1e30;

export function mipVoxelSize(mip) {
  const m = mip | 0;
  if ((m <= 0) | 0) {
    return 1;
  }
  if ((m >= 30) | 0) {
    return 1073741824;
  }
  return (1 << m) | 0;
}

export function mipInvScale(mip) {
  return 1 / mipVoxelSize(mip);
}

export function lod0RefineSubdiv(refineMip) {
  const m = refineMip | 0;
  const last = (LOD0_NEAR_SUBDIV.length - 1) | 0;
  if (m <= 0) {
    return LOD0_NEAR_SUBDIV[0];
  }
  if (m >= last) {
    return LOD0_NEAR_SUBDIV[last];
  }
  return LOD0_NEAR_SUBDIV[m];
}

export function lod0RefineCellSize(refineMip) {
  return 1 / lod0RefineSubdiv(refineMip);
}

export function lod0RefineSwitchDistances(_lod0Meters, _mode, out) {
  const switchN = LOD0_REFINE_SWITCH_COUNT;
  const far = retailNearEnd();
  const dest = out && out.length >= switchN ? out : new Float64Array(switchN);
  // Retail near ends: 1/16, 1/8, 1/4, 1/2 of factor 8. Direct0 starts after that.
  for (let i = 0; (i < switchN) | 0; i = (i + 1) | 0) {
    const u = Math.pow(2, i - 4);
    const t = u * far;
    dest[i] = far > 1 && t > 0 && t < far ? t : far;
  }
  if (dest.length === switchN) {
    return dest;
  }
  return dest.subarray(0, switchN);
}

export function lod0RefineMipAt(t, switches) {
  const last = (LOD0_REFINE_MIP_COUNT - 1) | 0;
  if (!switches) {
    return 0;
  }
  const swN = switches.length | 0;
  let m = 0;
  while ((m < swN) & (m < last) & (t >= switches[m])) {
    m = (m + 1) | 0;
  }
  if (!(m >= 0)) {
    m = 0;
  }
  if (m > last) {
    m = last;
  }
  return m | 0;
}

export function mipLevelAtDistance(t, switches, lastMip) {
  const last = lastMip | 0;
  if ((last <= 0) | 0) {
    return 0;
  }
  if (!switches) {
    return 0;
  }
  const swN = switches.length | 0;
  let m = 0;
  while ((m < swN) & (m < last) & (t >= switches[m])) {
    m = (m + 1) | 0;
  }
  if (!(m >= 0)) {
    m = 0;
  }
  if (m > last) {
    m = last;
  }
  return m | 0;
}

export function marchCellSize(mip, refine, refineMip) {
  if ((mip | 0) <= 0) {
    return refine ? lod0RefineCellSize(refineMip) : 1;
  }
  return mipVoxelSize(mip);
}

// Near Refine shortens the band step by the 1/16…1 cell. Far mips stay put.
export function nearMarchStep(bandStep, mip, refine, refineMip) {
  let s = Number(bandStep);
  if (!(s > 0)) {
    s = MIN_SAMPLE_DISTANCE;
  }
  if ((mip | 0) <= 0 && refine) {
    s = s * lod0RefineCellSize(refineMip);
  }
  return s;
}

export function mixNearestBilinear(nearest, bilinear, fade) {
  if (!(fade > 0)) {
    return nearest;
  }
  if (!(fade < 1)) {
    return bilinear;
  }
  return nearest + (bilinear - nearest) * fade;
}

const easeScratch = {
  sampleMip: 0,
  sampleRefineOn: false,
  sampleRefineMip: 0,
  filterFade: 0,
};

export function easeLodSample(
  t,
  wx,
  wy,
  mip,
  refineOn,
  refineMip
) {
  const sampleMip = mip | 0;
  const sampleRefineOn = lod0RefineAt(t, sampleMip);
  easeScratch.sampleMip = sampleMip;
  easeScratch.sampleRefineOn = sampleRefineOn;
  easeScratch.sampleRefineMip = sampleRefineOn ? refineMip | 0 : 0;
  easeScratch.filterFade = sampleRefineOn ? 1 : 0;
  return easeScratch;
}

// Near passes only. Direct0 is still mip 0, but it is not refined.
export function lod0RefineAt(t, mip) {
  if ((mip | 0) !== 0) {
    return false;
  }
  const end = retailNearEnd();
  return end > 0 && Number(t) < end;
}

export function marchMaxSteps(refine) {
  return refine ? LOD0_REFINE_MAX_STEPS : MARCH_MAX_STEPS;
}

export function lod0SamplePos(wx, wy, dirX, dirY, refine, refineMip) {
  if (!refine) {
    return { x: wx, y: wy };
  }
  const s = lod0RefineCellSize(refineMip);
  const e = mipDdaEps(s);
  const ix = Math.floor((wx + dirX * e) / s);
  const iy = Math.floor((wy + dirY * e) / s);
  return {
    x: (ix + 0.5) * s,
    y: (iy + 0.5) * s,
  };
}

export function clampMipCount(count) {
  let n = count | 0;
  if ((n < TERRAIN_MIP_COUNT_MIN) | 0) {
    n = TERRAIN_MIP_COUNT_MIN;
  }
  if ((n > TERRAIN_MIP_MAX_COUNT) | 0) {
    n = TERRAIN_MIP_MAX_COUNT;
  }
  return n;
}

export function mipCountMax(width, height) {
  let size = width | 0;
  const h = height | 0;
  if ((h > 0) & ((size <= 0) | (h < size))) {
    size = h;
  }
  if ((size < 2) | 0) {
    return TERRAIN_MIP_COUNT_MIN;
  }
  let log = 0;
  let s = size;
  while ((s > 1) | 0) {
    s = s >> 1;
    log = (log + 1) | 0;
    if ((log >= TERRAIN_MIP_MAX_COUNT) | 0) {
      return TERRAIN_MIP_MAX_COUNT;
    }
  }
  if ((log < TERRAIN_MIP_COUNT_MIN) | 0) {
    return TERRAIN_MIP_COUNT_MIN;
  }
  return log;
}

export function clampMipCountForMap(count, width, height, builtCount) {
  const max = mipCountMax(width, height);
  let n = clampMipCount(count);
  if ((n > max) | 0) {
    n = max;
  }
  const built = builtCount | 0;
  if ((built > 0) & (n > built)) {
    n = built;
  }
  return n;
}

export function lod0MaxMeters(farClip, minMeters) {
  const lo = minMeters > 0 ? minMeters | 0 : 1;
  const far = Number(farClip);
  let hi = Math.floor(far * LOD0_MAX_FAR_FRACTION);
  if (!(hi >= lo)) {
    hi = lo;
  }
  return hi;
}

export function clampLodSpacingMeters(value, min, max) {
  let n = Math.round(Number(value));
  const lo = min > 0 ? min | 0 : 1;
  const hi = max > 0 ? max | 0 : 0;
  if (n < lo) {
    n = lo;
  }
  if ((hi > 0) & (n > hi)) {
    n = hi;
  }
  return n;
}

export function mipSwitchDistances(mipCount, farClip, out, _mode, _spacing, _capLod0Fraction) {
  const n = clampMipCount(mipCount);
  const dest = out || new Float64Array(Math.max(0, (n - 1) | 0));
  void farClip;
  void _mode;
  void _spacing;
  void _capLod0Fraction;
  return retailMipSwitches(n, retailLodSpan(), dest);
}

// March start distance. Always the camera near plane — band step / Quality
// only set stride, never the first sample.
export function firstBandT(nearClip) {
  let t = Number(nearClip);
  if (!(t > 0)) {
    t = 0;
  }
  return t;
}

export function bandStepAt(steps, mip) {
  const m = mip | 0;
  const last = (steps.length - 1) | 0;
  const s = steps[m < 0 ? 0 : m > last ? last : m];
  return s > 0 ? s : MIN_SAMPLE_DISTANCE;
}

// Smallest march step at this mip: one mip cell divided by Quality.
// The step never exceeds the cell, so a band stride cannot skip voxels.
export function bandStepFloor(mip, refine, refineMip, quality) {
  const cell = marchCellSize(mip, refine, refineMip);
  const q = qualityStepDivisor(quality);
  let lo = cell / q;
  if (!(lo > 0)) {
    lo = cell > 0 ? cell : MIN_SAMPLE_DISTANCE;
  }
  return lo;
}

export function bandMarchStep(mip, refine, refineMip, quality) {
  return bandStepFloor(mip, refine, refineMip, quality);
}

export function fitBandStep(step, mip, refine, refineMip, quality) {
  const lo = bandStepFloor(mip, refine, refineMip, quality);
  const cell = marchCellSize(mip, refine, refineMip);
  const hi = cell > lo ? cell : lo;
  let s = Number(step);
  if (!(s >= lo)) {
    s = lo;
  }
  if (s > hi) {
    s = hi;
  }
  return s;
}

export function growBandStep(step, mip, refine, refineMip, growth, quality) {
  const cell = marchCellSize(mip, refine, refineMip);
  const g = Number(growth);
  let s = Number(step);
  if (g > 0) {
    s = s + g * cell;
  }
  return fitBandStep(s, mip, refine, refineMip, quality);
}

export function fillClassicLodDistances(out, zStart, farClip, switches, bandCount) {
  const n = bandCount | 0;
  out[0] = zStart;
  const swN = switches ? switches.length : 0;
  for (let i = 0; (i < (n - 1) | 0) | 0; i = (i + 1) | 0) {
    const s = (i < swN) | 0 ? switches[i] : LOD_SPACING_UNUSED;
    if (s < farClip) {
      out[i + 1] = s > zStart ? s : zStart;
    } else {
      out[i + 1] = farClip;
    }
  }
  out[n] = farClip;
  for (let i = 1; (i < n) | 0; i = (i + 1) | 0) {
    if (out[i] < out[i - 1]) {
      out[i] = out[i - 1];
    }
    if (out[i] > farClip) {
      out[i] = farClip;
    }
  }
  return n;
}

export function mipDdaDelta(wx, wy, dirX, dirY, cellSize) {
  const s = cellSize > 0 ? cellSize : 1;
  const ix = Math.floor(wx / s);
  const iy = Math.floor(wy / s);
  let tMaxX = 1e30;
  let tMaxY = 1e30;
  if (dirX > 0) {
    tMaxX = ((ix + 1) * s - wx) / dirX;
  } else if (dirX < 0) {
    tMaxX = (ix * s - wx) / dirX;
  }
  if (dirY > 0) {
    tMaxY = ((iy + 1) * s - wy) / dirY;
  } else if (dirY < 0) {
    tMaxY = (iy * s - wy) / dirY;
  }
  let dt = tMaxX < tMaxY ? tMaxX : tMaxY;
  if (!(dt > 0)) {
    dt = 0;
  }
  return dt;
}

export function mipCellFarT(t, wx, wy, dirX, dirY, cellSize) {
  const dt = mipDdaDelta(wx, wy, dirX, dirY, cellSize);
  if (dt > 0) {
    return t + dt;
  }
  return t + mipDdaEps(cellSize);
}

export function mipDdaEps(cellSize) {
  const e = cellSize * TERRAIN_MIP_DDA_EPS;
  if (e > 1e-6) {
    return e;
  }
  return 1e-6;
}

export function mipSpanFarT(t, step, wx, wy, dirX, dirY, mip, refine, refineMip) {
  let tFar = t + step;
  if (tFar > t) {
    return tFar;
  }
  return t;
}

export function projectSdfYSpan(sdf, dst, z, zFar, horizon) {
  let y = (sdf * (dst / z) + horizon) | 0;
  if (zFar > z) {
    const yFar = (sdf * (dst / zFar) + horizon) | 0;
    if ((yFar < y) | 0) {
      y = yFar;
    }
  }
  return y;
}
