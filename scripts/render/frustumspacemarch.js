"use strict";

import { Color } from "../math/color.js";
import { useRetailFrame, retailMipSwitches } from "./retail/schedule.js";
import { applyDetail, detailElevMax, detailHeightAdd, detailInRange } from "./retail/detail.js";
import {
  CHANNEL_MASK,
  CHANNEL_MAX,
  SHIFT_ALPHA,
  SHIFT_GREEN,
  SHIFT_RED,
} from "../constants/color.js";
import {
  GROUND_CLIP_OFFSET,
  GROUND_HEIGHT,
  HEIGHTMAP_MAX,
} from "../constants/terrain.js";
import { FILTER_DISTANCE_DEFAULT } from "../constants/sampling.js";
import { UNFILLED_PIXEL } from "../constants/framebuffer.js";
import {
  DEBUG_VIEW_DEPTH,
  DEBUG_VIEW_HEIGHT,
  DEBUG_VIEW_ITERATIONS,
  isDebugColor,
} from "../constants/debugView.js";
import { encodeHeight, encodeIter, encodeUnit } from "./debugEncode.js";
import {
  LOD0_REFINE_SWITCH_COUNT,
  TERRAIN_MIP_MAX_COUNT,
  bandMarchStep,
  fitBandStep,
  growBandStep,
  fillClassicLodDistances,
  firstBandT,
  lod0RefineAt,
  lod0RefineMipAt,
  lod0RefineSwitchDistances,
  mipLevelAtDistance,
} from "../constants/mip.js";
import { resolveTerrainMips } from "../terrain/mipChain.js";
import {
  FOG_SATURATED,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "../constants/quality.js";

// One ray per column, matching the retail terrain pass. LOD cell size sets
// the step; Quality divides the retail band step. On a heightfield hit the row is painted, the
// ray rewinds one step, and the row cursor moves up. The next test continues
// from that point. A miss only advances the ray. Spec is Y-up; this project
// is Z-up (X, Y map, Z altitude).

let sampleNScratch = new Int32Array(1);
const lodDistancesScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT + 1);
const lod0RefineSwitchScratch = new Float64Array(LOD0_REFINE_SWITCH_COUNT);
let sampleNCapacity = 1;

