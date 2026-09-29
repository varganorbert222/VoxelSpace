"use strict";

import { Color } from "../math/color.js";
import { useRetailFrame } from "./retail/schedule.js";
import {
  applyDetail,
  detailColumnBump,
  detailElevMax,
  detailInRange,
  detailSpanAt,
} from "./retail/detail.js";
import ColorPalette from "../math/colorPalette.js";
import {
  SKY_PALETTE_STEPS,
  skyLutIndexFromHat,
  skyPaletteT,
} from "../constants/framebuffer.js";
import { HEIGHTMAP_MAX, GROUND_HEIGHT } from "../constants/terrain.js";
import {
  DEG_TO_RAD,
  EPSILON,
  HALF,
  NDC_SCALE,
  PIXEL_CENTER,
} from "../constants/vmath.js";
import { DEBUG_VIEW_LOD, isDebugColor } from "../constants/debugView.js";
import { encodeCameraSample, encodeLodDistance } from "./debugEncode.js";
import { resolveTerrainMips } from "../terrain/mipChain.js";
import {
  LOD0_REFINE_SWITCH_COUNT,
  TERRAIN_MIP_MAX_COUNT,
  lod0RefineAt,
  lod0RefineMipAt,
  lod0RefineSubdiv,
  lod0RefineSwitchDistances,
  marchMaxSteps,
  mipLevelAtDistance,
  mipVoxelSize,
  mixNearestBilinear,
  mipDdaEps,
  mipSwitchDistances,
} from "../constants/mip.js";

const mipSwitchScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT);
const lod0RefineSwitchScratch = new Float64Array(LOD0_REFINE_SWITCH_COUNT);

const skyLutCache = {
  skyColor: NaN,
  horizonColor: NaN,
  height: 0,
  lut: null,
};

const AABB_Z_EPS = 1e-4;
const DIR_XY_EPS = 1e-8;
const DIR_FWD_EPS = 1e-4;
const SLAB_EPS = 1e-8;
const HIT_T_EPS = 1e-4;

function getSkyLut(skyColor, horizonColor, height) {
  if (
    skyLutCache.lut &&
    skyLutCache.height === height &&
    skyLutCache.skyColor === skyColor &&
    skyLutCache.horizonColor === horizonColor
  ) {
    return skyLutCache.lut;
  }
  const palette = new ColorPalette(
    skyColor ?? Color.WHITE,
    horizonColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );
  const lut = new Uint32Array(height);
  const h2 = height * HALF;
  for (let i = 0; (i < height) | 0; i = (i + 1) | 0) {
    lut[i] = palette.getColor(skyPaletteT(i / h2));
  }
  skyLutCache.skyColor = skyColor;
  skyLutCache.horizonColor = horizonColor;
  skyLutCache.height = height;
  skyLutCache.lut = lut;
  return lut;
}

function wrapSampleCoord(v, mask, wrap) {
  if (wrap) {
    return v & mask;
  }
  if ((v < 0) | 0) {
    return 0;
  }
  if ((v > mask) | 0) {
    return mask;
  }
  return v;
}

function heightAt(heightMap, ix, iy, mapShift, wMask, hMask, wrap) {
  iy = wrapSampleCoord(iy, wMask, wrap);
  ix = wrapSampleCoord(ix, hMask, wrap);
  return heightMap[((iy << mapShift) + ix) | 0];
}

function colorAt(colorMap, ix, iy, mapShift, wMask, hMask, wrap) {
  iy = wrapSampleCoord(iy, wMask, wrap);
  ix = wrapSampleCoord(ix, hMask, wrap);
  return colorMap[((iy << mapShift) + ix) | 0];
}

function lerpPacked(c0, c1, t256) {
  const mask = 0x00ff00ff;
  const u = t256 | 0;
  const v = (256 - u) | 0;
  const rb = (((c0 & mask) * v + (c1 & mask) * u) >>> 8) & mask;
  const ag =
    ((((c0 >>> 8) & mask) * v + ((c1 >>> 8) & mask) * u) >>> 8) & mask;
  return ((ag << 8) | rb) >>> 0;
}

function bilinearPacked4(c00, c10, c01, c11, fx, fy) {
  let tx = (fx * 256) | 0;
  let ty = (fy * 256) | 0;
  if ((tx < 0) | 0) tx = 0;
  else if ((tx > 256) | 0) tx = 256;
  if ((ty < 0) | 0) ty = 0;
  else if ((ty > 256) | 0) ty = 256;
  return lerpPacked(lerpPacked(c00, c10, tx), lerpPacked(c01, c11, tx), ty);
}

function quantFraction(f, subdiv) {
  const sub = subdiv | 0;
  if ((sub | 0) <= 1) {
    return f;
  }
  const last = (sub - 1) | 0;
  let c = (f * sub) | 0;
  if ((c < 0) | 0) c = 0;
  if ((c > last) | 0) c = last;
  return (c + 0.5) / sub;
}

