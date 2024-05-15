"use strict";

class VMath {
  static get DEG_TO_RAD() {
    return 0.01745329;
  }

  static get RAD_TO_DEG() {
    return 57.29577951;
  }

  static get FEET_TO_METER() {
    return 0.3048;
  }

  static clamp(min, max, value) {
    return Math.min(Math.max(value, min), max);
  }

  static feetToMeter(feet) {
    return feet * VMath.FEET_TO_METER;
  }

  static invLerp(from, to, value) {
    return (value - from) / (to - from);
  }

  static lerp(from, to, time) {
    return (1 - time) * from + time * to;
  }

  static angle(vector1, vector2) {
    return Math.atan2(vector2.y, vector2.x) - Math.atan2(vector1.y, vector1.x);
  }
}

export default VMath;
