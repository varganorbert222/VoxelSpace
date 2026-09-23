"use strict";

import { RETAIL_DEPTH_LUT_CAPACITY } from "../../render/retail/constants.js";
import { createStorageBuffer, createStorageTarget, createTexture, destroyBuf, destroyTex, uploadTexels } from "./resources.js";

const SAMPLED = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;

function destroyList(textures) {
  if (!textures) {
    return;
  }
  for (const texture of textures) {
    destroyTex(texture);
  }
}

export function destroyRetailGpu(gpu) {
  if (!gpu) {
    return;
  }
  destroyTex(gpu.height);
  destroyTex(gpu.color);
  destroyTex(gpu.detailMap);
  destroyTex(gpu.detailPacked);
  destroyTex(gpu.nearPalette);
  destroyTex(gpu.detailPalette);
  destroyTex(gpu.voxPal);
  destroyTex(gpu.cloud);
  destroyTex(gpu.skyTable);
  destroyTex(gpu.vmax);
  destroyTex(gpu.waterDepth);
  destroyTex(gpu.owner);
  destroyBuf(gpu.skyRows);
  destroyBuf(gpu.depthLut);
  destroyBuf(gpu.stats);
  destroyList(gpu.extra);
}

function uploadMips(device, texture, levels, bytesPerTexel, baseWidth, baseHeight) {
  let width = baseWidth;
  let height = baseHeight;
  for (let level = 0; level < levels.length; level++) {
    uploadTexels(device, texture, levels[level], width, height, bytesPerTexel, level);
    width = Math.max(1, width >> 1);
    height = Math.max(1, height >> 1);
  }
}

export function ensureRetailSkyRows(device, gpu, byteLength) {
  const bytes = byteLength | 0;
  if (gpu.skyRows && gpu.skyRowBytes === bytes) {
    return false;
  }
  destroyBuf(gpu.skyRows);
  gpu.skyRows = createStorageBuffer(device, bytes);
  gpu.skyRowBytes = bytes;
  return true;
}

export function createRetailGpu(device, resources) {
  const mapSize = resources.width;
  const height = createTexture(device, mapSize, mapSize, "r8uint", SAMPLED, resources.heightMips.length);
  const color = createTexture(device, mapSize, mapSize, "r8uint", SAMPLED, resources.colorMips.length);
  const detailMap = createTexture(device, mapSize, mapSize, "r8uint", SAMPLED, 1);
  const detailBase = resources.detail.packed[0];
  const detailWidth = 16;
  const detailHeight = detailBase.length / detailWidth;
  const detailPacked = createTexture(
    device,
    detailWidth,
    detailHeight,
    "r32uint",
    SAMPLED,
    resources.detail.packed.length
  );
  const nearPalette = createTexture(device, 256, 1, "rgba8uint", SAMPLED, 1);
  const detailPalette = createTexture(device, 256, 1, "rgba8uint", SAMPLED, 1);
  const voxPal = createTexture(device, 256, 10, "rgba8uint", SAMPLED, 1);
  const cloud = createTexture(device, 512, 512, "r8uint", SAMPLED, resources.cloudMips.length);
  const skyTable = createTexture(device, 64, 256, "rgba8unorm", SAMPLED, 1);
  const vmax = createTexture(device, mapSize, mapSize, "r8uint", SAMPLED, resources.vmaxMips.length);
  uploadMips(device, height, resources.heightMips, 1, mapSize, mapSize);
  uploadMips(device, color, resources.colorMips, 1, mapSize, mapSize);
  uploadTexels(device, detailMap, resources.detail.detailMap, mapSize, mapSize, 1, 0);
  uploadMips(device, detailPacked, resources.detail.packed, 4, detailWidth, detailHeight);
  uploadTexels(device, nearPalette, resources.nearPalette, 256, 1, 4, 0);
  uploadTexels(device, detailPalette, resources.detailPalette, 256, 1, 4, 0);
  uploadTexels(device, voxPal, resources.voxPal, 256, 10, 4, 0);
  uploadMips(device, cloud, resources.cloudMips, 1, 512, 512);
  uploadTexels(device, skyTable, resources.skyTable, 64, 256, 4, 0);
  uploadMips(device, vmax, resources.vmaxMips, 1, mapSize, mapSize);
  return {
    height,
    color,
    detailMap,
    detailPacked,
    nearPalette,
    detailPalette,
    voxPal,
    cloud,
    skyTable,
    vmax,
    waterDepth: createStorageTarget(device, 1, 1, "r32uint"),
    owner: createStorageTarget(device, 1, 1, "r32uint"),
    skyRows: null,
    skyRowBytes: 0,
    depthLut: createStorageBuffer(device, RETAIL_DEPTH_LUT_CAPACITY * 4),
    stats: createStorageBuffer(
      device,
      64,
      GPUBufferUsage.COPY_SRC
    ),
    resources,
  };
}
