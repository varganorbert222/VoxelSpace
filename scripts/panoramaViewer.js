"use strict";

import VMath from "./vmath.js";
import ColorPalette from "./colorpalette.js";
import { Color } from "./color.js";
import { PIXEL_CENTER, NDC_SCALE } from "./constants/panoramaViewer.js";
import {
  SKY_PALETTE_STEPS,
  UNFILLED_PIXEL,
  skyPaletteT,
} from "./constants/framebuffer.js";
import {
  CHANNEL_MASK,
  CHANNEL_MAX,
  SHIFT_ALPHA,
  SHIFT_GREEN,
  SHIFT_RED,
} from "./constants/color.js";
import { FOG_SATURATED } from "./constants/renderer.js";
import { HALF, TWO_PI } from "./constants/vmath.js";

function fogColor(color, fogT) {
  const a = (color >>> SHIFT_ALPHA) & CHANNEL_MASK;
  const r = (color >>> SHIFT_RED) & CHANNEL_MASK;
  const g = (color >>> SHIFT_GREEN) & CHANNEL_MASK;
  const b = color & CHANNEL_MASK;
  return (
    ((a + (CHANNEL_MAX - a) * fogT) << SHIFT_ALPHA) |
    ((r + (CHANNEL_MAX - r) * fogT) << SHIFT_RED) |
    ((g + (CHANNEL_MAX - g) * fogT) << SHIFT_GREEN) |
    (b + (CHANNEL_MAX - b) * fogT)
  );
}

export function renderPanoramaViewColumns({
  panorama,
  panoramaWidth,
  panoramaHeight,
  fovY,
  screenWidth,
  screenHeight,
  startColumn,
  endColumn,
  pixels,
  pixelWidth,
  fillUnfilled,
  horizon,
  depth,
  skyColor,
  horizonColor,
  nearClip,
  farClip,
  applyFog,
  rightX,
  rightY,
  rightZ,
  upX,
  upY,
  upZ,
  fwdX,
  fwdY,
  fwdZ,
}) {
  const localWidth = (endColumn - startColumn) | 0;
  const stride = pixelWidth;
  if (fillUnfilled) {
    const n = (localWidth * screenHeight) | 0;
    for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
      pixels[i] = UNFILLED_PIXEL;
    }
  }

  const palette = new ColorPalette(
    skyColor ?? Color.WHITE,
    horizonColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );

  const aspect = screenWidth / screenHeight;
  const tanHalfY = Math.tan(fovY * VMath.DEG_TO_RAD * HALF);
  const tanHalfX = tanHalfY * aspect;
  const invWidth = 1 / screenWidth;
  const invHeight = 1 / screenHeight;
  const panoLast = (panoramaHeight - 1) | 0;
  const fogRange = farClip - nearClip;
  const invFogRange = fogRange === 0 ? 0 : 1 / fogRange;
  const useFog = !!applyFog;

  for (let sy = 0; (sy < screenHeight) | 0; sy = (sy + 1) | 0) {
    const ndcY = 1 - (sy + PIXEL_CENTER) * invHeight * NDC_SCALE;
    const planeY = ndcY * tanHalfY;
    const row = (sy * stride) | 0;

    for (let sx = startColumn; (sx < endColumn) | 0; sx = (sx + 1) | 0) {
      const ndcX = (sx + PIXEL_CENTER) * invWidth * NDC_SCALE - 1;
      const planeX = ndcX * tanHalfX;
      const invLen = 1 / Math.sqrt(planeX * planeX + planeY * planeY + 1);
      const camX = planeX * invLen;
      const camY = planeY * invLen;
      const camZ = invLen;

      const worldX = rightX * camX + upX * camY + fwdX * camZ;
      const worldY = rightY * camX + upY * camY + fwdY * camZ;
      const worldZ = rightZ * camX + upZ * camY + fwdZ * camZ;

      const theta = Math.atan2(-worldX, -worldY);
      const horiz = Math.hypot(worldX, worldY);
      const phi = Math.atan2(worldZ, horiz);
      let u = theta / TWO_PI;
      u = ((u % 1) + 1) % 1;
      const v = VMath.clamp(0, 1, HALF - phi / Math.PI);

      let px = (u * panoramaWidth) | 0;
      if ((px >= panoramaWidth) | 0) px = 0;
      let py = (v * panoramaHeight) | 0;
      if ((py > panoLast) | 0) py = panoLast;

      const dest = (row + ((sx - startColumn) | 0)) | 0;
      if ((py < horizon[px]) | 0) {
        const planeZ = rightZ * planeX + upZ * planeY + fwdZ;
        pixels[dest] = palette.getColor(skyPaletteT(1 - planeZ / tanHalfY));
        continue;
      }

      const panoIdx = (py * panoramaWidth + px) | 0;
      const dist = depth ? depth[panoIdx] : 0;
      const zPlane = dist * camZ;
      if ((zPlane < nearClip) | 0 || ((zPlane >= farClip) | 0 && !useFog)) {
        const planeZ = rightZ * planeX + upZ * planeY + fwdZ;
        pixels[dest] = palette.getColor(skyPaletteT(1 - planeZ / tanHalfY));
        continue;
      }

      let color = panorama[panoIdx];
      if (useFog) {
        const fogT =
          fogRange === 0
            ? FOG_SATURATED
            : (zPlane - nearClip) * invFogRange;
        if (fogT >= FOG_SATURATED) {
          pixels[dest] = Color.WHITE;
          continue;
        }
        if (fogT > 0) {
          color = fogColor(color, fogT);
        }
      }
      pixels[dest] = color;
    }
  }
}

export function renderPanoramaView({
  panorama,
  panoramaWidth,
  panoramaHeight,
  fovY,
  frameBuffer,
  horizon,
  depth,
  skyColor,
  horizonColor,
  nearClip,
  farClip,
  applyFog,
  rightX,
  rightY,
  rightZ,
  upX,
  upY,
  upZ,
  fwdX,
  fwdY,
  fwdZ,
}) {
  renderPanoramaViewColumns({
    panorama,
    panoramaWidth,
    panoramaHeight,
    fovY,
    screenWidth: frameBuffer.width,
    screenHeight: frameBuffer.height,
    startColumn: 0,
    endColumn: frameBuffer.width,
    pixels: frameBuffer.buffer32bit,
    pixelWidth: frameBuffer.width,
    fillUnfilled: 0,
    horizon,
    depth,
    skyColor,
    horizonColor,
    nearClip,
    farClip,
    applyFog,
    rightX,
    rightY,
    rightZ,
    upX,
    upY,
    upZ,
    fwdX,
    fwdY,
    fwdZ,
  });
}
