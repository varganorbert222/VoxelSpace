"use strict";

import { Color } from "../math/color.js";
import { CHANNEL_MAX } from "../constants/color.js";
import {
  DEBUG_VIEW_COLOR,
  DEBUG_VIEW_DEPTH,
  DEBUG_VIEW_HEIGHT,
  ITER_VIS_MAX,
  isDebugColor,
} from "../constants/debugView.js";

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
  return encodeIter(iter);
}

export function encodeAtlasSample(debugView, color, dist, heightByte, iter, farClip) {
  if (isDebugColor(debugView)) {
    return color >>> 0;
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
    const t = farClip > 0 ? dist / farClip : 0;
    return encodeUnit(t);
  }
  return encodeIter(iter);
}
