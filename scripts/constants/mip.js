"use strict";

import { MIN_SAMPLE_DISTANCE, QUALITY_ULTRA, qualityIndex } from "./quality.js";

export const TERRAIN_MIP_KERNEL = 2;
export const TERRAIN_MIP_MIN_SIZE = 1;
export const TERRAIN_MIP_MAX_COUNT = 16;
export const TERRAIN_MIP_PIXEL_OFFSET_CAP = 8;
export const TERRAIN_MIP_DDA_EPS = 1e-4;

const SWITCH_FIRST = Object.freeze([0, 0.26, 0.32, 0.38, 0.45, 0.52]);
const SWITCH_LAST = Object.freeze([0, 0.52, 0.58, 0.64, 0.72, 0.78]);

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
  if ((n < 1) | 0) {
    n = 1;
  }
  if ((n > TERRAIN_MIP_MAX_COUNT) | 0) {
    n = TERRAIN_MIP_MAX_COUNT;
  }
  return n;
}

export function mipSwitchFractions(quality, mipCount) {
  const q = qualityIndex(quality);
  const n = (clampMipCount(mipCount) - 1) | 0;
  const first = SWITCH_FIRST[q];
  const last = SWITCH_LAST[q];
  const out = new Float64Array(n);
  if ((n <= 0) | 0) {
    return out;
  }
  if ((n === 1) | 0) {
    out[0] = first;
    return out;
  }
  const span = last - first;
  const denom = (n - 1) | 0;
  for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
    out[i] = first + span * (i / denom);
  }
  return out;
}

export function mipSwitchDistances(quality, mipCount, farClip, out) {
  const fracs = mipSwitchFractions(quality, mipCount);
  const dest = out || new Float64Array(fracs.length);
  const n = fracs.length | 0;
  for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
    dest[i] = farClip * fracs[i];
  }
  for (let i = n; (i < dest.length) | 0; i = (i + 1) | 0) {
    dest[i] = 1e30;
  }
  return dest;
}

export function classicPixelOffsets(quality, bandCount, out) {
  const n = clampMipCount(bandCount);
  const dest = out || new Int32Array(n);
  const ultra = qualityIndex(quality) === QUALITY_ULTRA ? 1 : 0;
  for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
    if (ultra) {
      dest[i] = 1;
      continue;
    }
    if ((i === 0) | 0) {
      dest[i] = 1;
      continue;
    }
    let v = (1 << ((((i + 1) | 0) >> 1) | 0)) | 0;
    if ((v > TERRAIN_MIP_PIXEL_OFFSET_CAP) | 0) {
      v = TERRAIN_MIP_PIXEL_OFFSET_CAP;
    }
    dest[i] = v;
  }
  return dest;
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

export function classicLodDistanceFractions(quality, bandCount) {
  const n = clampMipCount(bandCount);
  const q = qualityIndex(quality);
  const ultraPush = q === QUALITY_ULTRA ? 1.08 : 1;
  const out = new Float64Array((n - 1) | 0);
  for (let i = 0; (i < out.length) | 0; i = (i + 1) | 0) {
    let t = Math.pow((i + 1) / n, 0.85) * ultraPush;
    if (t > 0.98) {
      t = 0.98;
    }
    out[i] = t;
  }
  return out;
}

export function fillClassicLodDistances(out, zStart, farClip, fractions, bandCount) {
  const n = bandCount | 0;
  out[0] = zStart;
  const fracN = fractions.length | 0;
  for (let i = 0; (i < (n - 1) | 0) | 0; i = (i + 1) | 0) {
    const f = (i < fracN) | 0 ? fractions[i] : (i + 1) / n;
    out[i + 1] = f * farClip;
  }
  out[n] = farClip;
  for (let i = 1; (i < n) | 0; i = (i + 1) | 0) {
    if ((out[i] < out[i - 1]) | 0) {
      out[i] = out[i - 1];
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
  let minDt = s * TERRAIN_MIP_DDA_EPS;
  if (minDt < MIN_SAMPLE_DISTANCE) {
    minDt = MIN_SAMPLE_DISTANCE;
  }
  if (!(dt >= minDt)) {
    dt = minDt;
  }
  return dt;
}

export function advanceRayT(t, step, growth, mip, wx, wy, dirX, dirY) {
  if ((mip | 0) <= 0) {
    let next = t + step;
    if (!(next > t)) {
      next = t + MIN_SAMPLE_DISTANCE;
    }
    return { t: next, step: step + growth };
  }
  const dt = mipDdaDelta(wx, wy, dirX, dirY, mipVoxelSize(mip));
  let next = t + dt;
  if (!(next > t)) {
    next = t + MIN_SAMPLE_DISTANCE;
  }
  return { t: next, step: step };
}
