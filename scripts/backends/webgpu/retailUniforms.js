"use strict";

import { RETAIL_PASS_COUNT, RETAIL_UNIFORM_BYTES } from "../../render/retail/constants.js";

export const RETAIL_SCANLINE_BYTES = 512;
export const RETAIL_SCANLINE_PASS_COUNT = RETAIL_PASS_COUNT;

export function createRetailScanlineUniforms() {
  const buffer = new ArrayBuffer(RETAIL_SCANLINE_BYTES);
  return {
    buffer,
    f32: new Float32Array(buffer),
    i32: new Int32Array(buffer),
  };
}

// Layout matches the WGSL Params struct: ten vec4 headers, then eleven pass vec4s.
export function packRetailScanlineUniforms(packer, frame) {
  const ints = packer.i32;
  const floats = packer.f32;
  ints.fill(0);
  let cursor = 0;
  const putInt = (x, y, z, w) => {
    ints[cursor] = x | 0;
    ints[cursor + 1] = y | 0;
    ints[cursor + 2] = z | 0;
    ints[cursor + 3] = w | 0;
    cursor += 4;
  };
  const putFloat = (x, y, z, w) => {
    floats[cursor] = x;
    floats[cursor + 1] = y;
    floats[cursor + 2] = z;
    floats[cursor + 3] = w;
    cursor += 4;
  };
  putInt(frame.width, frame.height, frame.frameCounter, 0);
  putInt(frame.cameraQ.x, frame.cameraQ.y, frame.cameraQ.z, frame.cameraQ.w);
  putFloat(frame.cameraX, frame.cameraY, frame.retailCameraZ, frame.retailYaw);
  putInt(frame.forwardQ.x, frame.forwardQ.y, frame.forwardQ.z, 0);
  putInt(frame.rightQ.x, frame.rightQ.y, 0, 0);
  putInt(frame.upQ.x, frame.upQ.y, frame.upQ.z, 0);
  putFloat(frame.focal, frame.firstStep, frame.gradientStep, 0);
  putInt(frame.inverseFocalQ20, frame.horizonY | 0, frame.debugMode | 0, frame.mapMask | 0);
  putFloat(frame.environment[0], frame.environment[1], frame.environment[2], frame.skyHeight);
  putInt(frame.detailLight[0] | 0, frame.detailLight[1] | 0, frame.detailLight[2] | 0, frame.repeat ? 1 : 0);
  for (let index = 0; index < RETAIL_PASS_COUNT; index++) {
    const pass = frame.passes[index];
    putInt(pass.endScanIndex, pass.nextScaleQ16, pass.subdiv, pass.mip);
  }
  if (cursor * 4 < RETAIL_UNIFORM_BYTES) {
    throw new Error("Retail uniform pack is short");
  }
  return packer;
}
