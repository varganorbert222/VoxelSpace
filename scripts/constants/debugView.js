"use strict";

import { ALGORITHM_CUBEMAP, ALGORITHM_PANORAMA } from "./algorithm.js";
import {
  CUBE_FACE_NX,
  CUBE_FACE_NY,
  CUBE_FACE_NZ,
  CUBE_FACE_PX,
  CUBE_FACE_PY,
  CUBE_FACE_PZ,
} from "./cubemap.js";

export const DEBUG_VIEW_COLOR = "color";
export const DEBUG_VIEW_HEIGHT = "height";
export const DEBUG_VIEW_DEPTH = "depth";
export const DEBUG_VIEW_ITERATIONS = "iterations";

export const DEBUG_VIEW_COLOR_ID = 0;
export const DEBUG_VIEW_HEIGHT_ID = 1;
export const DEBUG_VIEW_DEPTH_ID = 2;
export const DEBUG_VIEW_ITERATIONS_ID = 3;

export const DEBUG_VIEW_IDS = Object.freeze({
  [DEBUG_VIEW_COLOR]: DEBUG_VIEW_COLOR_ID,
  [DEBUG_VIEW_HEIGHT]: DEBUG_VIEW_HEIGHT_ID,
  [DEBUG_VIEW_DEPTH]: DEBUG_VIEW_DEPTH_ID,
  [DEBUG_VIEW_ITERATIONS]: DEBUG_VIEW_ITERATIONS_ID,
});

export const DEBUG_VIEW_LABEL = Object.freeze({
  [DEBUG_VIEW_COLOR]: "Color",
  [DEBUG_VIEW_HEIGHT]: "Height",
  [DEBUG_VIEW_DEPTH]: "Depth",
  [DEBUG_VIEW_ITERATIONS]: "Iterations",
});

export const ITER_VIS_MAX = 256;

export const DEBUG_LEGEND_ID = "id_debug_legend";
export const DEBUG_LEGEND_RAMP_GRAY = "gray";
export const DEBUG_LEGEND_RAMP_ITER = "iter";

export const DEBUG_VIEW_LEGEND = Object.freeze({
  [DEBUG_VIEW_HEIGHT]: Object.freeze({
    title: "Height",
    low: "0",
    high: "255",
    miss: "Sky / miss",
    caption: "Heightmap byte at the hit. Black is 0 (and unhit sky). White is 255.",
    ramp: DEBUG_LEGEND_RAMP_GRAY,
  }),
  [DEBUG_VIEW_DEPTH]: Object.freeze({
    title: "Depth",
    low: "Near",
    high: "Far",
    miss: "Sky / miss",
    caption: "Hit distance scaled by far clip. Black is near the camera (and unhit sky). White is the far plane.",
    ramp: DEBUG_LEGEND_RAMP_GRAY,
  }),
  [DEBUG_VIEW_ITERATIONS]: Object.freeze({
    title: "Iterations",
    low: "1",
    high: String(ITER_VIS_MAX) + "+",
    miss: "Miss",
    caption:
      "March steps until a hit. Red is few steps. Magenta is " +
      String(ITER_VIS_MAX) +
      " or more.",
    ramp: DEBUG_LEGEND_RAMP_ITER,
  }),
});

export const DEBUG_OVERLAY_MARGIN = 8;
export const DEBUG_OVERLAY_WIDTH_FRAC = 0.55;
export const OVERLAY_BORDER = 2;
export const OVERLAY_SHADOW = 4;
export const OVERLAY_PAD = 6;
export const CUBE_NET_GAP = 8;

export const CUBE_NET_CELL_W = 4;
export const CUBE_NET_CELL_H = 3;

export const CUBE_NET_CELLS = Object.freeze([
  Object.freeze({ face: CUBE_FACE_PZ, cx: 1, cy: 0, rot: 1 }),
  Object.freeze({ face: CUBE_FACE_PY, cx: 0, cy: 1, rot: 0 }),
  Object.freeze({ face: CUBE_FACE_PX, cx: 1, cy: 1, rot: 0 }),
  Object.freeze({ face: CUBE_FACE_NY, cx: 2, cy: 1, rot: 0 }),
  Object.freeze({ face: CUBE_FACE_NX, cx: 3, cy: 1, rot: 0 }),
  Object.freeze({ face: CUBE_FACE_NZ, cx: 1, cy: 2, rot: 3 }),
]);

