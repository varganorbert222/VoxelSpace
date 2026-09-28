"use strict";

import { Color } from "../math/color.js";
import { qualityBandSteps, useRetailFrame } from "./retail/schedule.js";
import { applyDetail, detailElevMax, detailHeightAdd, detailInRange } from "./retail/detail.js";
import { vmaxHelperPeriod, vmaxLevel, vmaxShift, vmaxSkipDistance } from "./retail/vmax.js";
import {
  GROUND_CLIP_OFFSET,
  GROUND_HEIGHT,
  HEIGHTMAP_MAX,
} from "../constants/terrain.js";
import { FILTER_DISTANCE_DEFAULT } from "../constants/sampling.js";
import { COLUMN_PAIR, UNFILLED_PIXEL } from "../constants/framebuffer.js";
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
  marchMaxSteps,
  bandStepAt,
  nearMarchStep,
  fillClassicLodDistances,
  firstBandT,
  lod0RefineAt,
  lod0RefineMipAt,
  lod0RefineSubdiv,
  lod0RefineSwitchDistances,
  mipLevelAtDistance,
  mipSwitchDistances,
} from "../constants/mip.js";
import { resolveTerrainMips } from "../terrain/mipChain.js";

// One ray per two-pixel column. The step is the mip-band width divided by 32*q.
// On a heightfield hit the row is painted, the
// ray rewinds one step, and the row cursor moves up. The next test continues
// from that point. A miss only advances the ray. Spec is Y-up; this project
// is Z-up (X, Y map, Z altitude).

let sampleNScratch = new Int32Array(1);
const lodDistancesScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT + 1);
const bandStepsScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT);
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

function sampleHeightBilinear(heightMap, x, y, mapShift, wMask, hMask, wrap, subdiv) {
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
  let qx = fx;
  let qy = fy;
  if ((subdiv | 0) > 1) {
    const sub = subdiv | 0;
    const last = (sub - 1) | 0;
    let cx = (fx * sub) | 0;
    let cy = (fy * sub) | 0;
    if ((cx > last) | 0) cx = last;
    if ((cy > last) | 0) cy = last;
    const inv = 1 / sub;
    qx = (cx + 0.5) * inv;
    qy = (cy + 0.5) * inv;
  }
  const hx0 = h00 + (h10 - h00) * qx;
  const hx1 = h01 + (h11 - h01) * qx;
  return hx0 + (hx1 - hx0) * qy;
}

function sampleColorFiltered(colorMap, x, y, mapShift, wMask, hMask, wrap, subdiv) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const ix = x0 | 0;
  const iy = y0 | 0;
  let fx = x - x0;
  let fy = y - y0;
  if ((subdiv | 0) > 1) {
    const sub = subdiv | 0;
    const last = (sub - 1) | 0;
    let cx = (fx * sub) | 0;
    let cy = (fy * sub) | 0;
    if ((cx > last) | 0) cx = last;
    if ((cy > last) | 0) cy = last;
    const inv = 1 / sub;
    fx = (cx + 0.5) * inv;
    fy = (cy + 0.5) * inv;
  }
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
    fx,
    fy
  );
}

