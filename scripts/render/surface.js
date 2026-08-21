"use strict";

import { CANVAS_ID } from "../constants/main.js";

class Surface {
  constructor(canvas, frameBuffer) {
    this._canvas = canvas;
    this._frameBuffer = frameBuffer;
    this._input = null;
  }

  setInput(input) {
    this._input = input;
  }

  getCanvas() {
    return this._canvas;
  }

  getFrameBuffer() {
    return this._frameBuffer;
  }

  replaceForWebgpu() {
    // Later (webgpu-implementation-prompt): clone/swap the node so the visible
    // canvas keeps #id_fullscreen_canvas, call getContext("webgpu") on the GPU
    // canvas only, rebind Input (pointer lock), leave CSS fullscreen size.
    // Do not getContext("2d") and getContext("webgpu") on the same element.
    void CANVAS_ID;
  }

  restoreForSoftware() {
    // Later: put the 2D canvas back, FrameBuffer.set, rebind Input.setCanvas.
  }
}

export default Surface;
