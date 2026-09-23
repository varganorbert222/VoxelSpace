"use strict";

import {
  RETAIL_ALL_PASS_FACTORS,
  RETAIL_ALL_PASS_STEPS,
  RETAIL_ANGLE_U32_DEN,
  RETAIL_CLOUD_SCROLL_Q16_PER_FRAME,
  RETAIL_CLOUD_SCROLL_WRAP,
  RETAIL_DEFAULT_SKY_HEIGHT,
  RETAIL_DEFAULT_SKY_HORIZON,
  RETAIL_DEPTH_LUT_CAPACITY,
  RETAIL_FOV_DEG_RAD,
  RETAIL_GAME_TICK_MS,
  RETAIL_MAX_SKY_ROWS,
  RETAIL_NEAR_SUBDIV,
  RETAIL_PASS_COUNT,
  RETAIL_PASS_DIVISOR,
  RETAIL_PASS_FACTORS,
  RETAIL_PASS_STEPS,
  RETAIL_PITCH_BLACK_DEG,
  RETAIL_Q20_ONE,
  RETAIL_Q22_ONE,
  RETAIL_SKY_MODE_BLACK,
  RETAIL_SKY_MODE_CLOUD,
  RETAIL_SKY_MODE_HORIZON,
  RETAIL_SKY_PI,
  RETAIL_SKY_RAY_Z_MIN_Q22,
  RETAIL_SKY_ROW_WORDS,
} from "./constants.js";
import {
  fixedMulQ20,
  fixedMulShiftSigned32,
  projectAnglesToRetail,
  projectZToRetailWorld,
  radiansToRetailAngleU32,
  retailSinCosQ20,
  retailSinCosQ22,
  worldToQ22,
  worldZToRawQ20,
} from "./fixedPoint.js";

let gameClockLastMs = null;
let gameClockAccumulatorMs = 0;
let gameFrameCounter = 0;

export function resetRetailGameClock(nowMs) {
  gameClockLastMs = nowMs;
  gameClockAccumulatorMs = 0;
  gameFrameCounter = 0;
  return gameFrameCounter;
}

export function advanceRetailGameClock(nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  if (gameClockLastMs == null) {
    gameClockLastMs = now;
    return gameFrameCounter;
  }
  gameClockAccumulatorMs += now - gameClockLastMs;
  gameClockLastMs = now;
  const ticks = Math.floor(gameClockAccumulatorMs / RETAIL_GAME_TICK_MS) | 0;
  if (ticks > 0) {
    gameClockAccumulatorMs -= ticks * RETAIL_GAME_TICK_MS;
    gameFrameCounter = (gameFrameCounter + ticks) | 0;
  }
  return gameFrameCounter;
}

export function retailFrameCounter() {
  return gameFrameCounter | 0;
}

export function retailFocal(width, fovDegrees) {
  const fov = Math.max(1, Math.trunc(fovDegrees) || 1);
  const halfAngle = ((fov + 1) >> 1) * RETAIL_FOV_DEG_RAD;
  return Math.max(1, Math.trunc((width * 0.5) / Math.tan(halfAngle) + 0.5));
}

function passTransitionScaleQ16(currentQuant, nextQuant) {
  const current = currentQuant | 0;
  const next = nextQuant | 0;
  if (current === 0) {
    return 0x10000;
  }
  return Math.trunc((next * 65536) / current) | 0;
}

