"use strict";

import { WEBGPU_FRAME_BYTES } from "../../constants/webgpu.js";
import { unpackToVec4 } from "./color.js";

export const FRAME_BYTES = WEBGPU_FRAME_BYTES;

const FLAG_FOG = 1;
const FLAG_REPEAT = 2;
const FLAG_DEBUG_SHIFT = 8;
const FLAG_OVERLAY = 1 << 10;
const FLAG_OVERLAY_CUBE = 1 << 11;
const FLAG_HEIGHT_LERP = 1 << 12;
const FLAG_COLOR_FILTER = 1 << 13;

export function createFramePacker() {
  const buffer = new ArrayBuffer(FRAME_BYTES);
  return {
    buffer: buffer,
    f32: new Float32Array(buffer),
    u32: new Uint32Array(buffer),
  };
}

export function packFrame(packer, p) {
  const f = packer.f32;
  const u = packer.u32;
  f[0] = p.camX;
  f[1] = p.camY;
  f[2] = p.camZ;
  f[3] = p.tanHalfFovX;
  f[4] = p.rightX;
  f[5] = p.rightY;
  f[6] = p.rightZ;
  f[7] = p.dstToProjPlane;
  f[8] = p.upX;
  f[9] = p.upY;
  f[10] = p.upZ;
  f[11] = p.screenHorizon;
  f[12] = p.fwdX;
  f[13] = p.fwdY;
  f[14] = p.fwdZ;
  f[15] = p.t0;
  f[16] = p.sinAngle;
  f[17] = p.cosAngle;
  f[18] = p.nearClip;
  f[19] = p.farClip;
  f[20] = p.tMax;
  f[21] = p.minDeltaZ;
  f[22] = p.altitude;
  f[23] = p.maxHeight;
  u[24] = p.screenWidth | 0;
  u[25] = p.screenHeight | 0;
  u[26] = p.panoWidth | 0;
  u[27] = p.panoHeight | 0;
  u[28] = p.mapW | 0;
  u[29] = p.mapH | 0;
  u[30] = p.mapShift | 0;
  let flags = 0;
  if (p.applyFog) {
    flags |= FLAG_FOG;
  }
  if (p.repeat) {
    flags |= FLAG_REPEAT;
  }
  if (p.interpolateHeight) {
    flags |= FLAG_HEIGHT_LERP;
  }
  if (p.filterColor) {
    flags |= FLAG_COLOR_FILTER;
  }
  flags |= ((p.debugViewId | 0) & 3) << FLAG_DEBUG_SHIFT;
  if (p.debugOverlay) {
    flags |= FLAG_OVERLAY;
  }
  if (p.debugOverlayCube) {
    flags |= FLAG_OVERLAY_CUBE;
  }
  u[31] = flags;
  const sky = unpackToVec4(p.skyColor);
  f[32] = sky[0];
  f[33] = sky[1];
  f[34] = sky[2];
  f[35] = sky[3];
  const hor = unpackToVec4(p.horizonColor);
  f[36] = hor[0];
  f[37] = hor[1];
  f[38] = hor[2];
  f[39] = hor[3];
  f[40] = p.clipZ;
  f[41] = p.dhGround;
  f[42] = p.tanLast;
  f[43] = p.stepGrowth;
  f[44] = p.stepScale;
  f[45] = p.stepCap0;
  f[46] = p.stepCap1;
  f[47] = p.stepCap2;
  f[48] = p.switchT0;
  f[49] = p.switchT1;
  f[50] = p.mipStepScale;
  f[51] = p.yHitScale;
  f[52] = p.inv0;
  f[53] = p.inv1;
  f[54] = p.inv2;
  f[55] = p.pixelCenter;
  f[56] = p.fovY;
  f[57] = p.tanHalfY;
  f[58] = p.ndcScale;
  f[59] = Number.isFinite(p.cubeFace) ? p.cubeFace : p.epsilon;
  u[60] = p.quality | 0;
  u[61] = p.lodCount | 0;
  u[62] = p.yHitLast | 0;
  u[63] = p.atanLast | 0;
  u[64] = p.mipShift0 | 0;
  u[65] = p.mipShift1 | 0;
  u[66] = p.mipShift2 | 0;
  u[67] = p.mipCount | 0;
  u[68] = p.mipW0 | 0;
  u[69] = p.mipH0 | 0;
  u[70] = p.mipW1 | 0;
  u[71] = p.mipH1 | 0;
  u[72] = p.mipW2 | 0;
  u[73] = p.mipH2 | 0;
  u[74] = p.maskW0 | 0;
  u[75] = p.maskH0 | 0;
  u[76] = p.maskW1 | 0;
  u[77] = p.maskH1 | 0;
  u[78] = p.maskW2 | 0;
  u[79] = p.maskH2 | 0;
  u[80] = p.overlayX | 0;
  u[81] = p.overlayY | 0;
  u[82] = p.overlayW | 0;
  u[83] = p.overlayH | 0;
}
