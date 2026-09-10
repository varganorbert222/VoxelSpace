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

// View-Z slices, front-to-back, one persistent horizon per column.
//
// With roll = 0 the slice point's world Z is column independent:
//   wz(row, z) = camZ + z * ((H/2 - row - 0.5) * invH2 * upZ + fwdZ)
// so the terrain slab maps to a closed-form row window per slice, and the
// hit row of a sampled height is a closed-form projection (the pitch-general
// form of classic `heightOnScreen`).
//
// Per column the slice contributes rows above the running horizon only.
// If the column's XY drifts less than a texel across that span, one height
// sample resolves the whole span (classic cost). Otherwise the span is walked
// upward from the horizon, each row sampling its own XY.
//
// A pitched slice plane is close to parallel to the terrain, so above the first
// empty row the surface can cross the plane again: the rows a slice adds are
// contour bands, not one run above the horizon. Stopping at the first empty row
// leaves those bands to a later slice, which paints them from the wrong XY and
// eats into steep slopes. Empty rows are therefore skipped by the largest step
// that provably holds no terrain: with `maxSlope` bounding the steepest
// neighbour step, the sampled height rises by at most
//   riseMax = maxSlope * (|rowStepX| + |rowStepY|)
// per row while the plane rises by rowStepZ, so a gap of `g` world units needs
// at least g / (riseMax - rowStepZ) rows to close. When riseMax <= rowStepZ the
// surface can never return and the first empty row ends the column, which is
// the pitch-0 case. A coverage mask keeps each pixel's first hit even when a
// detached band reaches it before the horizon does.
//
// Spec is Y-up; this project is Z-up (X,Y map, Z altitude).
const DRIFT_SPAN_TEXELS = 1;
const ROW_LIMIT = 1e9;

let sampleNScratch = new Int32Array(1);
let hiddenScratch = new Int32Array(1);
let coverScratch = new Uint8Array(1);
let freeScratch = new Int32Array(1);
let dirtyScratch = new Uint8Array(1);
const deltasScratch = new Float64Array(LOD_BAND_COUNT);
const lodDistancesScratch = new Float64Array(LOD_BAND_COUNT + 1);
let sampleNCapacity = 1;
let hiddenCapacity = 1;
let coverCapacity = 1;
let freeCapacity = 1;

function sampleNBuffer(width) {
  if ((width > sampleNCapacity) | 0) {
    sampleNCapacity = width;
    sampleNScratch = new Int32Array(width);
  }
  return sampleNScratch;
}