export function buildRetailPasses(focal, quality, lodBias) {
  const focalValue = Number(focal);
  const sampleQuality = Math.max(0.05, Number(quality) || 1);
  const bias = Number(lodBias) || 0;
  const baseline = [];
  for (let index = 0; index < 5; index++) {
    baseline.push({
      endDistance: (focalValue * RETAIL_PASS_FACTORS[index]) / RETAIL_PASS_DIVISOR,
      rawStep: RETAIL_PASS_STEPS[index],
    });
  }
  for (let direct = 0; direct < 9; direct++) {
    const power = 1 << direct;
    baseline.push({
      endDistance: ((focalValue * 16) * power) / RETAIL_PASS_DIVISOR,
      rawStep: 16 * power,
    });
  }
  for (const pass of baseline) {
    pass.stepQuantQ16 = Math.max(1, Math.trunc((pass.rawStep / focalValue) * 65536)) | 0;
  }
  for (let index = 0; index < baseline.length; index++) {
    const next = index + 1 < baseline.length ? baseline[index + 1].stepQuantQ16 : baseline[index].stepQuantQ16;
    baseline[index].nextScaleQ16 = passTransitionScaleQ16(baseline[index].stepQuantQ16, next);
  }
  const biasScale = Math.pow(2, -bias);
  const effective = baseline.map((pass) => ({
    endDistance: pass.endDistance * biasScale,
    effectiveStep: pass.rawStep / sampleQuality,
    nextScaleQ16: pass.nextScaleQ16,
    rawStep: pass.rawStep,
  }));
  let endpoint = 0;
  for (let index = 0; index < effective.length; index++) {
    const pass = effective[index];
    let distance = index === 0 ? 0 : effective[index - 1].endDistance;
    let guard = 0;
    while (distance < pass.endDistance && guard++ < 1000000) {
      endpoint++;
      distance += pass.effectiveStep;
    }
    pass.endScanIndex = endpoint;
  }
  return effective.slice(0, RETAIL_PASS_COUNT).map((pass, index) => ({
    index,
    name: index < 5 ? "near" : "direct",
    endDistance: pass.endDistance,
    step: pass.effectiveStep,
    endScanIndex: pass.endScanIndex | 0,
    nextScaleQ16: pass.nextScaleQ16 | 0,
    subdiv: index < 5 ? RETAIL_NEAR_SUBDIV[index] : 0,
    mip: index >= 5 ? index - 5 : -1,
  }));
}

export function buildRetailDepthLut(focal, quality, lodBias) {
  const focalValue = Number(focal);
  const sampleQuality = Math.max(0.05, Number(quality) || 1);
  const biasScale = Math.pow(2, -(Number(lodBias) || 0));
  const lut = new Uint32Array(RETAIL_DEPTH_LUT_CAPACITY);
  lut.fill(0xffff);
  let out = 0;
  let previousEnd = 0;
  for (let index = 0; index < RETAIL_ALL_PASS_FACTORS.length; index++) {
    const end = (focalValue * RETAIL_ALL_PASS_FACTORS[index] / RETAIL_PASS_DIVISOR) * biasScale;
    const step = RETAIL_ALL_PASS_STEPS[index] / sampleQuality;
    let distance = index === 0 ? 0 : previousEnd;
    let guard = 0;
    while (distance < end && guard++ < 1000000) {
      if (out >= RETAIL_DEPTH_LUT_CAPACITY) {
        throw new Error("Retail depth LUT overflow at " + out + " entries");
      }
      lut[out++] = Math.min(65535, Math.max(0, Math.trunc(4 * distance + step))) >>> 0;
      distance += step;
    }
    previousEnd = end;
  }
  return { lut, count: out };
}

export function buildRetailCamera(retailYaw, retailPitch, focal) {
  const yaw = retailSinCosQ20(retailYaw);
  const pitch = retailSinCosQ20(retailPitch);
  const sineYaw = yaw[0];
  const cosineYaw = yaw[1];
  const sinePitch = pitch[0];
  const cosinePitch = pitch[1];
  const inverseFocalQ20 = Math.trunc(RETAIL_Q20_ONE / Math.max(1, focal)) | 0;
  return {
    forwardX: fixedMulQ20(cosineYaw, cosinePitch),
    forwardY: fixedMulQ20(sineYaw, cosinePitch),
    forwardZ: sinePitch | 0,
    rightX: (-sineYaw) | 0,
    rightY: cosineYaw | 0,
    rightZ: 0,
    upX: (-fixedMulQ20(cosineYaw, sinePitch)) | 0,
    upY: (-fixedMulQ20(sineYaw, sinePitch)) | 0,
    upZ: cosinePitch | 0,
    inverseFocalQ20,
  };
}

