"use strict";

import { Color } from "../math/color.js";
import ColorPalette from "../math/colorPalette.js";
import {
  SKY_PALETTE_STEPS,
  skyPaletteT,
  skyLinearFromHat,
} from "../constants/framebuffer.js";
import { EPSILON, HALF, TWO_PI } from "../constants/vmath.js";
import {
  FILTER_DISTANCE_DEFAULT,
  xyClipDistance,
} from "../constants/sampling.js";
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
} from "../constants/panorama.js";
import {
  CUBE_FACE_C,
  CUBE_FACE_NZ,
  CUBE_FACE_PZ,
  CUBE_FACE_U,
  CUBE_HORIZON_FACES,
  cubeDirFromTexelInto,
  cubeFaceOffset,
  cubePixelUV,
  cubeUVToTexelInto,
} from "../constants/cubemap.js";

const mipSwitchT = new Float64Array(PANO_MIP_COUNT);
const mipInvScale = new Float64Array(PANO_MIP_COUNT);
const mipWMaskScratch = new Int32Array(PANO_MIP_COUNT);
const mipHMaskScratch = new Int32Array(PANO_MIP_COUNT);
const skyDirScratch = { x: 0, y: 0, z: 0 };
const polarTexel0 = { i: 0, j: 0 };
const polarTexel1 = { i: 0, j: 0 };
const HAT_LUT_LAST = 256;
let skyLutCache = null;
let skyLutSky = 0;
let skyLutHorizon = 0;
let hatIndexCacheN = 0;
let hatIndexCache = null;

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

function skyPalette(skyColor, horizonColor) {
  return new ColorPalette(
    skyColor ?? Color.WHITE,
    horizonColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );
}

function skyHatLut(skyColor, horizonColor) {
  const sky = skyColor ?? Color.WHITE;
  const horizon = horizonColor ?? Color.WHITE;
  if (skyLutCache && skyLutSky === sky && skyLutHorizon === horizon) {
    return skyLutCache;
  }
  const palette = skyPalette(sky, horizon);
  const lut = new Uint32Array(HAT_LUT_LAST + 1);
  for (let i = 0; (i <= HAT_LUT_LAST) | 0; i = (i + 1) | 0) {
    const hat = i / (HAT_LUT_LAST * HALF) - 1;
    lut[i] = palette.getColor(skyPaletteT(skyLinearFromHat(hat)));
  }
  skyLutSky = sky;
  skyLutHorizon = horizon;
  skyLutCache = lut;
  return lut;
}

function hatIndicesForSize(n) {
  if (hatIndexCache && hatIndexCacheN === n) {
    return hatIndexCache;
  }
  const count = (6 * n * n) | 0;
  const table = new Uint16Array(count);
  const dir = skyDirScratch;
  const scale = HAT_LUT_LAST * HALF;
  for (let face = 0; (face < 6) | 0; face = (face + 1) | 0) {
    const faceOff = cubeFaceOffset(face, n);
    for (let j = 0; (j < n) | 0; j = (j + 1) | 0) {
      const row = (faceOff + j * n) | 0;
      for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
        cubeDirFromTexelInto(face, i, j, n, dir);
        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        const hat = len > EPSILON ? dir.z / len : 0;
        let idx = ((hat + 1) * scale) | 0;
        if ((idx < 0) | 0) idx = 0;
        if ((idx > HAT_LUT_LAST) | 0) idx = HAT_LUT_LAST;
        table[row + i] = idx;
      }
    }
  }
  hatIndexCacheN = n;
  hatIndexCache = table;
  return table;
}

