"use strict";

// Default requestAdapter() asks for core WebGPU. On this class of Android GPU
// (Samsung Xclipse, crbug.com/40643150) the Vulkan core adapter is blocklisted,
// so that call returns null even though about:gpu shows WebGPU as accelerated.
// The usable adapter is OpenGL ES compatibility mode.

async function requestGpuAdapter() {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return null;
  }
  try {
    const core = await navigator.gpu.requestAdapter();
    if (core) {
      return core;
    }
  } catch {
    void 0;
  }
  try {
    return await navigator.gpu.requestAdapter({
      featureLevel: "compatibility",
    });
  } catch {
    return null;
  }
}

export async function isWebGpuAvailable() {
  try {
    return !!(await requestGpuAdapter());
  } catch {
    return false;
  }
}

export async function createGpuDevice() {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    throw new Error("WebGPU is not available (secure context + navigator.gpu)");
  }
  const adapter = await requestGpuAdapter();
  if (!adapter) {
    throw new Error("WebGPU adapter request failed");
  }
  let device;
  try {
    device = await adapter.requestDevice();
  } catch (err) {
    throw new Error(
      "WebGPU device request failed: " + (err && err.message ? err.message : err)
    );
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  return { adapter, device, format };
}

export async function compileShader(device, label, code) {
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ label: label, code: code });
  const err = await device.popErrorScope();
  if (err) {
    throw new Error(label + ": " + err.message);
  }
  return module;
}

export function attachDeviceDiagnostics(device, onLost) {
  device.addEventListener("uncapturederror", (event) => {
    const err = event.error;
    console.warn("WebGPU uncaptured error:", err && err.message ? err.message : err);
  });
  if (device.lost) {
    device.lost.then((info) => {
      console.warn("WebGPU device lost:", info && info.reason, info && info.message);
      if (onLost) {
        onLost(info);
      }
    });
  }
}
