"use strict";

import { Color } from "./color.js";
import ColorPalette from "./colorpalette.js";
import { mapOffsetAt } from "./terrain.js";
import {
  SKY_PALETTE_STEPS,
  skyPaletteT,
} from "./constants/framebuffer.js";
import {
  CHANNEL_MASK,
  CHANNEL_MAX,
  SHIFT_ALPHA,
  SHIFT_GREEN,
  SHIFT_RED,
} from "./constants/color.js";
import { EPSILON } from "./constants/camera.js";
import { HEIGHTMAP_MAX } from "./constants/terrain.js";
import {
  FOG_SATURATED,
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
  applyFog,
  repeat,
  skyColor,
  initialStep,
  pixels,
  horizon,
  tanMin,
}) {
  const localWidth = (endPx - startPx) | 0;
  fillSkySlice(pixels, localWidth, height, skyColor);

  const lut = tanMin || buildTanMinLut(height);
  const fogRange = farClip - nearClip;
  let step0 = initialStep;
  if ((step0 <= 0) | 0) step0 = MIN_SAMPLE_DISTANCE;
  const t0 = Math.max(nearClip, initialStep, MIN_SAMPLE_DISTANCE);

  for (let px = startPx; (px < endPx) | 0; px = (px + 1) | 0) {
    const localX = (px - startPx) | 0;
    const theta = (px / width) * TWO_PI;
    const dirX = -Math.sin(theta);
    const dirY = -Math.cos(theta);
    let H = height;
    horizon[localX] = H;

    let t = t0;
    let step = step0;
    let wasInside = 0;

    while ((t < farClip) | 0) {
      if (H === 0) {
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

      if ((H !== height) | 0) {
        const tanH = lut[H];
        if (Number.isFinite(tanH)) {
          if (h < camZ + t * tanH - EPSILON) {
            t += step;
            step += STEP_GROWTH;
            continue;
          }
        }
      }

      const phiHit = Math.atan2(h - camZ, t);
      let yHit = ((HALF - phiHit / Math.PI) * height) | 0;
      if ((yHit < 0) | 0) yHit = 0;
      if ((yHit > height) | 0) yHit = height;

      const depth =
        fogRange === 0
          ? FOG_SATURATED
          : (t - nearClip) / fogRange;
      const fogWhite =
        (applyFog | 0) & ((depth >= FOG_SATURATED) | 0);

      if ((yHit < H) | 0) {
        let color = Color.WHITE;
        if (!fogWhite) {
          color = colorMap[offset];
          if (applyFog) {
            const a = (color >>> SHIFT_ALPHA) & CHANNEL_MASK;
            const r = (color >>> SHIFT_RED) & CHANNEL_MASK;
            const g = (color >>> SHIFT_GREEN) & CHANNEL_MASK;
            const b = color & CHANNEL_MASK;
            const fogT = depth < 0 ? 0 : depth > FOG_SATURATED ? FOG_SATURATED : depth;
            color =
              ((a + (CHANNEL_MAX - a) * fogT) << SHIFT_ALPHA) |
              ((r + (CHANNEL_MAX - r) * fogT) << SHIFT_RED) |
              ((g + (CHANNEL_MAX - g) * fogT) << SHIFT_GREEN) |
              (b + (CHANNEL_MAX - b) * fogT);
          }
        }
        for (let y = yHit; (y < H) | 0; y = (y + 1) | 0) {
          pixels[(y * localWidth + localX) | 0] = color;
        }
        H = yHit;
        horizon[localX] = H;
      }

      if (fogWhite) {
        if (H === 0) {
          break;
        }
        if ((H !== height) | 0) {
          const tanH = lut[H];
          if (Number.isFinite(tanH) && tanH >= 0) {
            if (altitude < camZ + t * tanH - EPSILON) {
              break;
            }
          }
        }
      }

      t += step;
      step += STEP_GROWTH;
    }
  }

  return pixels;
}
