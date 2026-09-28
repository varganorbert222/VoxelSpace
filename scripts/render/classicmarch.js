"use strict";

import { Color } from "../math/color.js";
import { qualityBandSteps, useRetailFrame } from "./retail/schedule.js";
import { applyDetail, detailElevMax, detailHeightAdd, detailInRange } from "./retail/detail.js";
import { vmaxClamp, vmaxLevel, vmaxMeters } from "./retail/vmax.js";
import { HEIGHTMAP_MAX } from "../constants/terrain.js";
import { FILTER_DISTANCE_DEFAULT } from "../constants/sampling.js";
import { COLUMN_PAIR, UNFILLED_PIXEL } from "../constants/framebuffer.js";
import {
  DEBUG_VIEW_DEPTH,
  DEBUG_VIEW_HEIGHT,
  DEBUG_VIEW_ITERATIONS,
  isDebugColor,
} from "../constants/debugView.js";
import { encodeHeight, encodeIter, encodeUnit } from "./debugEncode.js";
import { NON_REPEAT_GROUND_OFFSET } from "../constants/classic.js";
import {
  TERRAIN_MIP_MAX_COUNT,
  bandStepAt,
  nearMarchStep,
  fillClassicLodDistances,
  firstBandT,
  lod0RefineAt,
  lod0RefineMipAt,
  lod0RefineSwitchDistances,
  LOD0_REFINE_SWITCH_COUNT,
  mipSwitchDistances,
  lod0SamplePos,
  easeLodSample,
  mixNearestBilinear,
  mipInvScale,
  mipSpanFarT,
  projectSdfYSpan,
} from "../constants/mip.js";
import { resolveTerrainMips } from "../terrain/mipChain.js";

let hiddenYScratch = new Int32Array(1);
let sampleNScratch = new Int32Array(1);
const lodDistancesScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT + 1);
const bandStepsScratch = new Float64Array(TERRAIN_MIP_MAX_COUNT);
const lod0RefineSwitchScratch = new Float64Array(LOD0_REFINE_SWITCH_COUNT);
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

// First distance at which the terrain ceiling can enter the screen.
// Above the ceiling, near samples project below the view and must not
// abort the march.
function classicCeilingZ(z, ceilingSdf, dst, horizon, screenHeight) {
  if (!(ceilingSdf > 0) || !(dst > 0)) {
    return z;
  }
  const ySpan = screenHeight - horizon;
  if (!(ySpan > 1)) {
    return z;
  }
  const zEnter = (ceilingSdf * dst) / ySpan;
  if (zEnter > z) {
    return zEnter;
  }
  return z;
}

function cameraClearance(heightMap, camX, camY, camZ, altScale, mapShift, mapW, mapH, wrap) {
  const wMask = (mapW - 1) | 0;
  const hMask = (mapH - 1) | 0;
  const h = heightAt(
    heightMap,
    camX | 0,
    camY | 0,
    mapShift,
    wMask,
    hMask,
    wrap | 0
  );
  const c = camZ - h * altScale;
  if (c > 0) {
    return c;
  }
  return 0;
}

function classicProjectedY(sdf, dst, z, step, plx, ply, col, kLeftX, kLeftY, kDx, kDy, mip, horizon, refine, refineMip) {
  return projectSdfYSpan(
    sdf,
    dst,
    z,
    mipSpanFarT(z, step, plx, ply, kLeftX + kDx * col, kLeftY + kDy * col, mip, refine, refineMip),
    horizon
  );
}

