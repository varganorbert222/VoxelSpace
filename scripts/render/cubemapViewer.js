"use strict";

import ColorPalette from "../math/colorPalette.js";
import { Color } from "../math/color.js";
import {
  PIXEL_CENTER,
  NDC_SCALE,
} from "../constants/panoramaViewer.js";
import {
  SKY_PALETTE_STEPS,
  skyLutIndexFromHat,
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
import { DEG_TO_RAD, HALF } from "../constants/vmath.js";
import { cubeFaceOffset, cubeSelectInto, cubeUVToTexelInto } from "../constants/cubemap.js";
import { isDebugColor } from "../constants/debugView.js";
import { encodeCameraSample } from "./debugEncode.js";

const skyLutCache = {
  skyColor: NaN,
  horizonColor: NaN,
  height: 0,
  lut: null,
};

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

export function renderCubemapViewColumns({
  cubeColor,
  cubeDepth,
  cubeN,
  fovY,
  dstToProjPlane,
  screenWidth,
  screenHeight,
  startColumn,
  endColumn,
  pixels,
  pixelWidth,
  fillUnfilled,
  skyColor,
  horizonColor,
  nearClip,
    farClip,
    applyFog,
    fogStart = 0,
    fogEnd,
    debugView,
  cubeHeight,
  cubeIter,
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
    pixels.fill(0);
  }
  const n = cubeN | 0;
  const skyLut = getSkyLut(skyColor, horizonColor, screenHeight);
  const depthBuf = cubeDepth;
  const sel = { face: 0, u: 0, v: 0 };
  const tex = { i: 0, j: 0 };
  const aspect = screenWidth / screenHeight;
  let tanHalfY = Math.tan(fovY * DEG_TO_RAD * HALF);
  if (!(tanHalfY > 0) && dstToProjPlane > 0) {
    tanHalfY = (screenHeight * HALF) / dstToProjPlane;
  }
  const tanHalfX = tanHalfY * aspect;
  const invW = 1 / screenWidth;
  const invH = 1 / screenHeight;
  const fogStop = Number.isFinite(fogEnd) ? fogEnd : farClip;
  const fogRange = fogStop - fogStart;
  const invFogRange = fogRange === 0 ? 0 : 1 / fogRange;
  const useFog = applyFog | 0;
  const debug = isDebugColor(debugView) ? 0 : 1;
  const dCamX = NDC_SCALE * tanHalfX * invW;
  const camX0 =
    ((startColumn + PIXEL_CENTER) * invW * NDC_SCALE - 1) * tanHalfX;
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
      cubeSelectInto(dx, dy, dz, sel);
      cubeUVToTexelInto(sel.u, sel.v, n, tex);
      const idx = (cubeFaceOffset(sel.face, n) + tex.j * n + tex.i) | 0;
      const dest = (row + localX) | 0;
      const dist = depthBuf[idx];

      if (debug) {
        pixels[dest] = encodeCameraSample(
          debugView,
          dist,
          cubeHeight ? cubeHeight[idx] : 0,
          cubeIter ? cubeIter[idx] : 0,
          dist * invViewLen,
          farClip
        );
      } else if ((dist <= 0) | 0) {
        pixels[dest] = cubeColor[idx];
      } else {
        const viewZ = dist * invViewLen;
        if (
          ((useFog ^ 1) | 0) &
          (((viewZ >= farClip) | 0) | ((viewZ < nearClip) | 0))
        ) {
          pixels[dest] = skyLut[skyLutIndexFromHat(dz * invViewLen, screenHeight)];
        } else if (useFog) {
          const fogT =
            fogRange === 0 ? FOG_SATURATED : (viewZ - fogStart) * invFogRange;
          if (fogT >= FOG_SATURATED) {
            pixels[dest] = Color.WHITE;
          } else if (fogT > 0) {
            pixels[dest] = fogColor(cubeColor[idx], fogT);
          } else {
            pixels[dest] = cubeColor[idx];
          }
        } else {
          pixels[dest] = cubeColor[idx];
        }
      }
      camX += dCamX;
      dx += rdx;
      dy += rdy;
      dz += rdz;
    }
  }
}

export function renderCubemapView(params) {
  const fb = params.frameBuffer;
  renderCubemapViewColumns({
    cubeColor: params.cubeColor,
    cubeDepth: params.cubeDepth,
    cubeN: params.cubeN,
    fovY: params.fovY,
    dstToProjPlane: params.dstToProjPlane,
    screenWidth: fb.width,
    screenHeight: fb.height,
    startColumn: 0,
    endColumn: fb.width,
    pixels: fb.buffer32bit,
    pixelWidth: fb.width,
    fillUnfilled: 0,
    skyColor: params.skyColor,
    horizonColor: params.horizonColor,
    nearClip: params.nearClip,
    farClip: params.farClip,
    applyFog: params.applyFog,
    fogStart: params.fogStart,
    fogEnd: params.fogEnd,
    debugView: params.debugView,
    cubeHeight: params.cubeHeight,
    cubeIter: params.cubeIter,
    rightX: params.rightX,
    rightY: params.rightY,
    rightZ: params.rightZ,
    upX: params.upX,
    upY: params.upY,
    upZ: params.upZ,
    fwdX: params.fwdX,
    fwdY: params.fwdY,
    fwdZ: params.fwdZ,
  });
}
