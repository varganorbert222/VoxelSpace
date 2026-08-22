"use strict";

// Default requestAdapter() is core WebGPU (Vulkan/D3D/Metal). Many phones
// only expose a GLES compatibility adapter; that call returns null and the
// selector stays disabled unless we also try featureLevel: "compatibility"
// (Chrome 133+) and the older compatibilityMode flag.

const ADAPTER_TRIES = Object.freeze([
  undefined,
  { featureLevel: "compatibility" },
  { compatibilityMode: true },
  { powerPreference: "low-power" },
  { powerPreference: "high-performance" },
  { featureLevel: "compatibility", powerPreference: "low-power" },
  { compatibilityMode: true, powerPreference: "low-power" },
]);

export async function requestGpuAdapter() {
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return null;
  }
  for (let i = 0; i < ADAPTER_TRIES.length; i++) {
    try {
      const opts = ADAPTER_TRIES[i];
      const adapter = opts
        ? await navigator.gpu.requestAdapter(opts)
        : await navigator.gpu.requestAdapter();
      if (adapter) {
        return adapter;
      }
    } catch {
      void 0;
    }
  }
  return null;
}

export async function isWebGpuAvailable() {
  try {
    const adapter = await requestGpuAdapter();
    return !!adapter;
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