function retailSkyHorizonY(retailPitch, focal, height) {
  const angle = radiansToRetailAngleU32(retailPitch);
  const phase = angle / RETAIL_ANGLE_U32_DEN;
  const radians = phase * (2 * RETAIL_SKY_PI);
  let degrees = phase * 360;
  if (degrees > 180) {
    degrees -= 360;
  }
  if (degrees < RETAIL_PITCH_BLACK_DEG) {
    return -1;
  }
  const centerY = height >> 1;
  let offset;
  if (degrees >= 89) {
    offset = height | 0;
  } else {
    const tangentQ16 = Math.trunc(Math.tan(radians) * 65536) | 0;
    offset = fixedMulShiftSigned32(focal | 0, tangentQ16, 16);
  }
  return (centerY + 5 + offset) | 0;
}

function retailSkyGradientStepQ16(fovDegrees, focalWidth, skyHorizon) {
  const fov = Math.max(1, Math.trunc(fovDegrees) || 1);
  const width = Math.max(1, focalWidth | 0);
  const angleQ16 = Math.trunc((fov * 65536) / width) | 0;
  const scaled = Math.trunc((angleQ16 * 65536) / 0x2400) | 0;
  const shaped = fixedMulShiftSigned32(0x20000, scaled, 16);
  const horizonQ16 = Math.trunc(skyHorizon * 65536) | 0;
  return fixedMulShiftSigned32(horizonQ16, shaped, 16) | 0;
}

function retailCloudMipForScaleQ16(scaleQ16) {
  let scale = scaleQ16 | 0;
  let mip = 0;
  while (scale > 0x10000 && mip < 8) {
    scale >>= 1;
    mip++;
  }
  return mip;
}

