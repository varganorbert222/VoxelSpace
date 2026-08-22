"use strict";

import { Color } from "../math/color.js";
import {
  CUBE_NET_CELLS,
  CUBE_NET_CELL_H,
  CUBE_NET_CELL_W,
  OVERLAY_BORDER,
  OVERLAY_SHADOW,
  cubeNetApplyRot,
  cubeNetCellRect,
  envOverlayAllowed,
  overlayContentRect,
  overlayDestRect,
  overlayPanelRect,
} from "../constants/debugView.js";
import { cubeFaceOffset } from "../constants/cubemap.js";
import { encodeAtlasSample } from "./debugEncode.js";

const HUD_BG = Color.hexToColor("#12160c");
const HUD_HI = Color.hexToColor("#d4e06a");
const HUD_LO = Color.hexToColor("#3a4020");
const HUD_SHADOW = Color.BLACK;

function putPixel(pixels, stride, screenW, screenH, x, y, color) {
  if ((x < 0) | (x >= screenW) | (y < 0) | (y >= screenH)) {
    return;
  }
  pixels[(y * stride + x) | 0] = color;
}

function fillRect(pixels, stride, screenW, screenH, x, y, w, h, color) {
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = (x0 + (w | 0)) | 0;
  const y1 = (y0 + (h | 0)) | 0;
  for (let j = y0; (j < y1) | 0; j = (j + 1) | 0) {
    if ((j < 0) | (j >= screenH)) {
      continue;
    }
    const row = (j * stride) | 0;
    for (let i = x0; (i < x1) | 0; i = (i + 1) | 0) {
      if ((i < 0) | (i >= screenW)) {
        continue;
      }
      pixels[(row + i) | 0] = color;
    }
  }
}

function strokeBevel(pixels, stride, screenW, screenH, x, y, w, h, hi, lo, thick) {
  const t = thick | 0;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = (x0 + (w | 0)) | 0;
  const y1 = (y0 + (h | 0)) | 0;
  if ((w < 1) | (h < 1) | (t < 1)) {
    return;
  }
  for (let k = 0; (k < t) | 0; k = (k + 1) | 0) {
    const yy = (y0 + k) | 0;
    for (let i = x0; (i < x1) | 0; i = (i + 1) | 0) {
      putPixel(pixels, stride, screenW, screenH, i, yy, hi);
    }
  }
  for (let k = 0; (k < t) | 0; k = (k + 1) | 0) {
    const xx = (x0 + k) | 0;
    for (let j = y0; (j < y1) | 0; j = (j + 1) | 0) {
      putPixel(pixels, stride, screenW, screenH, xx, j, hi);
    }
  }
  for (let k = 0; (k < t) | 0; k = (k + 1) | 0) {
    const yy = (y1 - 1 - k) | 0;
    for (let i = x0; (i < x1) | 0; i = (i + 1) | 0) {
      putPixel(pixels, stride, screenW, screenH, i, yy, lo);
    }
  }
  for (let k = 0; (k < t) | 0; k = (k + 1) | 0) {
    const xx = (x1 - 1 - k) | 0;
    for (let j = y0; (j < y1) | 0; j = (j + 1) | 0) {
      putPixel(pixels, stride, screenW, screenH, xx, j, lo);
    }
  }
}

function paintOverlayChrome(pixels, stride, screenW, screenH, full) {
  const panel = overlayPanelRect(full);
  if ((panel.w < 1) | (panel.h < 1)) {
    return;
  }
  fillRect(
    pixels,
    stride,
    screenW,
    screenH,
    (panel.x + OVERLAY_SHADOW) | 0,
    (panel.y + OVERLAY_SHADOW) | 0,
    panel.w,
    panel.h,
    HUD_SHADOW
  );
  fillRect(pixels, stride, screenW, screenH, panel.x, panel.y, panel.w, panel.h, HUD_BG);
  strokeBevel(
    pixels,
    stride,
    screenW,
    screenH,
    panel.x,
    panel.y,
    panel.w,
    panel.h,
    HUD_HI,
    HUD_LO,
    OVERLAY_BORDER
  );
}

function blitPano(opts) {
  const pixels = opts.pixels;
  const screenW = opts.screenW | 0;
  const screenH = opts.screenH | 0;
  const panoW = opts.panoW | 0;
  const panoH = opts.panoH | 0;
  const color = opts.panoColor;
  const depth = opts.panoDepth;
  const height = opts.panoHeight;
  const iter = opts.panoIter;
  if (!color || (panoW < 1) | (panoH < 1)) {
    return;
  }
  const full = overlayDestRect(screenW, screenH, 2, 1);
  const stride = screenW;
  paintOverlayChrome(pixels, stride, screenW, screenH, full);
  const rect = overlayContentRect(full);
  if ((rect.w < 1) | (rect.h < 1)) {
    return;
  }
  const farClip = opts.farClip;
  const debugView = opts.debugView;
  for (let dy = 0; (dy < rect.h) | 0; dy = (dy + 1) | 0) {
    const sy = (rect.y + dy) | 0;
    if ((sy < 0) | (sy >= screenH)) {
      continue;
    }
    const srcY = ((dy + 0.5) * panoH) / rect.h;
    let j = srcY | 0;
    if ((j < 0) | 0) j = 0;
    if ((j >= panoH) | 0) j = (panoH - 1) | 0;
    const row = (sy * stride) | 0;
    const srcRow = (j * panoW) | 0;
    for (let dx = 0; (dx < rect.w) | 0; dx = (dx + 1) | 0) {
      const sx = (rect.x + dx) | 0;
      if ((sx < 0) | (sx >= screenW)) {
        continue;
      }
      const srcX = ((dx + 0.5) * panoW) / rect.w;
      let i = srcX | 0;
      if ((i < 0) | 0) i = 0;
      if ((i >= panoW) | 0) i = (panoW - 1) | 0;
      const idx = (srcRow + i) | 0;
      pixels[(row + sx) | 0] = encodeAtlasSample(
        debugView,
        color[idx],
        depth ? depth[idx] : 0,
        height ? height[idx] : 0,
        iter ? iter[idx] : 0,
        farClip
      );
    }
  }
  strokeBevel(
    pixels,
    stride,
    screenW,
    screenH,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    HUD_LO,
    HUD_HI,
    OVERLAY_BORDER
  );
}