function fillCubeFaceSky(
  pixels,
  depth,
  heightBuf,
  iterBuf,
  face,
  n,
  skyColor,
  horizonColor,
  startCol,
  endCol,
  faceOff
) {
  const off = faceOff == null ? cubeFaceOffset(face, n) : faceOff;
  const hatOff = cubeFaceOffset(face, n);
  const x0 = startCol | 0;
  const x1 = endCol == null ? n : endCol | 0;
  const lut = skyHatLut(skyColor, horizonColor);
  const hats = hatIndicesForSize(n);
  if (depth) {
    if ((x0 === 0) & (x1 === n)) {
      depth.fill(0, off, off + n * n);
    } else {
      for (let j = 0; (j < n) | 0; j = (j + 1) | 0) {
        depth.fill(0, off + j * n + x0, off + j * n + x1);
      }
    }
  }
  if (heightBuf) {
    if ((x0 === 0) & (x1 === n)) {
      heightBuf.fill(0, off, off + n * n);
    } else {
      for (let j = 0; (j < n) | 0; j = (j + 1) | 0) {
        heightBuf.fill(0, off + j * n + x0, off + j * n + x1);
      }
    }
  }
  if (iterBuf) {
    if ((x0 === 0) & (x1 === n)) {
      iterBuf.fill(0, off, off + n * n);
    } else {
      for (let j = 0; (j < n) | 0; j = (j + 1) | 0) {
        iterBuf.fill(0, off + j * n + x0, off + j * n + x1);
      }
    }
  }
  for (let j = 0; (j < n) | 0; j = (j + 1) | 0) {
    const row = (off + j * n) | 0;
    const hatRow = (hatOff + j * n) | 0;
    for (let i = x0; (i < x1) | 0; i = (i + 1) | 0) {
      pixels[row + i] = lut[hats[hatRow + i]];
    }
  }
}

export function fillCubePolarSky(
  pixels,
  depth,
  heightBuf,
  iterBuf,
  n,
  skyColor,
  horizonColor
) {
  fillCubeFaceSky(
    pixels,
    depth,
    heightBuf,
    iterBuf,
    CUBE_FACE_PZ,
    n,
    skyColor,
    horizonColor,
    0,
    n
  );
  fillCubeFaceSky(
    pixels,
    depth,
    heightBuf,
    iterBuf,
    CUBE_FACE_NZ,
    n,
    skyColor,
    horizonColor,
    0,
    n
  );
}

export function mergeCubePolarSlice(
  pixels,
  depth,
  heightBuf,
  iterBuf,
  slicePixels,
  sliceDepth,
  sliceHeight,
  sliceIter,
  off,
  count
) {
  for (let i = 0; (i < count) | 0; i = (i + 1) | 0) {
    const d = sliceDepth[i];
    if (!(d > 0)) {
      continue;
    }
    const dst = (off + i) | 0;
    const prev = depth[dst];
    if ((prev <= 0) | (d < prev)) {
      pixels[dst] = slicePixels[i];
      depth[dst] = d;
      if (heightBuf && sliceHeight) {
        heightBuf[dst] = sliceHeight[i];
      }
      if (iterBuf && sliceIter) {
        iterBuf[dst] = sliceIter[i];
      }
    }
  }
}

function setupMips(quality, farClip, panoMips, heightMap, colorMap, mapW, mapH, mapShift) {
  const q = qualityIndex(quality);
  const stepGrowth = STEP_GROWTH_BY_QUALITY[q];
  const mipStepMax = PANO_MIP_STEP_MAX_BY_QUALITY[q];
  const mipTFractions = PANO_MIP_T_FRACTIONS_BY_QUALITY[q];
  const mipHeightMaps = panoMips ? panoMips.heightMaps : [heightMap];
  const mipColorMaps = panoMips ? panoMips.colorMaps : [colorMap];
  const mipWidths = panoMips ? panoMips.widths : [mapW];
  const mipHeights = panoMips ? panoMips.heights : [mapH];
  const mipShifts =
    panoMips && panoMips.shifts
      ? panoMips.shifts
      : [mapShift, mapShift, mapShift];
  let mipCount = panoMips && panoMips.count ? panoMips.count | 0 : 1;
  if ((mipCount < 1) | 0) mipCount = 1;
  if ((mipCount > PANO_MIP_COUNT) | 0) mipCount = PANO_MIP_COUNT;
  const lastMip = (mipCount - 1) | 0;
  const fracN = mipTFractions.length;
  for (let m = 0; (m < PANO_MIP_COUNT) | 0; m = (m + 1) | 0) {
    mipInvScale[m] = PANO_MIP_INV_SCALE[m];
    if ((m < fracN) | 0) {
      mipSwitchT[m] = farClip * mipTFractions[m];
    }
  }
  const mipWMask = mipWMaskScratch;
  const mipHMask = mipHMaskScratch;
  for (let m = 0; (m < mipCount) | 0; m = (m + 1) | 0) {
    mipWMask[m] = (mipWidths[m] - 1) | 0;
    mipHMask[m] = (mipHeights[m] - 1) | 0;
  }
  return {
    q,
    stepGrowth,
    mipStepMax,
    mipHeightMaps,
    mipColorMaps,
    mipCount,
    lastMip,
    mipWMask,
    mipHMask,
    mipShifts,
  };
}

