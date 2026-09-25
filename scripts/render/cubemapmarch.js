"use strict";

import { Color } from "../math/color.js";
import { useRetailFrame } from "./retail/schedule.js";
import { applyDetail, detailHeightAdd, detailInRange } from "./retail/detail.js";
import { minmaxSkipT } from "./retail/minmax.js";
import { renderFrustumSpaceColumns } from "./frustumspacemarch.js";
import ColorPalette from "../math/colorPalette.js";
import {
  SKY_PALETTE_STEPS,
  skyPaletteT,
  skyLinearFromHat,
} from "../constants/framebuffer.js";
import { EPSILON, HALF, TWO_PI } from "../constants/vmath.js";
import {
  FILTER_DISTANCE_DEFAULT,
} from "../constants/sampling.js";
import {
  GROUND_CLIP_OFFSET,
  GROUND_HEIGHT,
  HEIGHTMAP_MAX,
} from "../constants/terrain.js";
import { FAR_PLANE_T_SCALE } from "../constants/panorama.js";
import {
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "../constants/quality.js";
import {
  TERRAIN_MIP_MAX_COUNT,
  bandSteps,
  fitBandStep,
  growBandStep,
  firstBandT,
  lod0RefineAt,
  lod0RefineMipAt,
  lod0RefineSwitchDistances,
  LOD0_REFINE_SWITCH_COUNT,
  lod0SamplePos,
  applyLod0RefineHeight,
  easeLodSample,
  mixNearestBilinear,
  marchMaxSteps,
  mipCellFarT,
  mipInvScale,
  mipSwitchDistances,
  mipTexelFloor,
} from "../constants/mip.js";
import { resolveTerrainMips } from "../terrain/mipChain.js";
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

const mipSwitchT = new Float64Array(TERRAIN_MIP_MAX_COUNT);
const bandStepScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT);
const lod0RefineSwitchScratch = new Float64Array(LOD0_REFINE_SWITCH_COUNT);
const mipInvScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT);
const mipWMaskScratch = new Int32Array(TERRAIN_MIP_MAX_COUNT);
const mipHMaskScratch = new Int32Array(TERRAIN_MIP_MAX_COUNT);
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

function setupMips(quality, farClip, panoMips, heightMap, colorMap, mapW, mapH, mapShift, wantedCount, lodSpacingMode, lodSpacing, lod0RefineCurve, stepDivisor) {
  const mips = resolveTerrainMips(
    panoMips,
    heightMap,
    colorMap,
    mapW,
    mapH,
    mapShift,
    wantedCount
  );
  const mipCount = mips.count;
  const lastMip = (mipCount - 1) | 0;
  mipSwitchDistances(mipCount, farClip, mipSwitchT, lodSpacingMode, lodSpacing);
  const refineSwitches = lod0RefineSwitchDistances(
    lodSpacing,
    lod0RefineCurve,
    lod0RefineSwitchScratch
  );
  for (let m = 0; (m < mipCount) | 0; m = (m + 1) | 0) {
    mipInvScratch[m] = mipInvScale(m);
    mipWMaskScratch[m] = (mips.widths[m] - 1) | 0;
    mipHMaskScratch[m] = (mips.heights[m] - 1) | 0;
  }
  return {
    mipHeightMaps: mips.heightMaps,
    mipColorMaps: mips.colorMaps,
    heightMaps: mips.heightMaps,
    widths: mips.widths,
    heights: mips.heights,
    shifts: mips.shifts,
    mipCount,
    lastMip,
    mipWMask: mipWMaskScratch,
    mipHMask: mipHMaskScratch,
    mipShifts: mips.shifts,
    refineSwitches: refineSwitches,
    steps: bandSteps(mipCount, stepDivisor, bandStepScratch),
  };
}

const svHit = {
  offset: 0,
  hFine: 0,
  hByte: 0,
  sx: 0,
  sy: 0,
  wx: 0,
  wy: 0,
  mip: 0,
  filterFade: 0,
  t: 0,
};