export function buildRetailSkyRows(input) {
  const width = input.width | 0;
  const height = input.height | 0;
  if (height > RETAIL_MAX_SKY_ROWS) {
    throw new Error("Framebuffer height " + height + " exceeds sky row capacity " + RETAIL_MAX_SKY_ROWS);
  }
  const focal = input.focal | 0;
  const centerX = width >> 1;
  const centerY = height >> 1;
  const yaw = retailSinCosQ22(input.retailYaw);
  const pitch = retailSinCosQ22(input.retailPitch);
  const sineYaw = yaw[0];
  const cosineYaw = yaw[1];
  const sinePitch = pitch[0];
  const cosinePitch = pitch[1];
  const yawPitchCos = fixedMulShiftSigned32(cosineYaw, cosinePitch, 22);
  const yawPitchSin = fixedMulShiftSigned32(cosineYaw, sinePitch, 22);
  const sineYawPitchCos = fixedMulShiftSigned32(sineYaw, cosinePitch, 22);
  const sineYawPitchSin = fixedMulShiftSigned32(sineYaw, sinePitch, 22);
  const cameraXQ16 = Math.trunc(input.cameraX * 65536) | 0;
  const cameraYQ16 = Math.trunc(input.cameraY * 65536) | 0;
  const cameraZQ16 = Math.trunc(input.retailCameraZ * 65536) | 0;
  const skyHeight = Number.isFinite(input.skyHeight) ? input.skyHeight : RETAIL_DEFAULT_SKY_HEIGHT;
  const skyZQ16 = (Math.trunc(skyHeight) << 16) | 0;
  const skyDeltaZQ16 = (skyZQ16 - cameraZQ16) | 0;
  const horizonY = retailSkyHorizonY(input.retailPitch, focal, height);
  const skyHorizon = Number.isFinite(input.skyHorizon) ? input.skyHorizon : RETAIL_DEFAULT_SKY_HORIZON;
  const gradientStepQ16 = retailSkyGradientStepQ16(input.fovDegrees, input.focalWidth || width, skyHorizon);
  const cloudPhase = (input.frameCounter | 0) & (RETAIL_CLOUD_SCROLL_WRAP - 1);
  const cloudScrollQ16 = Math.imul(cloudPhase, RETAIL_CLOUD_SCROLL_Q16_PER_FRAME) | 0;
  const rows = new Uint32Array(height * RETAIL_SKY_ROW_WORDS);
  for (let y = 0; y < height; y++) {
    const offset = y * RETAIL_SKY_ROW_WORDS;
    if (horizonY < 0) {
      rows[offset] = RETAIL_SKY_MODE_BLACK;
      continue;
    }
    const above = (horizonY - y) | 0;
    if (above < 0) {
      rows[offset] = RETAIL_SKY_MODE_HORIZON;
      continue;
    }
    const gradientQ16 = Math.imul(above, gradientStepQ16) | 0;
    const gradientRow = Math.min(255, Math.max(0, gradientQ16 >> 16));
    const rowForward = focal;
    const rowHorizontal = -centerX;
    const rowVertical = centerY - y + 0.5;
    const norm = Math.hypot(rowForward, rowHorizontal, rowVertical) || 1;
    const rayForward = Math.trunc((rowForward / norm) * RETAIL_Q22_ONE) | 0;
    const rayRight = Math.trunc((rowHorizontal / norm) * RETAIL_Q22_ONE) | 0;
    const rayUp = Math.trunc((rowVertical / norm) * RETAIL_Q22_ONE) | 0;
    const worldRayX = (
      fixedMulShiftSigned32(rayForward, yawPitchCos, 22) -
      fixedMulShiftSigned32(rayRight, sineYaw, 22) -
      fixedMulShiftSigned32(rayUp, yawPitchSin, 22)
    ) | 0;
    const worldRayY = (
      fixedMulShiftSigned32(rayForward, sineYawPitchCos, 22) +
      fixedMulShiftSigned32(rayRight, cosineYaw, 22) -
      fixedMulShiftSigned32(rayUp, sineYawPitchSin, 22)
    ) | 0;
    const rayZ = (
      fixedMulShiftSigned32(rayForward, sinePitch, 22) +
      fixedMulShiftSigned32(rayUp, cosinePitch, 22)
    ) | 0;
    if (rayZ <= RETAIL_SKY_RAY_Z_MIN_Q22) {
      rows[offset] = RETAIL_SKY_MODE_HORIZON;
      continue;
    }
    const rayZQ16 = rayZ >> 6;
    if (rayZQ16 <= 0) {
      rows[offset] = RETAIL_SKY_MODE_HORIZON;
      continue;
    }
    const reciprocalQ16 = Math.trunc(4294967296 / rayZQ16) | 0;
    const intersectionQ16 = fixedMulShiftSigned32(skyDeltaZQ16, reciprocalQ16, 16);
    const deltaXQ16 = fixedMulShiftSigned32(intersectionQ16, worldRayX, 22);
    const deltaYQ16 = fixedMulShiftSigned32(intersectionQ16, worldRayY, 22);
    let scaleQ16 = fixedMulShiftSigned32(intersectionQ16, rayForward, 22);
    scaleQ16 = Math.trunc(scaleQ16 / Math.max(1, focal)) | 0;
    scaleQ16 >>= 3;
    const stepXQ16 = (-fixedMulShiftSigned32(scaleQ16, sineYaw, 22)) | 0;
    const stepYQ16 = fixedMulShiftSigned32(scaleQ16, cosineYaw, 22) | 0;
    const mip = retailCloudMipForScaleQ16(scaleQ16);
    const uBaseQ16 = ((cameraXQ16 + deltaXQ16 + cloudScrollQ16) | 0) >> 3;
    const vBaseQ16 = ((cameraYQ16 + deltaYQ16 + cloudScrollQ16) | 0) >> 3;
    rows[offset] = RETAIL_SKY_MODE_CLOUD;
    rows[offset + 1] = mip >>> 0;
    rows[offset + 2] = (uBaseQ16 >> mip) >>> 0;
    rows[offset + 3] = (vBaseQ16 >> mip) >>> 0;
    rows[offset + 4] = ((stepXQ16 >> mip) << 1) >>> 0;
    rows[offset + 5] = ((stepYQ16 >> mip) << 1) >>> 0;
    rows[offset + 6] = (gradientRow << 6) >>> 0;
    rows[offset + 7] = 0;
  }
  return { rows, horizonY, gradientStepQ16, skyHeight };
}

