"use strict";

import { Color } from "../math/color.js";
import ColorPalette from "../math/colorPalette.js";
import {
  SKY_PALETTE_STEPS,
  skyPaletteT,
} from "../constants/framebuffer.js";
import { EPSILON, HALF, TWO_PI } from "../constants/vmath.js";
import {
  GROUND_CLIP_OFFSET,
  GROUND_HEIGHT,
  HEIGHTMAP_MAX,
} from "../constants/terrain.js";
import {
  INITIAL_STEP_SCALE_BY_QUALITY,
  MIN_SAMPLE_DISTANCE,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "../constants/quality.js";
import {
  FAR_PLANE_T_SCALE,
  PANO_MIP_COUNT,
  PANO_MIP_INV_SCALE,
  PANO_MIP_STEP_MAX_BY_QUALITY,
  PANO_MIP_STEP_SCALE,
  PANO_MIP_T_FRACTIONS_BY_QUALITY,
  PANO_YHIT_LUT_SIZE,
  PANO_YHIT_SLOPE_INF,
} from "../constants/panorama.js";

const tanMinCache = new Map();
const yHitLutCache = new Map();
const yHitLutSinCache = new Map();
const mipSwitchT = new Float64Array(PANO_MIP_COUNT);
const mipInvScale = new Float64Array(PANO_MIP_COUNT);
const mipWMaskScratch = new Int32Array(PANO_MIP_COUNT);
const mipHMaskScratch = new Int32Array(PANO_MIP_COUNT);
const yHitLutLast = (PANO_YHIT_LUT_SIZE - 1) | 0;
const yHitLutScale = PANO_YHIT_LUT_SIZE * HALF;

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

function boxPacked4(c00, c10, c01, c11) {
  const mask = 0x00ff00ff;
  const rb =
    (((c00 & mask) + (c10 & mask) + (c01 & mask) + (c11 & mask)) >>> 2) &
    mask;
  const ag =
    ((((c00 >>> 8) & mask) +
      ((c10 >>> 8) & mask) +
      ((c01 >>> 8) & mask) +
      ((c11 >>> 8) & mask)) >>>
      2) &
    mask;
  return ((ag << 8) | rb) >>> 0;
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
  const ix = Math.floor(x) | 0;
  const iy = Math.floor(y) | 0;
  return boxPacked4(
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
    )
  );
}

function heightByteFromFine(hFine) {
  let b = (hFine + 0.5) | 0;
  if ((b < 0) | 0) b = 0;
  if ((b > 255) | 0) b = 255;
  return b;
}

export function buildTanMinLut(height) {
  let lut = tanMinCache.get(height);
  if (lut) {
    return lut;
  }
  lut = new Float64Array(height);
  for (let H = 1; (H < height) | 0; H = (H + 1) | 0) {
    lut[H] = Math.tan(Math.PI * (HALF - H / height));
  }
  tanMinCache.set(height, lut);
  return lut;
}

function yHitFromSlope(s, lut, height) {
  const last = (height - 1) | 0;
  if ((last <= 0) | 0) {
    return 0;
  }
  if (s > lut[1]) {
    return 0;
  }
  if (s <= lut[last]) {
    return last;
  }
  let lo = 1;
  let hi = last;
  while ((lo < hi) | 0) {
    const mid = ((lo + hi + 1) >> 1) | 0;
    if (lut[mid] >= s) {
      lo = mid;
    } else {
      hi = (mid - 1) | 0;
    }
  }
  return lo;
}

function buildYHitLut(height, tanMin) {
  let table = yHitLutCache.get(height);
  if (table) {
    return table;
  }
  table = new Int16Array(PANO_YHIT_LUT_SIZE);
  for (let i = 0; (i < PANO_YHIT_LUT_SIZE) | 0; i = (i + 1) | 0) {
    const sHat = (i + HALF) / yHitLutScale - 1;
    const absHat = sHat < 0 ? -sHat : sHat;
    const denom = 1 - absHat;
    const s =
      denom > EPSILON
        ? sHat / denom
        : sHat < 0
          ? -PANO_YHIT_SLOPE_INF
          : PANO_YHIT_SLOPE_INF;
    table[i] = yHitFromSlope(s, tanMin, height);
  }
  yHitLutCache.set(height, table);
  return table;
}