function heightByteFromFine(hFine) {
  let b = (hFine + 0.5) | 0;
  if ((b < 0) | 0) b = 0;
  if ((b > 255) | 0) b = 255;
  return b;
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
  debugView,
  repeat,
  filterDistance = FILTER_DISTANCE_DEFAULT,
  mipCount = TERRAIN_MIP_MAX_COUNT,
  lodSpacingMode,
  lodSpacing,
  lodBias,
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
    lodSpacingMode,
    lodSpacing,
    lodBias,
  });
  const localWidth = (endColumn - startColumn) | 0;
  const stride = pixelWidth;
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
  const switches = mipSwitchDistances(
    bandCount,
    farClip,
    null,
    lodSpacingMode,
    lodSpacing
  );
  fillClassicLodDistances(
    lodDistances,
    zStart,
    farClip,
    switches,
    bandCount
  );
  const bandSteps = qualityBandSteps(
    bandCount,
    farClip,
    quality,
    switches,
    bandStepsScratch
  );

  const screenWidthScaler = 1 / screenWidth;
  const mapWMask = (mapW - 1) | 0;
  const mapHMask = (mapH - 1) | 0;
  const fine = showDetails ? 1 : 0;
  void filterDistance;
  const wrap = repeat | 0;
  const invH2 = dstToProjPlane === 0 ? 0 : 1 / dstToProjPlane;
  let shadeColorMap = colorMap;
  let shadeMapShift = mapShift;
  let shadeWMask = mapWMask;
  let shadeHMask = mapHMask;
  let shadeInvScale = 1;

  const nearEnd = switches.length && switches[0] > 0 ? switches[0] : farClip;
  const refineSwitches = lod0RefineSwitchDistances(
    nearEnd,
    lod0RefineCurve,
    lod0RefineSwitchScratch
  );
  const lastMip = (bandCount - 1) | 0;
  const rowBase = screenHorizon - 0.5;
  const xnStep = 2 * screenWidthScaler;
  // Same cap as the WebGPU frustum march. A budget that grows with the
  // framebuffer height stops high-resolution columns before the far ridges.
  const stepBudget = marchMaxSteps(true);

  function shade(wx, wy, offset, hByte, z, useFine, localI) {
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
    let plotColor =
      fine & useFine
        ? sampleColorFiltered(
            shadeColorMap,
            wx * shadeInvScale,
            wy * shadeInvScale,
            shadeMapShift,
            shadeWMask,
            shadeHMask,
            wrap,
            lod0RefineSubdiv(lod0RefineMipAt(z))
          )
        : shadeColorMap[offset];
    if (detailInRange(z)) {
      plotColor = applyDetail(plotColor, wx, wy, z);
    }
    return plotColor;
  }

  for (let i = startColumn; (i < endColumn) | 0; ) {
    let pair = COLUMN_PAIR;
    const remain = (endColumn - i) | 0;
    if ((pair > remain) | 0) {
      pair = remain;
    }
    const localI = (i - startColumn) | 0;
    const pixCol = spanColumns ? i : localI;
    const xn = (i + 0.5) * xnStep - 1;
    let sy = (screenHeight - 1) | 0;
    let t = zStart;
    let step = 0;
    let guard = 0;
    let helperOn = 1;
    let fineSince = 0;
    let helperBand = -1;
    let advance = 1;
    while (((sy >= 0) | 0) & (t < farClip) & ((guard < stepBudget) | 0)) {
      guard = (guard + 1) | 0;
      const mip = mipLevelAtDistance(t, switches, lastMip);
      const refineHere = lod0RefineAt(t, mip);
      const refineMip = refineHere ? lod0RefineMipAt(t, refineSwitches) : 0;
      step = nearMarchStep(bandStepAt(bandSteps, mip), mip, refineHere, refineMip);
      const yn = (rowBase - sy) * invH2;
      const bx = fwdX + xn * tanHalfFovX * rightX + yn * upX;
      const by = fwdY + xn * tanHalfFovX * rightY + yn * upY;
      const bz = fwdZ + xn * tanHalfFovX * rightZ + yn * upZ;
      let wx = camX + t * bx;
      let wy = camY + t * by;
      let wz = camZ + t * bz;
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
        fineSince = (fineSince + 1) | 0;
        continue;
      }
      const bandKey = refineHere ? (refineMip | 0) + 1 : (mip | 0) + 32;
      if (bandKey !== helperBand) {
        helperBand = bandKey;
        if (advance) {
          helperOn = 1;
        }
        fineSince = 0;
      }
      if (advance && helperOn && mips.vmaxMaps) {
        let bandEnd = farClip;
        if (((mip + 1) | 0) < switches.length && switches[mip] > t && switches[mip] < bandEnd) {
          bandEnd = switches[mip];
        }
        if (refineHere) {
          if (refineMip < refineSwitches.length) {
            const sw = refineSwitches[refineMip];
            if (sw > t && sw < bandEnd) {
              bandEnd = sw;
            }
          }
          const nearLimit = refineSwitches.length
            ? refineSwitches[refineSwitches.length - 1] * 2
            : 0;
          if (nearLimit > t && nearLimit < bandEnd) {
            bandEnd = nearLimit;
          }
        }
        const jumped = vmaxSkipDistance(
          t,
          step,
          bx,
          by,
          bz,
          camX,
          camY,
          camZ,
          mips,
          vmaxLevel(mip, refineHere, refineMip),
          vmaxShift(mip, refineHere, refineMip),
          bandEnd,
          mapW,
          mapH,
          wrap,
          altScale
        );
        helperOn = 0;
        fineSince = 0;
        if (jumped > t) {
          t = jumped + step;
          advance = 1;
          fineSince = 1;
          if (fineSince >= vmaxHelperPeriod(mip, refineHere, refineMip)) {
            helperOn = 1;
          }
          continue;
        }
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
      const useFine = refineHere ? 1 : 0;
      const doLerp = fine & useFine;
      let hFine = doLerp
        ? sampleHeightBilinear(
            mips.heightMaps[mip],
            sampleX,
            sampleY,
            shadeMapShift,
            shadeWMask,
            shadeHMask,
            wrap,
            lod0RefineSubdiv(refineMip)
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
        const hByte = doLerp ? heightByteFromFine(hFine) : nearestH;
        const col = shade(wx, wy, offset, hByte, t, useFine, localI);
        const o = (pixelBase + ((sy * stride + pixCol) | 0)) | 0;
        pixels[o] = col;
        let depthV = 0;
        if (depth) {
          const rayLen = Math.hypot(bx, by, bz);
          const dist = t * rayLen;
          depthV = dist > 0 ? dist : t;
          depth[o] = depthV;
        }
        if (heightBuf) {
          heightBuf[o] = hByte;
        }
        if (iterBuf) {
          iterBuf[o] = guard;
        }
        if (
          ((pair > 1) | 0) &
          ((((pixCol + 1) | 0) < stride) | 0) &
          ((((i + 1) | 0) < endColumn) | 0)
        ) {
          const o2 = (o + 1) | 0;
          pixels[o2] = col;
          if (depth) {
            depth[o2] = depthV;
          }
          if (heightBuf) {
            heightBuf[o2] = hByte;
          }
          if (iterBuf) {
            iterBuf[o2] = guard;
          }
        }
        sy = (sy - 1) | 0;
        const prev = t - step;
        t = prev > zStart ? prev : zStart;
        helperOn = 0;
        fineSince = 0;
        advance = 0;
      } else {
        t = t + step;
        advance = 1;
        fineSince = (fineSince + 1) | 0;
        if (fineSince >= vmaxHelperPeriod(mip, refineHere, refineMip)) {
          helperOn = 1;
        }
      }
    }
    i = (i + pair) | 0;
  }
}