export function buildRetailFrame(input) {
  const width = input.width | 0;
  const height = input.height | 0;
  const angles = projectAnglesToRetail(input.yawRadians || 0, input.pitchDegrees || 0);
  const focal = retailFocal(input.focalWidth || width, input.fovDegrees || 90);
  const quality = Math.max(0.05, Number(input.quality) || 1);
  const lodBias = Number(input.lodBias) || 0;
  const passes = buildRetailPasses(focal, quality, lodBias);
  const depth = buildRetailDepthLut(focal, quality, lodBias);
  const camera = buildRetailCamera(angles.yaw, angles.pitch, focal);
  const retailCameraZ = projectZToRetailWorld(input.cameraZ || 0, input.altitude || 1);
  const forwardScaleQ20 = Math.imul(focal, camera.inverseFocalQ20) | 0;
  const sky = buildRetailSkyRows({
    width,
    height,
    focal,
    focalWidth: input.focalWidth || width,
    fovDegrees: input.fovDegrees || 90,
    retailYaw: angles.yaw,
    retailPitch: angles.pitch,
    cameraX: input.cameraX || 0,
    cameraY: input.cameraY || 0,
    retailCameraZ,
    skyHeight: input.skyHeight,
    skyHorizon: input.skyHorizon,
    frameCounter: input.frameCounter | 0,
  });
  const mapSize = input.mapSize | 0;
  return {
    width,
    height,
    focal,
    quality,
    lodBias,
    passes,
    depthLut: depth.lut,
    depthCount: depth.count,
    frameCounter: input.frameCounter | 0,
    repeat: input.repeat ? 1 : 0,
    debugMode: input.debugMode | 0,
    mapSize,
    mapMask: (mapSize - 1) | 0,
    cameraX: input.cameraX || 0,
    cameraY: input.cameraY || 0,
    cameraZ: input.cameraZ || 0,
    retailCameraZ,
    retailYaw: angles.yaw,
    retailPitch: angles.pitch,
    cameraQ: {
      x: worldToQ22(input.cameraX || 0),
      y: worldToQ22(input.cameraY || 0),
      z: worldZToRawQ20(retailCameraZ),
      w: forwardScaleQ20,
    },
    forwardQ: {
      x: fixedMulQ20(camera.forwardX, forwardScaleQ20),
      y: fixedMulQ20(camera.forwardY, forwardScaleQ20),
      z: fixedMulQ20(camera.forwardZ, forwardScaleQ20),
    },
    rightQ: { x: camera.rightX, y: camera.rightY, z: camera.rightZ },
    upQ: { x: camera.upX, y: camera.upY, z: camera.upZ },
    inverseFocalQ20: camera.inverseFocalQ20,
    firstStep: passes[0].step,
    horizonY: sky.horizonY,
    gradientStep: sky.gradientStepQ16 / 65536,
    skyHeight: sky.skyHeight,
    skyRows: sky.rows,
    environment: input.environment || [0, 0, 0],
    detailLight: input.detailLight || [255, 255, 255],
  };
}