const svHit = { offset: 0, hFine: 0, hByte: 0, sx: 0, sy: 0 };

function sampleCubeHeight(m, wx, wy, mip, wrap, lerp) {
  const inv = mipInvScale[mip];
  const sx = wx * inv;
  const sy = wy * inv;
  const doLerp = lerp & ((mip | 0) === 0);
  const shift = m.mipShifts[mip];
  const wMask = m.mipWMask[mip];
  const hMask = m.mipHMask[mip];
  const hm = m.mipHeightMaps[mip];
  const offset = ((((sy | 0) & wMask) << shift) + ((sx | 0) & hMask)) | 0;
  const nearestH = hm[offset];
  svHit.sx = sx;
  svHit.sy = sy;
  svHit.offset = offset;
  if (doLerp) {
    svHit.hFine = sampleHeightBilinear(hm, sx, sy, shift, wMask, hMask, wrap);
    svHit.hByte = heightByteFromFine(svHit.hFine);
  } else {
    svHit.hFine = nearestH;
    svHit.hByte = nearestH;
  }
}

function sampleCubeColor(m, mip, wrap, filter) {
  const doFilter = filter & ((mip | 0) === 0);
  if (!doFilter) {
    return m.mipColorMaps[mip][svHit.offset];
  }
  return sampleColorFiltered(
    m.mipColorMaps[mip],
    svHit.sx,
    svHit.sy,
    m.mipShifts[mip],
    m.mipWMask[mip],
    m.mipHMask[mip],
    wrap
  );
}

function plotPolarTexel(pixels, depth, n, faceOff, i, j, color, dist) {
  const last = (n - 1) | 0;
  let ii = i | 0;
  let jj = j | 0;
  if ((ii < 0) | 0) ii = 0;
  if ((ii > last) | 0) ii = last;
  if ((jj < 0) | 0) jj = 0;
  if ((jj > last) | 0) jj = last;
  const i1 = ii >= last ? last : (ii + 1) | 0;
  const j1 = jj >= last ? last : (jj + 1) | 0;
  for (let y = jj; (y <= j1) | 0; y = (y + 1) | 0) {
    const row = (faceOff + y * n) | 0;
    for (let x = ii; (x <= i1) | 0; x = (x + 1) | 0) {
      const idx = (row + x) | 0;
      const prev = depth[idx];
      if ((prev <= 0) | (dist < prev)) {
        pixels[idx] = color;
        depth[idx] = dist;
      }
    }
  }
}

function plotPolarTexelDebug(
  pixels,
  depth,
  heightBuf,
  iterBuf,
  n,
  faceOff,
  i,
  j,
  color,
  dist,
  hByte,
  iter
) {
  const last = (n - 1) | 0;
  let ii = i | 0;
  let jj = j | 0;
  if ((ii < 0) | 0) ii = 0;
  if ((ii > last) | 0) ii = last;
  if ((jj < 0) | 0) jj = 0;
  if ((jj > last) | 0) jj = last;
  const i1 = ii >= last ? last : (ii + 1) | 0;
  const j1 = jj >= last ? last : (jj + 1) | 0;
  for (let y = jj; (y <= j1) | 0; y = (y + 1) | 0) {
    const row = (faceOff + y * n) | 0;
    for (let x = ii; (x <= i1) | 0; x = (x + 1) | 0) {
      const idx = (row + x) | 0;
      const prev = depth[idx];
      if ((prev <= 0) | (dist < prev)) {
        pixels[idx] = color;
        depth[idx] = dist;
        if (heightBuf) {
          heightBuf[idx] = hByte;
        }
        if (iterBuf) {
          iterBuf[idx] = iter;
        }
      }
    }
  }
}