function blitCubeFace(opts, cell, contentRect) {
  const pixels = opts.pixels;
  const screenW = opts.screenW | 0;
  const screenH = opts.screenH | 0;
  const n = opts.cubeN | 0;
  const color = opts.cubeColor;
  const depth = opts.cubeDepth;
  const height = opts.cubeHeight;
  const iter = opts.cubeIter;
  const cellRect = cubeNetCellRect(contentRect, cell.cx, cell.cy);
  const cw = cellRect.w | 0;
  const ch = cellRect.h | 0;
  if ((cw < 1) | (ch < 1)) {
    return;
  }
  const farClip = opts.farClip;
  const debugView = opts.debugView;
  const stride = screenW;
  const last = (n - 1) | 0;
  const rot = cell.rot | 0;
  const faceOff = cubeFaceOffset(cell.face, n);
  for (let dy = 0; (dy < ch) | 0; dy = (dy + 1) | 0) {
    const sy = (cellRect.y + dy) | 0;
    if ((sy < 0) | (sy >= screenH)) {
      continue;
    }
    const fy = (dy + 0.5) / ch;
    const row = (sy * stride) | 0;
    for (let dx = 0; (dx < cw) | 0; dx = (dx + 1) | 0) {
      const sx = (cellRect.x + dx) | 0;
      if ((sx < 0) | (sx >= screenW)) {
        continue;
      }
      const fx = (dx + 0.5) / cw;
      let i = (fx * n) | 0;
      let j = (fy * n) | 0;
      if ((i < 0) | 0) i = 0;
      if ((i > last) | 0) i = last;
      if ((j < 0) | 0) j = 0;
      if ((j > last) | 0) j = last;
      const tex = cubeNetApplyRot(i, j, last, rot);
      const idx = (faceOff + tex.j * n + tex.i) | 0;
      pixels[(row + sx) | 0] = encodeAtlasSample(
        debugView,
        color[idx],
        depth ? depth[idx] : 0,
        height ? height[idx] : 0,
        iter ? iter[idx] : 0,
        farClip
      );
    }
  }
  strokeBevel(
    pixels,
    stride,
    screenW,
    screenH,
    cellRect.x,
    cellRect.y,
    cw,
    ch,
    HUD_LO,
    HUD_HI,
    OVERLAY_BORDER
  );
}

function blitCube(opts) {
  const color = opts.cubeColor;
  const n = opts.cubeN | 0;
  if (!color || (n < 1) | 0) {
    return;
  }
  const screenW = opts.screenW | 0;
  const screenH = opts.screenH | 0;
  const full = overlayDestRect(screenW, screenH, CUBE_NET_CELL_W, CUBE_NET_CELL_H);
  paintOverlayChrome(opts.pixels, screenW, screenW, screenH, full);
  const content = overlayContentRect(full);
  if ((content.w < 1) | (content.h < 1)) {
    return;
  }
  for (let i = 0; (i < CUBE_NET_CELLS.length) | 0; i = (i + 1) | 0) {
    blitCubeFace(opts, CUBE_NET_CELLS[i], content);
  }
}

export function blitDebugOverlay(opts) {
  if (!opts || !opts.pixels) {
    return;
  }
  if (opts.cubeColor) {
    blitCube(opts);
    return;
  }
  blitPano(opts);
}

export function blitRendererOverlay(renderer, atlas) {
  if (!renderer || !atlas) {
    return;
  }
  if (!renderer.debugOverlay || !envOverlayAllowed(renderer.algorithm)) {
    return;
  }
  const fb = renderer.frameBuffer;
  blitDebugOverlay({
    pixels: fb.buffer32bit,
    screenW: fb.width,
    screenH: fb.height,
    debugView: renderer.debugView,
    farClip: renderer.camera.farClip,
    panoColor: atlas.panoColor,
    panoDepth: atlas.panoDepth,
    panoHeight: atlas.panoHeight,
    panoIter: atlas.panoIter,
    panoW: atlas.panoW,
    panoH: atlas.panoH,
    cubeColor: atlas.cubeColor,
    cubeDepth: atlas.cubeDepth,
    cubeHeight: atlas.cubeHeight,
    cubeIter: atlas.cubeIter,
    cubeN: atlas.cubeN,
  });
}
