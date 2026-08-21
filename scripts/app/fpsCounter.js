"use strict";

import {
  FPS_ELEMENT_ID,
  FPS_UPDATE_MS,
  MS_PER_SECOND,
  FPS_DECIMALS,
} from "../constants/main.js";

class FpsCounter {
  constructor() {
    this._totalFrames = 0;
    this._lastTimeForFps = 0;
    this._lastFps = 0;
  }

  addFrame() {
    this._totalFrames++;
  }

  start() {
    window.setInterval(() => this._print(), FPS_UPDATE_MS);
  }

  _print() {
    const currentTime = new Date().getTime();
    const fps =
      (this._totalFrames / (currentTime - this._lastTimeForFps)) * MS_PER_SECOND;
    if (fps !== this._lastFps) {
      document.getElementById(FPS_ELEMENT_ID).innerText =
        fps.toFixed(FPS_DECIMALS) + " fps";
      this._lastFps = fps;
    }
    this._totalFrames = 0;
    this._lastTimeForFps = currentTime;
  }
}

export default FpsCounter;
