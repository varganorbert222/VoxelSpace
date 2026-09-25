"use strict";

import { mipCellFarT, mipTexelFloor } from "../../constants/mip.js";

function maxHeightByte(mips, level, wx, wy, dirX, dirY, wrap) {
  const cell = mipTexelFloor(wx, wy, level, dirX, dirY);
  const w = mips.widths[level] | 0;
  const h = mips.heights[level] | 0;
  if (!w || !h) {
    return 0;
  }
  let ix = cell.ix | 0;
  let iy = cell.iy | 0;
  if (wrap) {
    ix = ((ix % w) + w) % w;
    iy = ((iy % h) + h) % h;
  } else if (ix < 0 || iy < 0 || ix >= w || iy >= h) {
    return -1;
  }
  const shift = mips.shifts[level] | 0;
  return mips.heightMaps[level][((iy << shift) + ix) | 0] | 0;
}

// Coarse height mips store a 2×2 maximum. If that maximum is already below
// the sealed horizon, the whole cell is skipped to its far edge.
export function minmaxSkipT(opts) {
  const mip = opts.mip | 0;
  const last = opts.lastMip | 0;
  if (!(last > mip)) {
    return 0;
  }
  const mips = opts.mips;
  if (!mips || !mips.heightMaps) {
    return 0;
  }
  for (let level = last; level > mip; level--) {
    const tFar = mipCellFarT(
      opts.t,
      opts.wx,
      opts.wy,
      opts.dirX,
      opts.dirY,
      level,
      0,
      0
    );
    if (!(tFar > opts.t)) {
      continue;
    }
    const byte = maxHeightByte(
      mips,
      level,
      opts.wx,
      opts.wy,
      opts.dirX,
      opts.dirY,
      opts.wrap | 0
    );
    if (byte < 0) {
      continue;
    }
    const h = byte * opts.altScale;
    if (opts.below(h, opts.t, tFar)) {
      return tFar;
    }
  }
  return 0;
}
