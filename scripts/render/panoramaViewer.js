"use strict";

import ColorPalette from "../math/colorPalette.js";
import { Color } from "../math/color.js";
import { getPanoYHitLutSin, panoYHitFromHat } from "./panoramamarch.js";
import {
  PIXEL_CENTER,
  NDC_SCALE,
  PANO_VIEW_ATAN_LUT_SIZE,
} from "../constants/panoramaViewer.js";
import {
  SKY_PALETTE_STEPS,
  UNFILLED_PIXEL,
  skyPaletteT,
} from "../constants/framebuffer.js";
import {
  CHANNEL_MASK,
  CHANNEL_MAX,
  SHIFT_ALPHA,
  SHIFT_GREEN,
  SHIFT_RED,
} from "../constants/color.js";
import { FOG_SATURATED } from "../constants/quality.js";
import {
  DEG_TO_RAD,
  EPSILON,
  HALF,
  HALF_PI,
  INV_TWO_PI,
} from "../constants/vmath.js";

const atanLutLast = (PANO_VIEW_ATAN_LUT_SIZE - 1) | 0;
const atanLut = new Float64Array(PANO_VIEW_ATAN_LUT_SIZE);
for (let i = 0; (i <= atanLutLast) | 0; i = (i + 1) | 0) {
  atanLut[i] = Math.atan(i / atanLutLast);
}

const skyLutCache = {
  skyColor: NaN,
  horizonColor: NaN,
  height: 0,
  lut: null,
};

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

function getSkyLut(skyColor, horizonColor, height) {
  if (
    skyLutCache.lut &&
    skyLutCache.height === height &&
    skyLutCache.skyColor === skyColor &&
    skyLutCache.horizonColor === horizonColor
  ) {
    return skyLutCache.lut;
  }
  const palette = new ColorPalette(
    skyColor ?? Color.WHITE,
    horizonColor ?? Color.WHITE,
    SKY_PALETTE_STEPS
  );
  const lut = new Uint32Array(height);
  const h2 = height * HALF;
  for (let i = 0; (i < height) | 0; i = (i + 1) | 0) {
    lut[i] = palette.getColor(skyPaletteT(i / h2));
  }
  skyLutCache.skyColor = skyColor;
  skyLutCache.horizonColor = horizonColor;
  skyLutCache.height = height;
  skyLutCache.lut = lut;
  return lut;
}

export function renderPanoramaViewColumns({
  panorama,
  panoramaWidth,
  panoramaHeight,
  fovY,
  dstToProjPlane,
  screenWidth,
  screenHeight,
  startColumn,
  endColumn,
  pixels,
  pixelWidth,
  fillUnfilled,
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

  const panoLast = (panoramaHeight - 1) | 0;
  const panoW = panoramaWidth;
  const skyLut = getSkyLut(skyColor, horizonColor, panoramaHeight);
  const yHitLut = getPanoYHitLutSin(panoramaHeight);
  const depthBuf = depth;

  const aspect = screenWidth / screenHeight;
  let tanHalfY = Math.tan(fovY * DEG_TO_RAD * HALF);
  if (!(tanHalfY > 0) && dstToProjPlane > 0) {
    tanHalfY = (screenHeight * HALF) / dstToProjPlane;
  }
  const tanHalfX = tanHalfY * aspect;
  const invW = 1 / screenWidth;
  const invH = 1 / screenHeight;
  const fogRange = farClip - nearClip;
  const invFogRange = fogRange === 0 ? 0 : 1 / fogRange;
  const useFog = applyFog | 0;
  const dCamX = NDC_SCALE * tanHalfX * invW;
  const camX0 =
    ((startColumn + PIXEL_CENTER) * invW * NDC_SCALE - 1) * tanHalfX;
  const pxScale = panoW * INV_TWO_PI;
  const rdx = rightX * dCamX;
  const rdy = rightY * dCamX;
  const rdz = rightZ * dCamX;

  for (let sy = 0; (sy < screenHeight) | 0; sy = (sy + 1) | 0) {
    const camY = (1 - (sy + PIXEL_CENTER) * invH * NDC_SCALE) * tanHalfY;
    const row = (sy * stride) | 0;
    const viewLen2Base = camY * camY + 1;
    let camX = camX0;
    let dx = rightX * camX0 + upX * camY + fwdX;
    let dy = rightY * camX0 + upY * camY + fwdY;
    let dz = rightZ * camX0 + upZ * camY + fwdZ;

    for (
      let sx = startColumn, localX = 0;
      (sx < endColumn) | 0;
      sx = (sx + 1) | 0, localX = (localX + 1) | 0
    ) {
      const invViewLen = 1 / Math.sqrt(camX * camX + viewLen2Base);
      let py = panoYHitFromHat(dz * invViewLen, yHitLut);
      if ((py < 0) | 0) py = 0;
      if ((py > panoLast) | 0) py = panoLast;

      const theta = atan2Lut(-dx, -dy);
      let px = (theta * pxScale + panoW) | 0;
      if ((px >= panoW) | 0) px = (px - panoW) | 0;
      if ((px < 0) | 0) px = (px + panoW) | 0;

      const dest = (row + localX) | 0;
      const panoIdx = (py * panoW + px) | 0;
      const dist = depthBuf[panoIdx];

      if ((dist <= 0) | 0) {
        pixels[dest] = panorama[panoIdx];
      } else {
        const viewZ = dist * invViewLen;
        if (
          ((useFog ^ 1) | 0) &
          (((viewZ >= farClip) | 0) | ((viewZ < nearClip) | 0))
        ) {
          pixels[dest] = skyLut[py];
        } else if (useFog) {
          const fogT =
            fogRange === 0 ? FOG_SATURATED : (viewZ - nearClip) * invFogRange;
          if (fogT >= FOG_SATURATED) {
            pixels[dest] = Color.WHITE;
          } else if (fogT > 0) {
            pixels[dest] = fogColor(panorama[panoIdx], fogT);
          } else {
            pixels[dest] = panorama[panoIdx];
          }
        } else {
          pixels[dest] = panorama[panoIdx];
        }
      }
      camX += dCamX;
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
  dstToProjPlane,
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
    dstToProjPlane,
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