export function cubeNetApplyRot(i, j, last, rot) {
  const r = rot & 3;
  if (r === 1) {
    return { i: j, j: (last - i) | 0 };
  }
  if (r === 2) {
    return { i: (last - i) | 0, j: (last - j) | 0 };
  }
  if (r === 3) {
    return { i: (last - j) | 0, j: i };
  }
  return { i: i, j: j };
}

export function overlayChromeExtra() {
  const inset = ((OVERLAY_BORDER + OVERLAY_PAD) * 2) | 0;
  return {
    w: (inset + OVERLAY_SHADOW) | 0,
    h: (inset + OVERLAY_SHADOW) | 0,
  };
}

export function overlayPanelRect(full) {
  return {
    x: full.x | 0,
    y: full.y | 0,
    w: ((full.w | 0) - OVERLAY_SHADOW) | 0,
    h: ((full.h | 0) - OVERLAY_SHADOW) | 0,
  };
}

export function overlayContentRect(full) {
  const inset = (OVERLAY_BORDER + OVERLAY_PAD) | 0;
  const panel = overlayPanelRect(full);
  return {
    x: (panel.x + inset) | 0,
    y: (panel.y + inset) | 0,
    w: (panel.w - inset * 2) | 0,
    h: (panel.h - inset * 2) | 0,
  };
}

export function cubeNetCellRect(rect, cx, cy) {
  const gap = CUBE_NET_GAP;
  const usableW = (rect.w - gap * (CUBE_NET_CELL_W - 1)) | 0;
  const usableH = (rect.h - gap * (CUBE_NET_CELL_H - 1)) | 0;
  const cw = (usableW / CUBE_NET_CELL_W) | 0;
  const ch = (usableH / CUBE_NET_CELL_H) | 0;
  return {
    x: (rect.x + cx * (cw + gap)) | 0,
    y: (rect.y + cy * (ch + gap)) | 0,
    w: cw,
    h: ch,
  };
}

export function debugViewId(value) {
  const id = DEBUG_VIEW_IDS[value];
  return id == null ? DEBUG_VIEW_COLOR_ID : id;
}

export function isDebugColor(value) {
  return !value || value === DEBUG_VIEW_COLOR;
}

export function needsHeightBuf(value) {
  return value === DEBUG_VIEW_HEIGHT;
}

export function needsIterBuf(value) {
  return value === DEBUG_VIEW_ITERATIONS;
}

export function envOverlayAllowed(algorithm) {
  return algorithm === ALGORITHM_PANORAMA || algorithm === ALGORITHM_CUBEMAP;
}

export function overlayDestRect(screenW, screenH, aspectW, aspectH) {
  const margin = DEBUG_OVERLAY_MARGIN;
  const extra = overlayChromeExtra();
  let w = (screenW - margin * 2) | 0;
  const cap = (screenW * DEBUG_OVERLAY_WIDTH_FRAC) | 0;
  if ((w > cap) | 0) {
    w = cap;
  }
  let innerW = (w - extra.w) | 0;
  if ((innerW < 1) | 0) {
    innerW = 1;
  }
  let innerH = ((innerW * aspectH) / aspectW) | 0;
  const maxInnerH = (screenH - margin * 2 - extra.h) | 0;
  if ((innerH > maxInnerH) | 0) {
    innerH = maxInnerH;
    innerW = ((innerH * aspectW) / aspectH) | 0;
  }
  if ((innerW < 1) | 0) innerW = 1;
  if ((innerH < 1) | 0) innerH = 1;
  w = (innerW + extra.w) | 0;
  const h = (innerH + extra.h) | 0;
  const x = ((screenW - w) >> 1) | 0;
  let y = (screenH - margin - h) | 0;
  if ((y < margin) | 0) {
    y = margin;
  }
  return { x: x, y: y, w: w, h: h };
}
