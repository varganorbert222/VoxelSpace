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
import { HALF, TWO_PI } from "./constants/vmath.js";

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
  skyColor,
  horizonColor,
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
  const tanHalf = Math.tan(fovY * VMath.DEG_TO_RAD * HALF);
  const invWidth = 1 / screenWidth;
  const invHeight = 1 / screenHeight;
  const panoLast = (panoramaHeight - 1) | 0;

  for (let sy = 0; (sy < screenHeight) | 0; sy = (sy + 1) | 0) {
    const ndcY = 1 - (sy + PIXEL_CENTER) * invHeight * NDC_SCALE;
    const cyBase = ndcY * tanHalf;
    const row = (sy * stride) | 0;

    for (let sx = startColumn; (sx < endColumn) | 0; sx = (sx + 1) | 0) {
      const ndcX = (sx + PIXEL_CENTER) * invWidth * NDC_SCALE - 1;
      let cx = ndcX * aspect * tanHalf;
      let cy = cyBase;
      let cz = 1;
      const invLen = 1 / Math.sqrt(cx * cx + cy * cy + cz * cz);
      cx *= invLen;
      cy *= invLen;
      cz *= invLen;

      const worldX = rightX * cx + upX * cy + fwdX * cz;
      const worldY = rightY * cx + upY * cy + fwdY * cz;
      const worldZ = rightZ * cx + upZ * cy + fwdZ * cz;

      const theta = Math.atan2(-worldX, -worldY);
      const phi = Math.asin(VMath.clamp(-1, 1, worldZ));
      let u = theta / TWO_PI;
      u = ((u % 1) + 1) % 1;
      const v = VMath.clamp(0, 1, HALF - phi / Math.PI);

      let px = (u * panoramaWidth) | 0;
      if ((px >= panoramaWidth) | 0) px = 0;
      let py = (v * panoramaHeight) | 0;
      if ((py > panoLast) | 0) py = panoLast;

      const dest = (row + ((sx - startColumn) | 0)) | 0;
      if ((py < horizon[px]) | 0) {
        pixels[dest] = palette.getColor(skyPaletteT(v * 2));
        continue;
      }

      pixels[dest] = panorama[(py * panoramaWidth + px) | 0];
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
  skyColor,
  horizonColor,
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
    skyColor,
    horizonColor,
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