export function getPanoYHitLut(height) {
  return buildYHitLut(height, buildTanMinLut(height));
}

function buildYHitLutSin(height, tanMin) {
  let table = yHitLutSinCache.get(height);
  if (table) {
    return table;
  }
  table = new Int16Array(PANO_YHIT_LUT_SIZE);
  for (let i = 0; (i < PANO_YHIT_LUT_SIZE) | 0; i = (i + 1) | 0) {
    const sinPhi = (i + HALF) / yHitLutScale - 1;
    const cos2 = 1 - sinPhi * sinPhi;
    const cosPhi = cos2 > 0 ? Math.sqrt(cos2) : 0;
    const s =
      cosPhi > EPSILON
        ? sinPhi / cosPhi
        : sinPhi < 0
          ? -PANO_YHIT_SLOPE_INF
          : PANO_YHIT_SLOPE_INF;
    table[i] = yHitFromSlope(s, tanMin, height);
  }
  yHitLutSinCache.set(height, table);
  return table;
}

export function getPanoYHitLutSin(height) {
  return buildYHitLutSin(height, buildTanMinLut(height));
}

export function panoYHitFromHat(sHat, table) {
  let idx = ((sHat + 1) * yHitLutScale) | 0;
  if ((idx < 0) | 0) idx = 0;
  if ((idx > yHitLutLast) | 0) idx = yHitLutLast;
  return table[idx];
}

function fillSkySlice(
  pixels,
  localWidth,
  height,
  skyColor,
  horizonColor,
  heightBuf,
  iterBuf
) {
  const palette = new ColorPalette(
    skyColor ?? Color.WHITE,
    horizonColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );
  const h2 = height * HALF;
  const n = (localWidth * height) | 0;
  for (let y = 0; (y < height) | 0; y = (y + 1) | 0) {
    const color = palette.getColor(skyPaletteT(y / h2));
    const row = (y * localWidth) | 0;
    for (let x = 0; (x < localWidth) | 0; x = (x + 1) | 0) {
      pixels[row + x] = color;
    }
  }
  if (heightBuf) {
    heightBuf.fill(0, 0, n);
  }
  if (iterBuf) {
    iterBuf.fill(0, 0, n);
  }
}

