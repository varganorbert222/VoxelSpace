"use strict";

import { MIN_SAMPLE_DISTANCE, QUALITY_ULTRA, qualityIndex } from "./quality.js";

export const TERRAIN_MIP_KERNEL = 2;
export const TERRAIN_MIP_MIN_SIZE = 1;
export const TERRAIN_MIP_COUNT_MIN = 1;
export const TERRAIN_MIP_MAX_COUNT = 16;
export const TERRAIN_MIP_DEFAULT_COUNT = 5;
export const TERRAIN_MIP_DDA_EPS = 1e-4;

export const LOD_SPACING_LINEAR = "linear";
export const LOD_SPACING_DOUBLE = "double";
export const LOD_SPACING_LOG = "log";
export const LOD_SPACING_DEFAULT_MODE = LOD_SPACING_LINEAR;
export const LOD_SPACING_DEFAULT_METERS = 100;
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

export function mipSwitchDistances(mipCount, farClip, out, mode, spacing) {
  const n = clampMipCount(mipCount);
  const switchN = (n - 1) | 0;
  const dest = out || new Float64Array(switchN);
  const spacingMode = normalizeLodSpacingMode(mode);
  const far = farClip;

  if ((switchN <= 0) | !(far > 1)) {
    return fillUnusedFrom(dest, 0);
  }

  const maxT0 = Math.max(1, (Math.floor(far) - switchN) | 0);
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

export function classicLodDeltas(quality, bandCount, minDeltaZ, stepScale, out) {
  const n = clampMipCount(bandCount);
  const dest = out || new Float64Array(n);
  const ultra = qualityIndex(quality) === QUALITY_ULTRA ? 1 : 0;
  dest[0] = minDeltaZ * stepScale;
  const k = ultra ? 0.5 : 1;
  for (let i = 1; (i < n) | 0; i = (i + 1) | 0) {
    let d = mipVoxelSize(i) * k;
    if (d < dest[0]) {
      d = dest[0];
    }
    dest[i] = d;
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

export function mipCellFarT(t, wx, wy, dirX, dirY, mip) {
  if ((mip | 0) <= 0) {
    return t;
  }
  const dt = mipDdaDelta(wx, wy, dirX, dirY, mipVoxelSize(mip));
  const tFar = t + dt;
  if (tFar > t) {
    return tFar;
  }
  return t;
}

export function mipSpanFarT(t, step, wx, wy, dirX, dirY, mip) {
  if ((mip | 0) <= 0) {
    return t;
  }
  let tFar = t + step;
  const cellFar = mipCellFarT(t, wx, wy, dirX, dirY, mip);
  if (cellFar > tFar) {
    tFar = cellFar;
  }
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

export function advanceRayT(t, step, growth, mip, wx, wy, dirX, dirY) {
  if ((mip | 0) <= 0) {
    let next = t + step;
    if (!(next > t)) {
      next = t + MIN_SAMPLE_DISTANCE;
    }
    return { t: next, step: step + growth };
  }
  const s = mipVoxelSize(mip);
  const dt = mipDdaDelta(wx, wy, dirX, dirY, s);
  const eps = mipDdaEps(s);
  let next = t + dt + eps;
  if (!(next > t)) {
    next = t + eps;
  }
  return { t: next, step: step };
}
