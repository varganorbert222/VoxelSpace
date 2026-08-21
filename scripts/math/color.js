"use strict";

import {
  CHANNEL_MAX,
  CHANNEL_MASK,
  SHIFT_ALPHA,
  SHIFT_RED,
  SHIFT_GREEN,
} from "../constants/color.js";

class Color {
  static get WHITE() {
    return 0xffffffff;
  }

  static get BLACK() {
    return 0xff000000;
  }

  static makeColor(r, g, b, a) {
    return (a << SHIFT_ALPHA) | (r << SHIFT_RED) | (g << SHIFT_GREEN) | b;
  }

  static unpackColor(color) {
    const a = (color >> SHIFT_ALPHA) & CHANNEL_MASK;
    const r = (color >> SHIFT_RED) & CHANNEL_MASK;
    const g = (color >> SHIFT_GREEN) & CHANNEL_MASK;
    const b = color & CHANNEL_MASK;

    return {
      a: a,
      r: r,
      g: g,
      b: b,
    };
  }

  static hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          b: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          r: parseInt(result[3], 16),
        }
      : null;
  }

  static hexToColor(hex) {
    const rgb = Color.hexToRgb(hex);
    return Color.makeColor(rgb.r, rgb.g, rgb.b, CHANNEL_MAX);
  }

  static lerp(color1, color2, time) {
    const c = Color.unpackColor(color1);
    const s = Color.unpackColor(color2);

    const cr = c.r + (s.r - c.r) * time;
    const cg = c.g + (s.g - c.g) * time;
    const cb = c.b + (s.b - c.b) * time;
    const ca = c.a + (s.a - c.a) * time;

    return Color.makeColor(cr, cg, cb, ca);
  }
}

export { Color };
