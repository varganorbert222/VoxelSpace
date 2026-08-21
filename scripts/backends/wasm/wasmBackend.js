"use strict";

import { BACKEND_WASM } from "../../constants/backend.js";

// Kernels come from WASM_MARCH_PROMPT.md: clang -O3 scalar module embedded in
// the ES graph, copies into linear memory, never SharedArrayBuffer, never
// transfer exports.memory.buffer. Present stays Canvas 2D. One instance per
// worker realm when this runtime is live.

class WasmBackend {
  static get id() {
    return BACKEND_WASM;
  }

  static async isAvailable() {
    return false;
  }

  async init() {
    throw new Error("WASM runtime is not implemented yet");
  }

  async setMaps() {
    throw new Error("WASM runtime is not implemented yet");
  }

  async resize() {
    throw new Error("WASM runtime is not implemented yet");
  }

  invalidatePanorama() {
    throw new Error("WASM runtime is not implemented yet");
  }

  async render() {
    throw new Error("WASM runtime is not implemented yet");
  }

  dispose() {}
}

export default WasmBackend;
