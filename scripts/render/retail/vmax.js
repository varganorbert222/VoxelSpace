"use strict";

// Separate from the visible height chain. Level 0 is the 4-corner max of the
// raw height plus the positive detail bump of each corner tile. Coarser levels
// are a 2×2 max. A sample under this envelope cannot hit, so the march may
// jump it. The stored bytes stay an upper bound, so the picture does not move.

function tileAdds(heightLength, retail) {
  if (!retail || !retail.detailReady || !retail.detailMips || !retail.characterIndex) {
    return null;
  }
  const mips = retail.detailMips;
  const one = mips[4] || mips[mips.length - 1];
  const tiles = retail.characterIndex.data;
  if (!one || !tiles || tiles.length !== heightLength) {
    return null;
  }
  const tileMax = new Uint8Array(256);
  for (let tile = 0; tile < 256; tile = (tile + 1) | 0) {
    const elev = (one[tile] >>> 16) & 255;
    tileMax[tile] = elev > 128 ? ((elev - 128 + 15) >> 4) : 0;
  }
  const adds = new Uint8Array(heightLength);
  for (let i = 0; i < heightLength; i = (i + 1) | 0) {
    adds[i] = tileMax[tiles[i] & 255];
  }
  return adds;
}

export function attachVMaxMips(mips, retail) {
  if (!mips || !mips.heightMaps || !mips.heightMaps[0]) {
    return;
  }
  const height = mips.heightMaps[0];
  const width = mips.widths[0] | 0;
  const heightN = mips.heights[0] | 0;
  const mapShift = mips.shifts[0] | 0;
  const count = mips.count | 0;
  const adds = tileAdds(height.length, retail);
  const base = new Uint8Array(height.length);
  const xMask = (width - 1) | 0;
  const yMask = (heightN - 1) | 0;
  for (let y = 0; (y < heightN) | 0; y = (y + 1) | 0) {
    const y1 = (y + 1) & yMask;
    const row = y << mapShift;
    const row1 = y1 << mapShift;
    for (let x = 0; (x < width) | 0; x = (x + 1) | 0) {
      const x1 = (x + 1) & xMask;
      const ia = (row + x) | 0;
      const ib = (row + x1) | 0;
      const ic = (row1 + x) | 0;
      const id = (row1 + x1) | 0;
      const aa = height[ia] + (adds ? adds[ia] : 0);
      const bb = height[ib] + (adds ? adds[ib] : 0);
      const cc = height[ic] + (adds ? adds[ic] : 0);
      const dd = height[id] + (adds ? adds[id] : 0);
      let v = aa;
      if (bb > v) v = bb;
      if (cc > v) v = cc;
      if (dd > v) v = dd;
      if (v > 255) v = 255;
      base[ia] = v;
    }
  }
  const levels = [base];
  let src = base;
  for (let level = 1; (level < count) | 0; level = (level + 1) | 0) {
    const srcW = mips.widths[level - 1] | 0;
    const srcH = mips.heights[level - 1] | 0;
    const dstW = mips.widths[level] | 0;
    const dstH = mips.heights[level] | 0;
    const dstShift = mips.shifts[level] | 0;
    const kx = (srcW / dstW) | 0;
    const ky = (srcH / dstH) | 0;
    if ((kx < 1) | (ky < 1)) {
      break;
    }
    const dst = new Uint8Array((dstW * dstH) | 0);
    for (let y = 0; (y < dstH) | 0; y = (y + 1) | 0) {
      const y0 = (y * ky) | 0;
      for (let x = 0; (x < dstW) | 0; x = (x + 1) | 0) {
        const x0 = (x * kx) | 0;
        let maxH = 0;
        for (let oy = 0; (oy < ky) | 0; oy = (oy + 1) | 0) {
          const row = ((y0 + oy) << (mips.shifts[level - 1] | 0)) | 0;
          for (let ox = 0; (ox < kx) | 0; ox = (ox + 1) | 0) {
            const h = src[(row + x0 + ox) | 0];
            if (h > maxH) maxH = h;
          }
        }
        dst[(y << dstShift) + x] = maxH;
      }
    }
    levels.push(dst);
    src = dst;
  }
  mips.vmaxMaps = levels;
}

// Near passes follow the retail helper: the first two 1/16 bands jump 16 fine
// steps, the 1/8 band jumps 8, and the rest jump 4. Direct mip m reads level m+2.
export function vmaxQuery(mip, refine, refineMip) {
  if ((mip | 0) <= 0 && refine) {
    const band = refineMip | 0;
    if (band >= 4) {
      return { level: 1, shift: 2 };
    }
    if (band >= 3) {
      return { level: 0, shift: 2 };
    }
    if (band >= 2) {
      return { level: 0, shift: 3 };
    }
    return { level: 0, shift: 4 };
  }
  let level = (mip | 0) + 2;
  if (level > 9) {
    level = 9;
  }
  return { level: level, shift: 2 };
}

export function vmaxClamp(mips, level) {
  let n = mips.vmaxMaps.length | 0;
  const count = mips.count | 0;
  if ((count > 0) & (count < n)) {
    n = count;
  }
  let lv = level | 0;
  if (lv >= n) {
    lv = (n - 1) | 0;
  }
  if (lv < 0) {
    lv = 0;
  }
  return lv;
}

export function vmaxMeters(mips, x, y, level, altScale, wrap) {
  const lv = level | 0;
  const map = mips.vmaxMaps[lv];
  const w = mips.widths[lv] | 0;
  const h = mips.heights[lv] | 0;
  const shift = mips.shifts[lv] | 0;
  let ix = Math.floor(x) >> lv;
  let iy = Math.floor(y) >> lv;
  if (wrap) {
    ix &= (w - 1) | 0;
    iy &= (h - 1) | 0;
  } else {
    if (ix < 0) ix = 0;
    if (iy < 0) iy = 0;
    if (ix >= w) ix = (w - 1) | 0;
    if (iy >= h) iy = (h - 1) | 0;
  }
  return map[((iy << shift) + ix) | 0] * altScale;
}

// Last distance still at or above the envelope, at most one envelope cell at a
// time, and never past the current band. The fine march covers the crossing.
export function vmaxSkipDistance(
  t,
  step,
  bx,
  by,
  bz,
  camX,
  camY,
  camZ,
  mips,
  level,
  shift,
  bandEnd,
  mapW,
  mapH,
  wrap,
  altScale
) {
  const lv = vmaxClamp(mips, level);
  const cell = 1 << lv;
  let coarse = step * (1 << shift);
  if (coarse > cell) {
    coarse = cell;
  }
  if (!(coarse > step * 0.5)) {
    return t;
  }
  if (camZ + t * bz < vmaxMeters(mips, camX + t * bx, camY + t * by, lv, altScale, wrap)) {
    return t;
  }
  let cursor = t;
  let hops = 0;
  while (hops < 32) {
    const next = cursor + coarse;
    if (!(next < bandEnd)) {
      break;
    }
    const nx = camX + next * bx;
    const ny = camY + next * by;
    if (!wrap && (nx < 0 || ny < 0 || nx > mapW || ny > mapH)) {
      break;
    }
    if (camZ + next * bz < vmaxMeters(mips, nx, ny, lv, altScale, wrap)) {
      break;
    }
    cursor = next;
    hops = (hops + 1) | 0;
  }
  return cursor;
}
