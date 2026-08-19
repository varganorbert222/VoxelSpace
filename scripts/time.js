"use strict";

const MS_PER_SECOND = 1000;
const MAX_DELTA_TIME = 1;

class Time {
  get deltaTime() {
    return this._deltaTime;
  }

  constructor() {
    this._lastTime = 0;
    this._deltaTime = 0;
  }

  tick() {
    const now = performance.now();
    if (this._lastTime === 0) {
      this._deltaTime = 0;
    } else {
      this._deltaTime = Math.min(
        (now - this._lastTime) / MS_PER_SECOND,
        MAX_DELTA_TIME
      );
    }
    this._lastTime = now;
  }
}

const time = new Time();
export default time;
