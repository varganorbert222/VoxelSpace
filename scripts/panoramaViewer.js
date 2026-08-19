"use strict";

import ColorPalette from "./colorpalette.js";
import { Color } from "./color.js";
import { getPanoYHitLut, panoYHitFromHat } from "./panoramamarch.js";
import {
  PIXEL_CENTER,
  NDC_SCALE,
  PANO_VIEW_ATAN_LUT_SIZE,
  PANO_VIEW_SKY_LUT_SIZE,
} from "./constants/panoramaViewer.js";
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
import { EPSILON } from "./constants/camera.js";
import {
  DEG_TO_RAD,
  HALF,
  HALF_PI,
  INV_TWO_PI,
} from "./constants/vmath.js";

const atanLutLast = (PANO_VIEW_ATAN_LUT_SIZE - 1) | 0;
const atanLut = new Float64Array(PANO_VIEW_ATAN_LUT_SIZE);
for (let i = 0; (i <= atanLutLast) | 0; i = (i + 1) | 0) {
  atanLut[i] = Math.atan(i / atanLutLast);
}

function atan2Lut(y, x) {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  let ang;
  if (ay > ax) {
    if (ay < EPSILON) {
      ang = 0;
    } else {
      let idx = ((ax / ay) * atanLutLast) | 0;
      if ((idx > atanLutLast) | 0) idx = atanLutLast;
      ang = HALF_PI - atanLut[idx];
    }
  } else if (ax < EPSILON) {
    ang = 0;
  } else {
    let idx = ((ay / ax) * atanLutLast) | 0;
    if ((idx > atanLutLast) | 0) idx = atanLutLast;
    ang = atanLut[idx];
  }
  if (x < 0) ang = Math.PI - ang;
  if (y < 0) ang = -ang;
  return ang;
}

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
  const stride = pixelWidth;
  if (fillUnfilled) {
    pixels.fill(UNFILLED_PIXEL);
  }

  const palette = new ColorPalette(
    skyColor ?? Color.WHITE,
    horizonColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );
  const skyLutLast = (PANO_VIEW_SKY_LUT_SIZE - 1) | 0;
  const skyLut = new Uint32Array(PANO_VIEW_SKY_LUT_SIZE);
  for (let i = 0; (i <= skyLutLast) | 0; i = (i + 1) | 0) {
    skyLut[i] = palette.getColor(skyPaletteT(i / skyLutLast));
  }

  const aspect = screenWidth / screenHeight;
  const tanHalfY = Math.tan(fovY * DEG_TO_RAD * HALF);
  const tanHalfX = tanHalfY * aspect;
  const invWidth = 1 / screenWidth;
  const invHeight = 1 / screenHeight;
  const invTanHalfY = 1 / tanHalfY;
  const panoLast = (panoramaHeight - 1) | 0;
  const panoW = panoramaWidth;
  const fogRange = farClip - nearClip;
  const invFogRange = fogRange === 0 ? 0 : 1 / fogRange;
  const useFog = !!applyFog;
  const yHitLut = getPanoYHitLut(panoramaHeight);

  const dPlaneX = NDC_SCALE * tanHalfX * invWidth;
  const planeX0 =
    ((startColumn + PIXEL_CENTER) * invWidth * NDC_SCALE - 1) * tanHalfX;
  const rdx = rightX * dPlaneX;
  const rdy = rightY * dPlaneX;
  const rdz = rightZ * dPlaneX;

  for (let sy = 0; (sy < screenHeight) | 0; sy = (sy + 1) | 0) {
    const ndcY = 1 - (sy + PIXEL_CENTER) * invHeight * NDC_SCALE;
    const planeY = ndcY * tanHalfY;
    const row = (sy * stride) | 0;
    const rowHyp2 = planeY * planeY + 1;
    let planeX = planeX0;
    let dx = rightX * planeX0 + upX * planeY + fwdX;
    let dy = rightY * planeX0 + upY * planeY + fwdY;
    let dz = rightZ * planeX0 + upZ * planeY + fwdZ;

    for (
      let sx = startColumn, localX = 0;
      (sx < endColumn) | 0;
      sx = (sx + 1) | 0, localX = (localX + 1) | 0
    ) {
      const horiz = Math.sqrt(dx * dx + dy * dy);
      const absZ = dz < 0 ? -dz : dz;
      let py = panoYHitFromHat(dz / (horiz + absZ), yHitLut);
      if ((py < 0) | 0) py = 0;
      if ((py > panoLast) | 0) py = panoLast;

      const theta = atan2Lut(-dx, -dy);
      let px = ((theta * INV_TWO_PI + 1) * panoW) | 0;
      if ((px >= panoW) | 0) px = (px - panoW) | 0;
      if ((px < 0) | 0) px = (px + panoW) | 0;

      const dest = (row + localX) | 0;
      if ((py < horizon[px]) | 0) {
        let si = ((1 - dz * invTanHalfY) * skyLutLast) | 0;
        if ((si < 0) | 0) si = 0;
        if ((si > skyLutLast) | 0) si = skyLutLast;
        pixels[dest] = skyLut[si];
      } else {
        const panoIdx = (py * panoW + px) | 0;
        const dist = depth ? depth[panoIdx] : 0;
        const camZ = 1 / Math.sqrt(planeX * planeX + rowHyp2);
        const zPlane = dist * camZ;
        if ((zPlane < nearClip) | 0 || ((zPlane >= farClip) | 0 && !useFog)) {
          let si = ((1 - dz * invTanHalfY) * skyLutLast) | 0;
          if ((si < 0) | 0) si = 0;
          if ((si > skyLutLast) | 0) si = skyLutLast;
          pixels[dest] = skyLut[si];
        } else {
          let color = panorama[panoIdx];
          if (useFog) {
            const fogT =
              fogRange === 0
                ? FOG_SATURATED
                : (zPlane - nearClip) * invFogRange;
            if (fogT >= FOG_SATURATED) {
              pixels[dest] = Color.WHITE;
            } else {
              if (fogT > 0) {
                color = fogColor(color, fogT);
              }
              pixels[dest] = color;
            }
          } else {
            pixels[dest] = color;
          }
        }
      }
      planeX += dPlaneX;
      dx += rdx;
      dy += rdy;
      dz += rdz;
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