function sampleHeightBilinear(heightMap, x, y, mapShift, wMask, hMask, wrap, subdiv) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const ix = x0 | 0;
  const iy = y0 | 0;
  const fx = quantFraction(x - x0, subdiv);
  const fy = quantFraction(y - y0, subdiv);
  const h00 = heightAt(heightMap, ix, iy, mapShift, wMask, hMask, wrap);
  const h10 = heightAt(
    heightMap,
    (ix + 1) | 0,
    iy,
    mapShift,
    wMask,
    hMask,
    wrap
  );
  const h01 = heightAt(
    heightMap,
    ix,
    (iy + 1) | 0,
    mapShift,
    wMask,
    hMask,
    wrap
  );
  const h11 = heightAt(
    heightMap,
    (ix + 1) | 0,
    (iy + 1) | 0,
    mapShift,
    wMask,
    hMask,
    wrap
  );
  const hx0 = h00 + (h10 - h00) * fx;
  const hx1 = h01 + (h11 - h01) * fx;
  return hx0 + (hx1 - hx0) * fy;
}

function sampleColorFiltered(colorMap, x, y, mapShift, wMask, hMask, wrap, subdiv) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const ix = x0 | 0;
  const iy = y0 | 0;
  return bilinearPacked4(
    colorAt(colorMap, ix, iy, mapShift, wMask, hMask, wrap),
    colorAt(colorMap, (ix + 1) | 0, iy, mapShift, wMask, hMask, wrap),
    colorAt(colorMap, ix, (iy + 1) | 0, mapShift, wMask, hMask, wrap),
    colorAt(
      colorMap,
      (ix + 1) | 0,
      (iy + 1) | 0,
      mapShift,
      wMask,
      hMask,
      wrap
    ),
    quantFraction(x - x0, subdiv),
    quantFraction(y - y0, subdiv)
  );
}

const XY_INF = 1e30;

function gridIndex(p, dir, cellSize) {
  const g = p / cellSize;
  let i = Math.floor(g);
  if (dir < -SLAB_EPS) {
    const edge = i * cellSize;
    const tol = Math.max(cellSize * 1e-5, Math.abs(p) * 1e-6);
    if (p <= edge + tol) {
      i = (i - 1) | 0;
    }
  }
  return i | 0;
}

function slabExit(camX, camY, dirX, dirY, ix, iy, cellSize) {
  const x0 = ix * cellSize;
  const y0 = iy * cellSize;
  let tFarX = XY_INF;
  let tFarY = XY_INF;
  if (dirX > SLAB_EPS) {
    tFarX = (x0 + cellSize - camX) / dirX;
  } else if (dirX < -SLAB_EPS) {
    tFarX = (x0 - camX) / dirX;
  }
  if (dirY > SLAB_EPS) {
    tFarY = (y0 + cellSize - camY) / dirY;
  } else if (dirY < -SLAB_EPS) {
    tFarY = (y0 - camY) / dirY;
  }
  return {
    tx: tFarX,
    ty: tFarY,
    t: tFarX < tFarY ? tFarX : tFarY,
  };
}

function voxelXyCell(camX, camY, dirX, dirY, s, cellSize) {
  const e = mipDdaEps(cellSize);
  const px = camX + dirX * (s + e);
  const py = camY + dirY * (s + e);
  let ix = gridIndex(px, dirX, cellSize);
  let iy = gridIndex(py, dirY, cellSize);
  let far = slabExit(camX, camY, dirX, dirY, ix, iy, cellSize);
  if (!(far.t > s)) {
    const tol = Math.max(e, cellSize * 1e-4);
    const stepX = far.tx <= s + tol;
    const stepY = far.ty <= s + tol;
    if (stepX && dirX > SLAB_EPS) {
      ix = (ix + 1) | 0;
    } else if (stepX && dirX < -SLAB_EPS) {
      ix = (ix - 1) | 0;
    }
    if (stepY && dirY > SLAB_EPS) {
      iy = (iy + 1) | 0;
    } else if (stepY && dirY < -SLAB_EPS) {
      iy = (iy - 1) | 0;
    }
    far = slabExit(camX, camY, dirX, dirY, ix, iy, cellSize);
    if (!(far.t > s)) {
      const ax = dirX < 0 ? -dirX : dirX;
      const ay = dirY < 0 ? -dirY : dirY;
      const ad = ax > ay ? ax : ay;
      far.t = s + (ad > e ? cellSize / ad : e);
    }
  }
  return { ix: ix | 0, iy: iy | 0, tFar: far.t };
}

function patchHeight(u, v, z00, z10, z01, z11) {
  let fu = u;
  let fv = v;
  if (fu < 0) {
    fu = 0;
  } else if (fu > 1) {
    fu = 1;
  }
  if (fv < 0) {
    fv = 0;
  } else if (fv > 1) {
    fv = 1;
  }
  if (fv <= fu) {
    return z00 + (z10 - z00) * fu + (z11 - z10) * fv;
  }
  return z00 + (z11 - z01) * fu + (z01 - z00) * fv;
}

function rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-8 && det < 1e-8) {
    return -1;
  }
  const inv = 1 / det;
  const tx = ox - ax;
  const ty = oy - ay;
  const tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-4 || u > 1 + 1e-4) {
    return -1;
  }
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-4 || u + v > 1 + 1e-4) {
    return -1;
  }
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