function fillPolarRadial(
  pixels,
  depth,
  heightBuf,
  iterBuf,
  n,
  faceOff,
  su,
  sv,
  r0,
  r1,
  color,
  dist,
  hByte,
  iter
) {
  const absU = su < 0 ? -su : su;
  const absV = sv < 0 ? -sv : sv;
  const rMax = 1 / (absU > absV ? absU : absV > EPSILON ? absV : EPSILON);
  let a = r0 < 0 ? 0 : r0;
  let b = r1;
  if (b > rMax) b = rMax;
  if (!(b > a)) {
    return;
  }
  cubeUVToTexelInto(su * a, sv * a, n, polarTexel0);
  cubeUVToTexelInto(su * b, sv * b, n, polarTexel1);
  let x0 = polarTexel0.i | 0;
  let y0 = polarTexel0.j | 0;
  const x1 = polarTexel1.i | 0;
  const y1 = polarTexel1.j | 0;
  const dx = x1 > x0 ? (x1 - x0) | 0 : (x0 - x1) | 0;
  const dy = y1 > y0 ? (y1 - y0) | 0 : (y0 - y1) | 0;
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = (dx - dy) | 0;
  if (heightBuf || iterBuf) {
    for (let guard = 0; (guard < 2048) | 0; guard = (guard + 1) | 0) {
      plotPolarTexelDebug(
        pixels,
        depth,
        heightBuf,
        iterBuf,
        n,
        faceOff,
        x0,
        y0,
        color,
        dist,
        hByte,
        iter
      );
      if (((x0 === x1) | 0) & ((y0 === y1) | 0)) {
        break;
      }
      const e2 = (err << 1) | 0;
      if ((e2 > -dy) | 0) {
        err = (err - dy) | 0;
        x0 = (x0 + sx) | 0;
      }
      if ((e2 < dx) | 0) {
        err = (err + dx) | 0;
        y0 = (y0 + sy) | 0;
      }
    }
    return;
  }
  for (let guard = 0; (guard < 2048) | 0; guard = (guard + 1) | 0) {
    plotPolarTexel(pixels, depth, n, faceOff, x0, y0, color, dist);
    if (((x0 === x1) | 0) & ((y0 === y1) | 0)) {
      break;
    }
    const e2 = (err << 1) | 0;
    if ((e2 > -dy) | 0) {
      err = (err - dy) | 0;
      x0 = (x0 + sx) | 0;
    }
    if ((e2 < dx) | 0) {
      err = (err + dx) | 0;
      y0 = (y0 + sy) | 0;
    }
  }
}

