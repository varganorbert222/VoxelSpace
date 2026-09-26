"use strict";

import { MIN_SAMPLE_DISTANCE } from "./quality.js";

export const TERRAIN_MIP_KERNEL = 2;
export const TERRAIN_MIP_MIN_SIZE = 1;
export const TERRAIN_MIP_COUNT_MIN = 1;
export const TERRAIN_MIP_MAX_COUNT = 16;
export const TERRAIN_MIP_DEFAULT_COUNT = 5;
export const TERRAIN_MIP_DDA_EPS = 1e-4;
export const LOD0_REFINE_SUBDIV = 16;
export const LOD0_REFINE_SUBDIV_MIN = 1;
export const LOD0_REFINE_MIP_COUNT = 5;
export const LOD0_REFINE_SWITCH_COUNT = LOD0_REFINE_MIP_COUNT - 1;
export const MARCH_MAX_STEPS = 16384;
export const LOD0_REFINE_MAX_STEPS = 65536;

export const LOD_SPACING_LINEAR = "linear";
export const LOD_SPACING_DOUBLE = "double";
export const LOD_SPACING_LOG = "log";
export const LOD_SPACING_DEFAULT_MODE = LOD_SPACING_LINEAR;
export const LOD_SPACING_DEFAULT_METERS = 100;
export const LOD0_MAX_FAR_FRACTION = 0.1;
export const LOD_SPACING_UNUSED = 1e30;
export const LOD_SPACING_LABEL = Object.freeze({
  linear: "Linear",
  double: "Doubling",
  log: "Logarithmic",
});

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
  if (m <= 0) {
    return LOD0_REFINE_SUBDIV;
  }
  if (m >= LOD0_REFINE_MIP_COUNT) {
    return LOD0_REFINE_SUBDIV_MIN;
  }
  const s = LOD0_REFINE_SUBDIV >> m;
  if (s < LOD0_REFINE_SUBDIV_MIN) {
    return LOD0_REFINE_SUBDIV_MIN;
  }
  return s;
}

export function lod0RefineCellSize(refineMip) {
  return 1 / lod0RefineSubdiv(refineMip);
}

export function lod0RefineFirstSpacing(lod0Meters, mode) {
  const far = Number(lod0Meters);
  const n = LOD0_REFINE_MIP_COUNT;
  const spacingMode = normalizeLodSpacingMode(mode);
  if (!(far > 0)) {
    return 1;
  }
  if (spacingMode === LOD_SPACING_DOUBLE) {
    return far / (Math.pow(2, n) - 1);
  }
  if (spacingMode === LOD_SPACING_LOG) {
    const t0 = Math.pow(far, 1 / n);
    if (!(t0 > 0) || !(t0 < far)) {
      return far / n;
    }
    return t0;
  }
  return far / n;
}

export function lod0RefineSwitchDistances(lod0Meters, mode, out) {
  const n = LOD0_REFINE_MIP_COUNT;
  const far = Number(lod0Meters);
  return mipSwitchDistances(
    n,
    far,
    out,
    mode,
    lod0RefineFirstSpacing(far, mode),
    false
  );
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
  const sampleRefineOn = lod0RefineAt(refineOn, sampleMip);
  easeScratch.sampleMip = sampleMip;
  easeScratch.sampleRefineOn = sampleRefineOn;
  easeScratch.sampleRefineMip = sampleRefineOn ? refineMip | 0 : 0;
  easeScratch.filterFade = sampleMip === 0 ? 1 : 0;
  return easeScratch;
}

