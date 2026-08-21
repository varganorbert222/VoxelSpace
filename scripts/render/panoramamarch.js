"use strict";

import { Color } from "../math/color.js";
import ColorPalette from "../math/colorPalette.js";
import { mapOffsetAt } from "../terrain/mapOffset.js";
import {
  SKY_PALETTE_STEPS,
  skyPaletteT,
} from "../constants/framebuffer.js";
import { EPSILON, HALF, TWO_PI } from "../constants/vmath.js";
import { HEIGHTMAP_MAX } from "../constants/terrain.js";
import {
  INITIAL_STEP_SCALE_BY_QUALITY,
  MIN_SAMPLE_DISTANCE,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "../constants/quality.js";
import {
  FAR_PLANE_T_SCALE,
  PANO_DIR_RESYNC,
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
const mipSwitchT = new Float64Array(PANO_MIP_COUNT);
const mipInvScale = new Float64Array(PANO_MIP_COUNT);
const yHitLutLast = (PANO_YHIT_LUT_SIZE - 1) | 0;
const yHitLutScale = PANO_YHIT_LUT_SIZE * HALF;

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

export function panoYHitFromHat(sHat, table) {
  let idx = ((sHat + 1) * yHitLutScale) | 0;
  if ((idx < 0) | 0) idx = 0;
  if ((idx > yHitLutLast) | 0) idx = yHitLutLast;
  return table[idx];
}

function fillSkySlice(pixels, localWidth, height, skyColor) {
  const palette = new ColorPalette(skyColor, Color.WHITE, SKY_PALETTE_STEPS);
  const h2 = height * HALF;
  for (let y = 0; (y < height) | 0; y = (y + 1) | 0) {
    const color = palette.getColor(skyPaletteT(y / h2));
    const row = (y * localWidth) | 0;
    for (let x = 0; (x < localWidth) | 0; x = (x + 1) | 0) {
      pixels[row + x] = color;
    }
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
  initialStep,
  quality,
  pixels,
  horizon,
  depth,
  tMax,
  tanMin,
  panoMips,
}) {
  const localWidth = (endPx - startPx) | 0;
  fillSkySlice(pixels, localWidth, height, skyColor);
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
  const t0 = Math.max(nearClip, step0, MIN_SAMPLE_DISTANCE);
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
  const ceiling = maxHeight == null ? altitude : maxHeight;
  let dirX = 0;
  let dirY = 0;

  for (let px = startPx; (px < endPx) | 0; px = (px + 1) | 0) {
    const localX = (px - startPx) | 0;
    if ((((px - startPx) | 0) % PANO_DIR_RESYNC) === 0) {
      const theta = ((px + HALF) / width) * TWO_PI;
      dirX = -Math.sin(theta);
      dirY = -Math.cos(theta);
    } else {
      const nextX = dirX * rotC + dirY * rotS;
      const nextY = dirY * rotC - dirX * rotS;
      dirX = nextX;
      dirY = nextY;
    }
    let H = height;
    horizon[localX] = H;

    let t = t0;
    let step = step0;
    let wasInside = 0;
    let mip = 0;
    let stepCap = stepCap0;
    let tStopCol = tStop;

    while (t < tStopCol) {
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
      const offset = mapOffsetAt(
        wx * inv,
        wy * inv,
        mipWidths[mip],
        mipHeights[mip],
        mipShifts[mip]
      );
      const h = mipHeightMaps[mip][offset] * altScale;

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
        const color = mipColorMaps[mip][offset];
        const dist = Math.hypot(t, dh);
        for (let y = yHit; (y < H) | 0; y = (y + 1) | 0) {
          const pix = (y * localWidth + localX) | 0;
          pixels[pix] = color;
          if (depth) {
            depth[pix] = dist;
          }
        }
        H = yHit;
        horizon[localX] = H;
      }

      t += step;
      step += stepGrowth;
      if (step > stepCap) step = stepCap;
    }
  }

  return pixels;
}
