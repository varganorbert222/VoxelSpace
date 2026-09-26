"use strict";

import { Color } from "../math/color.js";
import { useRetailFrame } from "./retail/schedule.js";
import { applyDetail, detailElevMax, detailHeightAdd, detailInRange } from "./retail/detail.js";
import ColorPalette from "../math/colorPalette.js";
import {
  CHANNEL_MASK,
  CHANNEL_MAX,
  SHIFT_ALPHA,
  SHIFT_GREEN,
  SHIFT_RED,
} from "../constants/color.js";
import {
  SKY_PALETTE_STEPS,
  skyLutIndexFromHat,
  skyPaletteT,
} from "../constants/framebuffer.js";
import { HEIGHTMAP_MAX, GROUND_HEIGHT } from "../constants/terrain.js";
import { FOG_SATURATED } from "../constants/quality.js";
import {
  DEG_TO_RAD,
  EPSILON,
  HALF,
  NDC_SCALE,
  PIXEL_CENTER,
} from "../constants/vmath.js";
import { isDebugColor } from "../constants/debugView.js";
import { encodeCameraSample } from "./debugEncode.js";
import { resolveTerrainMips } from "../terrain/mipChain.js";
import {
  LOD0_REFINE_NOISE_AMPLITUDE,
  LOD0_REFINE_SWITCH_COUNT,
  TERRAIN_MIP_MAX_COUNT,
  applyLod0RefineHeight,
  lod0RefineAt,
  lod0RefineMipAt,
  lod0RefineSwitchDistances,
  lod0SamplePos,
  marchCellSize,
  marchMaxSteps,
  mixNearestBilinear,
  mipDdaEps,
  mipLevelAtDistance,
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
const SLAB_EPS = 1e-8;

function fogColor(color, fogT) {
  const a = (color >>> SHIFT_ALPHA) & CHANNEL_MASK;
  const r = (color >>> SHIFT_RED) & CHANNEL_MASK;
  const g = (color >>> SHIFT_GREEN) & CHANNEL_MASK;
  const b = color & CHANNEL_MASK;
  return (
    ((a + (CHANNEL_MAX - a) * fogT) << SHIFT_ALPHA) |
    ((r + (CHANNEL_MAX - r) * fogT) << SHIFT_RED) |
    ((g + (CHANNEL_MAX - g) * fogT) << SHIFT_GREEN) |
    (b + (CHANNEL_MAX - b) * fogT)
  );
}

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

function sampleHeightBilinear(heightMap, x, y, mapShift, wMask, hMask, wrap) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ix = x0 | 0;
  const iy = y0 | 0;
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

function sampleColorFiltered(colorMap, x, y, mapShift, wMask, hMask, wrap) {
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
    x - x0,
    y - y0
  );
}

const XY_INF = 1e30;

function voxelXyCell(camX, camY, dirX, dirY, s, cellSize) {
  const e = mipDdaEps(cellSize);
  const px = camX + dirX * (s + e);
  const py = camY + dirY * (s + e);
  const inv = 1 / cellSize;
  let ix = Math.floor(px * inv);
  let iy = Math.floor(py * inv);
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
  let tFar = tFarX < tFarY ? tFarX : tFarY;
  if (!(tFar > s)) {
    const ax = dirX < 0 ? -dirX : dirX;
    const ay = dirY < 0 ? -dirY : dirY;
    const ad = ax > ay ? ax : ay;
    tFar = s + (ad > e ? cellSize / ad : e);
    if (tFarX <= tFarY) {
      ix = (ix + (dirX > 0 ? 1 : dirX < 0 ? -1 : 0)) | 0;
    } else {
      iy = (iy + (dirY > 0 ? 1 : dirY < 0 ? -1 : 0)) | 0;
    }
  }
  return { ix: ix | 0, iy: iy | 0, tFar: tFar };
}

function voxelColumnHit(camZ, dirZ, h, s, sExit) {
  const z1 = h;
  const zEnter = camZ + dirZ * s;
  const zExitV = camZ + dirZ * sExit;
  const zLo = zEnter < zExitV ? zEnter : zExitV;
  const zHi = zEnter > zExitV ? zEnter : zExitV;
  if (zHi < GROUND_HEIGHT || zLo > z1) {
    return -1;
  }
  let tHit = s;
  if (zEnter > z1) {
    if (dirZ < 0) {
      tHit = (z1 - camZ) / dirZ;
    }
  } else if (zEnter < GROUND_HEIGHT) {
    if (dirZ > 0) {
      tHit = (GROUND_HEIGHT - camZ) / dirZ;
    }
  }
  if (tHit < s) {
    tHit = s;
  }
  if (tHit > sExit) {
    tHit = sExit;
  }
  return tHit;
}

