"use strict";

import { Color } from "./color.js";
import ColorPalette from "./colorpalette.js";
import VMath from "./vmath.js";
import {
  SKY_PALETTE_STEPS,
  SKY_PALETTE_T_MAX,
} from "./constants/framebuffer.js";
import {
  STEP_GROWTH,
  MIN_SAMPLE_DISTANCE,
} from "./constants/renderer.js";
import { HALF, TWO_PI } from "./constants/vmath.js";

export function generateSphericalPanorama({
  terrain,
  camX,
  camY,
  camZ,
  width,
  height,
  farClip,
  nearClip,
  applyFog,
  repeat,
  skyColor,
  initialStep,
  pixels,
  horizon,
}) {
  const palette = new ColorPalette(skyColor, Color.WHITE, SKY_PALETTE_STEPS);
  const h2 = height * HALF;
  for (let y = 0; (y < height) | 0; y = (y + 1) | 0) {
    let t = y / h2;
    if ((t < 0) | 0) t = 0;
    if (t > SKY_PALETTE_T_MAX) t = SKY_PALETTE_T_MAX;
    const color = palette.getColor(t);
    const row = (y * width) | 0;
    for (let x = 0; (x < width) | 0; x = (x + 1) | 0) {
      pixels[row + x] = color;
    }
  }

  const mapW = terrain.width;
  const mapH = terrain.height;

  for (let px = 0; (px < width) | 0; px = (px + 1) | 0) {
    const theta = (px / width) * TWO_PI;
    const dirX = -Math.sin(theta);
    const dirY = -Math.cos(theta);
    horizon[px] = height;

    let t = Math.max(nearClip, initialStep, MIN_SAMPLE_DISTANCE);
    let step = initialStep;
    if ((step <= 0) | 0) step = MIN_SAMPLE_DISTANCE;
    let wasInside = 0;

    while ((t < farClip) | 0) {
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

      const h = terrain.getTerrainHeight(wx, wy);
      const phiHit = Math.atan2(h - camZ, t);
      let yHit = ((HALF - phiHit / Math.PI) * height) | 0;
      if ((yHit < 0) | 0) yHit = 0;
      if ((yHit > height) | 0) yHit = height;

      if ((yHit < horizon[px]) | 0) {
        let color = terrain.getTerrainColor(wx, wy);
        if (applyFog) {
          const depth = VMath.clamp(0, 1, VMath.invLerp(nearClip, farClip, t));
          color = Color.lerp(color, Color.WHITE, depth);
        }
        const yEnd = horizon[px];
        for (let y = yHit; (y < yEnd) | 0; y = (y + 1) | 0) {
          pixels[(y * width + px) | 0] = color;
        }
        horizon[px] = yHit;
      }

      t += step;
      step += STEP_GROWTH;
    }
  }

  return pixels;
}
