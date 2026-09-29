"use strict";

import { Color } from "../math/color.js";
import { CHANNEL_MAX } from "../constants/color.js";
import {
  DEBUG_VIEW_COLOR,
  DEBUG_VIEW_DEPTH,
  DEBUG_VIEW_HEIGHT,
  DEBUG_VIEW_LOD,
  ITER_VIS_MAX,
  isDebugColor,
} from "../constants/debugView.js";
import { LOD0_REFINE_MIP_COUNT, LOD0_REFINE_SWITCH_COUNT } from "../constants/mip.js";
import { retailNearEnd } from "./retail/schedule.js";

function phys(r, g, b) {
  return Color.makeColor(b, g, r, CHANNEL_MAX);
}

const ITER_STOPS = Object.freeze([
  Object.freeze({ t: 0, c: phys(255, 0, 0) }),
  Object.freeze({ t: 0.25, c: phys(255, 160, 0) }),
  Object.freeze({ t: 0.5, c: phys(255, 255, 0) }),
  Object.freeze({ t: 0.75, c: phys(144, 0, 255) }),
  Object.freeze({ t: 1, c: phys(255, 0, 255) }),
]);

function lerpStops(stops, t) {
  let u = t;
  if (!(u > 0)) {
    return stops[0].c;
  }
  if (u >= 1) {
    return stops[stops.length - 1].c;
  }
  for (let i = 1; (i < stops.length) | 0; i = (i + 1) | 0) {
    const hi = stops[i];
    if (u <= hi.t) {
      const lo = stops[i - 1];
      const span = hi.t - lo.t;
      const f = span === 0 ? 0 : (u - lo.t) / span;
      return Color.lerp(lo.c, hi.c, f);
    }
  }
  return stops[stops.length - 1].c;
}

export function encodeUnit(t) {
  if (!(t > 0)) {
    return Color.BLACK;
  }
  if (t >= 1) {
    return Color.WHITE;
  }
  return Color.lerp(Color.BLACK, Color.WHITE, t);
}

export function encodeHeight(byte) {
  return encodeUnit((byte & 255) / 255);
}

const LOD_HUE_STEP = 137.508;
const LOD_SAT = 0.92;
const LOD_VAL = 1;
const LOD_EDGE_FRAC = 0.05;
export const LOD_LEGEND_STEPS = 12;

function lodVisBytes(index) {
  const n = index > 0 ? index : 0;
  let hue = (n * LOD_HUE_STEP) % 360;
  if (hue < 0) {
    hue += 360;
  }
  const c = LOD_VAL * LOD_SAT;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = LOD_VAL - c;
  return phys(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  );
}

function lodOnEdge(t, lo, hi) {
  const width = hi - lo;
  if (!(width > 0)) {
    return false;
  }
  const tail = hi - t;
  return tail >= 0 && tail <= width * LOD_EDGE_FRAC;
}

export function lodLegendGradient(steps) {
  const n = steps > 1 ? steps | 0 : LOD_LEGEND_STEPS;
  const stops = [];
  for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
    const css = Color.toCss(lodVisBytes(i));
    const a = (i / n) * 100;
    const b = ((i + 1) / n) * 100;
    stops.push(css + " " + a + "%", css + " " + b + "%");
  }
  return "linear-gradient(to right, " + stops.join(", ") + ")";
}

export function encodeLodDistance(
  t,
  mip,
  refineHere,
  refineMip,
  refineSwitches,
  mipSwitches,
  farClip
) {
  if (!(t > 0)) {
    return Color.BLACK;
  }
  let index = (LOD0_REFINE_MIP_COUNT + (mip > 0 ? mip | 0 : 0)) | 0;
  let lo = 0;
  let hi = farClip;
  let mark = false;
  if (refineHere) {
    const m = refineMip | 0;
    index = m;
    if (m <= 0) {
      lo = 0;
      hi = refineSwitches[0];
    } else if (m >= LOD0_REFINE_SWITCH_COUNT) {
      lo = refineSwitches[LOD0_REFINE_SWITCH_COUNT - 1];
      hi = retailNearEnd();
    } else {
      lo = refineSwitches[m - 1];
      hi = refineSwitches[m];
    }
    mark = true;
  } else {
    const m = mip > 0 ? mip | 0 : 0;
    lo = m <= 0 ? retailNearEnd() : mipSwitches[m - 1];
    if (mipSwitches && (m < mipSwitches.length) | 0) {
      const s = mipSwitches[m];
      if (s > lo && s < farClip && s < 1e20) {
        hi = s;
        mark = true;
      }
    }
  }
  if (mark && lodOnEdge(t, lo, hi)) {
    return Color.WHITE;
  }
  return lodVisBytes(index);
}

export function encodeIter(iter) {
  const n = iter | 0;
  if ((n <= 0) | 0) {
    return Color.BLACK;
  }
  const t = n >= ITER_VIS_MAX ? 1 : n / ITER_VIS_MAX;
  return lerpStops(ITER_STOPS, t);
}

export function encodeCameraSample(debugView, dist, heightByte, iter, viewZ, farClip) {
  if (isDebugColor(debugView) || debugView === DEBUG_VIEW_COLOR) {
    return 0;
  }
  if (debugView === DEBUG_VIEW_HEIGHT) {
    if ((dist <= 0) | 0) {
      return Color.BLACK;
    }
    return encodeHeight(heightByte);
  }
  if (debugView === DEBUG_VIEW_DEPTH) {
    if ((dist <= 0) | 0) {
      return Color.BLACK;
    }
    const t = farClip > 0 ? viewZ / farClip : 0;
    return encodeUnit(t);
  }
  if (debugView === DEBUG_VIEW_LOD) {
    return Color.BLACK;
  }
  return encodeIter(iter);
}
