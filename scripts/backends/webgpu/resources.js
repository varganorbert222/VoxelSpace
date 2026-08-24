"use strict";

import { WEBGPU_TEXTURE_ROW_ALIGN } from "../../constants/webgpu.js";
import { expandColorMapRgba8 } from "./color.js";

function alignRow(bytes) {
  const a = WEBGPU_TEXTURE_ROW_ALIGN;
  return ((bytes + a - 1) / a | 0) * a;
}

function writeTexels(device, texture, data, width, height, bytesPerTexel) {
  const unpadded = width * bytesPerTexel;
  const bytesPerRow = alignRow(unpadded);
  let src = data;
  if (bytesPerRow !== unpadded) {
    const padded = new Uint8Array(bytesPerRow * height);
    const raw =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let y = 0; (y < height) | 0; y = (y + 1) | 0) {
      padded.set(
        raw.subarray(y * unpadded, y * unpadded + unpadded),
        y * bytesPerRow
      );
    }
    src = padded;
  }
  device.queue.writeTexture(
    { texture: texture },
    src,
    { bytesPerRow: bytesPerRow, rowsPerImage: height },
    { width: width, height: height }
  );
}

export function createTexture(device, width, height, format, usage) {
  const w = width < 1 ? 1 : width;
  const h = height < 1 ? 1 : height;
  return device.createTexture({
    size: { width: w, height: h },
    format: format,
    usage: usage,
  });
}

export function createHeightTexture(device, width, height) {
  return createTexture(
    device,
    width,
    height,
    "r8uint",
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  );
}

export function createColorTexture(device, width, height) {
  return createTexture(
    device,
    width,
    height,
    "rgba8unorm",
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  );
}

export function createStorageTarget(device, width, height, format) {
  return createTexture(
    device,
    width,
    height,
    format,
    GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC
  );
}

export function createSampleTarget(device, width, height, format) {
  return createTexture(
    device,
    width,
    height,
    format,
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  );
}

export function copyTarget(encoder, src, dst, width, height) {
  encoder.copyTextureToTexture(
    { texture: src },
    { texture: dst },
    { width: width, height: height }
  );
}

export function copyTargetToLayer(encoder, src, dst, width, height, layer) {
  encoder.copyTextureToTexture(
    { texture: src },
    { texture: dst, origin: { x: 0, y: 0, z: layer } },
    { width: width, height: height, depthOrArrayLayers: 1 }
  );
}

export function createCubeArray(device, size, format) {
  const n = size < 1 ? 1 : size;
  return device.createTexture({
    size: { width: n, height: n, depthOrArrayLayers: 6 },
    format: format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
}

export function createScreenTarget(device, width, height) {
  return createStorageTarget(device, width, height, "r32uint");
}

export function createPanoColorTarget(device, width, height) {
  return createStorageTarget(device, width, height, "r32uint");
}

export function createPanoDepthTarget(device, width, height) {
  return createStorageTarget(device, width, height, "r32float");
}

export function uploadHeight(device, texture, heightMap, width, height) {
  writeTexels(device, texture, heightMap, width, height, 1);
}

export function uploadColor(device, texture, colorMap, width, height) {
  writeTexels(
    device,
    texture,
    expandColorMapRgba8(colorMap),
    width,
    height,
    4
  );
}

export function writeBuffer(device, gpuBuf, data, destOffset) {
  const raw =
    data.buffer && data.byteLength != null
      ? new Uint8Array(data.buffer, data.byteOffset | 0, data.byteLength)
      : new Uint8Array(data);
  device.queue.writeBuffer(gpuBuf, destOffset | 0, raw);
}

export function createStorageBuffer(device, bytes, extraUsage) {
  const size = bytes < 4 ? 4 : (bytes + 3) & ~3;
  return device.createBuffer({
    size: size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | (extraUsage || 0),
  });
}

export function createUniformBuffer(device, bytes) {
  const size = (bytes + 15) & ~15;
  return device.createBuffer({
    size: size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

export function destroyTex(tex) {
  if (tex) {
    tex.destroy();
  }
}

export function destroyBuf(buf) {
  if (buf) {
    buf.destroy();
  }
}
