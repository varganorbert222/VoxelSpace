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
export const LOD0_REFINE_CELL = 1 / LOD0_REFINE_SUBDIV;
export const STEP_DIVISOR_MIN = 1;
export const STEP_DIVISOR_MAX = 5;
export const STEP_DIVISOR_DEFAULT = 3;
export const LOD0_REFINE_NOISE_AMPLITUDE = 1;
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

export function clampStepDivisor(value) {
  let n = Math.round(Number(value));
  if (!(n >= STEP_DIVISOR_MIN)) {
    n = STEP_DIVISOR_DEFAULT;
  }
  if (n < STEP_DIVISOR_MIN) {
    n = STEP_DIVISOR_MIN;
  }
  if (n > STEP_DIVISOR_MAX) {
    n = STEP_DIVISOR_MAX;
  }
  return n;
}

export function marchStep(mip, refine, refineMip, divisor) {
  return marchCellSize(mip, refine, refineMip) / clampStepDivisor(divisor);
}

export function clampMarchStep(step, mip, refine, refineMip, divisor) {
  const lo = marchStep(mip, refine, refineMip, divisor);
  const hi = marchCellSize(mip, refine, refineMip);
  let s = Number(step);
  if (!(s >= lo)) {
    s = lo;
  }
  if (s > hi) {
    s = hi;
  }
  return s;
}

export function growMarchStep(step, growth, mip, refine, refineMip, divisor) {
  const g = Number(growth);
  return clampMarchStep(step + (g > 0 ? g : 0), mip, refine, refineMip, divisor);
}

export function marchBandKey(mip, refineMip) {
  return (((mip | 0) << 8) | (refineMip & 255)) | 0;
}

export function syncBandStep(step, prevKey, mip, refine, refineMip, divisor) {
  const key = marchBandKey(mip, refine ? refineMip : 0);
  return {
    step: clampMarchStep(step, mip, refine, refineMip, divisor),
    key: key,
  };
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
  const sampleRefineMip = sampleRefineOn ? refineMip | 0 : 0;
  return {
    sampleMip: sampleMip,
    sampleRefineOn: sampleRefineOn,
    sampleRefineMip: sampleRefineMip,
    noiseAmp: sampleRefineOn ? LOD0_REFINE_NOISE_AMPLITUDE : 0,
    filterFade: (sampleMip | 0) === 0 ? 1 : 0,
  };
}

export function firstMarchT(nearClip, refine, divisor) {
  const step = marchStep(0, refine, 0, divisor);
  let t0 = Number(nearClip);
  if (!(t0 > 0)) {
    t0 = step;
  }
  if (step > t0) {
    t0 = step;
  }
  return t0;
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

function lod0RefineHash(ix, iy) {
  let n = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

function lod0RefineFineSpan(refineMip) {
  let m = refineMip | 0;
  if (m < 0) {
    m = 0;
  }
  if (m > LOD0_REFINE_MIP_COUNT - 1) {
    m = LOD0_REFINE_MIP_COUNT - 1;
  }
  return (1 << m) | 0;
}

function lod0RefineHashMax(x0, y0, span) {
  let maxH = 0;
  const n = span | 0;
  for (let dy = 0; (dy < n) | 0; dy = (dy + 1) | 0) {
    for (let dx = 0; (dx < n) | 0; dx = (dx + 1) | 0) {
      const h = lod0RefineHash((x0 + dx) | 0, (y0 + dy) | 0);
      if (h > maxH) {
        maxH = h;
      }
    }
  }
  return maxH;
}

export function applyLod0RefineHeight(
  hFine,
  wx,
  wy,
  dirX,
  dirY,
  refine,
  refineMip,
  amp
) {
  if (!refine) {
    return hFine;
  }
  let a = LOD0_REFINE_NOISE_AMPLITUDE;
  if (amp != null) {
    a = Number(amp);
  }
  if (!(a > 0)) {
    return hFine;
  }
  const s = lod0RefineCellSize(refineMip);
  const e = mipDdaEps(s);
  const span = lod0RefineFineSpan(refineMip);
  const ix = Math.floor((wx + dirX * e) / s);
  const iy = Math.floor((wy + dirY * e) / s);
  const u = lod0RefineHashMax((ix * span) | 0, (iy * span) | 0, span) / 4294967296;
  let h = hFine + (u - 0.5) * a;
  if (h < 0) {
    h = 0;
  }
  if (h > 255) {
    h = 255;
  }
  return h;
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

export function mipCountDefault(width, height) {
  const max = mipCountMax(width, height);
  return ((TERRAIN_MIP_COUNT_MIN + max) >> 1) | 0;
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

export function classicLodDeltas(bandCount, divisor, out) {
  const n = clampMipCount(bandCount);
  const dest = out || new Float64Array(n);
  const d = clampStepDivisor(divisor);
  for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
    dest[i] = mipVoxelSize(i) / d;
  }
  return dest;
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
  const s = cellSize;
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

export function mipDdaEps(cellSize) {
  const e = cellSize * TERRAIN_MIP_DDA_EPS;
  if (e > 1e-6) {
    return e;
  }
  return 1e-6;
}

export function mipTexelFloor(wx, wy, mip, dirX, dirY) {
  const s = mipVoxelSize(mip);
  const e = mipDdaEps(s);
  return {
    ix: Math.floor((wx + dirX * e) / s),
    iy: Math.floor((wy + dirY * e) / s),
  };
}

export function mipCellFarT(t, wx, wy, dirX, dirY, mip, refine, refineMip) {
  if (((mip | 0) <= 0) & !refine) {
    return t;
  }
  const dt = mipDdaDelta(wx, wy, dirX, dirY, marchCellSize(mip, refine, refineMip));
  const tFar = t + dt;
  if (tFar > t) {
    return tFar;
  }
  return t;
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

export function advanceRayT(t, mip, wx, wy, dirX, dirY, refine, refineMip, divisor, step, growth) {
  const s = clampMarchStep(step, mip, refine, refineMip, divisor);
  let next = t + s;
  if (!(next > t)) {
    next = t + (s > 0 ? s : MIN_SAMPLE_DISTANCE);
  }
  return {
    t: next,
    step: growMarchStep(s, growth, mip, refine, refineMip, divisor),
  };
}