export function renderCubemapHorizonColumns({
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
  face,
  n,
  startCol,
  endCol,
  farClip,
  nearClip,
  repeat,
  skyColor,
  horizonColor,
  initialStep,
  quality,
  interpolateHeight,
  filterColor,
  filterDistance = FILTER_DISTANCE_DEFAULT,
  fwdX = 0,
  fwdY = -1,
  pixels,
  depth,
  heightBuf,
  iterBuf,
  tMax,
  panoMips,
  faceOff: faceOffArg,
}) {
  const m = setupMips(
    quality,
    farClip,
    panoMips,
    heightMap,
    colorMap,
    mapW,
    mapH,
    mapShift
  );
  let step0 = initialStep * INITIAL_STEP_SCALE_BY_QUALITY[m.q];
  if ((step0 <= 0) | 0) step0 = MIN_SAMPLE_DISTANCE;
  const stepCap0 = m.mipStepMax[0] < step0 ? step0 : m.mipStepMax[0];
  const stepCap1 = m.mipStepMax[1] < step0 ? step0 : m.mipStepMax[1];
  const stepCap2 = m.mipStepMax[2] < step0 ? step0 : m.mipStepMax[2];
  const lastRow = (n - 1) | 0;
  const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
  const t0 = Math.max(nearClip, step0, MIN_SAMPLE_DISTANCE);
  let tStop = tMax;
  if (!(tStop > 0)) {
    tStop = farClip * FAR_PLANE_T_SCALE;
  }
  const altScale = altitude / HEIGHTMAP_MAX;
  const lerpH = interpolateHeight | 0;
  const filterC = filterColor | 0;
  const wrap = repeat | 0;
  const cx = CUBE_FACE_C[face][0];
  const cy = CUBE_FACE_C[face][1];
  const ux = CUBE_FACE_U[face][0];
  const uy = CUBE_FACE_U[face][1];
  const faceOff = faceOffArg == null ? cubeFaceOffset(face, n) : faceOffArg | 0;
  const halfN = n * HALF;

  fillCubeFaceSky(
    pixels,
    depth,
    heightBuf,
    iterBuf,
    face,
    n,
    skyColor,
    horizonColor,
    startCol,
    endCol,
    faceOff
  );

  for (let col = startCol; (col < endCol) | 0; col = (col + 1) | 0) {
    const u = cubePixelUV(col, n);
    const dirXRaw = cx + u * ux;
    const dirYRaw = cy + u * uy;
    const lenXY = Math.hypot(dirXRaw, dirYRaw);
    const invLen = lenXY > EPSILON ? 1 / lenXY : 1;
    const dirX = dirXRaw * invLen;
    const dirY = dirYRaw * invLen;
    const dst = halfN * lenXY;
    const horizon = halfN;
    let H = n;
    let t = t0;
    let step = step0;
    let wasInside = 0;
    let mip = 0;
    let stepCap = stepCap0;
    let tStopCol = tStop;
    let k = 0;

    while ((t < tStopCol) & (H > 0) & (k < 16384)) {
      k = (k + 1) | 0;
      while (((mip < m.lastMip) | 0) && t >= mipSwitchT[mip]) {
        mip = (mip + 1) | 0;
        step *= PANO_MIP_STEP_SCALE;
        stepCap = mip === 1 ? stepCap1 : stepCap2;
        if (step > stepCap) step = stepCap;
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
          step += m.stepGrowth;
          if (step > stepCap) step = stepCap;
          continue;
        }
        wasInside = 1;
      }

      const useFine =
        (xyClipDistance(t, dirX, dirY, fwdX, fwdY) <= filterDistance) | 0;
      sampleCubeHeight(m, wx, wy, mip, wrap, lerpH & useFine);
      const offset = svHit.offset;
      const h = svHit.hFine * altScale;

      const zScale = dst / t;
      let yHit = ((camZ - h) * zScale + horizon) | 0;
      if ((yHit < 0) | 0) yHit = 0;
      if ((yHit > lastRow) | 0) {
        t += step;
        step += m.stepGrowth;
        if (step > stepCap) step = stepCap;
        continue;
      }

      if ((yHit < H) | 0) {
        let yBottom = H;
        const yGround = ((camZ - clipZ) * zScale + horizon) | 0;
        if ((yGround < yBottom) | 0) yBottom = yGround < 0 ? 0 : yGround;
        if ((yHit < yBottom) | 0) {
          const color = sampleCubeColor(m, mip, wrap, filterC & useFine);
          const dh = h - camZ;
          const dist = Math.sqrt(t * t + dh * dh);
          if (heightBuf || iterBuf) {
            const hByte = heightBuf ? svHit.hByte : 0;
            for (let y = yHit; (y < yBottom) | 0; y = (y + 1) | 0) {
              const pix = (faceOff + y * n + col) | 0;
              pixels[pix] = color;
              depth[pix] = dist;
              if (heightBuf) {
                heightBuf[pix] = hByte;
              }
              if (iterBuf) {
                iterBuf[pix] = k;
              }
            }
          } else {
            for (let y = yHit; (y < yBottom) | 0; y = (y + 1) | 0) {
              const pix = (faceOff + y * n + col) | 0;
              pixels[pix] = color;
              depth[pix] = dist;
            }
          }
        }
        H = yHit;
      }

      t += step;
      step += m.stepGrowth;
      if (step > stepCap) step = stepCap;
    }
  }
}

