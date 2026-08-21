"use strict";

import { BACKEND_WEBGPU } from "../../constants/backend.js";

// Shaders will live under scripts/backends/webgpu/shaders/ when
// webgpu-implementation-prompt.md ships. Threads stay off on this id.
// Canvas swap (Surface.replaceForWebgpu) is only for this present mode.
// Do not getContext("webgpu") here.

class WebGpuBackend {
  static get id() {
    return BACKEND_WEBGPU;
  }

  static async isAvailable() {
    return false;
  }

  async init() {
    throw new Error("WebGPU runtime is not implemented yet");
  }

  async setMaps() {
    throw new Error("WebGPU runtime is not implemented yet");
  }

  async resize() {
    throw new Error("WebGPU runtime is not implemented yet");
  }

  invalidatePanorama() {
    throw new Error("WebGPU runtime is not implemented yet");
  }

  async render() {
    throw new Error("WebGPU runtime is not implemented yet");
  }

  dispose() {}
}

export default WebGpuBackend;