function hiddenBuffer(width) {
  if ((width > hiddenCapacity) | 0) {
    hiddenCapacity = width;
    hiddenScratch = new Int32Array(width);
  }
  return hiddenScratch;
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
    dirtyScratch = new Uint8Array(width);
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
  // World height per texel the terrain can rise at most. Missing map data
  // degrades to the slowest but still correct bound.
  const slopeCap =
    maxSlope == null || !(maxSlope > 0) ? altitude : maxSlope;
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

  // Row parametrisation: yn(row) = screenHorizon - row - 0.5.
  const rowBase = screenHorizon - 0.5;
  const upXY = Math.sqrt(upX * upX + upY * upY);
  const xnStep = 2 * screenWidthScaler;
  const xn0 = (startColumn + 0.5) * xnStep - 1;

  const hiddenY = hiddenBuffer(localWidth);
  const freeN = freeBuffer(localWidth);
  const dirty = dirtyScratch;
  const coverN = (localWidth * screenHeight) | 0;
  const cover = coverBuffer(coverN);
  cover.fill(0, 0, coverN);
  for (let i = 0; (i < localWidth) | 0; i = (i + 1) | 0) {
    hiddenY[i] = screenHeight;
    freeN[i] = screenHeight;
    dirty[i] = 0;
  }
  let liveCols = localWidth;

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
      filterC & useFine
        ? sampleColorFiltered(
            colorMap,
            wx,
            wy,
            mapShift,
            mapWMask,
            mapHMask,
            wrap
          )
        : colorMap[offset];
    if (applyFogT) {
      plotColor = applyFogPacked(plotColor, fogT);
    }
    return plotColor;
  }

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
      const doLerp = lerpH & useFine;

      const zTanX = z * tanHalfFovX;
      const zInvH2 = z * invH2;
      // One row step upward (row - 1) moves the sample by these deltas.
      const rowStepX = zInvH2 * upX;
      const rowStepY = zInvH2 * upY;
      const rowStepZ = zInvH2 * upZ;
      const driftPerRow = zInvH2 * upXY;
      const hasRowStep = rowStepZ !== 0;
      const invRowStepZ = hasRowStep ? 1 / rowStepZ : 0;

      // Fastest the terrain can close the gap to the plane, per row upward.
      // Height only changes after XY moves ~1 texel, so empty rows can jump by
      // at least that many rows; the slope bound may jump further.
      const absX = rowStepX < 0 ? -rowStepX : rowStepX;
      const absY = rowStepY < 0 ? -rowStepY : rowStepY;
      const riseMax = slopeCap * (absX + absY);
      const closeRate = riseMax - rowStepZ;
      const canRise = closeRate > 0;
      const invCloseRate = canRise ? 1 / closeRate : 0;
      const driftCheb = absX > absY ? absX : absY;
      const skipTexelRaw =
        driftCheb > 0 ? Math.floor(1 / driftCheb) | 0 : screenHeight;
      const skipTexel = (skipTexelRaw < 1) | 0 ? 1 : skipTexelRaw;

      const colStepX = xnStep * zTanX * rightX;
      const colStepY = xnStep * zTanX * rightY;
      const colStepZ = xnStep * zTanX * rightZ;
      let wxBase = camX + xn0 * zTanX * rightX + z * fwdX;
      let wyBase = camY + xn0 * zTanX * rightY + z * fwdY;
      let wzBase = camZ + xn0 * zTanX * rightZ + z * fwdZ;

      for (let i = startColumn; (i < endColumn) | 0; i = (i + 1) | 0) {
        const localI = (i - startColumn) | 0;
        const hy = hiddenY[localI];
        if ((hy <= 0) | 0) {
          wxBase += colStepX;
          wyBase += colStepY;
          wzBase += colStepZ;
          continue;
        }

        // Terrain slab -> row window for this column (M2).
        let wTop = 0;
        let wBot = hy;
        if (hasRowStep) {
          const rCeil = rowBase - (ceiling - wzBase) * invRowStepZ;
          const rGround = rowBase - (clipZ - wzBase) * invRowStepZ;
          let lo = rCeil < rGround ? rCeil : rGround;
          let hi = rCeil < rGround ? rGround : rCeil;
          if (!(lo > -ROW_LIMIT)) lo = -ROW_LIMIT;
          if (!(hi < ROW_LIMIT)) hi = ROW_LIMIT;
          wTop = Math.ceil(lo) | 0;
          if ((wTop < 0) | 0) wTop = 0;
          const bot = (Math.floor(hi) | 0) + 1;
          if ((bot < wBot) | 0) wBot = bot;
        } else if (wzBase < clipZ || wzBase > ceiling) {
          wxBase += colStepX;
          wyBase += colStepY;
          wzBase += colStepZ;
          continue;
        }

        if ((wTop >= wBot) | 0) {
          wxBase += colStepX;
          wyBase += colStepY;
          wzBase += colStepZ;
          continue;
        }

        if (hasRowStep && driftPerRow * (hy - wTop) < DRIFT_SPAN_TEXELS) {
          // Sub-texel drift: the whole span shares one XY (M4, exact at
          // pitch 0). One height sample, closed-form hit row, span fill.
          const yn = rowBase - (hy - 1);
          const wx = wxBase + yn * rowStepX;
          const wy = wyBase + yn * rowStepY;
          const inside =
            ((wx >= 0) | 0) &
            ((wx <= mapW) | 0) &
            ((wy >= 0) | 0) &
            ((wy <= mapH) | 0);
          if (!(inside | wrap)) {
            wxBase += colStepX;
            wyBase += colStepY;
            wzBase += colStepZ;
            continue;
          }
          const offset =
            ((((wy | 0) & mapWMask) << mapShift) + ((wx | 0) & mapHMask)) | 0;
          const nearestH = heightMap[offset];
          const hFine = doLerp
            ? sampleHeightBilinear(
                heightMap,
                wx,
                wy,
                mapShift,
                mapWMask,
                mapHMask,
                wrap
              )
            : nearestH;
          if (countIter) {
            sampleN[localI] = (sampleN[localI] + 1) | 0;
          }
          let rHit =
            Math.ceil(rowBase - (hFine * altScale - wzBase) * invRowStepZ) | 0;
          if ((rHit < hy) | 0) {
            if ((rHit < wTop) | 0) rHit = wTop;
            let bottom = hy;
            if (!wrap && wBot < bottom) {
              bottom = wBot;
            }
            if ((rHit < bottom) | 0) {
              const hByte = doLerp ? heightByteFromFine(hFine) : nearestH;
              const col = shade(
                wx,
                wy,
                offset,
                hByte,
                z,
                fogT,
                fogWhite,
                applyFogT,
                useFine,
                localI
              );
              let painted = 0;
              let o = (rHit * stride + localI) | 0;
              if (dirty[localI]) {
                let ci = (rHit * localWidth + localI) | 0;
                for (let r = rHit; (r < bottom) | 0; r = (r + 1) | 0) {
                  if (!cover[ci]) {
                    pixels[o] = col;
                    cover[ci] = 1;
                    painted = (painted + 1) | 0;
                  }
                  o = (o + stride) | 0;
                  ci = (ci + localWidth) | 0;
                }
              } else {
                for (let r = rHit; (r < bottom) | 0; r = (r + 1) | 0) {
                  pixels[o] = col;
                  o = (o + stride) | 0;
                }
                painted = (bottom - rHit) | 0;
              }
              freeN[localI] = (freeN[localI] - painted) | 0;
              hiddenY[localI] = rHit;
            }
          }
        } else {
          // Pitched column: walk upward from the horizon. Occupied rows paint
          // their own XY, empty rows jump over the rows terrain cannot reach.
          const seed = (wBot < hy ? wBot : hy) | 0;
          let suffix = seed;
          let firstColor = 0;
          let painted = 0;
          let r = (wBot - 1) | 0;
          while ((r >= wTop) | 0) {
            const cidx = (r * localWidth + localI) | 0;
            if (cover[cidx]) {
              if ((r + 1 === suffix) | 0) {
                suffix = r;
              }
              r = (r - 1) | 0;
              continue;
            }
            const yn = rowBase - r;
            const wx = wxBase + yn * rowStepX;
            const wy = wyBase + yn * rowStepY;
            const wz = wzBase + yn * rowStepZ;
            const inside =
              ((wx >= 0) | 0) &
              ((wx <= mapW) | 0) &
              ((wy >= 0) | 0) &
              ((wy <= mapH) | 0);
            if (!(inside | wrap)) {
              break;
            }
            const offset =
              ((((wy | 0) & mapWMask) << mapShift) + ((wx | 0) & mapHMask)) | 0;
            const nearestH = heightMap[offset];
            const hFine = doLerp
              ? sampleHeightBilinear(
                  heightMap,
                  wx,
                  wy,
                  mapShift,
                  mapWMask,
                  mapHMask,
                  wrap
                )
              : nearestH;
            if (countIter) {
              sampleN[localI] = (sampleN[localI] + 1) | 0;
            }
            const gap = wz - hFine * altScale;
            if (gap > 0) {
              let skip = skipTexel | 0;
              if (canRise) {
                const s2 = Math.ceil(gap * invCloseRate) | 0;
                if ((s2 > skip) | 0) {
                  skip = s2;
                }
              }
              if ((skip < 1) | 0) {
                skip = 1;
              }
              r = (r - skip) | 0;
              continue;
            }
            const hByte = doLerp ? heightByteFromFine(hFine) : nearestH;
            const col = shade(
              wx,
              wy,
              offset,
              hByte,
              z,
              fogT,
              fogWhite,
              applyFogT,
              useFine,
              localI
            );
            pixels[(r * stride + localI) | 0] = col;
            cover[cidx] = 1;
            if ((painted === 0) | 0) {
              firstColor = col;
            }
            painted = (painted + 1) | 0;
            if ((r + 1 === suffix) | 0) {
              suffix = r;
            } else {
              dirty[localI] = 1;
            }
            r = (r - 1) | 0;
          }
          if (painted) {
            freeN[localI] = (freeN[localI] - painted) | 0;
          }
          if ((suffix < seed) | 0) {
            if (wrap && ((wBot < hy) | 0)) {
              let f = (wBot * stride + localI) | 0;
              let ci = (wBot * localWidth + localI) | 0;
              for (let rr = wBot; (rr < hy) | 0; rr = (rr + 1) | 0) {
                if (!cover[ci]) {
                  pixels[f] = firstColor;
                  cover[ci] = 1;
                  freeN[localI] = (freeN[localI] - 1) | 0;
                }
                f = (f + stride) | 0;
                ci = (ci + localWidth) | 0;
              }
            }
            hiddenY[localI] = suffix;
          }
        }

        if (((hiddenY[localI] <= 0) | 0) | ((freeN[localI] <= 0) | 0)) {
          hiddenY[localI] = 0;
          liveCols = (liveCols - 1) | 0;
        }

        wxBase += colStepX;
        wyBase += colStepY;
        wzBase += colStepZ;
      }

      z = z + step;
      step += stepGrowth;
    }
  }
}