function sampleNBuffer(width) {
  if ((width > sampleNCapacity) | 0) {
    sampleNCapacity = width;
    sampleNScratch = new Int32Array(width);
  }
  return sampleNScratch;
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

function heightByteFromFine(hFine) {
  let b = (hFine + 0.5) | 0;
  if ((b < 0) | 0) b = 0;
  if ((b > 255) | 0) b = 255;
  return b;
}

function applyFogPacked(plotColor, fogT) {
  const a = (plotColor >>> SHIFT_ALPHA) & CHANNEL_MASK;
  const r = (plotColor >>> SHIFT_RED) & CHANNEL_MASK;
  const g = (plotColor >>> SHIFT_GREEN) & CHANNEL_MASK;
  const b = plotColor & CHANNEL_MASK;
  return (
    ((a + (CHANNEL_MAX - a) * fogT) << SHIFT_ALPHA) |
    ((r + (CHANNEL_MAX - r) * fogT) << SHIFT_RED) |
    ((g + (CHANNEL_MAX - g) * fogT) << SHIFT_GREEN) |
    (b + (CHANNEL_MAX - b) * fogT)
  );
}

export function renderFrustumSpaceColumns({
  heightMap,
  colorMap,
  mapW,
  mapH,
  mapShift,
  altitude,
  maxHeight,
  maxSlope,
  terrainMips,
  startColumn,
  endColumn,
  screenWidth,
  screenHeight,
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
  tanHalfFovX,
  fov = 0,
  showDetails = 0,
  lod0Refine = 0,
  lod0RefineCurve,
  dstToProjPlane,
  nearClip,
  farClip,
  minDeltaZ,
  quality,
  applyFog,
  fogStart = 0,
  debugView,
  repeat,
  filterDistance = FILTER_DISTANCE_DEFAULT,
  mipCount = TERRAIN_MIP_MAX_COUNT,
  lodSpacingMode,
  lodSpacing,
  pixels,
  pixelWidth,
  fillUnfilled,
  depth = null,
  heightBuf = null,
  iterBuf = null,
  pixelBase = 0,
  spanColumns = 0,
}) {
  useRetailFrame({
    screenWidth,
    tanHalfFovX,
    fov,
    quality,
    showDetails,
    lod0Refine,
    farClip,
  });
  const stepGrowth = STEP_GROWTH_BY_QUALITY[qualityIndex(quality)];
  const localWidth = (endColumn - startColumn) | 0;
  const stride = pixelWidth;
  const fogRange = farClip - fogStart;
  const invFogRange = fogRange === 0 ? 0 : 1 / fogRange;
  const useFog = applyFog | 0;
  const debug = isDebugColor(debugView) ? 0 : 1;
  const countIter = debugView === DEBUG_VIEW_ITERATIONS ? 1 : 0;
  const sampleN = countIter ? sampleNBuffer(localWidth) : null;
  if (sampleN) {
    sampleN.fill(0, 0, localWidth);
  }
  const altScale = altitude / HEIGHTMAP_MAX;
  const ceiling = maxHeight == null ? altitude : maxHeight;
  // World height per texel the terrain can rise at most. Missing map data
  // degrades to the slowest but still correct bound.
  const slopeCap =
    maxSlope == null || !(maxSlope > 0) ? altitude : maxSlope;
  const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
  const screenHorizon = screenHeight * 0.5;

  if (fillUnfilled) {
    pixels.fill(UNFILLED_PIXEL, 0, (localWidth * screenHeight) | 0);
  }

  const mips = resolveTerrainMips(
    terrainMips,
    heightMap,
    colorMap,
    mapW,
    mapH,
    mapShift,
    mipCount
  );
  const bandCount = Math.max(1, Math.min(TERRAIN_MIP_MAX_COUNT, mips.count | 0));
  const zStart = firstBandT(nearClip);
  const lodDistances = lodDistancesScratch;
  const switches = retailMipSwitches(bandCount, farClip);
  fillClassicLodDistances(
    lodDistances,
    zStart,
    farClip,
    switches,
    bandCount
  );

  const screenWidthScaler = 1 / screenWidth;
  const mapWMask = (mapW - 1) | 0;
  const mapHMask = (mapH - 1) | 0;
  const fine = lod0Refine | 0;
  const filterDist = filterDistance;
  const wrap = repeat | 0;
  const invH2 = dstToProjPlane === 0 ? 0 : 1 / dstToProjPlane;
  let shadeColorMap = colorMap;
  let shadeMapShift = mapShift;
  let shadeWMask = mapWMask;
  let shadeHMask = mapHMask;
  let shadeInvScale = 1;

  const refineSwitches = lod0RefineSwitchDistances(
    lodSpacing,
    lod0RefineCurve,
    lod0RefineSwitchScratch
  );
  const lastMip = (bandCount - 1) | 0;
  const rowBase = screenHorizon - 0.5;
  const xnStep = 2 * screenWidthScaler;
  let stepBudget = (screenHeight + 64) | 0;
  for (let m = 0; (m < bandCount) | 0; m = (m + 1) | 0) {
    const bandWidth = lodDistances[m + 1] - lodDistances[m];
    const refineHere = lod0RefineAt(lod0Refine, m);
    const refineMip = refineHere
      ? lod0RefineMipAt(lodDistances[m], refineSwitches)
      : 0;
    const bandStep = bandMarchStep(m, refineHere, refineMip, quality);
    const s = bandStep > 0 ? bandStep : 1;
    if (bandWidth > 0) {
      stepBudget = (stepBudget + Math.ceil(bandWidth / s)) | 0;
    }
  }
  if ((stepBudget > 2000000) | 0) {
    stepBudget = 2000000;
  }

  function shade(wx, wy, offset, hByte, z, fogT, fogWhite, applyFogT, useFine, localI) {
    if (debug) {
      if (debugView === DEBUG_VIEW_HEIGHT) {
        return encodeHeight(hByte);
      }
      if (debugView === DEBUG_VIEW_DEPTH) {
        return encodeUnit(farClip > 0 ? z / farClip : 0);
      }
      if (countIter) {
        return encodeIter(sampleN[localI]);
      }
      return Color.WHITE;
    }
    if (fogWhite) {
      return Color.WHITE;
    }
    let plotColor =
      fine & useFine
        ? sampleColorFiltered(
            shadeColorMap,
            wx * shadeInvScale,
            wy * shadeInvScale,
            shadeMapShift,
            shadeWMask,
            shadeHMask,
            wrap
          )
        : shadeColorMap[offset];
    if (detailInRange(z)) {
      plotColor = applyDetail(plotColor, wx, wy, z);
    }
    if (applyFogT) {
      plotColor = applyFogPacked(plotColor, fogT);
    }
    return plotColor;
  }

  for (let i = startColumn; (i < endColumn) | 0; i = (i + 1) | 0) {
    const localI = (i - startColumn) | 0;
    const pixCol = spanColumns ? i : localI;
    const xn = (i + 0.5) * xnStep - 1;
    let sy = (screenHeight - 1) | 0;
    let t = zStart;
    let step = 0;
    let guard = 0;
    while (((sy >= 0) | 0) & (t < farClip) & ((guard < stepBudget) | 0)) {
      guard = (guard + 1) | 0;
      const mip = mipLevelAtDistance(t, switches, lastMip);
      const refineHere = lod0RefineAt(lod0Refine, mip);
      const refineMip = refineHere ? lod0RefineMipAt(t, refineSwitches) : 0;
      step = fitBandStep(step, mip, refineHere, refineMip, quality);
      const yn = (rowBase - sy) * invH2;
      const bx = fwdX + xn * tanHalfFovX * rightX + yn * upX;
      const by = fwdY + xn * tanHalfFovX * rightY + yn * upY;
      const bz = fwdZ + xn * tanHalfFovX * rightZ + yn * upZ;
      const wx = camX + t * bx;
      const wy = camY + t * by;
      const wz = camZ + t * bz;
      if ((wz > ceiling) & !(bz < 0)) {
        break;
      }
      const inside =
        ((wx >= 0) | 0) &
        ((wx <= mapW) | 0) &
        ((wy >= 0) | 0) &
        ((wy <= mapH) | 0);
      if (!(inside | wrap)) {
        t = t + step;
        step = growBandStep(step, mip, refineHere, refineMip, stepGrowth, quality);
        continue;
      }
      shadeInvScale = 1 / (1 << mip);
      shadeColorMap = mips.colorMaps[mip];
      shadeMapShift = mips.shifts[mip];
      shadeWMask = (mips.widths[mip] - 1) | 0;
      shadeHMask = (mips.heights[mip] - 1) | 0;
      const sampleX = wx * shadeInvScale;
      const sampleY = wy * shadeInvScale;
      const offset =
        ((((sampleY | 0) & shadeWMask) << shadeMapShift) +
          ((sampleX | 0) & shadeHMask)) |
        0;
      const nearestH = mips.heightMaps[mip][offset];
      const useFine = ((mip | 0) === 0) & ((t <= filterDist) | 0);
      const doLerp = fine & useFine;
      let hFine = doLerp
        ? sampleHeightBilinear(
            mips.heightMaps[mip],
            sampleX,
            sampleY,
            shadeMapShift,
            shadeWMask,
            shadeHMask,
            wrap
          )
        : nearestH;
      const bump = detailElevMax(t) * altScale;
      if (wz < hFine * altScale + bump) {
        hFine += detailHeightAdd(wx, wy, t);
      }
      if (countIter) {
        sampleN[localI] = (sampleN[localI] + 1) | 0;
      }
      if (wz < hFine * altScale) {
        const fogTRaw =
          fogRange === 0 ? FOG_SATURATED : (t - fogStart) * invFogRange;
        const fogT =
          fogTRaw < 0
            ? 0
            : fogTRaw > FOG_SATURATED
              ? FOG_SATURATED
              : fogTRaw;
        const fogWhite = useFog & ((fogT >= FOG_SATURATED) | 0);
        const applyFogT = useFog & ((fogT > 0) | 0) & (fogWhite ^ 1);
        const hByte = doLerp ? heightByteFromFine(hFine) : nearestH;
        const col = shade(
          wx,
          wy,
          offset,
          hByte,
          t,
          fogT,
          fogWhite,
          applyFogT,
          useFine,
          localI
        );
        const o = (pixelBase + ((sy * stride + pixCol) | 0)) | 0;
        pixels[o] = col;
        if (depth) {
          const rayLen = Math.hypot(bx, by, bz);
          const dist = t * rayLen;
          depth[o] = dist > 0 ? dist : t;
        }
        if (heightBuf) {
          heightBuf[o] = hByte;
        }
        if (iterBuf) {
          iterBuf[o] = guard;
        }
        sy = (sy - 1) | 0;
        const prev = t - step;
        t = prev > zStart ? prev : zStart;
      } else {
        t = t + step;
        step = growBandStep(step, mip, refineHere, refineMip, stepGrowth, quality);
      }
    }
  }
}
