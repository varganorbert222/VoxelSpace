"use strict";

import { Color } from "./color.js";
import ColorPalette from "./colorpalette.js";
import { mapOffsetAt } from "./terrain.js";
import {
  SKY_PALETTE_STEPS,
  skyPaletteT,
} from "./constants/framebuffer.js";
import { EPSILON } from "./constants/camera.js";
import { HEIGHTMAP_MAX } from "./constants/terrain.js";
import {
  FAR_PLANE_T_SCALE,
  MIN_SAMPLE_DISTANCE,
  STEP_GROWTH,
} from "./constants/renderer.js";
import { HALF, TWO_PI } from "./constants/vmath.js";

const tanMinCache = new Map();

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
  pixels,
  horizon,
  depth,
  tMax,
  tanMin,
}) {
  const localWidth = (endPx - startPx) | 0;
  fillSkySlice(pixels, localWidth, height, skyColor);
  if (depth) {
    const dn = (localWidth * height) | 0;
    for (let i = 0; (i < dn) | 0; i = (i + 1) | 0) {
      depth[i] = 0;
    }
  }

  const lut = tanMin || buildTanMinLut(height);
  let step0 = initialStep;
  if ((step0 <= 0) | 0) step0 = MIN_SAMPLE_DISTANCE;
  const t0 = Math.max(nearClip, initialStep, MIN_SAMPLE_DISTANCE);
  let tStop = tMax;
  if (!(tStop > 0)) {
    tStop = farClip * FAR_PLANE_T_SCALE;
  }

  for (let px = startPx; (px < endPx) | 0; px = (px + 1) | 0) {
    const localX = (px - startPx) | 0;
    const theta = ((px + HALF) / width) * TWO_PI;
    const dirX = -Math.sin(theta);
    const dirY = -Math.cos(theta);
    let H = height;
    horizon[localX] = H;

    let t = t0;
    let step = step0;
    let wasInside = 0;

    while (t < tStop) {
      if (H === 0) {
        break;
      }

      const sealed = (H !== height) | 0;
      const tanH = sealed ? lut[H] : 0;
      if (sealed && tanH >= 0 && altitude < camZ + t * tanH - EPSILON) {
        break;
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
          step += STEP_GROWTH;
          continue;
        }
        wasInside = 1;
      }

      const offset = mapOffsetAt(wx, wy, mapW, mapH, mapShift);
      const h = (heightMap[offset] / HEIGHTMAP_MAX) * altitude;

      if (sealed && h < camZ + t * tanH - EPSILON) {
        t += step;
        step += STEP_GROWTH;
        continue;
      }

      const dh = h - camZ;
      const phiHit = Math.atan2(dh, t);
      let yHit = ((HALF - phiHit / Math.PI) * height) | 0;
      if ((yHit < 0) | 0) yHit = 0;
      if ((yHit >= height) | 0) yHit = (height - 1) | 0;

      if ((yHit < H) | 0) {
        const color = colorMap[offset];
        const dist = Math.hypot(t, dh);
        for (let y = yHit; (y < H) | 0; y = (y + 1) | 0) {
          const idx = (y * localWidth + localX) | 0;
          pixels[idx] = color;
          if (depth) {
            depth[idx] = dist;
          }
        }
        H = yHit;
        horizon[localX] = H;
      }

      t += step;
      step += STEP_GROWTH;
    }
  }

  return pixels;
}
