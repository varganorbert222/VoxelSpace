"use strict";

class VMath {
  static DEG_TO_RAD = 0.01745329;
  static FEET_TO_METER = 0.3048;

  static degToRad(deg) {
    return deg * VMath.DEG_TO_RAD;
  }

  static clamp(min, max, value) {
    return Math.min(Math.max(value, min), max);
  }

  static feetToMeter(feet) {
    return feet * VMath.FEET_TO_METER;
  }
}

export default VMath;
