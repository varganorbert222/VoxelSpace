"use strict";

import {
  FPS_ELEMENT_ID,
  FPS_UPDATE_MS,
  MS_PER_SECOND,
  FPS_DECIMALS,
  FPS_COLOR_MIN,
  FPS_COLOR_MAX,
  FPS_PALETTE_STEPS,
  FPS_GLOW_ALPHA,
} from "../constants/main.js";
import { CHANNEL_MAX } from "../constants/color.js";
import { Color } from "../math/color.js";
import ColorPalette from "../math/colorPalette.js";

const FPS_COLOR_LOW = Color.makeColor(255, 60, 60, CHANNEL_MAX);
const FPS_COLOR_MID = Color.makeColor(255, 191, 60, CHANNEL_MAX);
const FPS_COLOR_HIGH = Color.makeColor(157, 255, 74, CHANNEL_MAX);

class FpsCounter {
  constructor() {
    this._totalFrames = 0;
    this._lastTimeForFps = 0;
    this._lastLabel = "";
    this._element = null;
    this._lowPalette = new ColorPalette(
      FPS_COLOR_LOW,
      FPS_COLOR_MID,
      FPS_PALETTE_STEPS
    );
    this._highPalette = new ColorPalette(
      FPS_COLOR_MID,
      FPS_COLOR_HIGH,
      FPS_PALETTE_STEPS
    );
  }

  addFrame() {
    this._totalFrames++;
  }

  start() {
    this._element = document.getElementById(FPS_ELEMENT_ID);
    this._lastTimeForFps = new Date().getTime();
    window.setInterval(() => this._print(), FPS_UPDATE_MS);
  }

  _colorForFps(fps) {
    const span = FPS_COLOR_MAX - FPS_COLOR_MIN;
    let t = (fps - FPS_COLOR_MIN) / span;
    if (t < 0) {
      t = 0;
    } else if (t > 1) {
      t = 1;
    }
    if (t < 0.5) {
      return this._lowPalette.getColor(t * 2);
    }
    return this._highPalette.getColor((t - 0.5) * 2);
  }

  _print() {
    const currentTime = new Date().getTime();
    const elapsed = currentTime - this._lastTimeForFps;
    let fps = elapsed > 0 ? (this._totalFrames / elapsed) * MS_PER_SECOND : 0;
    if (!Number.isFinite(fps)) {
      fps = 0;
    }
    const label = fps.toFixed(FPS_DECIMALS) + " fps";
    if (label !== this._lastLabel) {
      const color = this._colorForFps(fps);
      this._element.innerText = label;
      this._element.style.setProperty("--hud-fps-color", Color.toCss(color));
      this._element.style.setProperty(
        "--hud-fps-glow",
        Color.toCssRgba(color, FPS_GLOW_ALPHA)
      );
      this._lastLabel = label;
    }
    this._totalFrames = 0;
    this._lastTimeForFps = currentTime;
  }
}

export default FpsCounter;
