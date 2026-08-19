"use strict";

import { Color } from "./color.js";
import { mapOffsetAt } from "./terrain.js";
import {
  CHANNEL_MASK,
  CHANNEL_MAX,
  SHIFT_ALPHA,
  SHIFT_GREEN,
  SHIFT_RED,
} from "./constants/color.js";
import { HEIGHTMAP_MAX } from "./constants/terrain.js";
import { UNFILLED_PIXEL } from "./constants/framebuffer.js";
import {
  FOG_SATURATED,
  LOD_BAND_COUNT,
  LOD_DISTANCE_FRACTIONS,
  LOD_FAR_DELTAS,
  MIN_SAMPLE_DISTANCE,
  NON_REPEAT_GROUND_OFFSET,
  PIXEL_OFFSETS,
  INITIAL_STEP_SCALE_BY_QUALITY,
  STEP_GROWTH_BY_QUALITY,
  qualityIndex,
} from "./constants/renderer.js";

let hiddenYScratch = new Int32Array(1);
const deltasScratch = new Float64Array(LOD_BAND_COUNT);
const lodDistancesScratch = new Float64Array(LOD_BAND_COUNT + 1);
let hiddenYCapacity = 1;

function hiddenYBuffer(width) {
  if ((width > hiddenYCapacity) | 0) {
    hiddenYCapacity = width;
    hiddenYScratch = new Int32Array(width);
  }
  return hiddenYScratch;
}

function drawVerticalLine(pixels, stride, x, ytop, ybottom, col, width, xEnd) {
  x = x | 0;
  ytop = ytop | 0;
  ybottom = ybottom | 0;
  col = col | 0;
  if ((ytop < 0) | 0) ytop = 0;
  if ((ytop > ybottom) | 0) return;

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

function projectToScreen(y, z, dstToProjPlane, screenHorizon) {
  return ((y / z) * dstToProjPlane + screenHorizon) | 0;
}

export function renderClassicColumns({
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
  minDeltaZ,
  quality,
  applyFog,
  repeat,
  pixels,
  pixelWidth,
  fillUnfilled,
}) {
  const localWidth = (endColumn - startColumn) | 0;
  const stride = pixelWidth;
  const hiddenY = hiddenYBuffer(localWidth);
  const fogRange = farClip - nearClip;
  const ceiling = maxHeight == null ? altitude : maxHeight;
  const ceilingSdf = camZ - ceiling;

  if (fillUnfilled) {
    const n = (localWidth * screenHeight) | 0;
    for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
      pixels[i] = UNFILLED_PIXEL;
    }
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

  for (let lod = LOD_BAND_COUNT; (lod > 0) | 0; lod = (lod - 1) | 0) {
    const startIndex = lodDistances[lod - 1];
    const endIndex = lodDistances[lod];
    const pxOffset = PIXEL_OFFSETS[lod - 1];
    let step = deltas[lod - 1];

    if ((startIndex >= farClip) | 0) {
      continue;
    }

    for (let i = 0; (i < localWidth) | 0; i = (i + 1) | 0) {
      hiddenY[i] = screenHeight;
    }

    for (
      let z = startIndex;
      ((z < endIndex) | 0) & ((z < farClip) | 0);
      z = z + step
    ) {
      const viewX = -sinAngle * z;
      const viewY = -cosAngle * z;
      const rightX = cosAngle * tanHalfFovX * z;
      const rightY = -sinAngle * tanHalfFovX * z;
      let plx = viewX - rightX + camX;
      let ply = viewY - rightY + camY;
      const prx = viewX + rightX + camX;
      const pry = viewY + rightY + camY;
      const dx = (prx - plx) * screenWidthScaler;
      const dy = (pry - ply) * screenWidthScaler;

      plx += dx * startColumn;
      ply += dy * startColumn;

      for (
        let i = startColumn;
        (i < endColumn) | 0;
        i = (i + pxOffset) | 0
      ) {
        const localI = (i - startColumn) | 0;
        const colHidden = hiddenY[localI];
        if (colHidden === 0) {
          plx += dx * pxOffset;
          ply += dy * pxOffset;
          continue;
        }

        const inside =
          ((plx >= 0) | 0) &
          ((plx <= mapW) | 0) &
          ((ply >= 0) | 0) &
          ((ply <= mapH) | 0);
        const isOk = inside | (repeat | 0);

        if (isOk) {
          const ceilingOnScreen = projectToScreen(
            ceilingSdf,
            z,
            dstToProjPlane,
            screenHorizon
          );
          if ((ceilingOnScreen >= colHidden) | 0) {
            plx += dx * pxOffset;
            ply += dy * pxOffset;
            continue;
          }

          const offset = mapOffsetAt(plx, ply, mapW, mapH, mapShift);
          const terrainHeight =
            (heightMap[offset] / HEIGHTMAP_MAX) * altitude;
          const terrainSDF = camZ - terrainHeight;
          const heightOnScreen = projectToScreen(
            terrainSDF,
            z,
            dstToProjPlane,
            screenHorizon
          );

          let heightOnScreenBottom = colHidden;
          if (!repeat) {
            const ground = projectToScreen(
              camZ + NON_REPEAT_GROUND_OFFSET,
              z,
              dstToProjPlane,
              screenHorizon
            );
            if ((ground < heightOnScreenBottom) | 0) {
              heightOnScreenBottom = ground;
            }
          }

          const depth =
            fogRange === 0
              ? FOG_SATURATED
              : (z - nearClip) / fogRange;
          const fogWhite =
            (applyFog | 0) & ((depth >= FOG_SATURATED) | 0);

          let plotColor = Color.WHITE;
          if (!fogWhite) {
            plotColor = colorMap[offset];
            if (applyFog) {
              const fogT =
                depth < 0 ? 0 : depth > FOG_SATURATED ? FOG_SATURATED : depth;
              const a = (plotColor >>> SHIFT_ALPHA) & CHANNEL_MASK;
              const r = (plotColor >>> SHIFT_RED) & CHANNEL_MASK;
              const g = (plotColor >>> SHIFT_GREEN) & CHANNEL_MASK;
              const b = plotColor & CHANNEL_MASK;
              plotColor =
                ((a + (CHANNEL_MAX - a) * fogT) << SHIFT_ALPHA) |
                ((r + (CHANNEL_MAX - r) * fogT) << SHIFT_RED) |
                ((g + (CHANNEL_MAX - g) * fogT) << SHIFT_GREEN) |
                (b + (CHANNEL_MAX - b) * fogT);
            }
          }

          if ((heightOnScreen < colHidden) | 0) {
            let drawWidth = pxOffset;
            if ((i + drawWidth > endColumn) | 0) {
              drawWidth = (endColumn - i) | 0;
            }
            drawVerticalLine(
              pixels,
              stride,
              localI,
              heightOnScreen,
              heightOnScreenBottom,
              plotColor,
              drawWidth,
              localWidth
            );

            for (
              let j = localI;
              ((j < localI + drawWidth) | 0) & ((j < localWidth) | 0);
              j = (j + 1) | 0
            ) {
              hiddenY[j] = heightOnScreen;
            }
          }
        }

        plx += dx * pxOffset;
        ply += dy * pxOffset;
      }

      step += stepGrowth;
    }
  }
}
