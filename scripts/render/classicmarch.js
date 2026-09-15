"use strict";

import { Color } from "../math/color.js";
import {
  CHANNEL_MASK,
  CHANNEL_MAX,
  SHIFT_ALPHA,
  SHIFT_GREEN,
  SHIFT_RED,
} from "../constants/color.js";
import { HEIGHTMAP_MAX } from "../constants/terrain.js";
import { FILTER_DISTANCE_DEFAULT } from "../constants/sampling.js";
import { UNFILLED_PIXEL } from "../constants/framebuffer.js";
import {
  DEBUG_VIEW_DEPTH,
  DEBUG_VIEW_HEIGHT,
  DEBUG_VIEW_ITERATIONS,
  isDebugColor,
} from "../constants/debugView.js";
import { encodeHeight, encodeIter, encodeUnit } from "./debugEncode.js";
import { NON_REPEAT_GROUND_OFFSET } from "../constants/classic.js";
import {
  FOG_SATURATED,
  INITIAL_STEP_SCALE_BY_QUALITY,
  MIN_SAMPLE_DISTANCE,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "../constants/quality.js";
import {
  TERRAIN_MIP_MAX_COUNT,
  classicLodDeltas,
  classicLodDistanceFractions,
  classicPixelOffsets,
  fillClassicLodDistances,
  mipInvScale,
} from "../constants/mip.js";
import { resolveTerrainMips } from "../terrain/mipChain.js";

let hiddenYScratch = new Int32Array(1);
let sampleNScratch = new Int32Array(1);
const deltasScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT);
const lodDistancesScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT + 1);
const pixelOffsetScratch = new Int32Array(TERRAIN_MIP_MAX_COUNT);
const mipWMaskScratch = new Int32Array(TERRAIN_MIP_MAX_COUNT);
const mipHMaskScratch = new Int32Array(TERRAIN_MIP_MAX_COUNT);
let hiddenYCapacity = 1;

function hiddenYBuffer(width) {
  if ((width > hiddenYCapacity) | 0) {
    hiddenYCapacity = width;
    hiddenYScratch = new Int32Array(width);
    sampleNScratch = new Int32Array(width);
  }
  return hiddenYScratch;
}

