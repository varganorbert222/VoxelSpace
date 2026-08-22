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
} from "../constants/panorama.js";
import {
  CUBE_FACE_C,
  CUBE_FACE_NZ,
  CUBE_FACE_PZ,
  CUBE_FACE_U,
  CUBE_HORIZON_FACES,
  cubeFaceOffset,
  cubePixelUV,
  cubeUVToTexel,
} from "../constants/cubemap.js";

const mipSwitchT = new Float64Array(PANO_MIP_COUNT);
const mipInvScale = new Float64Array(PANO_MIP_COUNT);
const mipWMaskScratch = new Int32Array(PANO_MIP_COUNT);
const mipHMaskScratch = new Int32Array(PANO_MIP_COUNT);

function fillFaceSky(pixels, depth, heightBuf, iterBuf, faceOff, n, skyColor) {
  const palette = new ColorPalette(skyColor, Color.WHITE, SKY_PALETTE_STEPS);
  const h2 = n * HALF;
  const count = (n * n) | 0;
  if (depth) {
    depth.fill(0, faceOff, faceOff + count);
  }
  if (heightBuf) {
    heightBuf.fill(0, faceOff, faceOff + count);
  }
  if (iterBuf) {
    iterBuf.fill(0, faceOff, faceOff + count);
  }
  for (let j = 0; (j < n) | 0; j = (j + 1) | 0) {
    const color = palette.getColor(skyPaletteT(j / h2));
    const row = (faceOff + j * n) | 0;
    pixels.fill(color, row, row + n);
  }
}

function fillPolarSky(pixels, depth, heightBuf, iterBuf, n, skyColor) {
  const zenith = skyColor;
  const nadir = Color.WHITE;
  const pz = cubeFaceOffset(CUBE_FACE_PZ, n);
  const nz = cubeFaceOffset(CUBE_FACE_NZ, n);
  const count = (n * n) | 0;
  pixels.fill(zenith, pz, pz + count);
  pixels.fill(nadir, nz, nz + count);
  if (depth) {
    depth.fill(0, pz, pz + count);
    depth.fill(0, nz, nz + count);
  }
  if (heightBuf) {
    heightBuf.fill(0, pz, pz + count);
    heightBuf.fill(0, nz, nz + count);
  }
  if (iterBuf) {
    iterBuf.fill(0, pz, pz + count);
    iterBuf.fill(0, nz, nz + count);
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

function plotPolarTexel(
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
  face,
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
  const p0 = cubeUVToTexel(su * a, sv * a, n);
  const p1 = cubeUVToTexel(su * b, sv * b, n);
  let x0 = p0.i | 0;
  let y0 = p0.j | 0;
  const x1 = p1.i | 0;
  const y1 = p1.j | 0;
  const dx = x1 > x0 ? (x1 - x0) | 0 : (x0 - x1) | 0;
  const dy = y1 > y0 ? (y1 - y0) | 0 : (y0 - y1) | 0;
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = (dx - dy) | 0;
  const faceOff = cubeFaceOffset(face, n);
  for (let guard = 0; (guard < 2048) | 0; guard = (guard + 1) | 0) {
    plotPolarTexel(
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
  initialStep,
  quality,
  pixels,
  depth,
  heightBuf,
  iterBuf,
  tMax,
  panoMips,
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
  const cx = CUBE_FACE_C[face][0];
  const cy = CUBE_FACE_C[face][1];
  const ux = CUBE_FACE_U[face][0];
  const uy = CUBE_FACE_U[face][1];
  const faceOff = cubeFaceOffset(face, n);
  const halfN = n * HALF;

  if ((startCol | 0) === 0) {
    fillFaceSky(pixels, depth, heightBuf, iterBuf, faceOff, n, skyColor);
  }

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

      const inv = mipInvScale[mip];
      const offset =
        (((((wy * inv) | 0) & m.mipWMask[mip]) << m.mipShifts[mip]) +
          (((wx * inv) | 0) & m.mipHMask[mip])) |
        0;
      const h = m.mipHeightMaps[mip][offset] * altScale;

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
          const color = m.mipColorMaps[mip][offset];
          const dh = h - camZ;
          const dist = Math.sqrt(t * t + dh * dh);
          const hByte = m.mipHeightMaps[mip][offset];
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
  initialStep,
  quality,
  pixels,
  depth,
  heightBuf,
  iterBuf,
  tMax,
  panoMips,
  fillSky,
}) {
  if (fillSky) {
    fillPolarSky(pixels, depth, heightBuf, iterBuf, n, skyColor);
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
  const clipZ = GROUND_HEIGHT - GROUND_CLIP_OFFSET;
  const azN = azCount > 0 ? azCount : (n << 2);
  const nadirInside =
    (repeat | 0) |
    (((camX >= 0) | 0) &
      ((camX < mapW) | 0) &
      ((camY >= 0) | 0) &
      ((camY < mapH) | 0));
  for (let az = startAz; (az < endAz) | 0; az = (az + 1) | 0) {
    const theta = ((az + HALF) / azN) * TWO_PI;
    const dirX = -Math.sin(theta);
    const dirY = -Math.cos(theta);
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

      const inv = mipInvScale[mip];
      const offset =
        (((((wy * inv) | 0) & m.mipWMask[mip]) << m.mipShifts[mip]) +
          (((wx * inv) | 0) & m.mipHMask[mip])) |
        0;
      const h = m.mipHeightMaps[mip][offset] * altScale;

      const dh = h - camZ;
      const slope = dh / t;
      const color = m.mipColorMaps[mip][offset];
      const dist = Math.sqrt(t * t + dh * dh);
      const hByte = m.mipHeightMaps[mip][offset];
      if (slope > EPSILON) {
        const r = 1 / slope;
        if (r < rOuterUp) {
          fillPolarRadial(
            pixels,
            depth,
            heightBuf,
            iterBuf,
            n,
            CUBE_FACE_PZ,
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
            CUBE_FACE_NZ,
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
        CUBE_FACE_NZ,
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

function stitchCubePolarSeams(pixels, depth, heightBuf, iterBuf, n) {
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
