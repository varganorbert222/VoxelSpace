"use strict";

import { mapOffsetAt } from "./mapOffset.js";
import {
  TERRAIN_MIP_KERNEL,
  TERRAIN_MIP_MAX_COUNT,
  TERRAIN_MIP_MIN_SIZE,
  clampMipCount,
  mipInvScale,
  mipVoxelSize,
} from "../constants/mip.js";

export function resolveTerrainMips(
  mips,
  heightMap,
  colorMap,
  width,
  height,
  mapShift
) {
  const src = mips || null;
  const heightMaps = src && src.heightMaps ? src.heightMaps : [heightMap];
  const colorMaps = src && src.colorMaps ? src.colorMaps : [colorMap];
  const widths = src && src.widths ? src.widths : [width];
  const heights = src && src.heights ? src.heights : [height];
  const shifts = src && src.shifts ? src.shifts : [mapShift];
  let count = src && src.count ? src.count | 0 : heightMaps.length;
  count = clampMipCount(count);
  if ((count > heightMaps.length) | 0) {
    count = heightMaps.length;
  }
  if ((count < 1) | 0) {
    count = 1;
  }
  return {
    count: count,
    heightMaps: heightMaps,
    colorMaps: colorMaps,
    widths: widths,
    heights: heights,
    shifts: shifts,
  };
}

export function buildTerrainMips(heightMap, colorMap, width, height, mapShift) {
  const heightMaps = [heightMap];
  const colorMaps = [colorMap];
  const widths = [width];
  const heights = [height];
  const shifts = [mapShift];
  const voxelSizes = [mipVoxelSize(0)];
  const invScales = [mipInvScale(0)];

  let srcHeight = heightMap;
  let srcColor = colorMap;
  let srcW = width;
  let srcH = height;
  let srcShift = mapShift;

  while ((heightMaps.length < TERRAIN_MIP_MAX_COUNT) | 0) {
    if (
      ((srcW <= TERRAIN_MIP_MIN_SIZE) | 0) &
        ((srcH <= TERRAIN_MIP_MIN_SIZE) | 0)
    ) {
      break;
    }
    if (
      ((srcW > TERRAIN_MIP_MIN_SIZE) | 0) & ((srcW % TERRAIN_MIP_KERNEL) | 0) |
      (((srcH > TERRAIN_MIP_MIN_SIZE) | 0) & ((srcH % TERRAIN_MIP_KERNEL) | 0))
    ) {
      break;
    }

    const dstW =
      (srcW > TERRAIN_MIP_MIN_SIZE) | 0
        ? (srcW / TERRAIN_MIP_KERNEL) | 0
        : srcW | 0;
    const dstH =
      (srcH > TERRAIN_MIP_MIN_SIZE) | 0
        ? (srcH / TERRAIN_MIP_KERNEL) | 0
        : srcH | 0;
    if (((dstW < 1) | 0) | ((dstH < 1) | 0)) {
      break;
    }
    if (((dstW === srcW) | 0) & ((dstH === srcH) | 0)) {
      break;
    }

    const dstShift = (srcShift - 1) | 0;
    const dstHeight = new Uint8Array((dstW * dstH) | 0);
    const dstColor = new Uint32Array((dstW * dstH) | 0);
    const kxMax = srcW > dstW ? TERRAIN_MIP_KERNEL : 1;
    const kyMax = srcH > dstH ? TERRAIN_MIP_KERNEL : 1;

    for (let y = 0; (y < dstH) | 0; y = (y + 1) | 0) {
      const y2 = (y * kyMax) | 0;
      for (let x = 0; (x < dstW) | 0; x = (x + 1) | 0) {
        const x2 = (x * kxMax) | 0;
        let maxH = -1;
        let bestC = 0;
        for (let ky = 0; (ky < kyMax) | 0; ky = (ky + 1) | 0) {
          for (let kx = 0; (kx < kxMax) | 0; kx = (kx + 1) | 0) {
            const off = mapOffsetAt(
              (x2 + kx) | 0,
              (y2 + ky) | 0,
              srcW,
              srcH,
              srcShift
            );
            const h = srcHeight[off];
            if ((h > maxH) | 0) {
              maxH = h;
              bestC = srcColor[off];
            }
          }
        }
        const dstOff = mapOffsetAt(x, y, dstW, dstH, dstShift);
        dstHeight[dstOff] = maxH;
        dstColor[dstOff] = bestC;
      }
    }

    heightMaps.push(dstHeight);
    colorMaps.push(dstColor);
    widths.push(dstW);
    heights.push(dstH);
    shifts.push(dstShift);
    const level = (heightMaps.length - 1) | 0;
    voxelSizes.push(mipVoxelSize(level));
    invScales.push(mipInvScale(level));

    srcHeight = dstHeight;
    srcColor = dstColor;
    srcW = dstW;
    srcH = dstH;
    srcShift = dstShift;
  }

  return {
    count: heightMaps.length,
    heightMaps: heightMaps,
    colorMaps: colorMaps,
    widths: widths,
    heights: heights,
    shifts: shifts,
    voxelSizes: voxelSizes,
    invScales: invScales,
  };
}

export function buildPanoMips(heightMap, colorMap, width, height, mapShift) {
  return buildTerrainMips(heightMap, colorMap, width, height, mapShift);
}
