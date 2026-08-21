"use strict";

import { mapOffsetAt } from "./mapOffset.js";
import {
  PANO_MIP_COUNT,
  PANO_MIP_KERNEL,
  PANO_MIP_MIN_SIZE,
} from "../constants/panorama.js";

export function buildPanoMips(heightMap, colorMap, width, height, mapShift) {
  const heightMaps = [heightMap];
  const colorMaps = [colorMap];
  const widths = [width];
  const heights = [height];
  const shifts = [mapShift];

  let srcHeight = heightMap;
  let srcColor = colorMap;
  let srcW = width;
  let srcH = height;
  let srcShift = mapShift;

  while ((heightMaps.length < PANO_MIP_COUNT) | 0) {
    if (
      (srcW < PANO_MIP_MIN_SIZE) |
      (srcH < PANO_MIP_MIN_SIZE) |
      (srcW % PANO_MIP_KERNEL) |
      (srcH % PANO_MIP_KERNEL)
    ) {
      break;
    }

    const dstW = (srcW / PANO_MIP_KERNEL) | 0;
    const dstH = (srcH / PANO_MIP_KERNEL) | 0;
    const dstShift = (srcShift - 1) | 0;
    const dstHeight = new Uint8Array((dstW * dstH) | 0);
    const dstColor = new Uint32Array((dstW * dstH) | 0);

    for (let y = 0; (y < dstH) | 0; y = (y + 1) | 0) {
      const y2 = (y * PANO_MIP_KERNEL) | 0;
      for (let x = 0; (x < dstW) | 0; x = (x + 1) | 0) {
        const x2 = (x * PANO_MIP_KERNEL) | 0;
        let maxH = -1;
        let bestC = 0;
        for (let ky = 0; (ky < PANO_MIP_KERNEL) | 0; ky = (ky + 1) | 0) {
          for (let kx = 0; (kx < PANO_MIP_KERNEL) | 0; kx = (kx + 1) | 0) {
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
  };
}
