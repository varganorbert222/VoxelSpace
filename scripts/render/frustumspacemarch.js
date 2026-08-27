"use strict";

import { Color } from "../math/color.js";
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
  LOD_BAND_COUNT,
  LOD_DISTANCE_FRACTIONS,
  LOD_FAR_DELTAS,
} from "../constants/classic.js";
import {
  FOG_SATURATED,
  INITIAL_STEP_SCALE_BY_QUALITY,
  MIN_SAMPLE_DISTANCE,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "../constants/quality.js";

// Coarse occupancy probes along P(t). Occupied t-bands are filled per screen
// row (own XY color) front-to-back with a coverage mask — one texel must not
// smear down a pitched column. Spec is Y-up; this project is Z-up.
const SLICE_SAMPLES = 64;

let sampleNScratch = new Int32Array(1);
let coverScratch = new Uint8Array(1);
let freeScratch = new Int32Array(1);
const deltasScratch = new Float64Array(LOD_BAND_COUNT);
const lodDistancesScratch = new Float64Array(LOD_BAND_COUNT + 1);
let sampleNCapacity = 1;
let coverCapacity = 1;
let freeCapacity = 1;

function sampleNBuffer(width) {
  if ((width > sampleNCapacity) | 0) {
    sampleNCapacity = width;
    sampleNScratch = new Int32Array(width);
  }
  return sampleNScratch;
}

function coverBuffer(n) {
  if ((n > coverCapacity) | 0) {
    coverCapacity = n;
    coverScratch = new Uint8Array(n);
  }
  return coverScratch;
}

function freeBuffer(width) {
  if ((width > freeCapacity) | 0) {
    freeCapacity = width;
    freeScratch = new Int32Array(width);
  }
  return freeScratch;
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
  dstToProjPlane,
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
}) {
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
  const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
  const screenHorizon = screenHeight * 0.5;

  if (fillUnfilled) {
    pixels.fill(UNFILLED_PIXEL, 0, (localWidth * screenHeight) | 0);
  }

  const q = qualityIndex(quality);
  const stepGrowth = STEP_GROWTH_BY_QUALITY[q];
  const stepScale = INITIAL_STEP_SCALE_BY_QUALITY[q];

  const deltas = deltasScratch;
  deltas[0] = minDeltaZ * stepScale;
  for (let i = 0; (i < LOD_FAR_DELTAS.length) | 0; i = (i + 1) | 0) {
    deltas[i + 1] = LOD_FAR_DELTAS[i];
  }

  const zStart = Math.max(nearClip, deltas[0], MIN_SAMPLE_DISTANCE);
  const lodDistances = lodDistancesScratch;
  lodDistances[0] = zStart;
  for (let i = 0; (i < LOD_DISTANCE_FRACTIONS.length) | 0; i = (i + 1) | 0) {
    lodDistances[i + 1] = LOD_DISTANCE_FRACTIONS[i] * farClip;
  }
  lodDistances[LOD_BAND_COUNT] = farClip;
  for (let i = 1; (i < LOD_BAND_COUNT) | 0; i = (i + 1) | 0) {
    if ((lodDistances[i] < lodDistances[i - 1]) | 0) {
      lodDistances[i] = lodDistances[i - 1];
    }
  }

  const screenWidthScaler = 1 / screenWidth;
  const mapWMask = (mapW - 1) | 0;
  const mapHMask = (mapH - 1) | 0;
  const lerpH = interpolateHeight | 0;
  const filterC = filterColor | 0;
  const filterDist = filterDistance;
  const wrap = repeat | 0;
  const invH2 = dstToProjPlane === 0 ? 0 : 1 / dstToProjPlane;
  const cover = coverBuffer((localWidth * screenHeight) | 0);
  cover.fill(0, 0, (localWidth * screenHeight) | 0);
  const freeN = freeBuffer(localWidth);
  for (let i = 0; (i < localWidth) | 0; i = (i + 1) | 0) {
    freeN[i] = screenHeight;
  }
  let liveCols = localWidth;

  const hit = {
    occ: 0,
    wx: 0,
    wy: 0,
    wz: 0,
    hFine: 0,
    hByte: 0,
    offset: 0,
  };

  function bumpIter(localI) {
    if (countIter) {
      sampleN[localI] = (sampleN[localI] + 1) | 0;
    }
  }

  // P(t) = P_top + t (P_bottom - P_top). t=0 screen top, t=1 screen bottom.
  function evalT(t, xView, yTop, yBot, z, useFine, slack, localI) {
    const yView = yTop + t * (yBot - yTop);
    hit.wx = camX + xView * rightX + yView * upX + z * fwdX;
    hit.wy = camY + xView * rightY + yView * upY + z * fwdY;
    hit.wz = camZ + xView * rightZ + yView * upZ + z * fwdZ;
    hit.occ = 0;
    hit.hFine = 0;
    hit.hByte = 0;
    hit.offset = 0;
    bumpIter(localI);
    const inside =
      ((hit.wx >= 0) | 0) &
      ((hit.wx <= mapW) | 0) &
      ((hit.wy >= 0) | 0) &
      ((hit.wy <= mapH) | 0);
    if (!(inside | wrap)) {
      return 0;
    }
    if (hit.wz > ceiling + slack) {
      return 0;
    }
    if (hit.wz < clipZ) {
      return 0;
    }
    const offset =
      ((((hit.wy | 0) & mapWMask) << mapShift) + ((hit.wx | 0) & mapHMask)) | 0;
    const nearestH = heightMap[offset];
    const doLerp = lerpH & useFine;
    const hFine = doLerp
      ? sampleHeightBilinear(
          heightMap,
          hit.wx,
          hit.wy,
          mapShift,
          mapWMask,
          mapHMask,
          wrap
        )
      : nearestH;
    hit.hFine = hFine;
    hit.hByte = doLerp ? heightByteFromFine(hFine) : nearestH;
    hit.offset = offset;
    hit.occ = hit.wz <= hFine * altScale + slack ? 1 : 0;
    return hit.occ;
  }

  function terrainColor(z, fogT, fogWhite, applyFogT, useFine, localI) {
    if (debug) {
      if (debugView === DEBUG_VIEW_HEIGHT) {
        return encodeHeight(hit.hByte);
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
    const doFilter = filterC & useFine;
    let plotColor = doFilter
      ? sampleColorFiltered(
          colorMap,
          hit.wx,
          hit.wy,
          mapShift,
          mapWMask,
          mapHMask,
          wrap
        )
      : colorMap[hit.offset];
    if (applyFogT) {
      plotColor = applyFogPacked(plotColor, fogT);
    }
    return plotColor;
  }

  function paintOccupiedBand(
    localI,
    t0,
    t1,
    xView,
    yTop,
    yBot,
    z,
    useFine,
    slackRow,
    fogT,
    fogWhite,
    applyFogT
  ) {
    let y0 = (t0 * screenHeight) | 0;
    let y1 = (t1 * screenHeight) | 0;
    if ((y0 < 0) | 0) {
      y0 = 0;
    }
    if ((y1 > screenHeight) | 0) {
      y1 = screenHeight;
    }
    if ((y1 <= y0) | 0) {
      y1 = (y0 + 1) | 0;
      if ((y1 > screenHeight) | 0) {
        return;
      }
    }
    const invH = screenHeight === 0 ? 0 : 1 / screenHeight;
    for (let row = y0; (row < y1) | 0; row = (row + 1) | 0) {
      const cidx = (row * localWidth + localI) | 0;
      if (cover[cidx]) {
        continue;
      }
      const t = (row + 0.5) * invH;
      if (!evalT(t, xView, yTop, yBot, z, useFine, slackRow, localI)) {
        continue;
      }
      pixels[(row * stride + localI) | 0] = terrainColor(
        z,
        fogT,
        fogWhite,
        applyFogT,
        useFine,
        localI
      );
      cover[cidx] = 1;
      freeN[localI] = (freeN[localI] - 1) | 0;
      if ((freeN[localI] <= 0) | 0) {
        liveCols = (liveCols - 1) | 0;
        break;
      }
    }
  }

  // Front-to-back view-Z: first occupied hit keeps the pixel (coverage).
  for (let lod = 1; (lod <= LOD_BAND_COUNT) | 0; lod = (lod + 1) | 0) {
    if ((liveCols <= 0) | 0) {
      break;
    }
    const startIndex = lodDistances[lod - 1];
    const endIndex = lodDistances[lod];
    if ((startIndex >= farClip) | 0) {
      continue;
    }
    let step = deltas[lod - 1];
    let z = startIndex;
    while (
      ((z < endIndex) | 0) &
      ((z < farClip) | 0) &
      ((liveCols > 0) | 0)
    ) {
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
      const useFine = (z <= filterDist) | 0;
      const xScale = z * tanHalfFovX * 2 * screenWidthScaler;

      for (let i = startColumn; (i < endColumn) | 0; i = (i + 1) | 0) {
        const localI = (i - startColumn) | 0;
        if ((freeN[localI] <= 0) | 0) {
          continue;
        }
        const xView = (i + 0.5) * xScale - z * tanHalfFovX;
        const yTop = (screenHorizon - 0.5) * z * invH2;
        const yBot = (screenHorizon - (screenHeight - 0.5)) * z * invH2;
        let slackCol = (yBot - yTop) * upZ;
        if (slackCol < 0) {
          slackCol = -slackCol;
        }
        const slackCoarse = slackCol / SLICE_SAMPLES;
        const slackRow = screenHeight === 0 ? 0 : slackCol / screenHeight;
        for (let si = 0; (si < SLICE_SAMPLES) | 0; si = (si + 1) | 0) {
          const t0 = si / SLICE_SAMPLES;
          const t1 = (si + 1) / SLICE_SAMPLES;
          const tS = (t0 + t1) * 0.5;
          if (!evalT(tS, xView, yTop, yBot, z, useFine, slackCoarse, localI)) {
            continue;
          }
          paintOccupiedBand(
            localI,
            t0,
            t1,
            xView,
            yTop,
            yBot,
            z,
            useFine,
            slackRow,
            fogT,
            fogWhite,
            applyFogT
          );
          if ((freeN[localI] <= 0) | 0) {
            break;
          }
        }
      }
      z = z + step;
      step += stepGrowth;
    }
  }
}