function patchHit(ox, oy, oz, dx, dy, dz, x0, y0, cell, z00, z10, z01, z11, s, sExit) {
  const x1 = x0 + cell;
  const y1 = y0 + cell;
  let best = -1;
  const consider = function (t) {
    if (t < s - HIT_T_EPS || t > sExit + HIT_T_EPS) {
      return;
    }
    let hit = t;
    if (hit < s) {
      hit = s;
    }
    if (hit > sExit) {
      hit = sExit;
    }
    if (best < 0 || hit < best) {
      best = hit;
    }
  };
  consider(rayTri(ox, oy, oz, dx, dy, dz, x0, y0, z00, x1, y0, z10, x1, y1, z11));
  consider(rayTri(ox, oy, oz, dx, dy, dz, x0, y0, z00, x1, y1, z11, x0, y1, z01));
  return best;
}

function voxelColumnHit(camZ, dirZ, h, s, sExit) {
  const zEnter = camZ + dirZ * s;
  const zExitV = camZ + dirZ * sExit;
  const zLo = zEnter < zExitV ? zEnter : zExitV;
  const zHi = zEnter > zExitV ? zEnter : zExitV;
  if (zHi < GROUND_HEIGHT || zLo > h) {
    return -1;
  }
  let tHit = s;
  if (zEnter > h) {
    if (!(dirZ < 0)) {
      return -1;
    }
    tHit = (h - camZ) / dirZ;
  } else if (zEnter < GROUND_HEIGHT) {
    if (!(dirZ > 0)) {
      return -1;
    }
    tHit = (GROUND_HEIGHT - camZ) / dirZ;
  }
  if (tHit < s - HIT_T_EPS || tHit > sExit + HIT_T_EPS) {
    return -1;
  }
  if (tHit < s) {
    tHit = s;
  }
  if (tHit > sExit) {
    tHit = sExit;
  }
  return tHit;
}

function rayHeightSpan(camZ, dirZ, ceiling, sNear, sFar) {
  let s0 = sNear;
  let s1 = sFar;
  if (camZ > ceiling) {
    if (!(dirZ < -SLAB_EPS)) {
      return null;
    }
    const sCeil = (ceiling - camZ) / dirZ;
    if (sCeil > s0) {
      s0 = sCeil;
    }
  } else if (dirZ > SLAB_EPS) {
    const sCeil = (ceiling - camZ) / dirZ;
    if (sCeil < s1) {
      s1 = sCeil;
    }
  }
  if (!(s0 < s1)) {
    return null;
  }
  return { s0: s0, s1: s1 };
}

