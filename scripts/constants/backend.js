"use strict";

export const BACKEND_JS = "js";
export const BACKEND_WASM = "wasm";
export const BACKEND_WEBGPU = "webgpu";

export const BACKEND_IDS = Object.freeze([
  BACKEND_JS,
  BACKEND_WASM,
  BACKEND_WEBGPU,
]);

export const BACKEND_LABEL = Object.freeze({
  [BACKEND_JS]: "CPU · JS",
  [BACKEND_WASM]: "CPU · WASM",
  [BACKEND_WEBGPU]: "GPU · WebGPU",
});

export const BACKEND_CHIP = Object.freeze({
  [BACKEND_JS]: "JS",
  [BACKEND_WASM]: "WASM",
  [BACKEND_WEBGPU]: "GPU",
});

export const BACKEND_TITLE = Object.freeze({
  [BACKEND_JS]: "JavaScript kernels, Canvas 2D",
  [BACKEND_WASM]: "WebAssembly kernels, Canvas 2D",
  [BACKEND_WEBGPU]: "WebGPU compute, swapchain",
});

export const BACKEND_PRESENT_2D = Object.freeze([BACKEND_JS, BACKEND_WASM]);

export function usesCanvas2d(id) {
  return BACKEND_PRESENT_2D.includes(id);
}

export function usesWorkers(id) {
  return usesCanvas2d(id);
}