export function renderCubemapPolarAzimuths({
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
  n,
  startAz,
  endAz,
  azCount,
  farClip,
  nearClip,
  repeat,
  skyColor,
  horizonColor,
  initialStep,
  quality,
  interpolateHeight,
  filterColor,
  filterDistance = FILTER_DISTANCE_DEFAULT,
  fwdX = 0,
  fwdY = -1,
  pixels,
  depth,
  heightBuf,
  iterBuf,
  tMax,
  panoMips,
  fillSky,
  pzOff: pzOffArg,
  nzOff: nzOffArg,
}) {
  const pzOff = pzOffArg == null ? cubeFaceOffset(CUBE_FACE_PZ, n) : pzOffArg | 0;
  const nzOff = nzOffArg == null ? cubeFaceOffset(CUBE_FACE_NZ, n) : nzOffArg | 0;
  if (fillSky) {
    fillCubeFaceSky(
      pixels,
      depth,
      heightBuf,
      iterBuf,
      CUBE_FACE_PZ,
      n,
      skyColor,
      horizonColor,
      0,
      n,
      pzOff
    );
    fillCubeFaceSky(
      pixels,
      depth,
      heightBuf,
      iterBuf,
      CUBE_FACE_NZ,
      n,
      skyColor,
      horizonColor,
      0,
      n,
      nzOff
    );
  }
  const m = setupMips(
    quality,
    farClip,
    panoMips,
    heightMap,
    colorMap,
    mapW,
    mapH,
    mapShift
  );
  let step0 = initialStep * INITIAL_STEP_SCALE_BY_QUALITY[m.q];
  if ((step0 <= 0) | 0) step0 = MIN_SAMPLE_DISTANCE;
  const stepCap0 = m.mipStepMax[0] < step0 ? step0 : m.mipStepMax[0];
  const stepCap1 = m.mipStepMax[1] < step0 ? step0 : m.mipStepMax[1];
  const stepCap2 = m.mipStepMax[2] < step0 ? step0 : m.mipStepMax[2];
  const t0 = Math.max(nearClip, step0, MIN_SAMPLE_DISTANCE);
  let tStop = tMax;
  if (!(tStop > 0)) {
    tStop = farClip * FAR_PLANE_T_SCALE;
  }
  const altScale = altitude / HEIGHTMAP_MAX;
  const lerpH = interpolateHeight | 0;
  const filterC = filterColor | 0;
  const wrap = repeat | 0;
  const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
  const azN = azCount > 0 ? azCount : (n << 2);
  const nadirInside =
    (repeat | 0) |
    (((camX >= 0) | 0) &
      ((camX < mapW) | 0) &
      ((camY >= 0) | 0) &
      ((camY < mapH) | 0));
  const dTheta = TWO_PI / azN;
  const rotC = Math.cos(dTheta);
  const rotS = Math.sin(dTheta);
  const theta0 = ((startAz + HALF) / azN) * TWO_PI;
  let dirX = -Math.sin(theta0);
  let dirY = -Math.cos(theta0);
  for (let az = startAz; (az < endAz) | 0; az = (az + 1) | 0) {
    const absDX = dirX < 0 ? -dirX : dirX;
    const absDY = dirY < 0 ? -dirY : dirY;
    const rMaxSpoke =
      1 / (absDX > absDY ? absDX : absDY > EPSILON ? absDY : EPSILON);
    let rOuterUp = 2;
    let rInnerDown = nadirInside ? 0 : -1;
    let lastDownColor = 0;
    let lastDownDist = 0;
    let lastDownHeight = 0;
    let lastDownIter = 0;
    let t = t0;
    let step = step0;
    let wasInside = 0;
    let leftMap = 0;
    let mip = 0;
    let stepCap = stepCap0;
    let tStopCol = tStop;
    const tGroundRim = rMaxSpoke * (camZ - clipZ);
    if (tGroundRim > tStopCol) tStopCol = tGroundRim;
    let k = 0;

    while ((t < tStopCol) & (k < 16384)) {
      k = (k + 1) | 0;
      while (((mip < m.lastMip) | 0) && t >= mipSwitchT[mip]) {
        mip = (mip + 1) | 0;
        step *= PANO_MIP_STEP_SCALE;
        stepCap = mip === 1 ? stepCap1 : stepCap2;
        if (step > stepCap) step = stepCap;
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
            leftMap = 1;
            break;
          }
          t += step;
          step += m.stepGrowth;
          if (step > stepCap) step = stepCap;
          continue;
        }
        wasInside = 1;
      }

      const useFine =
        (xyClipDistance(t, dirX, dirY, fwdX, fwdY) <= filterDistance) | 0;
      sampleCubeHeight(m, wx, wy, mip, wrap, lerpH & useFine);
      const offset = svHit.offset;
      const h = svHit.hFine * altScale;

      const dh = h - camZ;
      const slope = dh / t;
      const color = sampleCubeColor(m, mip, wrap, filterC & useFine);
      const dist = Math.sqrt(t * t + dh * dh);
      const hByte = heightBuf ? svHit.hByte : 0;
      if (slope > EPSILON) {
        const r = 1 / slope;
        if (r < rOuterUp) {
          fillPolarRadial(
            pixels,
            depth,
            heightBuf,
            iterBuf,
            n,
            pzOff,
            dirX,
            dirY,
            r,
            rOuterUp,
            color,
            dist,
            hByte,
            k
          );
          rOuterUp = r;
        }
      } else if (slope < -EPSILON) {
        const rTop = -1 / slope;
        const groundDen = camZ - clipZ;
        const rBase = groundDen > EPSILON ? t / groundDen : rMaxSpoke;
        let lo = rInnerDown;
        if (lo < 0) {
          lo = rBase > 0 ? rBase : 0;
        }
        let hi = rTop;
        if (hi > rMaxSpoke) hi = rMaxSpoke;
        if (lo < rMaxSpoke && hi > lo) {
          fillPolarRadial(
            pixels,
            depth,
            heightBuf,
            iterBuf,
            n,
            nzOff,
            dirX,
            -dirY,
            lo,
            hi,
            color,
            dist,
            hByte,
            k
          );
        }
        if (rTop <= rMaxSpoke) {
          if (rTop > rInnerDown) rInnerDown = rTop;
        } else if (hi >= rMaxSpoke && rInnerDown < rMaxSpoke) {
          rInnerDown = rMaxSpoke;
        }
        lastDownColor = color;
        lastDownDist = dist;
        lastDownHeight = hByte;
        lastDownIter = k;
      }

      if (h <= clipZ + EPSILON && slope < 0) {
        break;
      }

      t += step;
      step += m.stepGrowth;
      if (step > stepCap) step = stepCap;
    }
    if (
      !leftMap &&
      rInnerDown > 0 &&
      rInnerDown < rMaxSpoke
    ) {
      fillPolarRadial(
        pixels,
        depth,
        heightBuf,
        iterBuf,
        n,
        nzOff,
        dirX,
        -dirY,
        rInnerDown,
        rMaxSpoke,
        lastDownColor,
        lastDownDist,
        lastDownHeight,
        lastDownIter
      );
    }
    const nextX = dirX * rotC + dirY * rotS;
    const nextY = dirY * rotC - dirX * rotS;
    dirX = nextX;
    dirY = nextY;
  }
}

