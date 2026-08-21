"use strict";

import { Color } from "../../math/color.js";
import { CHANNEL_MAX } from "../../constants/color.js";

// Canvas ImageData is RGBA in memory. This engine packs uint32 as
// (a<<24)|(namedR<<16)|(namedG<<8)|namedB, with CHANNEL_BLUE=0 and
// CHANNEL_RED=2, so named R/B are swapped vs physical RGB. Little-endian
// bytes of that uint32 are already [R, G, B, A]. WebGPU rgba8unorm and
// shader packRgba use physical RGB — copy the bits, do not unpack by name.

export function cpuU32ToRgba8(u32) {
  const c = Color.unpackColor(u32);
  return [c.b, c.g, c.r, c.a];
}

export function rgba8ToCpuU32(r, g, b, a) {
  return Color.makeColor(b, g, r, a == null ? CHANNEL_MAX : a);
}

export function unpackToVec4(u32) {
  const c = Color.unpackColor(u32);
  return [c.b / CHANNEL_MAX, c.g / CHANNEL_MAX, c.r / CHANNEL_MAX, c.a / CHANNEL_MAX];
}

export function expandColorMapRgba8(colorMap) {
  return new Uint8Array(colorMap.buffer, colorMap.byteOffset, colorMap.byteLength);
}

export function packRgbaU32(r, g, b, a) {
  return (
    (r & 255) |
    ((g & 255) << 8) |
    ((b & 255) << 16) |
    ((a & 255) << 24)
  );
}

export function cpuU32ToPackedRgba(u32) {
  return u32 >>> 0;
}

export function expandSkyRowsPacked(colors) {
  const n = colors.length;
  const out = new Uint32Array(n);
  for (let i = 0; (i < n) | 0; i = (i + 1) | 0) {
    out[i] = cpuU32ToPackedRgba(colors[i]);
  }
  return out;
}