export function renderVoxelTexels({
  heightMap,
  colorMap,
  mapW,
  mapH,
  mapShift,
  altitude,
  maxHeight,
  camX,
  camY,
  camZ,
  rightX,
  rightY,
  rightZ,
  upX,
  upY,
  upZ,
  fwdX,
  fwdY,
  fwdZ,
  fovY,
  dstToProjPlane,
  screenWidth,
  screenHeight,
  startColumn,
  endColumn,
  nearClip,
  farClip,
  debugView,
  repeat,
  filterDistance,
  skyColor,
  horizonColor,
  pixels,
  pixelWidth,
  fillUnfilled,
  terrainMips,
  mipCount,
  lod0Refine,
  lod0RefineCurve,
  lodSpacingMode,
  lodSpacing,
  lodBias,
  quality = 1,
  showDetails = 0,
}) {
  useRetailFrame({
    screenWidth,
    fov: fovY,
    quality,
    farClip,
    showDetails,
    lod0Refine,
    lodSpacingMode,
    lodSpacing,
    lodBias,
  });
  const localWidth = (endColumn - startColumn) | 0;
  const stride = pixelWidth;
  if (fillUnfilled) {
    pixels.fill(0, 0, (localWidth * screenHeight) | 0);
  }
  const skyLut = getSkyLut(skyColor, horizonColor, screenHeight);
  const mips = resolveTerrainMips(
    terrainMips,
    heightMap,
    colorMap,
    mapW,
    mapH,
    mapShift,
    mipCount
  );
  const lastMip = (mips.count - 1) | 0;
  const altScale = altitude / HEIGHTMAP_MAX;
  const ceiling = maxHeight == null ? altitude : maxHeight;
  const wrap = repeat | 0;
  const fine = showDetails ? 1 : 0;
  const switches = mipSwitchDistances(
    mips.count,
    farClip,
    mipSwitchScratch,
    lodSpacingMode,
    lodSpacing
  );
  const nearEnd = switches.length && switches[0] > 0 ? switches[0] : farClip;
  const refineSwitches = lod0RefineSwitchDistances(
    nearEnd,
    lod0RefineCurve,
    lod0RefineSwitchScratch
  );
  const debug = isDebugColor(debugView) ? 0 : 1;
  const aspect = screenWidth / screenHeight;
  let tanHalfY = 0;
  if (dstToProjPlane > 0 && screenHeight > 0) {
    tanHalfY = (screenHeight * HALF) / dstToProjPlane;
  } else {
    tanHalfY = Math.tan(fovY * DEG_TO_RAD * HALF);
  }
  const tanHalfX = tanHalfY * aspect;
  const invW = 1 / screenWidth;
  const invH = 1 / screenHeight;
  const mapWf = mapW;
  const mapHf = mapH;
  const lod0H = mips.heightMaps[0];
  const lod0C = mips.colorMaps[0];
  const lod0Shift = mips.shifts[0];
  const lod0WMask = (mips.widths[0] - 1) | 0;
  const lod0HMask = (mips.heights[0] - 1) | 0;
  const maxSteps = marchMaxSteps(true);
  let s0 = nearClip;
  if (!(s0 > 0)) {
    s0 = EPSILON;
  }
  const DETAIL_SUBDIV = [16, 8, 4, 2];

  function detailLevelForSubdiv(subdiv) {
    if ((subdiv | 0) >= 16) {
      return 0;
    }
    if ((subdiv | 0) >= 8) {
      return 1;
    }
    if ((subdiv | 0) >= 4) {
      return 2;
    }
    return 3;
  }

  function detailLevelForDepth(depth) {
    return detailLevelForSubdiv(lod0RefineSubdiv(lod0RefineMipAt(depth, refineSwitches)));
  }

  function heightBilinear(x, y) {
    return sampleHeightBilinear(
      lod0H,
      x,
      y,
      lod0Shift,
      lod0WMask,
      lod0HMask,
      wrap,
      0
    );
  }

  function detailLeaf(ix, iy, cellSize) {
    const wx = (ix + HALF) * cellSize;
    const wy = (iy + HALF) * cellSize;
    const subdiv = Math.round(1 / cellSize) | 0;
    const hFine = sampleHeightBilinear(
      lod0H,
      wx,
      wy,
      lod0Shift,
      lod0WMask,
      lod0HMask,
      wrap,
      subdiv
    );
    const span = detailSpanAt(wx, wy, detailLevelForSubdiv(subdiv));
    let h = (hFine + span.max) * altScale;
    if (!(h > GROUND_HEIGHT)) {
      h = GROUND_HEIGHT + AABB_Z_EPS;
    }
    let hb = (hFine + span.max + HALF) | 0;
    if ((hb < 0) | 0) {
      hb = 0;
    }
    if ((hb > 255) | 0) {
      hb = 255;
    }
    return { h: h, hByte: hb };
  }

  function detailCellTop(ix, iy, cellSize, level) {
    const x0 = ix * cellSize;
    const y0 = iy * cellSize;
    const x1 = x0 + cellSize;
    const y1 = y0 + cellSize;
    let hMax = heightBilinear(x0, y0);
    const h10 = heightBilinear(x1, y0);
    const h01 = heightBilinear(x0, y1);
    const h11 = heightBilinear(x1, y1);
    if (h10 > hMax) hMax = h10;
    if (h01 > hMax) hMax = h01;
    if (h11 > hMax) hMax = h11;
    const span = detailSpanAt(x0 + cellSize * HALF, y0 + cellSize * HALF, level);
    let h = (hMax + span.max) * altScale;
    if (!(h > GROUND_HEIGHT)) {
      h = GROUND_HEIGHT + AABB_Z_EPS;
    }
    return h;
  }

  function meterTop(ix, iy) {
    let hMax = heightAt(lod0H, ix, iy, lod0Shift, lod0WMask, lod0HMask, wrap);
    const h10 = heightAt(lod0H, (ix + 1) | 0, iy, lod0Shift, lod0WMask, lod0HMask, wrap);
    const h01 = heightAt(lod0H, ix, (iy + 1) | 0, lod0Shift, lod0WMask, lod0HMask, wrap);
    const h11 = heightAt(
      lod0H,
      (ix + 1) | 0,
      (iy + 1) | 0,
      lod0Shift,
      lod0WMask,
      lod0HMask,
      wrap
    );
    if (h10 > hMax) hMax = h10;
    if (h01 > hMax) hMax = h01;
    if (h11 > hMax) hMax = h11;
    let bump = 0;
    const ox = ix | 0;
    const oy = iy | 0;
    const a = detailSpanAt(ox + 0.25, oy + 0.25, 3);
    const b = detailSpanAt(ox + 0.75, oy + 0.25, 3);
    const c = detailSpanAt(ox + 0.25, oy + 0.75, 3);
    const d = detailSpanAt(ox + 0.75, oy + 0.75, 3);
    if (a.max > bump) bump = a.max;
    if (b.max > bump) bump = b.max;
    if (c.max > bump) bump = c.max;
    if (d.max > bump) bump = d.max;
    let h = (hMax + bump) * altScale;
    if (!(h > GROUND_HEIGHT)) {
      h = GROUND_HEIGHT + AABB_Z_EPS;
    }
    return h;
  }

  const dCamX = NDC_SCALE * tanHalfX * invW;
  const camX0 =
    ((startColumn + PIXEL_CENTER) * invW * NDC_SCALE - 1) * tanHalfX;
  const rdx = rightX * dCamX;
  const rdy = rightY * dCamX;
  const rdz = rightZ * dCamX;

  function columnAt(ix, iy, skipMip, cellSize, t, probeZ) {
    if ((skipMip | 0) <= 0) {
      const wx = (ix + HALF) * cellSize;
      const wy = (iy + HALF) * cellSize;
      const lodIx = Math.floor(wx) | 0;
      const lodIy = Math.floor(wy) | 0;
      const nearestH = heightAt(
        lod0H,
        lodIx,
        lodIy,
        lod0Shift,
        lod0WMask,
        lod0HMask,
        wrap
      );
      const refineHere = fine && lod0RefineAt(t, 0);
      const refineMip = refineHere ? lod0RefineMipAt(t, refineSwitches) : 0;
      const subdiv = refineHere ? lod0RefineSubdiv(refineMip) : 0;
      let hFine = refineHere
        ? sampleHeightBilinear(
            lod0H,
            wx,
            wy,
            lod0Shift,
            lod0WMask,
            lod0HMask,
            wrap,
            subdiv
          )
        : nearestH;
      const bump = detailColumnBump(wx, wy, t);
      if (probeZ <= hFine * altScale + bump.max * altScale) {
        hFine += bump.add;
      }
      let h = hFine * altScale;
      if (!(h > GROUND_HEIGHT)) {
        h = GROUND_HEIGHT + AABB_Z_EPS;
      }
      let hb = (hFine + HALF) | 0;
      if ((hb < 0) | 0) {
        hb = 0;
      }
      if ((hb > 255) | 0) {
        hb = 255;
      }
      return { h: h, hByte: hb, colX: lodIx, colY: lodIy };
    }
    const wx = (ix + HALF) * cellSize;
    const wy = (iy + HALF) * cellSize;
    let hFine =
      heightAt(
        mips.heightMaps[skipMip],
        ix | 0,
        iy | 0,
        mips.shifts[skipMip],
        (mips.widths[skipMip] - 1) | 0,
        (mips.heights[skipMip] - 1) | 0,
        wrap
      );
    const bump = detailColumnBump(wx, wy, t);
    if (probeZ <= hFine * altScale + bump.max * altScale) {
      hFine += bump.add;
    }
    let hByte = (hFine + HALF) | 0;
    if ((hByte < 0) | 0) {
      hByte = 0;
    }
    if ((hByte > 255) | 0) {
      hByte = 255;
    }
    let h = hFine * altScale;
    if (!(h > GROUND_HEIGHT)) {
      h = GROUND_HEIGHT + AABB_Z_EPS;
    }
    return { h: h, hByte: hByte, colX: ix | 0, colY: iy | 0 };
  }

  function sampleCorners(ix, iy, mip, cellSize) {
    let z00;
    let z10;
    let z01;
    let z11;
    if ((mip | 0) <= 0) {
      const x0 = ix | 0;
      const y0 = iy | 0;
      z00 = heightAt(lod0H, x0, y0, lod0Shift, lod0WMask, lod0HMask, wrap) * altScale;
      z10 = heightAt(lod0H, (x0 + 1) | 0, y0, lod0Shift, lod0WMask, lod0HMask, wrap) * altScale;
      z01 = heightAt(lod0H, x0, (y0 + 1) | 0, lod0Shift, lod0WMask, lod0HMask, wrap) * altScale;
      z11 =
        heightAt(lod0H, (x0 + 1) | 0, (y0 + 1) | 0, lod0Shift, lod0WMask, lod0HMask, wrap) *
        altScale;
    } else {
      const level = mip | 0;
      const hm = mips.heightMaps[level];
      const shift = mips.shifts[level];
      const wMask = (mips.widths[level] - 1) | 0;
      const hMask = (mips.heights[level] - 1) | 0;
      z00 = heightAt(hm, ix, iy, shift, wMask, hMask, wrap) * altScale;
      z10 = heightAt(hm, (ix + 1) | 0, iy, shift, wMask, hMask, wrap) * altScale;
      z01 = heightAt(hm, ix, (iy + 1) | 0, shift, wMask, hMask, wrap) * altScale;
      z11 = heightAt(hm, (ix + 1) | 0, (iy + 1) | 0, shift, wMask, hMask, wrap) * altScale;
    }
    let zMax = z00;
    if (z10 > zMax) zMax = z10;
    if (z01 > zMax) zMax = z01;
    if (z11 > zMax) zMax = z11;
    return { z00: z00, z10: z10, z01: z01, z11: z11, zMax: zMax };
  }

  function coarseEdgeTop(ix, iy, mip) {
    const level = mip | 0;
    const hm = mips.heightMaps[level];
    const shift = mips.shifts[level];
    const wMask = (mips.widths[level] - 1) | 0;
    const hMask = (mips.heights[level] - 1) | 0;
    let z = heightAt(hm, ix, iy, shift, wMask, hMask, wrap);
    const z10 = heightAt(hm, (ix + 1) | 0, iy, shift, wMask, hMask, wrap);
    const z01 = heightAt(hm, ix, (iy + 1) | 0, shift, wMask, hMask, wrap);
    const z11 = heightAt(hm, (ix + 1) | 0, (iy + 1) | 0, shift, wMask, hMask, wrap);
    if (z10 > z) z = z10;
    if (z01 > z) z = z01;
    if (z11 > z) z = z11;
    return z * altScale;
  }

  function hitColor(ix, iy, cellSize, t, colX, colY, skipMip) {
    const wx = (ix + HALF) * cellSize;
    const wy = (iy + HALF) * cellSize;
    if ((skipMip | 0) <= 0) {
      const refineHere = fine && lod0RefineAt(t, 0);
      const subdiv = refineHere ? lod0RefineSubdiv(lod0RefineMipAt(t, refineSwitches)) : 0;
      const base = refineHere
        ? sampleColorFiltered(
            lod0C,
            wx,
            wy,
            lod0Shift,
            lod0WMask,
            lod0HMask,
            wrap,
            subdiv
          )
        : colorAt(
            lod0C,
            Math.floor(wx) | 0,
            Math.floor(wy) | 0,
            lod0Shift,
            lod0WMask,
            lod0HMask,
            wrap
          );
      return detailInRange(t) ? applyDetail(base, wx, wy, t) : base;
    }
    const mip = skipMip | 0;
    const coarse = colorAt(
      mips.colorMaps[mip],
      colX | 0,
      colY | 0,
      mips.shifts[mip],
      (mips.widths[mip] - 1) | 0,
      (mips.heights[mip] - 1) | 0,
      wrap
    );
    return detailInRange(t) ? applyDetail(coarse, wx, wy, t) : coarse;
  }

  function writeHit(dest, color, dist, hByte, iter, hatZ) {
    if (debug) {
      if (debugView === DEBUG_VIEW_LOD) {
        const hitMip = mipLevelAtDistance(dist, switches, lastMip);
        const refineHere = lod0RefineAt(dist, hitMip);
        const refineMip = refineHere ? lod0RefineMipAt(dist, refineSwitches) : 0;
        pixels[dest] = encodeLodDistance(
          dist,
          hitMip,
          refineHere,
          refineMip,
          refineSwitches,
          switches,
          farClip
        );
        return;
      }
      pixels[dest] = encodeCameraSample(
        debugView,
        dist,
        hByte,
        iter,
        dist,
        farClip
      );
      return;
    }
    if (!(dist > 0)) {
      pixels[dest] = skyLut[skyLutIndexFromHat(hatZ, screenHeight)];
      return;
    }
    if (((dist >= farClip) | 0) | ((dist < nearClip) | 0)) {
      pixels[dest] = skyLut[skyLutIndexFromHat(hatZ, screenHeight)];
      return;
    }
    pixels[dest] = color;
  }

  function marchRay(dx, dy, dz, dest) {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > EPSILON)) {
      writeHit(dest, 0, 0, 0, 0, 0);
      return;
    }
    const invLen = 1 / len;
    const dirX = dx * invLen;
    const dirY = dy * invLen;
    const dirZ = dz * invLen;
    const hatZ = dirZ;
    const lenXY2 = dirX * dirX + dirY * dirY;
    const dirFwd = dirX * fwdX + dirY * fwdY + dirZ * fwdZ;

    const depthNear = s0 * dirFwd;
    const camInDetail = fine && lod0RefineAt(depthNear, 0);
    let camIx = Math.floor(camX) | 0;
    let camIy = Math.floor(camY) | 0;
    let camCell = 1;
    let hCam = 0;
    let hCamW = 0;
    if (camInDetail) {
      const level = detailLevelForDepth(depthNear);
      camCell = 1 / DETAIL_SUBDIV[level];
      camIx = Math.floor(camX / camCell) | 0;
      camIy = Math.floor(camY / camCell) | 0;
      const leaf = detailLeaf(camIx, camIy, camCell);
      hCam = leaf.hByte;
      hCamW = leaf.h;
    } else if (lod0RefineAt(depthNear, 0)) {
      const camPatch = sampleCorners(camIx, camIy, 0, 1);
      hCamW = patchHeight(
        camX - camIx,
        camY - camIy,
        camPatch.z00,
        camPatch.z10,
        camPatch.z01,
        camPatch.z11
      );
      hCam = (hCamW / altScale + HALF) | 0;
      if ((hCam < 0) | 0) {
        hCam = 0;
      }
      if ((hCam > 255) | 0) {
        hCam = 255;
      }
    } else {
      const camCol = columnAt(camIx, camIy, 0, 1, s0, camZ);
      hCam = camCol.hByte;
      hCamW = camCol.h;
    }
    const camInsideMap =
      wrap |
      (((camX >= 0) | 0) &
        ((camX < mapWf) | 0) &
        ((camY >= 0) | 0) &
        ((camY < mapHf) | 0));
    if (camInsideMap && camZ <= hCamW) {
      writeHit(
        dest,
        hitColor(camIx, camIy, camCell, s0, 0, 0, 0),
        s0,
        hCam,
        1,
        hatZ
      );
      return;
    }

    if (!(dirFwd > DIR_FWD_EPS)) {
      writeHit(dest, 0, 0, 0, 0, hatZ);
      return;
    }

    const sNear = s0 / dirFwd;
    const sFar = farClip / dirFwd;
    const spanZ = rayHeightSpan(camZ, dirZ, ceiling, sNear, sFar);
    if (!spanZ) {
      writeHit(dest, 0, 0, 0, 0, hatZ);
      return;
    }

    if (!(lenXY2 > DIR_XY_EPS)) {
      if (!camInsideMap) {
        writeHit(dest, 0, 0, 0, 0, hatZ);
        return;
      }
      if (dirZ < 0) {
        if (camZ > hCamW) {
          const sHit = (hCamW - camZ) / dirZ;
          const depthHit = sHit * dirFwd;
          if (sHit >= spanZ.s0 && sHit <= spanZ.s1 && depthHit >= s0 && depthHit <= farClip) {
            writeHit(
              dest,
              hitColor(camIx, camIy, camCell, depthHit, 0, 0, 0),
              depthHit,
              hCam,
              1,
              hatZ
            );
            return;
          }
        }
      } else if (hCamW > camZ) {
        const sHit = (hCamW - camZ) / dirZ;
        const depthHit = sHit * dirFwd;
        if (sHit >= spanZ.s0 && sHit <= spanZ.s1 && depthHit >= s0 && depthHit <= farClip) {
          writeHit(
            dest,
            hitColor(camIx, camIy, camCell, depthHit, 0, 0, 0),
            depthHit,
            hCam,
            1,
            hatZ
          );
          return;
        }
      }
      writeHit(dest, 0, 0, 0, 0, hatZ);
      return;
    }

    function marchDetail(sIn, sLimit, kIn) {
      let s = sIn;
      let k = kIn | 0;
      let level = 3;
      while ((s < sLimit) & (k < maxSteps)) {
        k = (k + 1) | 0;
        const depth = s * dirFwd;
        if (!lod0RefineAt(depth, 0)) {
          break;
        }
        const target = detailLevelForDepth(depth);
        if ((level < target) | 0) {
          level = target;
        }
        const cellSize = 1 / DETAIL_SUBDIV[level];
        const span = voxelXyCell(camX, camY, dirX, dirY, s, cellSize);
        let sExit = span.tFar;
        if (sExit > sLimit) {
          sExit = sLimit;
        }
        if (!(sExit > s)) {
          s = s + mipDdaEps(cellSize);
          continue;
        }
        const zEnter = camZ + dirZ * s;
        const zExitV = camZ + dirZ * sExit;
        const zLo = zEnter < zExitV ? zEnter : zExitV;
        const zHi = zEnter > zExitV ? zEnter : zExitV;
        const leafNow = (level | 0) <= (target | 0);
        const leaf = leafNow ? detailLeaf(span.ix, span.iy, cellSize) : null;
        const hTop = leafNow
          ? leaf.h
          : detailCellTop(span.ix, span.iy, cellSize, level);
        if ((zHi < GROUND_HEIGHT) | (zLo > hTop)) {
          s = sExit;
          if ((level < 3) | 0) {
            level = (level + 1) | 0;
          }
          continue;
        }
        if (!leafNow) {
          level = (level - 1) | 0;
          continue;
        }
        const sHit = voxelColumnHit(camZ, dirZ, leaf.h, s, sExit);
        if (sHit >= 0) {
          const depthHit = sHit * dirFwd;
          const wx = (span.ix + HALF) * cellSize;
          const wy = (span.iy + HALF) * cellSize;
          return {
            hit: 1,
            k: k,
            s: sHit,
            depth: depthHit,
            hByte: leaf.hByte,
            color: hitColor(
              span.ix,
              span.iy,
              cellSize,
              depthHit,
              Math.floor(wx) | 0,
              Math.floor(wy) | 0,
              0
            ),
          };
        }
        s = sExit;
      }
      return { hit: 0, k: k, s: s };
    }

    let s = spanZ.s0;
    const sEnd = spanZ.s1;
    let mip = lastMip;
    let k = 0;
    let wasInside = 0;
    while ((s < sEnd) & (k < maxSteps)) {
      k = (k + 1) | 0;
      const depth = s * dirFwd;
      const zHere = camZ + dirZ * s;
      if (zHere > ceiling && !(dirZ < 0)) {
        break;
      }
      const cellSize = mipVoxelSize(mip);
      const span = voxelXyCell(camX, camY, dirX, dirY, s, cellSize);
      const ix = span.ix;
      const iy = span.iy;
      let sExit = span.tFar;
      if (sExit > sEnd) {
        sExit = sEnd;
      }
      if (!(sExit > s)) {
        s = s + mipDdaEps(cellSize);
        continue;
      }
      const x0 = ix * cellSize;
      const y0 = iy * cellSize;
      if (!wrap) {
        const overlap =
          ((x0 < mapWf) | 0) &
          ((y0 < mapHf) | 0) &
          ((x0 + cellSize > 0) | 0) &
          ((y0 + cellSize > 0) | 0);
        if (!overlap) {
          if (wasInside) {
            break;
          }
          s = sExit;
          continue;
        }
        wasInside = 1;
      }
      const zEnter = camZ + dirZ * s;
      const zExitV = camZ + dirZ * sExit;
      const zLo = zEnter < zExitV ? zEnter : zExitV;
      const zHi = zEnter > zExitV ? zEnter : zExitV;
      const inDetail = ((mip | 0) <= 0) & (fine ? 1 : 0) & (lod0RefineAt(depth, 0) ? 1 : 0);
      let col = null;
      let hMax = 0;
      if (inDetail) {
        hMax = meterTop(ix, iy);
      } else {
        col = columnAt(ix, iy, mip, cellSize, depth, zLo);
        hMax = col.h;
      }
      if (zHi < GROUND_HEIGHT) {
        s = sExit;
        if ((mip < lastMip) | 0) {
          mip = (mip + 1) | 0;
        }
        continue;
      }
      const smooth =
        ((mip | 0) <= 0) & (lod0RefineAt(depth, 0) ? 1 : 0) & (inDetail ? 0 : 1);
      let surfMax = hMax;
      if (zLo > hMax) {
        if (smooth) {
          const above = sampleCorners(ix, iy, mip, cellSize);
          if (above.zMax > surfMax) {
            surfMax = above.zMax;
          }
        } else if ((mip | 0) > 0) {
          const edge = coarseEdgeTop(ix, iy, mip);
          if (edge > surfMax) {
            surfMax = edge;
          }
        }
        if (zLo > surfMax && !inDetail) {
          const bump = detailElevMax(depth) * altScale;
          if (bump > 0) {
            surfMax += bump;
          }
        }
      }
      if (zLo > surfMax) {
        s = sExit;
        const approaching =
          ((dirZ < 0) & (zEnter > surfMax)) | ((dirZ > 0) & (zEnter < GROUND_HEIGHT));
        if (!approaching && (mip < lastMip) | 0) {
          mip = (mip + 1) | 0;
        }
        continue;
      }
      const band = mipLevelAtDistance(depth, switches, lastMip);
      if ((mip > band) | 0) {
        mip = (mip - 1) | 0;
        continue;
      }
      if ((mip < band) | 0) {
        mip = band;
        continue;
      }
      if (inDetail) {
        const refined = marchDetail(s, sExit, k);
        k = refined.k;
        if (refined.hit) {
          const hx = camX + dirX * refined.s;
          const hy = camY + dirY * refined.s;
          if (!wrap) {
            const hitInside =
              ((hx >= 0) | 0) &
              ((hx < mapWf) | 0) &
              ((hy >= 0) | 0) &
              ((hy < mapHf) | 0);
            if (!hitInside) {
              break;
            }
          }
          writeHit(dest, refined.color, refined.depth, refined.hByte, refined.k, hatZ);
          return;
        }
        s = sExit;
        continue;
      }
      if (!smooth) {
        const sHit = voxelColumnHit(camZ, dirZ, col.h, s, sExit);
        if (sHit >= 0) {
          const depthHit = sHit * dirFwd;
          const hx = camX + dirX * sHit;
          const hy = camY + dirY * sHit;
          if (!wrap) {
            const hitInside =
              ((hx >= 0) | 0) &
              ((hx < mapWf) | 0) &
              ((hy >= 0) | 0) &
              ((hy < mapHf) | 0);
            if (!hitInside) {
              break;
            }
          }
          writeHit(
            dest,
            hitColor(ix, iy, cellSize, depthHit, col.colX, col.colY, mip),
            depthHit,
            col.hByte,
            k,
            hatZ
          );
          return;
        }
        s = sExit;
        continue;
      }
      const surf = sampleCorners(ix, iy, mip, cellSize);
      let sHit = patchHit(
        camX,
        camY,
        camZ,
        dirX,
        dirY,
        dirZ,
        x0,
        y0,
        cellSize,
        surf.z00,
        surf.z10,
        surf.z01,
        surf.z11,
        s,
        sExit
      );
      if (!(sHit >= 0)) {
        const u = (camX + dirX * s - x0) / cellSize;
        const v = (camY + dirY * s - y0) / cellSize;
        const zs = patchHeight(u, v, surf.z00, surf.z10, surf.z01, surf.z11);
        if (zEnter <= zs && zEnter >= GROUND_HEIGHT) {
          sHit = s;
        }
      }
      if (sHit >= 0) {
        const depthHit = sHit * dirFwd;
        const hx = camX + dirX * sHit;
        const hy = camY + dirY * sHit;
        if (!wrap) {
          const hitInside =
            ((hx >= 0) | 0) &
            ((hx < mapWf) | 0) &
            ((hy >= 0) | 0) &
            ((hy < mapHf) | 0);
          if (!hitInside) {
            break;
          }
        }
        const zu = (hx - x0) / cellSize;
        const zv = (hy - y0) / cellSize;
        const zSurf = patchHeight(zu, zv, surf.z00, surf.z10, surf.z01, surf.z11);
        let hByte = (zSurf / altScale + HALF) | 0;
        if ((hByte < 0) | 0) {
          hByte = 0;
        }
        if ((hByte > 255) | 0) {
          hByte = 255;
        }
        const colorIx = (mip | 0) <= 0 ? Math.floor(hx) | 0 : ix;
        const colorIy = (mip | 0) <= 0 ? Math.floor(hy) | 0 : iy;
        writeHit(
          dest,
          hitColor(colorIx, colorIy, (mip | 0) <= 0 ? 1 : cellSize, depthHit, col.colX, col.colY, mip),
          depthHit,
          hByte,
          k,
          hatZ
        );
        return;
      }
      s = sExit;
    }
    writeHit(dest, 0, 0, 0, k, hatZ);
  }

  for (let sy = 0; (sy < screenHeight) | 0; sy = (sy + 1) | 0) {
    const camYndc = (1 - (sy + PIXEL_CENTER) * invH * NDC_SCALE) * tanHalfY;
    const row = (sy * stride) | 0;
    let camXndc = camX0;
    let dx = rightX * camX0 + upX * camYndc + fwdX;
    let dy = rightY * camX0 + upY * camYndc + fwdY;
    let dz = rightZ * camX0 + upZ * camYndc + fwdZ;
    for (
      let sx = startColumn, localX = 0;
      (sx < endColumn) | 0;
      sx = (sx + 1) | 0, localX = (localX + 1) | 0
    ) {
      marchRay(dx, dy, dz, (row + localX) | 0);
      camXndc += dCamX;
      dx += rdx;
      dy += rdy;
      dz += rdz;
    }
  }
}