export function renderVoxelTexels({
  heightMap,
  colorMap,
  mapW,
  mapH,
  mapShift,
  altitude,
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
  applyFog,
  fogStart = 0,
  fogEnd,
  debugView,
  repeat,
  interpolateHeight,
  filterColor,
  filterDistance,
  skyColor,
  horizonColor,
  pixels,
  pixelWidth,
  fillUnfilled,
  terrainMips,
  panoMips,
  mipCount,
  lod0Refine,
  lod0RefineCurve,
  lodSpacingMode,
  lodSpacing,
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
  });
  const localWidth = (endColumn - startColumn) | 0;
  const stride = pixelWidth;
  if (fillUnfilled) {
    pixels.fill(0, 0, (localWidth * screenHeight) | 0);
  }
  const skyLut = getSkyLut(skyColor, horizonColor, screenHeight);
  const mips = resolveTerrainMips(
    terrainMips || panoMips,
    heightMap,
    colorMap,
    mapW,
    mapH,
    mapShift,
    mipCount
  );
  const lastMip = (mips.count - 1) | 0;
  const altScale = altitude / HEIGHTMAP_MAX;
  const wrap = repeat | 0;
  const lerpH = interpolateHeight | 0;
  const filterC = filterColor | 0;
  const refine = !!lod0Refine;
  const switches = mipSwitchDistances(
    mips.count,
    farClip,
    mipSwitchScratch,
    lodSpacingMode,
    lodSpacing
  );
  const refineSwitches = lod0RefineSwitchDistances(
    lodSpacing,
    lod0RefineCurve,
    lod0RefineSwitchScratch
  );
  const fogStop = Number.isFinite(fogEnd) ? fogEnd : farClip;
  const fogRange = fogStop - fogStart;
  const invFogRange = fogRange === 0 ? 0 : 1 / fogRange;
  const useFog = applyFog | 0;
  const debug = isDebugColor(debugView) ? 0 : 1;
  const aspect = screenWidth / screenHeight;
  let tanHalfY = Math.tan(fovY * DEG_TO_RAD * HALF);
  if (!(tanHalfY > 0) && dstToProjPlane > 0) {
    tanHalfY = (screenHeight * HALF) / dstToProjPlane;
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
  const maxSteps = marchMaxSteps(refine);
  let s0 = nearClip;
  if (!(s0 > 0)) {
    s0 = EPSILON;
  }
  const dCamX = NDC_SCALE * tanHalfX * invW;
  const camX0 =
    ((startColumn + PIXEL_CENTER) * invW * NDC_SCALE - 1) * tanHalfX;
  const rdx = rightX * dCamX;
  const rdy = rightY * dCamX;
  const rdz = rightZ * dCamX;

  function lod0SampleXY(wx, wy, dirX, dirY, t) {
    const refineHere = lod0RefineAt(refine, 0);
    const refineMip = refineHere ? lod0RefineMipAt(t, refineSwitches) : 0;
    const sample = lod0SamplePos(wx, wy, dirX, dirY, refineHere, refineMip);
    return {
      sx: refineHere ? sample.x : wx,
      sy: refineHere ? sample.y : wy,
      refineHere: refineHere,
      refineMip: refineMip,
    };
  }

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
      const refineHere = lod0RefineAt(refine, 0);
      const refineMip = refineHere ? lod0RefineMipAt(t, refineSwitches) : 0;
      let hFine = applyLod0RefineHeight(
        nearestH,
        wx,
        wy,
        0,
        0,
        refineHere,
        refineMip,
        LOD0_REFINE_NOISE_AMPLITUDE
      );
      const bump = detailElevMax(t) * altScale;
      if (probeZ <= hFine * altScale + bump) {
        hFine += detailHeightAdd(wx, wy, t);
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
    const bump = detailElevMax(t) * altScale;
    if (probeZ <= hFine * altScale + bump) {
      hFine += detailHeightAdd(wx, wy, t);
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

  function hitColor(hx, hy, dirX, dirY, t, colX, colY, skipMip) {
    if ((skipMip | 0) <= 0) {
      const lod = lod0SampleXY(hx, hy, dirX, dirY, t);
      const base = filterC
        ? sampleColorFiltered(
            lod0C,
            lod.sx,
            lod.sy,
            lod0Shift,
            lod0WMask,
            lod0HMask,
            wrap
          )
        : colorAt(
            lod0C,
            Math.floor(lod.sx) | 0,
            Math.floor(lod.sy) | 0,
            lod0Shift,
            lod0WMask,
            lod0HMask,
            wrap
          );
      return detailInRange(t) ? applyDetail(base, lod.sx, lod.sy, t) : base;
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
    return detailInRange(t) ? applyDetail(coarse, hx, hy, t) : coarse;
  }

  function writeHit(dest, color, dist, hByte, iter, hatZ) {
    if (debug) {
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
    const viewZ = dist;
    if (
      ((useFog ^ 1) | 0) &
      (((viewZ >= farClip) | 0) | ((viewZ < nearClip) | 0))
    ) {
      pixels[dest] = skyLut[skyLutIndexFromHat(hatZ, screenHeight)];
      return;
    }
    if (useFog) {
      const fogT =
        fogRange === 0 ? FOG_SATURATED : (viewZ - fogStart) * invFogRange;
      if (fogT >= FOG_SATURATED) {
        pixels[dest] = Color.WHITE;
      } else if (fogT > 0) {
        pixels[dest] = fogColor(color, fogT);
      } else {
        pixels[dest] = color;
      }
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

    const camRefine = lod0RefineAt(refine, 0);
    const camRefineMip = camRefine ? lod0RefineMipAt(s0, refineSwitches) : 0;
    const camCell = marchCellSize(0, camRefine, camRefineMip);
    const camIx = Math.floor(camX / camCell) | 0;
    const camIy = Math.floor(camY / camCell) | 0;
    const camCol = columnAt(camIx, camIy, 0, camCell, s0, camZ);
    const hCam = camCol.hByte;
    const hCamW = camCol.h;
    const camInsideMap =
      wrap |
      (((camX >= 0) | 0) &
        ((camX < mapWf) | 0) &
        ((camY >= 0) | 0) &
        ((camY < mapHf) | 0));
    if (camInsideMap && camZ <= hCamW) {
      writeHit(
        dest,
        hitColor(camX, camY, dirX, dirY, s0, camCol.colX, camCol.colY, 0),
        s0,
        hCam,
        1,
        hatZ
      );
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
          if (sHit >= s0 && sHit <= farClip) {
            writeHit(
              dest,
              hitColor(camX, camY, dirX, dirY, sHit, camCol.colX, camCol.colY, 0),
              sHit,
              hCam,
              1,
              hatZ
            );
            return;
          }
        }
      } else if (hCamW > camZ) {
        const sHit = (hCamW - camZ) / dirZ;
        if (sHit >= s0 && sHit <= farClip) {
          writeHit(
            dest,
            hitColor(camX, camY, dirX, dirY, sHit, camCol.colX, camCol.colY, 0),
            sHit,
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

    let s = s0;
    let mip = lastMip;
    let k = 0;
    let wasInside = 0;
    while ((s < farClip) & (k < maxSteps)) {
      k = (k + 1) | 0;
      const hitMip = mipLevelAtDistance(s, switches, lastMip);
      if ((mip < hitMip) | 0) {
        mip = hitMip;
      }
      const refineHere = lod0RefineAt(refine, mip);
      const refineMip = refineHere ? lod0RefineMipAt(s, refineSwitches) : 0;
      const cellSize = marchCellSize(mip, refineHere, refineMip);
      const span = voxelXyCell(camX, camY, dirX, dirY, s, cellSize);
      const ix = span.ix;
      const iy = span.iy;
      let sExit = span.tFar;
      if (sExit > farClip) {
        sExit = farClip;
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
      const col = columnAt(ix, iy, mip, cellSize, s, zLo);
      const hMax = col.h;
      if (zHi < GROUND_HEIGHT) {
        s = sExit;
        if ((mip < lastMip) | 0) {
          mip = (mip + 1) | 0;
        }
        continue;
      }
      if (zLo > hMax) {
        s = sExit;
        const approaching =
          ((dirZ < 0) & (zEnter > hMax)) | ((dirZ > 0) & (zEnter < GROUND_HEIGHT));
        if (!approaching && (mip < lastMip) | 0) {
          mip = (mip + 1) | 0;
        }
        continue;
      }
      if ((mip > hitMip) | 0) {
        mip = (mip - 1) | 0;
        continue;
      }
      const sHit = voxelColumnHit(camZ, dirZ, col.h, s, sExit);
      if (sHit >= 0) {
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
          hitColor(hx, hy, dirX, dirY, sHit, col.colX, col.colY, mip),
          sHit,
          col.hByte,
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