function sampleCubeHeight(m, wx, wy, mip, wrap, lerp, dirX, dirY, refine, refineMip, t, lod0Far, mipCount) {
  const ease = easeLodSample(
    t,
    wx,
    wy,
    mip,
    refine,
    refineMip,
    m.refineSwitches,
    lod0Far,
    mipCount,
    mipSwitchT
  );
  const useMip = ease.sampleMip;
  const useRefine = ease.sampleRefineOn;
  const useRm = ease.sampleRefineMip;
  const inv = mipInvScratch[useMip];
  let sx;
  let sy;
  if ((useMip | 0) === 0) {
    const sp = lod0SamplePos(wx, wy, dirX, dirY, useRefine, useRm);
    sx = useRefine ? sp.x * inv : wx * inv;
    sy = useRefine ? sp.y * inv : wy * inv;
  } else {
    const cell = mipTexelFloor(wx, wy, useMip, dirX, dirY);
    sx = cell.ix;
    sy = cell.iy;
  }
  const doLerp = lerp & ((useMip | 0) === 0);
  const shift = m.mipShifts[useMip];
  const wMask = m.mipWMask[useMip];
  const hMask = m.mipHMask[useMip];
  const hm = m.mipHeightMaps[useMip];
  const offset = ((((sy | 0) & wMask) << shift) + ((sx | 0) & hMask)) | 0;
  const nearestH = hm[offset];
  svHit.sx = sx;
  svHit.sy = sy;
  svHit.wx = wx;
  svHit.wy = wy;
  svHit.offset = offset;
  svHit.mip = useMip;
  svHit.filterFade = ease.filterFade;
  if (doLerp) {
    svHit.hFine = mixNearestBilinear(
      nearestH,
      sampleHeightBilinear(hm, sx, sy, shift, wMask, hMask, wrap),
      ease.filterFade
    );
  } else {
    svHit.hFine = nearestH;
  }
  svHit.hFine = applyLod0RefineHeight(
    svHit.hFine,
    wx,
    wy,
    dirX,
    dirY,
    useRefine,
    useRm,
    ease.noiseAmp
  );
  if (detailInRange(t)) {
    svHit.hFine += detailHeightAdd(wx, wy, t);
  }
  svHit.hByte = heightByteFromFine(svHit.hFine);
  svHit.t = t;
}

