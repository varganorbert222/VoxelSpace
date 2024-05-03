"use strict";

class VMath {
  static DEG_TO_RAD = 0.01745329;

  static degToRad(deg) {
    return deg * VMath.DEG_TO_RAD;
  }

  static clamp(min, max, value) {
    return Math.min(Math.max(value, min), max);
  }
}

export default VMath;