function setupClassicLod(params) {
  const mips = resolveTerrainMips(
    params.terrainMips,
    params.heightMap,
    params.colorMap,
    params.mapW,
    params.mapH,
    params.mapShift,
    params.mipCount
  );
  const bandCount = mips.count;
  const refine = !!params.lod0Refine;
  const zStart = firstBandT(params.nearClip);
  const switches = mipSwitchDistances(
    bandCount,
    params.farClip,
    null,
    params.lodSpacingMode,
    params.lodSpacing
  );
  const steps = qualityBandSteps(
    bandCount,
    params.farClip,
    params.quality,
    switches,
    bandStepsScratch
  );
  const nearEnd = switches.length && switches[0] > 0 ? switches[0] : params.farClip;
  const refineSwitches = lod0RefineSwitchDistances(
    nearEnd,
    params.lod0RefineCurve,
    lod0RefineSwitchScratch
  );
  fillClassicLodDistances(
    lodDistancesScratch,
    zStart,
    params.farClip,
    switches,
    bandCount
  );
  for (let m = 0; (m < bandCount) | 0; m = (m + 1) | 0) {
    mipWMaskScratch[m] = (mips.widths[m] - 1) | 0;
    mipHMaskScratch[m] = (mips.heights[m] - 1) | 0;
  }
  return {
    mips: mips,
    bandCount: bandCount,
    refine: refine,
    steps: steps,
    lodSpacing: params.lodSpacing,
    refineSwitches: refineSwitches,
    mipSwitches: switches,
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

function drawVerticalLine(pixels, stride, x, ytop, ybottom, col, width) {
  x = x | 0;
  ytop = ytop | 0;
  ybottom = ybottom | 0;
  col = col | 0;
  let span = width | 0;
  if ((span < 1) | 0) span = 1;
  if ((ytop < 0) | 0) ytop = 0;
  if ((ytop > ybottom) | 0) return;
  let xEnd = (x + span) | 0;
  if ((xEnd > stride) | 0) xEnd = stride;
  if (((xEnd - x) | 0) === 2) {
    let offset = (ytop * stride + x) | 0;
    for (let k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
      pixels[offset] = col;
      pixels[(offset + 1) | 0] = col;
      offset = (offset + stride) | 0;
    }
    return;
  }
  for (let j = x; (j < xEnd) | 0; j = (j + 1) | 0) {
    let offset = (ytop * stride + j) | 0;
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
  quality,
  debugView,
  repeat,
  showDetails = 0,
  lod0Refine,
  lod0RefineCurve,
  filterDistance = FILTER_DISTANCE_DEFAULT,
  pixels,
  pixelWidth,
  fillUnfilled,
  terrainMips,
  mipCount,
  lodSpacingMode,
  lodSpacing,
}) {
  const localWidth = (endColumn - startColumn) | 0;
  const stride = pixelWidth;
  const hiddenY = hiddenYBuffer(localWidth);
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
  let clearance = cameraClearance(
    heightMap,
    camX,
    camY,
    camZ,
    altScale,
    mapShift,
    mapW,
    mapH,
    repeat
  );

  if (fillUnfilled) {
    pixels.fill(UNFILLED_PIXEL, 0, (localWidth * screenHeight) | 0);
  }

  const lodState = setupClassicLod({
    terrainMips: terrainMips,
    heightMap: heightMap,
    colorMap: colorMap,
    mapW: mapW,
    mapH: mapH,
    mapShift: mapShift,
    nearClip: nearClip,
    farClip: farClip,
    mipCount: mipCount,
    lodSpacingMode: lodSpacingMode,
    lodSpacing: lodSpacing,
    lod0Refine: lod0Refine,
    lod0RefineCurve: lod0RefineCurve,
    quality: quality,
  });
  const mips = lodState.mips;
  const bandCount = lodState.bandCount;
  const bandSteps = lodState.steps;
  const refineSwitches = lodState.refineSwitches;
  const mipSwitches = lodState.mipSwitches;
  const lod0Far = lodState.lodSpacing;
  const lodDistances = lodDistancesScratch;

  const screenWidthScaler = 1 / screenWidth;
  const fine = showDetails | 0;
  const kRightX = cosAngle * tanHalfFovX;
  const kRightY = -sinAngle * tanHalfFovX;
  const kLeftX = -sinAngle - kRightX;
  const kLeftY = -cosAngle - kRightY;
  const kDx = (kRightX + kRightX) * screenWidthScaler;
  const kDy = (kRightY + kRightY) * screenWidthScaler;
  for (let lod = bandCount; (lod > 0) | 0; lod = (lod - 1) | 0) {
    const startIndex = lodDistances[lod - 1];
    const endIndex = lodDistances[lod];
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

    let step = 0;
    let z = classicCeilingZ(
      startIndex,
      ceilingSdf,
      dstToProjPlane,
      screenHorizon,
      screenHeight
    );
    for (
      ;
      ((z < endIndex) | 0) & ((z < farClip) | 0);

    ) {
      const refineHere = lod0RefineAt(z, mip);
      const refineMip = refineHere ? lod0RefineMipAt(z, refineSwitches) : 0;
      step = nearMarchStep(bandStepAt(bandSteps, mip), mip, refineHere, refineMip);
      const zScale = dstToProjPlane / z;
      const ceilingOnScreen = (ceilingSdf * zScale + screenHorizon) | 0;
      const groundOnScreen = (yGround * zScale + screenHorizon) | 0;
      const dx = kDx * z;
      const dy = kDy * z;
      let plx = kLeftX * z + camX + dx * startColumn;
      let ply = kLeftY * z + camY + dy * startColumn;
      let sliceOpen = 0;
      let sliceSdf = 0;
      const vmaxLv = mips.vmaxMaps
        ? vmaxClamp(mips, vmaxLevel(mip, refineHere, refineMip))
        : 0;
      const zFar = z + step;

      for (let i = startColumn; (i < endColumn) | 0; ) {
        let pair = COLUMN_PAIR;
        const remain = (endColumn - i) | 0;
        if ((pair > remain) | 0) {
          pair = remain;
        }
        const localI = (i - startColumn) | 0;
        const colHidden = hiddenY[localI];
        if (colHidden === 0) {
          plx += dx * pair;
          ply += dy * pair;
          i = (i + pair) | 0;
          continue;
        }

        const inside =
          ((plx >= 0) | 0) &
          ((plx <= mapW) | 0) &
          ((ply >= 0) | 0) &
          ((ply <= mapH) | 0);
        const isOk = inside | (repeat | 0);
        const ceilingBelow = (ceilingOnScreen >= colHidden) | 0;
        if (!((isOk & ceilingBelow) & ((ceilingSdf <= 0) | 0))) {
          sliceOpen = 1;
        }

        if (isOk) {
          if ((ceilingOnScreen >= colHidden) | 0) {
            plx += dx * pair;
            ply += dy * pair;
            i = (i + pair) | 0;
            continue;
          }

          if (mips.vmaxMaps) {
            const env = vmaxMeters(
              mips,
              plx,
              ply,
              vmaxLv,
              altScale,
              repeat | 0
            );
            const envY = projectSdfYSpan(
              camZ - env,
              dstToProjPlane,
              z,
              zFar,
              screenHorizon
            );
            if ((envY >= colHidden) | 0) {
              plx += dx * pair;
              ply += dy * pair;
              i = (i + pair) | 0;
              continue;
            }
          }

          const dirX = kLeftX + kDx * i;
          const dirY = kLeftY + kDy * i;
          const ease = easeLodSample(
            z,
            plx,
            ply,
            mip,
            refineHere,
            refineMip,
            refineSwitches,
            lod0Far,
            bandCount,
            mipSwitches
          );
          const useMip = ease.sampleMip;
          const useRefine = ease.sampleRefineOn;
          const useRm = ease.sampleRefineMip;
          const useHeight = mips.heightMaps[useMip];
          const useColor = mips.colorMaps[useMip];
          const useShift = mips.shifts[useMip];
          const useWMask = mipWMaskScratch[useMip];
          const useHMask = mipHMaskScratch[useMip];
          const useInv = mipInvScale(useMip);
          const sample = lod0SamplePos(plx, ply, dirX, dirY, useRefine, useRm);
          const sx = useRefine ? sample.x : plx * useInv;
          const sy = useRefine ? sample.y : ply * useInv;
          const offset =
            ((((sy | 0) & useWMask) << useShift) +
              ((sx | 0) & useHMask)) |
            0;
          const doLerp = fine & (useRefine ? 1 : 0);
          const doFilter = fine & (useRefine ? 1 : 0) & (ease.filterFade > 0);
          const nearestH = useHeight[offset];
          const hSample = doLerp
            ? mixNearestBilinear(
                nearestH,
                sampleHeightBilinear(
                  useHeight,
                  sx,
                  sy,
                  useShift,
                  useWMask,
                  useHMask,
                  repeat | 0
                ),
                ease.filterFade
              )
            : nearestH;
          let hFine = hSample;
          const yCap = classicProjectedY(
            camZ - (hFine + detailElevMax(z)) * altScale,
            dstToProjPlane,
            z,
            step,
            plx,
            ply,
            i,
            kLeftX,
            kLeftY,
            kDx,
            kDy,
            useMip,
            screenHorizon,
            useRefine,
            useRm
          );
          if ((yCap < colHidden) | 0) {
            hFine += detailHeightAdd(plx, ply, z);
          }
          const hByte = heightByteFromFine(hFine);
          const terrainHeight = hFine * altScale;
          const terrainSDF = camZ - terrainHeight;
          if (terrainSDF > sliceSdf) {
            sliceSdf = terrainSDF;
          }
          const heightOnScreen = classicProjectedY(
            terrainSDF,
            dstToProjPlane,
            z,
            step,
            plx,
            ply,
            i,
            kLeftX,
            kLeftY,
            kDx,
            kDy,
            useMip,
            screenHorizon,
            useRefine,
            useRm
          );

          let heightOnScreenBottom = colHidden;
          if (!repeat) {
            if ((groundOnScreen < heightOnScreenBottom) | 0) {
              heightOnScreenBottom = groundOnScreen;
            }
          }

          if ((heightOnScreen < colHidden) | 0) {
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
            } else {
              plotColor = doFilter
                ? ease.filterFade >= 1
                  ? sampleColorFiltered(
                      useColor,
                      sx,
                      sy,
                      useShift,
                      useWMask,
                      useHMask,
                      repeat | 0
                    )
                  : lerpPacked(
                      useColor[offset],
                      sampleColorFiltered(
                        useColor,
                        sx,
                        sy,
                        useShift,
                        useWMask,
                        useHMask,
                        repeat | 0
                      ),
                      (ease.filterFade * 256) | 0
                    )
                : useColor[offset];
              if (detailInRange(z)) {
                plotColor = applyDetail(plotColor, plx, ply, z);
              }
            }
            drawVerticalLine(
              pixels,
              stride,
              localI,
              heightOnScreen,
              heightOnScreenBottom,
              plotColor,
              pair
            );
            const hiddenEnd = (localI + pair) | 0;
            for (let j = localI; (j < hiddenEnd) | 0; j = (j + 1) | 0) {
              hiddenY[j] = heightOnScreen;
            }
          }
        }

        plx += dx * pair;
        ply += dy * pair;
        i = (i + pair) | 0;
      }

      if (sliceSdf > clearance) {
        clearance = sliceSdf;
      }
      if (!sliceOpen) {
        break;
      }
      z = z + step;
    }
  }
}

export function renderClassicColumns(params) {
  useRetailFrame(params);
  return renderClassicColumnsSampled(params);
}