function sampleCubeColor(m, wrap, filter) {
  const mip = svHit.mip | 0;
  const doFilter = filter & ((mip | 0) === 0) & (svHit.filterFade > 0);
  let color;
  if (!doFilter) {
    color = m.mipColorMaps[mip][svHit.offset];
  } else {
    const bi = sampleColorFiltered(
      m.mipColorMaps[mip],
      svHit.sx,
      svHit.sy,
      m.mipShifts[mip],
      m.mipWMask[mip],
      m.mipHMask[mip],
      wrap
    );
    color =
      svHit.filterFade >= 1
        ? bi
        : lerpPacked(
            m.mipColorMaps[mip][svHit.offset],
            bi,
            (svHit.filterFade * 256) | 0
          );
  }
  if (detailInRange(svHit.t)) {
    return applyDetail(color, svHit.wx, svHit.wy, svHit.t);
  }
  return color;
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
  quality,
  interpolateHeight,
  filterColor,
  lod0Refine,
  lod0RefineCurve,
  stepDivisor,
  retailWidth,
  fov,
  showDetails = 0,
  filterDistance = FILTER_DISTANCE_DEFAULT,
  fwdX = 0,
  fwdY = -1,
  pixels,
  depth,
  heightBuf,
  iterBuf,
  tMax,
  panoMips,
  terrainMips,
  mipCount,
  lodSpacingMode,
  lodSpacing,
  faceOff: faceOffArg,
}) {
  useRetailFrame({
    screenWidth: retailWidth || n,
    fov,
    quality,
    lod0Refine,
    farClip,
    showDetails,
  });
  const stepGrowth = STEP_GROWTH_BY_QUALITY[qualityIndex(quality)];
  const m = setupMips(
    quality,
    farClip,
    terrainMips || panoMips,
    heightMap,
    colorMap,
    mapW,
    mapH,
    mapShift,
    mipCount,
    lodSpacingMode,
    lodSpacing,
    lod0RefineCurve,
    stepDivisor
  );
  const lastRow = (n - 1) | 0;
  const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
  const refine = lod0Refine ? 1 : 0;
  const refineOn = refine;
  const t0 = firstBandT(nearClip, m.steps);
  let tStop = tMax;
  if (!(tStop > 0)) {
    tStop = farClip * FAR_PLANE_T_SCALE;
  }
  const altScale = altitude / HEIGHTMAP_MAX;
  const lerpH = interpolateHeight | 0;
  const filterC = filterColor | 0;
  const wrap = repeat | 0;
  const maxSteps = marchMaxSteps(refineOn);
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
    let wasInside = 0;
    let mip = 0;
    let tStopCol = tStop;
    let k = 0;
    let step = 0;

    while ((t < tStopCol) & (H > 0) & (k < maxSteps)) {
      k = (k + 1) | 0;
      while (((mip < m.lastMip) | 0) && t >= mipSwitchT[mip]) {
        mip = (mip + 1) | 0;
      }

      const refineHere = lod0RefineAt(refine, mip);
      const refineMip = refineHere ? lod0RefineMipAt(t, m.refineSwitches) : 0;
      step = fitBandStep(step, m.steps, mip, refineHere, refineMip);
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
          t = t + step;
          step = growBandStep(step, m.steps, mip, refineHere, refineMip, stepGrowth);
          continue;
        }
        wasInside = 1;
      }

      if (H < n) {
        const skip = minmaxSkipT({
          t,
          mip,
          lastMip: m.lastMip,
          wx,
          wy,
          dirX,
          dirY,
          mips: m,
          wrap,
          altScale,
          below(h, t0, t1) {
            const y0 = ((camZ - h) * (dst / t0) + horizon) | 0;
            const y1 = ((camZ - h) * (dst / t1) + horizon) | 0;
            const top = y0 < y1 ? y0 : y1;
            return top >= H;
          },
        });
        if (skip > t) {
          t = skip;
          continue;
        }
      }

      sampleCubeHeight(m, wx, wy, mip, wrap, lerpH, dirX, dirY, refineHere, refineMip, t, lodSpacing, m.mipCount);
      const offset = svHit.offset;
      const h = svHit.hFine * altScale;

      const zScale = dst / t;
      let yHit = ((camZ - h) * zScale + horizon) | 0;
      if (((mip | 0) > 0) | refineHere) {
        const tFar = mipCellFarT(t, wx, wy, dirX, dirY, mip, refineHere, refineMip);
        if (tFar > t) {
          const yFar = ((camZ - h) * (dst / tFar) + horizon) | 0;
          if ((yFar < yHit) | 0) {
            yHit = yFar;
          }
        }
      }
      if ((yHit < 0) | 0) yHit = 0;
      if ((yHit > lastRow) | 0) {
        t = t + step;
        step = growBandStep(step, m.steps, mip, refineHere, refineMip, stepGrowth);
        continue;
      }

      if ((yHit < H) | 0) {
        let yBottom = H;
        const yGround = ((camZ - clipZ) * zScale + horizon) | 0;
        if ((yGround < yBottom) | 0) yBottom = yGround < 0 ? 0 : yGround;
        if ((yHit < yBottom) | 0) {
          const color = sampleCubeColor(m, wrap, filterC);
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

      t = t + step;
      step = growBandStep(step, m.steps, mip, refineHere, refineMip, stepGrowth);
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
  maxSlope,
  camX,
  camY,
  camZ,
  n,
  startCol = 0,
  endCol = 0,
  farClip,
  nearClip,
  repeat,
  quality,
  interpolateHeight,
  filterColor,
  lod0Refine,
  lod0RefineCurve,
  stepDivisor,
  filterDistance = FILTER_DISTANCE_DEFAULT,
  pixels,
  depth,
  heightBuf,
  iterBuf,
  panoMips,
  terrainMips,
  mipCount,
  lodSpacingMode,
  lodSpacing,
  retailWidth,
  fov,
  showDetails = 0,
  pzOff: pzOffArg,
  nzOff: nzOffArg,
}) {
  useRetailFrame({
    screenWidth: retailWidth || n,
    fov,
    quality,
    lod0Refine,
    farClip,
    showDetails,
  });
  const faceN = n | 0;
  const col0 = startCol | 0;
  let col1 = endCol | 0;
  if (!((col1 > col0) | 0)) {
    col1 = faceN;
  }
  const pzOff = pzOffArg == null ? cubeFaceOffset(CUBE_FACE_PZ, faceN) : pzOffArg | 0;
  const nzOff = nzOffArg == null ? cubeFaceOffset(CUBE_FACE_NZ, faceN) : nzOffArg | 0;
  const shared = {
    heightMap: heightMap,
    colorMap: colorMap,
    mapW: mapW,
    mapH: mapH,
    mapShift: mapShift,
    altitude: altitude,
    maxHeight: maxHeight,
    maxSlope: maxSlope,
    terrainMips: terrainMips || panoMips,
    startColumn: col0,
    endColumn: col1,
    screenWidth: faceN,
    screenHeight: faceN,
    camX: camX,
    camY: camY,
    camZ: camZ,
    rightX: 1,
    rightY: 0,
    rightZ: 0,
    tanHalfFovX: 1,
    fov: 90,
    dstToProjPlane: faceN * 0.5,
    nearClip: nearClip,
    farClip: farClip,
    quality: quality,
    applyFog: 0,
    repeat: repeat,
    interpolateHeight: interpolateHeight,
    filterColor: filterColor,
    filterDistance: filterDistance,
    lod0Refine: lod0Refine,
    lod0RefineCurve: lod0RefineCurve,
    mipCount: mipCount,
    stepDivisor: stepDivisor,
    lodSpacingMode: lodSpacingMode,
    lodSpacing: lodSpacing,
    pixels: pixels,
    pixelWidth: faceN,
    fillUnfilled: 0,
    depth: depth,
    heightBuf: heightBuf,
    iterBuf: iterBuf,
    spanColumns: 1,
  };
  // Top face: pitch -90, looking along +Z.
  renderFrustumSpaceColumns({
    ...shared,
    upX: 0,
    upY: 1,
    upZ: 0,
    fwdX: 0,
    fwdY: 0,
    fwdZ: 1,
    pixelBase: pzOff,
  });
  // Bottom face: pitch +90, looking along -Z.
  renderFrustumSpaceColumns({
    ...shared,
    upX: 0,
    upY: -1,
    upZ: 0,
    fwdX: 0,
    fwdY: 0,
    fwdZ: -1,
    pixelBase: nzOff,
  });
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