function setupClassicLod(params) {
  const mips = resolveTerrainMips(
    params.terrainMips || params.panoMips,
    params.heightMap,
    params.colorMap,
    params.mapW,
    params.mapH,
    params.mapShift
  );
  const q = qualityIndex(params.quality);
  const stepGrowth = STEP_GROWTH_BY_QUALITY[q];
  const stepScale = INITIAL_STEP_SCALE_BY_QUALITY[q];
  const bandCount = mips.count;
  classicLodDeltas(q, bandCount, params.minDeltaZ, stepScale, deltasScratch);
  const zStart = Math.max(params.nearClip, deltasScratch[0], MIN_SAMPLE_DISTANCE);
  const fractions = classicLodDistanceFractions(q, bandCount);
  fillClassicLodDistances(
    lodDistancesScratch,
    zStart,
    params.farClip,
    fractions,
    bandCount
  );
  classicPixelOffsets(q, bandCount, pixelOffsetScratch);
  for (let m = 0; (m < bandCount) | 0; m = (m + 1) | 0) {
    mipWMaskScratch[m] = (mips.widths[m] - 1) | 0;
    mipHMaskScratch[m] = (mips.heights[m] - 1) | 0;
  }
  return {
    mips: mips,
    q: q,
    stepGrowth: stepGrowth,
    bandCount: bandCount,
  };
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

function drawVerticalLine(pixels, stride, x, ytop, ybottom, col, width, xEnd) {
  x = x | 0;
  ytop = ytop | 0;
  ybottom = ybottom | 0;
  col = col | 0;
  if ((ytop < 0) | 0) ytop = 0;
  if ((ytop > ybottom) | 0) return;

  if (((width === 1) | 0) & ((x < xEnd) | 0)) {
    let offset = (ytop * stride + x) | 0;
    for (let k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
      pixels[offset] = col;
      offset = (offset + stride) | 0;
    }
    return;
  }

  let offset = 0;
  for (
    let j = 0;
    ((j < width) | 0) & ((x + j < xEnd) | 0);
    j = (j + 1) | 0
  ) {
    offset = (ytop * stride + x + j) | 0;
    for (let k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
      pixels[offset] = col;
      offset = (offset + stride) | 0;
    }
  }
}

function renderClassicColumnsSampled({
  heightMap,
  colorMap,
  mapW,
  mapH,
  mapShift,
  altitude,
  maxHeight,
  startColumn,
  endColumn,
  screenWidth,
  screenHeight,
  camX,
  camY,
  camZ,
  sinAngle,
  cosAngle,
  tanHalfFovX,
  dstToProjPlane,
  screenHorizon,
  nearClip,
  farClip,
  minDeltaZ,
  quality,
  applyFog,
  fogStart = 0,
  debugView,
  repeat,
  interpolateHeight,
  filterColor,
  filterDistance = FILTER_DISTANCE_DEFAULT,
  pixels,
  pixelWidth,
  fillUnfilled,
  terrainMips,
  panoMips,
}) {
  const localWidth = (endColumn - startColumn) | 0;
  const stride = pixelWidth;
  const hiddenY = hiddenYBuffer(localWidth);
  const fogRange = farClip - fogStart;
  const invFogRange = fogRange === 0 ? 0 : 1 / fogRange;
  const useFog = applyFog | 0;
  const debug = isDebugColor(debugView) ? 0 : 1;
  const countIter = debugView === DEBUG_VIEW_ITERATIONS ? 1 : 0;
  const sampleN = countIter ? sampleNScratch : null;
  if (sampleN) {
    sampleN.fill(0, 0, localWidth);
  }
  const altScale = altitude / HEIGHTMAP_MAX;
  const ceiling = maxHeight == null ? altitude : maxHeight;
  const ceilingSdf = camZ - ceiling;
  const yGround = camZ + NON_REPEAT_GROUND_OFFSET;

  if (fillUnfilled) {
    pixels.fill(UNFILLED_PIXEL, 0, (localWidth * screenHeight) | 0);
  }

  const lodState = setupClassicLod({
    terrainMips: terrainMips,
    panoMips: panoMips,
    heightMap: heightMap,
    colorMap: colorMap,
    mapW: mapW,
    mapH: mapH,
    mapShift: mapShift,
    quality: quality,
    minDeltaZ: minDeltaZ,
    nearClip: nearClip,
    farClip: farClip,
  });
  const mips = lodState.mips;
  const stepGrowth = lodState.stepGrowth;
  const bandCount = lodState.bandCount;
  const deltas = deltasScratch;
  const lodDistances = lodDistancesScratch;

  const screenWidthScaler = 1 / screenWidth;
  const lerpH = interpolateHeight | 0;
  const filterC = filterColor | 0;
  const filterDist = filterDistance;
  const kRightX = cosAngle * tanHalfFovX;
  const kRightY = -sinAngle * tanHalfFovX;
  const kLeftX = -sinAngle - kRightX;
  const kLeftY = -cosAngle - kRightY;
  const kDx = (kRightX + kRightX) * screenWidthScaler;
  const kDy = (kRightY + kRightY) * screenWidthScaler;

  for (let lod = bandCount; (lod > 0) | 0; lod = (lod - 1) | 0) {
    const startIndex = lodDistances[lod - 1];
    const endIndex = lodDistances[lod];
    const pxOffset = pixelOffsetScratch[lod - 1];
    let step = deltas[lod - 1];
    const mip = (lod - 1) | 0;
    const mipHeight = mips.heightMaps[mip];
    const mipColor = mips.colorMaps[mip];
    const mipShift = mips.shifts[mip];
    const mapWMask = mipWMaskScratch[mip];
    const mapHMask = mipHMaskScratch[mip];
    const inv = mipInvScale(mip);

    if ((startIndex >= farClip) | 0) {
      continue;
    }

    for (let i = 0; (i < localWidth) | 0; i = (i + 1) | 0) {
      hiddenY[i] = screenHeight;
    }

    for (
      let z = startIndex;
      ((z < endIndex) | 0) & ((z < farClip) | 0);
      z = z + step
    ) {
      const zScale = dstToProjPlane / z;
      const ceilingOnScreen = (ceilingSdf * zScale + screenHorizon) | 0;
      const groundOnScreen = (yGround * zScale + screenHorizon) | 0;
      const fogTRaw =
        fogRange === 0 ? FOG_SATURATED : (z - fogStart) * invFogRange;
      const fogT =
        fogTRaw < 0
          ? 0
          : fogTRaw > FOG_SATURATED
            ? FOG_SATURATED
            : fogTRaw;
      const fogWhite = useFog & ((fogT >= FOG_SATURATED) | 0);
      const applyFogT = useFog & ((fogT > 0) | 0) & (fogWhite ^ 1);
      const dx = kDx * z;
      const dy = kDy * z;
      let plx = kLeftX * z + camX + dx * startColumn;
      let ply = kLeftY * z + camY + dy * startColumn;

      for (
        let i = startColumn;
        (i < endColumn) | 0;
        i = (i + pxOffset) | 0
      ) {
        const localI = (i - startColumn) | 0;
        const colHidden = hiddenY[localI];
        if (colHidden === 0) {
          plx += dx * pxOffset;
          ply += dy * pxOffset;
          continue;
        }

        const inside =
          ((plx >= 0) | 0) &
          ((plx <= mapW) | 0) &
          ((ply >= 0) | 0) &
          ((ply <= mapH) | 0);
        const isOk = inside | (repeat | 0);

        if (isOk) {
          if ((ceilingOnScreen >= colHidden) | 0) {
            plx += dx * pxOffset;
            ply += dy * pxOffset;
            continue;
          }

          const sx = plx * inv;
          const sy = ply * inv;
          const offset =
            ((((sy | 0) & mapWMask) << mipShift) +
              ((sx | 0) & mapHMask)) |
            0;
          const useFine = ((mip | 0) === 0) & ((z <= filterDist) | 0);
          const doLerp = lerpH & useFine;
          const doFilter = filterC & useFine;
          const nearestH = mipHeight[offset];
          const hFine = doLerp
            ? sampleHeightBilinear(
                mipHeight,
                sx,
                sy,
                mipShift,
                mapWMask,
                mapHMask,
                repeat | 0
              )
            : nearestH;
          const hByte = doLerp ? heightByteFromFine(hFine) : nearestH;
          const terrainHeight = hFine * altScale;
          const terrainSDF = camZ - terrainHeight;
          const heightOnScreen = (terrainSDF * zScale + screenHorizon) | 0;

          let heightOnScreenBottom = colHidden;
          if (!repeat) {
            if ((groundOnScreen < heightOnScreenBottom) | 0) {
              heightOnScreenBottom = groundOnScreen;
            }
          }

          let plotColor = Color.WHITE;
          if (debug) {
            if (countIter) {
              sampleN[localI] = (sampleN[localI] + 1) | 0;
            }
            if (debugView === DEBUG_VIEW_HEIGHT) {
              plotColor = encodeHeight(hByte);
            } else if (debugView === DEBUG_VIEW_DEPTH) {
              plotColor = encodeUnit(farClip > 0 ? z / farClip : 0);
            } else if (countIter) {
              plotColor = encodeIter(sampleN[localI]);
            }
          } else if (!fogWhite) {
            plotColor = doFilter
              ? sampleColorFiltered(
                  mipColor,
                  sx,
                  sy,
                  mipShift,
                  mapWMask,
                  mapHMask,
                  repeat | 0
                )
              : mipColor[offset];
            if (applyFogT) {
              const a = (plotColor >>> SHIFT_ALPHA) & CHANNEL_MASK;
              const r = (plotColor >>> SHIFT_RED) & CHANNEL_MASK;
              const g = (plotColor >>> SHIFT_GREEN) & CHANNEL_MASK;
              const b = plotColor & CHANNEL_MASK;
              plotColor =
                ((a + (CHANNEL_MAX - a) * fogT) << SHIFT_ALPHA) |
                ((r + (CHANNEL_MAX - r) * fogT) << SHIFT_RED) |
                ((g + (CHANNEL_MAX - g) * fogT) << SHIFT_GREEN) |
                (b + (CHANNEL_MAX - b) * fogT);
            }
          }

          if ((heightOnScreen < colHidden) | 0) {
            let drawWidth = pxOffset;
            if ((i + drawWidth > endColumn) | 0) {
              drawWidth = (endColumn - i) | 0;
            }
            drawVerticalLine(
              pixels,
              stride,
              localI,
              heightOnScreen,
              heightOnScreenBottom,
              plotColor,
              drawWidth,
              localWidth
            );

            for (
              let j = localI;
              ((j < localI + drawWidth) | 0) & ((j < localWidth) | 0);
              j = (j + 1) | 0
            ) {
              hiddenY[j] = heightOnScreen;
            }
          }
        }

        plx += dx * pxOffset;
        ply += dy * pxOffset;
      }

      step += stepGrowth;
    }
  }
}

function renderClassicColumnsNearest({
  heightMap,
  colorMap,
  mapW,
  mapH,
  mapShift,
  altitude,
  maxHeight,
  startColumn,
  endColumn,
  screenWidth,
  screenHeight,
  camX,
  camY,
  camZ,
  sinAngle,
  cosAngle,
  tanHalfFovX,
  dstToProjPlane,
  screenHorizon,
  nearClip,
  farClip,
  minDeltaZ,
  quality,
  applyFog,
  fogStart = 0,
  debugView,
  repeat,
  pixels,
  pixelWidth,
  fillUnfilled,
  terrainMips,
  panoMips,
}) {
  const localWidth = (endColumn - startColumn) | 0;
  const stride = pixelWidth;
  const hiddenY = hiddenYBuffer(localWidth);
  const fogRange = farClip - fogStart;
  const invFogRange = fogRange === 0 ? 0 : 1 / fogRange;
  const useFog = applyFog | 0;
  const debug = isDebugColor(debugView) ? 0 : 1;
  const countIter = debugView === DEBUG_VIEW_ITERATIONS ? 1 : 0;
  const sampleN = countIter ? sampleNScratch : null;
  if (sampleN) {
    sampleN.fill(0, 0, localWidth);
  }
  const altScale = altitude / HEIGHTMAP_MAX;
  const ceiling = maxHeight == null ? altitude : maxHeight;
  const ceilingSdf = camZ - ceiling;
  const yGround = camZ + NON_REPEAT_GROUND_OFFSET;

  if (fillUnfilled) {
    pixels.fill(UNFILLED_PIXEL, 0, (localWidth * screenHeight) | 0);
  }

  const lodState = setupClassicLod({
    terrainMips: terrainMips,
    panoMips: panoMips,
    heightMap: heightMap,
    colorMap: colorMap,
    mapW: mapW,
    mapH: mapH,
    mapShift: mapShift,
    quality: quality,
    minDeltaZ: minDeltaZ,
    nearClip: nearClip,
    farClip: farClip,
  });
  const mips = lodState.mips;
  const stepGrowth = lodState.stepGrowth;
  const bandCount = lodState.bandCount;
  const deltas = deltasScratch;
  const lodDistances = lodDistancesScratch;

  const screenWidthScaler = 1 / screenWidth;
  const kRightX = cosAngle * tanHalfFovX;
  const kRightY = -sinAngle * tanHalfFovX;
  const kLeftX = -sinAngle - kRightX;
  const kLeftY = -cosAngle - kRightY;
  const kDx = (kRightX + kRightX) * screenWidthScaler;
  const kDy = (kRightY + kRightY) * screenWidthScaler;

  for (let lod = bandCount; (lod > 0) | 0; lod = (lod - 1) | 0) {
    const startIndex = lodDistances[lod - 1];
    const endIndex = lodDistances[lod];
    const pxOffset = pixelOffsetScratch[lod - 1];
    let step = deltas[lod - 1];
    const mip = (lod - 1) | 0;
    const mipHeight = mips.heightMaps[mip];
    const mipColor = mips.colorMaps[mip];
    const mipShift = mips.shifts[mip];
    const mapWMask = mipWMaskScratch[mip];
    const mapHMask = mipHMaskScratch[mip];
    const inv = mipInvScale(mip);

    if ((startIndex >= farClip) | 0) {
      continue;
    }

    for (let i = 0; (i < localWidth) | 0; i = (i + 1) | 0) {
      hiddenY[i] = screenHeight;
    }

    for (
      let z = startIndex;
      ((z < endIndex) | 0) & ((z < farClip) | 0);
      z = z + step
    ) {
      const zScale = dstToProjPlane / z;
      const ceilingOnScreen = (ceilingSdf * zScale + screenHorizon) | 0;
      const groundOnScreen = (yGround * zScale + screenHorizon) | 0;
      const fogTRaw =
        fogRange === 0 ? FOG_SATURATED : (z - fogStart) * invFogRange;
      const fogT =
        fogTRaw < 0
          ? 0
          : fogTRaw > FOG_SATURATED
            ? FOG_SATURATED
            : fogTRaw;
      const fogWhite = useFog & ((fogT >= FOG_SATURATED) | 0);
      const applyFogT = useFog & ((fogT > 0) | 0) & (fogWhite ^ 1);
      const dx = kDx * z;
      const dy = kDy * z;
      let plx = kLeftX * z + camX + dx * startColumn;
      let ply = kLeftY * z + camY + dy * startColumn;

      for (
        let i = startColumn;
        (i < endColumn) | 0;
        i = (i + pxOffset) | 0
      ) {
        const localI = (i - startColumn) | 0;
        const colHidden = hiddenY[localI];
        if (colHidden === 0) {
          plx += dx * pxOffset;
          ply += dy * pxOffset;
          continue;
        }

        const inside =
          ((plx >= 0) | 0) &
          ((plx <= mapW) | 0) &
          ((ply >= 0) | 0) &
          ((ply <= mapH) | 0);
        const isOk = inside | (repeat | 0);

        if (isOk) {
          if ((ceilingOnScreen >= colHidden) | 0) {
            plx += dx * pxOffset;
            ply += dy * pxOffset;
            continue;
          }

          const sx = plx * inv;
          const sy = ply * inv;
          const offset =
            ((((sy | 0) & mapWMask) << mipShift) +
              ((sx | 0) & mapHMask)) |
            0;
          const terrainHeight = mipHeight[offset] * altScale;
          const terrainSDF = camZ - terrainHeight;
          const heightOnScreen = (terrainSDF * zScale + screenHorizon) | 0;

          let heightOnScreenBottom = colHidden;
          if (!repeat) {
            if ((groundOnScreen < heightOnScreenBottom) | 0) {
              heightOnScreenBottom = groundOnScreen;
            }
          }

          let plotColor = Color.WHITE;
          if (debug) {
            if (countIter) {
              sampleN[localI] = (sampleN[localI] + 1) | 0;
            }
            if (debugView === DEBUG_VIEW_HEIGHT) {
              plotColor = encodeHeight(mipHeight[offset]);
            } else if (debugView === DEBUG_VIEW_DEPTH) {
              plotColor = encodeUnit(farClip > 0 ? z / farClip : 0);
            } else if (countIter) {
              plotColor = encodeIter(sampleN[localI]);
            }
          } else if (!fogWhite) {
            plotColor = mipColor[offset];
            if (applyFogT) {
              const a = (plotColor >>> SHIFT_ALPHA) & CHANNEL_MASK;
              const r = (plotColor >>> SHIFT_RED) & CHANNEL_MASK;
              const g = (plotColor >>> SHIFT_GREEN) & CHANNEL_MASK;
              const b = plotColor & CHANNEL_MASK;
              plotColor =
                ((a + (CHANNEL_MAX - a) * fogT) << SHIFT_ALPHA) |
                ((r + (CHANNEL_MAX - r) * fogT) << SHIFT_RED) |
                ((g + (CHANNEL_MAX - g) * fogT) << SHIFT_GREEN) |
                (b + (CHANNEL_MAX - b) * fogT);
            }
          }

          if ((heightOnScreen < colHidden) | 0) {
            let drawWidth = pxOffset;
            if ((i + drawWidth > endColumn) | 0) {
              drawWidth = (endColumn - i) | 0;
            }
            drawVerticalLine(
              pixels,
              stride,
              localI,
              heightOnScreen,
              heightOnScreenBottom,
              plotColor,
              drawWidth,
              localWidth
            );

            for (
              let j = localI;
              ((j < localI + drawWidth) | 0) & ((j < localWidth) | 0);
              j = (j + 1) | 0
            ) {
              hiddenY[j] = heightOnScreen;
            }
          }
        }

        plx += dx * pxOffset;
        ply += dy * pxOffset;
      }

      step += stepGrowth;
    }
  }
}

export function renderClassicColumns(params) {
  if ((params.interpolateHeight | 0) | (params.filterColor | 0)) {
    return renderClassicColumnsSampled(params);
  }
  return renderClassicColumnsNearest(params);
}