export function renderPanoramaColumns({
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
  width,
  height,
  startPx,
  endPx,
  farClip,
  nearClip,
  repeat,
  skyColor,
  horizonColor,
  initialStep,
  quality,
  interpolateHeight,
  filterColor,
  pixels,
  horizon,
  depth,
  heightBuf,
  iterBuf,
  tMax,
  tanMin,
  panoMips,
}) {
  const localWidth = (endPx - startPx) | 0;
  fillSkySlice(
    pixels,
    localWidth,
    height,
    skyColor,
    horizonColor,
    heightBuf,
    iterBuf
  );
  if (depth) {
    depth.fill(0);
  }

  const lut = tanMin || buildTanMinLut(height);
  const yHitLut = buildYHitLut(height, lut);
  const q = qualityIndex(quality);
  const stepGrowth = STEP_GROWTH_BY_QUALITY[q];
  const mipStepMax = PANO_MIP_STEP_MAX_BY_QUALITY[q];
  const mipTFractions = PANO_MIP_T_FRACTIONS_BY_QUALITY[q];
  let step0 = initialStep * INITIAL_STEP_SCALE_BY_QUALITY[q];
  if ((step0 <= 0) | 0) step0 = MIN_SAMPLE_DISTANCE;
  const lastRow = (height - 1) | 0;
  const tanLast = lut[lastRow];
  const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
  let t0 = Math.max(nearClip, step0, MIN_SAMPLE_DISTANCE);
  if ((camZ > clipZ) & (tanLast < 0)) {
    const tGroundPole = (clipZ - camZ) / tanLast;
    if ((tGroundPole > 0) & (tGroundPole < t0)) {
      t0 = nearClip > tGroundPole ? nearClip : tGroundPole;
    }
  }
  let tStop = tMax;
  if (!(tStop > 0)) {
    tStop = farClip * FAR_PLANE_T_SCALE;
  }

  const mipHeightMaps = panoMips ? panoMips.heightMaps : [heightMap];
  const mipColorMaps = panoMips ? panoMips.colorMaps : [colorMap];
  const mipWidths = panoMips ? panoMips.widths : [mapW];
  const mipHeights = panoMips ? panoMips.heights : [mapH];
  const mipShifts = panoMips ? panoMips.shifts : [mapShift];
  let mipCount = panoMips && panoMips.count ? panoMips.count | 0 : 1;
  if ((mipCount < 1) | 0) mipCount = 1;
  if ((mipCount > PANO_MIP_COUNT) | 0) mipCount = PANO_MIP_COUNT;
  const lastMip = (mipCount - 1) | 0;
  const fracN = mipTFractions.length;
  const stepCap0 = mipStepMax[0] < step0 ? step0 : mipStepMax[0];
  const stepCap1 = mipStepMax[1] < step0 ? step0 : mipStepMax[1];
  const stepCap2 = mipStepMax[2] < step0 ? step0 : mipStepMax[2];
  for (let m = 0; (m < PANO_MIP_COUNT) | 0; m = (m + 1) | 0) {
    mipInvScale[m] = PANO_MIP_INV_SCALE[m];
    if ((m < fracN) | 0) {
      mipSwitchT[m] = farClip * mipTFractions[m];
    }
  }

  const dTheta = TWO_PI / width;
  const rotC = Math.cos(dTheta);
  const rotS = Math.sin(dTheta);
  const altScale = altitude / HEIGHTMAP_MAX;
  const lerpH = interpolateHeight | 0;
  const filterC = filterColor | 0;
  const wrap = repeat | 0;
  const ceiling = maxHeight == null ? altitude : maxHeight;
  const dhGround = clipZ - camZ;
  const absGround = dhGround < 0 ? -dhGround : dhGround;
  const theta0 = ((startPx + HALF) / width) * TWO_PI;
  let dirX = -Math.sin(theta0);
  let dirY = -Math.cos(theta0);
  const mipWMask = mipWMaskScratch;
  const mipHMask = mipHMaskScratch;
  for (let m = 0; (m < mipCount) | 0; m = (m + 1) | 0) {
    mipWMask[m] = (mipWidths[m] - 1) | 0;
    mipHMask[m] = (mipHeights[m] - 1) | 0;
  }

  for (let px = startPx; (px < endPx) | 0; px = (px + 1) | 0) {
    const localX = (px - startPx) | 0;
    let H = height;
    horizon[localX] = H;

    let t = t0;
    let step = step0;
    let wasInside = 0;
    let mip = 0;
    let stepCap = stepCap0;
    let tStopCol = tStop;
    let k = 0;

    while ((t < tStopCol) & (k < 16384)) {
      k = (k + 1) | 0;
      if (H === 0) {
        break;
      }

      while (((mip < lastMip) | 0) && t >= mipSwitchT[mip]) {
        mip = (mip + 1) | 0;
        step *= PANO_MIP_STEP_SCALE;
        stepCap = mip === 1 ? stepCap1 : stepCap2;
        if (step > stepCap) step = stepCap;
      }

      const sealed = (H !== height) | 0;
      const tanH = sealed ? lut[H] : 0;
      if (sealed) {
        const zRay = camZ + t * tanH;
        if (tanH >= 0) {
          if (ceiling < zRay - EPSILON) {
            break;
          }
          if (tanH > EPSILON) {
            const tCeil = (ceiling - camZ) / tanH;
            if (tCeil < tStopCol) tStopCol = tCeil;
            if (t >= tStopCol) {
              break;
            }
          } else if (ceiling < camZ - EPSILON) {
            break;
          }
        } else if (zRay > ceiling + EPSILON) {
          const tEnter = (ceiling - camZ) / tanH;
          if (tEnter >= tStopCol) {
            break;
          }
          if (tEnter > t + EPSILON) {
            t = tEnter;
            continue;
          }
        }
      }

      const wx = camX + dirX * t;
      const wy = camY + dirY * t;

      if (!repeat) {
        const inside =
          ((wx >= 0) | 0) &
          ((wx < mapW) | 0) &
          ((wy >= 0) | 0) &
          ((wy < mapH) | 0);
        if (!inside) {
          if (wasInside) {
            break;
          }
          t += step;
          step += stepGrowth;
          if (step > stepCap) step = stepCap;
          continue;
        }
        wasInside = 1;
      }

      const inv = mipInvScale[mip];
      const sx = wx * inv;
      const sy = wy * inv;
      const doLerp = lerpH & ((mip | 0) === 0);
      const doFilter = filterC & ((mip | 0) === 0);
      const shift = mipShifts[mip];
      const wMask = mipWMask[mip];
      const hMask = mipHMask[mip];
      const hm = mipHeightMaps[mip];
      const offset =
        ((((sy | 0) & wMask) << shift) + ((sx | 0) & hMask)) | 0;
      const nearestH = hm[offset];
      const hFine = doLerp
        ? sampleHeightBilinear(hm, sx, sy, shift, wMask, hMask, wrap)
        : nearestH;
      const h = hFine * altScale;

      if (sealed && h < camZ + t * tanH - EPSILON) {
        t += step;
        step += stepGrowth;
        if (step > stepCap) step = stepCap;
        continue;
      }

      const dh = h - camZ;
      const absS = dh < 0 ? -dh : dh;
      const sHat = dh / (t + absS);
      let idx = ((sHat + 1) * yHitLutScale) | 0;
      if ((idx < 0) | 0) idx = 0;
      if ((idx > yHitLutLast) | 0) idx = yHitLutLast;
      let yHit = yHitLut[idx];
      if ((yHit < 0) | 0) yHit = 0;
      if ((yHit >= height) | 0) yHit = (height - 1) | 0;

      if ((yHit < H) | 0) {
        let yBottom = H;
        const tanG = dhGround / t;
        let yGround;
        if (tanG > tanLast) {
          const sHatG = dhGround / (t + absGround);
          let gIdx = ((sHatG + 1) * yHitLutScale) | 0;
          if ((gIdx < 0) | 0) gIdx = 0;
          if ((gIdx > yHitLutLast) | 0) gIdx = yHitLutLast;
          yGround = yHitLut[gIdx];
        } else {
          yGround = height;
        }
        if ((yGround < yBottom) | 0) yBottom = yGround;
        if ((yHit < yBottom) | 0) {
          const color = doFilter
            ? sampleColorFiltered(
                mipColorMaps[mip],
                sx,
                sy,
                shift,
                wMask,
                hMask,
                wrap
              )
            : mipColorMaps[mip][offset];
          const dist = Math.sqrt(t * t + dh * dh);
          if (heightBuf || iterBuf) {
            const hByte = heightBuf
              ? doLerp
                ? heightByteFromFine(hFine)
                : nearestH
              : 0;
            for (let y = yHit; (y < yBottom) | 0; y = (y + 1) | 0) {
              const pix = (y * localWidth + localX) | 0;
              pixels[pix] = color;
              if (depth) {
                depth[pix] = dist;
              }
              if (heightBuf) {
                heightBuf[pix] = hByte;
              }
              if (iterBuf) {
                iterBuf[pix] = k;
              }
            }
          } else {
            for (let y = yHit; (y < yBottom) | 0; y = (y + 1) | 0) {
              const pix = (y * localWidth + localX) | 0;
              pixels[pix] = color;
              if (depth) {
                depth[pix] = dist;
              }
            }
          }
        }
        H = yHit;
        horizon[localX] = H;
      }

      t += step;
      step += stepGrowth;
      if (step > stepCap) step = stepCap;
    }

    const nextX = dirX * rotC + dirY * rotS;
    const nextY = dirY * rotC - dirX * rotS;
    dirX = nextX;
    dirY = nextY;
  }

  return pixels;
}