function copyCubeTexel(pixels, depth, heightBuf, iterBuf, n, srcFace, si, sj, dstFace, di, dj) {
  const src = (cubeFaceOffset(srcFace, n) + sj * n + si) | 0;
  const dst = (cubeFaceOffset(dstFace, n) + dj * n + di) | 0;
  pixels[dst] = pixels[src];
  if (depth) {
    depth[dst] = depth[src];
  }
  if (heightBuf) {
    heightBuf[dst] = heightBuf[src];
  }
  if (iterBuf) {
    iterBuf[dst] = iterBuf[src];
  }
}

export function stitchCubePolarSeams(pixels, depth, heightBuf, iterBuf, n) {
  const last = (n - 1) | 0;
  for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
    copyCubeTexel(pixels, depth, heightBuf, iterBuf, n, 2, i, last, CUBE_FACE_NZ, i, last);
    copyCubeTexel(pixels, depth, heightBuf, iterBuf, n, 3, i, last, CUBE_FACE_NZ, last - i, 0);
    copyCubeTexel(pixels, depth, heightBuf, iterBuf, n, 0, i, last, CUBE_FACE_NZ, last, last - i);
    copyCubeTexel(pixels, depth, heightBuf, iterBuf, n, 1, i, last, CUBE_FACE_NZ, 0, i);
  }
}

export function renderCubemapFaces(params) {
  const n = params.n | 0;
  const pixels = params.pixels;
  const depth = params.depth;
  const heightBuf = params.heightBuf;
  const iterBuf = params.iterBuf;
  for (let face = 0; (face < CUBE_HORIZON_FACES) | 0; face = (face + 1) | 0) {
    renderCubemapHorizonColumns({
      ...params,
      face: face,
      startCol: 0,
      endCol: n,
    });
  }
  renderCubemapPolarAzimuths({
    ...params,
    startAz: 0,
    endAz: n << 2,
    azCount: n << 2,
    fillSky: 1,
  });
  stitchCubePolarSeams(pixels, depth, heightBuf, iterBuf, n);
}
