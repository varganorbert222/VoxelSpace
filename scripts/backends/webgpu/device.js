"use strict";

export async function isWebGpuAvailable() {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export async function createGpuDevice() {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    throw new Error("WebGPU is not available (secure context + navigator.gpu)");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("WebGPU adapter request failed");
  }
  let device;
  try {
    device = await adapter.requestDevice();
  } catch (err) {
    throw new Error("WebGPU device request failed: " + (err && err.message ? err.message : err));
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
