"use strict";

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

export function debugViewId(value) {
  const id = DEBUG_VIEW_IDS[value];
  return id == null ? DEBUG_VIEW_COLOR_ID : id;
}

export function isDebugColor(value) {
  return !value || value === DEBUG_VIEW_COLOR;
}

