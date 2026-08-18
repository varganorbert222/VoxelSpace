"use strict";

import { Color } from "./color.js";
import ColorPalette from "./colorpalette.js";
import VMath from "./vmath.js";

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
  const palette = new ColorPalette(skyColor, Color.WHITE, 24);
  const h2 = height * 0.5;
  for (let y = 0; (y < height) | 0; y = (y + 1) | 0) {
    let t = y / h2;
    if ((t < 0) | 0) t = 0;
    if (t > 23 / 24) t = 23 / 24;
    const color = palette.getColor(t);
    const row = (y * width) | 0;
    for (let x = 0; (x < width) | 0; x = (x + 1) | 0) {
      pixels[row + x] = color;
    }
  }

  const mapW = terrain.width;
  const mapH = terrain.height;

  for (let px = 0; (px < width) | 0; px = (px + 1) | 0) {
    const theta = (px / width) * Math.PI * 2;
    const dirX = -Math.sin(theta);
    const dirY = -Math.cos(theta);
    horizon[px] = height;

    let t = Math.max(nearClip, initialStep, 1);
    let step = Math.max(initialStep, 1);
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
          step += 0.005;
          continue;
        }
        wasInside = 1;
      }

      const h = terrain.getTerrainHeight(wx, wy);
      const phiHit = Math.atan2(h - camZ, t);
      let yHit = ((0.5 - phiHit / Math.PI) * height) | 0;
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
      step += 0.005;
    }
  }

  return pixels;
}
