"use strict";

import { CANVAS_ID } from "../constants/main.js";
import {
  WEBGPU_PRESENT_ATTR,
  WEBGPU_PRESENT_VALUE,
} from "../constants/webgpu.js";

class Surface {
  constructor(canvas, frameBuffer) {
    this._softwareCanvas = canvas;
    this._canvas = canvas;
    this._gpuCanvas = null;
    this._frameBuffer = frameBuffer;
    this._input = null;
    this._present = "2d";
  }

  setInput(input) {
    this._input = input;
  }

  get present() {
    return this._present;
  }

  getCanvas() {
    return this._canvas;
  }

  getFrameBuffer() {
    return this._frameBuffer;
  }

  _rebindInput() {
    if (this._input && this._input.setCanvas) {
      this._input.setCanvas(this._canvas);
    }
  }

  replaceForWebgpu() {
    if (this._present === "webgpu" && this._gpuCanvas) {
      return this._gpuCanvas;
    }
    const software = this._softwareCanvas;
    const parent = software.parentNode;
    const gpu = software.cloneNode(false);
    gpu.removeAttribute("id");
    gpu.width = software.width;
    gpu.height = software.height;
    gpu.setAttribute("data-" + WEBGPU_PRESENT_ATTR, WEBGPU_PRESENT_VALUE);
    if (parent) {
      parent.insertBefore(gpu, software);
    }
    software.removeAttribute("id");
    software.hidden = true;
    gpu.id = CANVAS_ID;
    this._gpuCanvas = gpu;
    this._canvas = gpu;
    this._present = "webgpu";
    this._rebindInput();
    return gpu;
  }

  restoreForSoftware() {
    if (this._present !== "webgpu") {
      return this._softwareCanvas;
    }
    const gpu = this._gpuCanvas;
    const software = this._softwareCanvas;
    if (gpu) {
      gpu.removeAttribute("id");
      gpu.removeAttribute("data-" + WEBGPU_PRESENT_ATTR);
      if (gpu.parentNode) {
        gpu.parentNode.removeChild(gpu);
      }
    }
    software.id = CANVAS_ID;
    software.hidden = false;
    this._gpuCanvas = null;
    this._canvas = software;
    this._present = "2d";
    this._rebindInput();
    return software;
  }
}

export default Surface;