export function lod0RefineAt(enabled, mip) {
  return !!enabled && ((mip | 0) === 0);
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

export function normalizeLodSpacingMode(mode) {
  if (mode === LOD_SPACING_DOUBLE) {
    return LOD_SPACING_DOUBLE;
  }
  if (mode === LOD_SPACING_LOG) {
    return LOD_SPACING_LOG;
  }
  return LOD_SPACING_LINEAR;
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

function roundLodDistance(x) {
  if (!(x > 0) || !(x < LOD_SPACING_UNUSED * 0.5)) {
    return LOD_SPACING_UNUSED;
  }
  const n = Math.round(x);
  if (!(n > 0)) {
    return LOD_SPACING_UNUSED;
  }
  return n;
}

function fillUnusedFrom(dest, start) {
  const destLen = dest.length | 0;
  for (let j = start; (j < destLen) | 0; j = (j + 1) | 0) {
    dest[j] = LOD_SPACING_UNUSED;
  }
  return dest;
}

function finalizeLodSwitches(dest, switchN, farClip) {
  const far = farClip;
  const n = switchN | 0;
  const maxLast = Math.floor(far) - 1;
  if ((n <= 0) | !(maxLast >= 1)) {
    return fillUnusedFrom(dest, 0);
  }
  let prev = 0;
  for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
    const remain = (n - 1 - i) | 0;
    const room = maxLast - remain;
    let t = dest[i];
    if (t < LOD_SPACING_UNUSED * 0.5) {
      t = roundLodDistance(t);
    } else {
      t = room;
    }
    if (!(t > prev)) {
      t = (prev + 1) | 0;
    }
    if (t > room) {
      t = room;
    }
    if (!(t > prev) || !(t < far)) {
      return fillUnusedFrom(dest, i);
    }
    dest[i] = t;
    prev = t;
  }
  return fillUnusedFrom(dest, n);
}

export function mipSwitchDistances(mipCount, farClip, out, mode, spacing, capLod0Fraction) {
  const n = clampMipCount(mipCount);
  const switchN = (n - 1) | 0;
  const dest = out || new Float64Array(switchN);
  const spacingMode = normalizeLodSpacingMode(mode);
  const far = farClip;

  if ((switchN <= 0) | !(far > 1)) {
    return fillUnusedFrom(dest, 0);
  }

  const byMips = Math.max(1, (Math.floor(far) - switchN) | 0);
  const maxT0 =
    capLod0Fraction === false
      ? byMips
      : Math.min(byMips, lod0MaxMeters(far, 1));
  let t0 = clampLodSpacingMeters(spacing, 1, maxT0);
  if (!(t0 < far)) {
    t0 = maxT0;
  }
  const span = far - t0;
  const denom = switchN;

  if (spacingMode === LOD_SPACING_DOUBLE) {
    const bits = Math.pow(2, n - 1) - 1;
    for (let i = 0; (i < switchN) | 0; i = (i + 1) | 0) {
      dest[i] = t0 + (span * (Math.pow(2, i) - 1)) / bits;
    }
  } else if (spacingMode === LOD_SPACING_LOG) {
    if ((switchN === 1) | 0) {
      dest[0] = t0;
    } else {
      const ratio = far / t0;
      const exp = 1 / denom;
      for (let i = 0; (i < switchN) | 0; i = (i + 1) | 0) {
        dest[i] = t0 * Math.pow(ratio, i * exp);
      }
    }
  } else {
    for (let i = 0; (i < switchN) | 0; i = (i + 1) | 0) {
      dest[i] = t0 + (span * i) / denom;
    }
  }

  return finalizeLodSwitches(dest, switchN, far);
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

export function bandMarchStep(steps, mip, refine, refineMip) {
  const base = mipVoxelSize(mip);
  const cell = marchCellSize(mip, refine, refineMip);
  const s = bandStepAt(steps, mip);
  if ((cell < base) & (base > 0)) {
    return (s * cell) / base;
  }
  return s;
}

export function fitBandStep(step, steps, mip, refine, refineMip) {
  const lo = bandMarchStep(steps, mip, refine, refineMip);
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

export function growBandStep(step, steps, mip, refine, refineMip, growth) {
  const cell = marchCellSize(mip, refine, refineMip);
  const g = Number(growth);
  let s = Number(step);
  if (g > 0) {
    s = s + g * cell;
  }
  return fitBandStep(s, steps, mip, refine, refineMip);
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
