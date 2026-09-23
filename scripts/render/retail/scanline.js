"use strict";

import {
  RETAIL_COARSE_SHIFT,
  RETAIL_DIRECT_HELPER_PERIOD,
  RETAIL_DONE_Z_Q20,
  RETAIL_ELEVATION_BIAS,
  RETAIL_HELPER_PERIOD_NEAR,
  RETAIL_NEAR_HEIGHT_MASK,
  RETAIL_PALETTE_COUNT,
  RETAIL_PASS_ITERATION_LIMIT,
  RETAIL_SHADE_MID,
  RETAIL_SKY_MODE_BLACK,
  RETAIL_SKY_MODE_CLOUD,
  RETAIL_SKY_MODE_HORIZON,
  RETAIL_SKY_ROW_WORDS,
  RETAIL_SKY_TABLE_WIDTH,
} from "./constants.js";
import { advanceRetailGameClock, buildRetailFrame } from "./frame.js";
import { fixedMulQ16Scan, fixedMulQ20Scan, scaledScanStep } from "./fixedPoint.js";
import { buildRetailResources } from "./resources.js";

function subBits(subdiv) {
  if (subdiv === 16) {
    return 4;
  }
  if (subdiv === 8) {
    return 3;
  }
  if (subdiv === 4) {
    return 2;
  }
  return 1;
}

function cellIndex(q, mapMask, repeat) {
  const cell = (q >>> 22) | 0;
  if (repeat) {
    return cell & mapMask;
  }
  if ((q | 0) < 0) {
    return 0;
  }
  if (cell > mapMask) {
    return mapMask;
  }
  return cell;
}

function neighborCell(cell, mapMask, repeat) {
  if (repeat) {
    return (cell + 1) & mapMask;
  }
  return cell >= mapMask ? mapMask : cell + 1;
}

function paletteRgb(palette, index) {
  const offset = (index & 255) * 4;
  return [palette[offset] | 0, palette[offset + 1] | 0, palette[offset + 2] | 0];
}

function detailPacked(resources, qx, qy, subdiv, repeat) {
  const bits = subBits(subdiv);
  const mask = subdiv - 1;
  const x = cellIndex(qx, resources.mapMask, repeat);
  const y = cellIndex(qy, resources.mapMask, repeat);
  const subX = (qx >>> (22 - bits)) & mask;
  const subY = (qy >>> (22 - bits)) & mask;
  const tile = resources.detail.detailMap[(y << resources.shift) + x] & 255;
  const level = subdiv === 16 ? 0 : subdiv === 8 ? 1 : subdiv === 4 ? 2 : 3;
  const packedLevel = resources.detail.packed[Math.min(level, resources.detail.packed.length - 1)];
  return packedLevel[(tile * subdiv + subY) * subdiv + subX] >>> 0;
}

function cachedHeightQ20(resources, qx, qy, subdiv, repeat) {
  const bits = subBits(subdiv);
  const mask = subdiv - 1;
  const x0 = cellIndex(qx, resources.mapMask, repeat);
  const y0 = cellIndex(qy, resources.mapMask, repeat);
  const x1 = neighborCell(x0, resources.mapMask, repeat);
  const y1 = neighborCell(y0, resources.mapMask, repeat);
  const subX = (qx >>> (22 - bits)) & mask;
  const subY = (qy >>> (22 - bits)) & mask;
  const denominator = subdiv << 1;
  const weightX = (subX << 1) + 1;
  const weightY = (subY << 1) + 1;
  const inverseX = denominator - weightX;
  const inverseY = denominator - weightY;
  const shift = resources.shift;
  const height = resources.heightMips[0];
  const h00 = height[(y0 << shift) + x0] | 0;
  const h10 = height[(y0 << shift) + x1] | 0;
  const h01 = height[(y1 << shift) + x0] | 0;
  const h11 = height[(y1 << shift) + x1] | 0;
  const row0 = h00 * inverseX + h10 * weightX;
  const row1 = h01 * inverseX + h11 * weightX;
  const numerator = row0 * inverseY + row1 * weightY;
  const qShift = 18 - (bits << 1);
  let out = numerator << qShift;
  const packed = detailPacked(resources, qx, qy, subdiv, repeat);
  const elevation = (packed >>> 16) & 255;
  if (elevation >= RETAIL_ELEVATION_BIAS) {
    out += (elevation - RETAIL_ELEVATION_BIAS) << 15;
  }
  return out | 0;
}

function shadeChannel(base, lightTarget, shade) {
  if (shade === 0 || shade === RETAIL_SHADE_MID) {
    return base;
  }
  let out = base;
  if (shade <= 64) {
    out = base + ((base * shade) >> 7);
  } else if (shade < RETAIL_SHADE_MID) {
    out = (base * shade) >> 7;
  } else if (shade < 192) {
    out = base + (((lightTarget - base) * (shade - RETAIL_SHADE_MID)) >> 7);
  } else {
    out = base + (((base - lightTarget) * (256 - shade)) >> 7);
  }
  if (out < 0) {
    return 0;
  }
  if (out > 255) {
    return 255;
  }
  return out | 0;
}

function retailLerpByte(a, b, fraction, bits) {
  const left = (a * 257) >> bits;
  const right = (b * 257) >> bits;
  return ((a * 257 + (right - left) * fraction) >> 8) & 255;
}

function retailNearBaseByte(p00, p10, p01, p11, subX, subY, subdiv, bits) {
  if (subdiv === 16 || subdiv === 8 || subdiv === 4) {
    const left = retailLerpByte(p00, p01, subY, bits);
    const right = retailLerpByte(p10, p11, subY, bits);
    return retailLerpByte(left, right, subX, bits);
  }
  if (subdiv === 2) {
    if (subY === 0) {
      return subX !== 0 ? (p10 >> 1) + (p00 >> 1) : p00;
    }
    return subX !== 0 ? (p11 >> 1) + (p00 >> 1) : (p01 >> 1) + (p00 >> 1);
  }
  const top = retailLerpByte(p00, p10, subX, bits);
  const bottom = retailLerpByte(p01, p11, subX, bits);
  return retailLerpByte(top, bottom, subY, bits);
}

function cachedColor(resources, frame, qx, qy, subdiv, repeat) {
  const bits = subBits(subdiv);
  const mask = subdiv - 1;
  const x0 = cellIndex(qx, resources.mapMask, repeat);
  const y0 = cellIndex(qy, resources.mapMask, repeat);
  const x1 = neighborCell(x0, resources.mapMask, repeat);
  const y1 = neighborCell(y0, resources.mapMask, repeat);
  const subX = (qx >>> (22 - bits)) & mask;
  const subY = (qy >>> (22 - bits)) & mask;
  const shift = resources.shift;
  const colors = resources.colorMips[0];
  const p00 = paletteRgb(resources.nearPalette, colors[(y0 << shift) + x0]);
  const p10 = paletteRgb(resources.nearPalette, colors[(y0 << shift) + x1]);
  const p01 = paletteRgb(resources.nearPalette, colors[(y1 << shift) + x0]);
  const p11 = paletteRgb(resources.nearPalette, colors[(y1 << shift) + x1]);
  const color = [
    retailNearBaseByte(p00[0], p10[0], p01[0], p11[0], subX, subY, subdiv, bits),
    retailNearBaseByte(p00[1], p10[1], p01[1], p11[1], subX, subY, subdiv, bits),
    retailNearBaseByte(p00[2], p10[2], p01[2], p11[2], subX, subY, subdiv, bits),
  ];
  const packed = detailPacked(resources, qx, qy, subdiv, repeat);
  const shade = (packed >>> 8) & 255;
  const detailIndex = packed & 255;
  if (shade === 0) {
    if (detailIndex !== 0) {
      return paletteRgb(resources.detailPalette, detailIndex);
    }
    return color;
  }
  color[0] = shadeChannel(color[0], frame.detailLight[0] | 0, shade);
  color[1] = shadeChannel(color[1], frame.detailLight[1] | 0, shade);
  color[2] = shadeChannel(color[2], frame.detailLight[2] | 0, shade);
  if (detailIndex !== 0) {
    const detail = paletteRgb(resources.detailPalette, detailIndex);
    color[0] = (color[0] >> 1) + (detail[0] >> 1);
    color[1] = (color[1] >> 1) + (detail[1] >> 1);
    color[2] = (color[2] >> 1) + (detail[2] >> 1);
  }
  return color;
}

function mipLevel(resources, mip) {
  const last = resources.heightMips.length - 1;
  if (mip < 0) {
    return 0;
  }
  if (mip > last) {
    return last;
  }
  return mip;
}

function directCoord(resources, qx, qy, mip, repeat) {
  const level = mipLevel(resources, mip);
  const size = resources.width >> level;
  const limit = size - 1;
  if (repeat) {
    return [
      ((qx >>> 22) >> level) & limit,
      ((qy >>> 22) >> level) & limit,
    ];
  }
  const x = cellIndex(qx, resources.mapMask, 0) >> level;
  const y = cellIndex(qy, resources.mapMask, 0) >> level;
  return [x > limit ? limit : x, y > limit ? limit : y];
}

function directHeightQ20(resources, qx, qy, mip, repeat) {
  const level = mipLevel(resources, mip);
  const coord = directCoord(resources, qx, qy, level, repeat);
  const size = resources.width >> level;
  return (resources.heightMips[level][coord[1] * size + coord[0]] << 20) | 0;
}

function directColor(resources, qx, qy, mip, bank, repeat) {
  const level = mipLevel(resources, mip);
  const coord = directCoord(resources, qx, qy, level, repeat);
  const size = resources.width >> level;
  const colorIndex = resources.colorMips[level][coord[1] * size + coord[0]] & 255;
  const row = Math.max(0, Math.min(9, bank | 0));
  return paletteRgb(resources.voxPal.subarray(row * RETAIL_PALETTE_COUNT * 4, (row + 1) * RETAIL_PALETTE_COUNT * 4), colorIndex);
}

function passHeightQ20(resources, frame, passId, qx, qy, repeat) {
  if (passId < 5) {
    return cachedHeightQ20(resources, qx, qy, frame.passes[passId].subdiv, repeat);
  }
  return directHeightQ20(resources, qx, qy, frame.passes[passId].mip, repeat);
}

function passColor(resources, frame, passId, qx, qy, repeat) {
  if (passId < 5) {
    return cachedColor(resources, frame, qx, qy, frame.passes[passId].subdiv, repeat);
  }
  return directColor(resources, qx, qy, frame.passes[passId].mip, passId - 5, repeat);
}

function vmaxLevelForPass(passId) {
  if (passId < 4) {
    return 0;
  }
  if (passId === 4) {
    return 1;
  }
  return Math.min(9, (passId - 5) + 2);
}

function vmaxHeightQ20(resources, passId, qx, qy, repeat) {
  const level = mipLevel(resources, vmaxLevelForPass(passId));
  const coord = directCoord(resources, qx, qy, level, repeat);
  const size = resources.width >> level;
  return (resources.vmaxMips[level][coord[1] * size + coord[0]] << 20) | 0;
}

function coarseShiftForPass(passId) {
  return RETAIL_COARSE_SHIFT[passId] | 0;
}

function helperPeriodForPass(passId) {
  if (passId < 5) {
    return RETAIL_HELPER_PERIOD_NEAR[passId] >>> 0;
  }
  return RETAIL_DIRECT_HELPER_PERIOD >>> 0;
}

function packPixel(red, green, blue) {
  const r = red < 0 ? 0 : red > 255 ? 255 : red;
  const g = green < 0 ? 0 : green > 255 ? 255 : green;
  const b = blue < 0 ? 0 : blue > 255 ? 255 : blue;
  return (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
}

function skyPixel(resources, frame, pair, y) {
  const row = y * RETAIL_SKY_ROW_WORDS;
  const mode = frame.skyRows[row] | 0;
  if (mode === RETAIL_SKY_MODE_BLACK) {
    return packPixel(0, 0, 0);
  }
  if (mode === RETAIL_SKY_MODE_HORIZON) {
    const environment = frame.environment;
    return packPixel(
      Math.round(environment[0] * 255),
      Math.round(environment[1] * 255),
      Math.round(environment[2] * 255)
    );
  }
  const mip = frame.skyRows[row + 1] | 0;
  const size = 512 >> mip;
  const u = (frame.skyRows[row + 2] | 0) + pair * (frame.skyRows[row + 4] | 0);
  const v = (frame.skyRows[row + 3] | 0) + pair * (frame.skyRows[row + 5] | 0);
  const texelU = (u >> 16) & (size - 1);
  const texelV = (v >> 16) & (size - 1);
  const level = resources.cloudMips[Math.min(mip, resources.cloudMips.length - 1)][texelV * size + texelU] & 63;
  const gradientRow = (frame.skyRows[row + 6] >>> 6) & 255;
  const offset = (gradientRow * RETAIL_SKY_TABLE_WIDTH + level) * 4;
  return packPixel(
    resources.skyTable[offset],
    resources.skyTable[offset + 1],
    resources.skyTable[offset + 2]
  );
}

function destinationColumn(column, pixelWidth, screenWidth, startColumn) {
  if (pixelWidth === screenWidth) {
    return column;
  }
  return column - startColumn;
}

function writePair(pixels, pixelWidth, width, x, y, color, startColumn, endColumn) {
  if (y < 0) {
    return;
  }
  const write = (column) => {
    if (column < startColumn || column >= endColumn || column >= width) {
      return;
    }
    const dest = destinationColumn(column, pixelWidth, width, startColumn);
    if (dest < 0 || dest >= pixelWidth) {
      return;
    }
    pixels[y * pixelWidth + dest] = color;
  };
  write(x);
  write(x + 1);
}

function createState(frame, x) {
  const centerX = frame.width >> 1;
  const centerY = frame.height >> 1;
  const horizontalQ = Math.imul((x - centerX) | 0, frame.inverseFocalQ20) | 0;
  const bottomV = Math.imul((centerY - (frame.height - 1)) | 0, frame.inverseFocalQ20) | 0;
  const rayX = (frame.forwardQ.x +
    fixedMulQ20Scan(frame.rightQ.x, horizontalQ) +
    fixedMulQ20Scan(frame.upQ.x, bottomV)) | 0;
  const rayY = (frame.forwardQ.y +
    fixedMulQ20Scan(frame.rightQ.y, horizontalQ) +
    fixedMulQ20Scan(frame.upQ.y, bottomV)) | 0;
  const rayZ = (frame.forwardQ.z + fixedMulQ20Scan(frame.upQ.z, bottomV)) | 0;
  return {
    scanIndex: 0,
    done: 0,
    sy: frame.height - 1,
    posX: frame.cameraQ.x | 0,
    posY: frame.cameraQ.y | 0,
    posZ: frame.cameraQ.z | 0,
    stepX: scaledScanStep(rayX, frame.firstStep),
    stepY: scaledScanStep(rayY, frame.firstStep),
    stepZ: scaledScanStep(rayZ, frame.firstStep),
    accX: 0,
    accY: 0,
    accZ: 0,
  };
}

function terrainPass(resources, frame, state, passId, x, pixels, pixelWidth, startColumn, endColumn) {
  if (state.done) {
    return;
  }
  let sy = state.sy | 0;
  let scanIndex = state.scanIndex | 0;
  let posX = state.posX | 0;
  let posY = state.posY | 0;
  let posZ = state.posZ | 0;
  let stepX = state.stepX | 0;
  let stepY = state.stepY | 0;
  let stepZ = state.stepZ | 0;
  let accX = state.accX | 0;
  let accY = state.accY | 0;
  let accZ = state.accZ | 0;
  const repeat = frame.repeat;
  const rowX = -fixedMulQ20Scan(frame.upQ.x, frame.inverseFocalQ20) | 0;
  const rowY = -fixedMulQ20Scan(frame.upQ.y, frame.inverseFocalQ20) | 0;
  const rowZ = -fixedMulQ20Scan(frame.upQ.z, frame.inverseFocalQ20) | 0;
  let deltaX = scaledScanStep(rowX, frame.firstStep);
  let deltaY = scaledScanStep(rowY, frame.firstStep);
  let deltaZ = scaledScanStep(rowZ, frame.firstStep);
  if (passId > 0) {
    for (let previous = 0; previous < passId; previous++) {
      const scale = frame.passes[previous].nextScaleQ16 | 0;
      deltaX = fixedMulQ16Scan(deltaX, scale);
      deltaY = fixedMulQ16Scan(deltaY, scale);
      deltaZ = fixedMulQ16Scan(deltaZ, scale);
    }
    const stepScale = frame.passes[passId - 1].nextScaleQ16 | 0;
    stepX = fixedMulQ16Scan(stepX, stepScale);
    stepY = fixedMulQ16Scan(stepY, stepScale);
    stepZ = fixedMulQ16Scan(stepZ, stepScale);
  }
  if (posZ > RETAIL_DONE_Z_Q20 && stepZ >= 0) {
    state.done = 1;
    state.stepX = stepX;
    state.stepY = stepY;
    state.stepZ = stepZ;
    return;
  }
  const endScan = frame.passes[passId].endScanIndex | 0;
  const coarseShift = coarseShiftForPass(passId);
  const coarseScale = 1 << coarseShift;
  const helperPeriod = helperPeriodForPass(passId);
  const coarseDeltaX = deltaX << coarseShift;
  const coarseDeltaY = deltaY << coarseShift;
  const coarseDeltaZ = deltaZ << coarseShift;
  let advance = true;
  let done = false;
  let helperPending = true;
  let fineSinceHelper = 0;
  for (let iteration = 0; iteration < RETAIL_PASS_ITERATION_LIMIT && !done && sy >= 0; iteration++) {
    if (advance) {
      if (helperPending) {
        const coarseStepX = stepX << coarseShift;
        const coarseStepY = stepY << coarseShift;
        const coarseStepZ = stepZ << coarseShift;
        for (let coarse = 0; coarse < RETAIL_PASS_ITERATION_LIMIT; coarse++) {
          posX = (posX + coarseStepX) | 0;
          posY = (posY + coarseStepY) | 0;
          posZ = (posZ + coarseStepZ) | 0;
          accX = (accX + coarseDeltaX) | 0;
          accY = (accY + coarseDeltaY) | 0;
          accZ = (accZ + coarseDeltaZ) | 0;
          scanIndex = (scanIndex + coarseScale) | 0;
          const upper = vmaxHeightQ20(resources, passId, posX, posY, repeat);
          if (posZ < upper || scanIndex > endScan) {
            break;
          }
        }
        posX = (posX - (stepX << coarseShift)) | 0;
        posY = (posY - (stepY << coarseShift)) | 0;
        posZ = (posZ - (stepZ << coarseShift)) | 0;
        accX = (accX - coarseDeltaX) | 0;
        accY = (accY - coarseDeltaY) | 0;
        accZ = (accZ - coarseDeltaZ) | 0;
        scanIndex = (scanIndex - coarseScale) | 0;
        helperPending = false;
        fineSinceHelper = 0;
      }
      scanIndex = (scanIndex + 1) | 0;
      posX = (posX + stepX) | 0;
      posY = (posY + stepY) | 0;
      posZ = (posZ + stepZ) | 0;
      accX = (accX + deltaX) | 0;
      accY = (accY + deltaY) | 0;
      accZ = (accZ + deltaZ) | 0;
      fineSinceHelper = (fineSinceHelper + 1) >>> 0;
    }
    let terrainZ = passHeightQ20(resources, frame, passId, posX, posY, repeat);
    if (passId < 5) {
      terrainZ = terrainZ & RETAIL_NEAR_HEIGHT_MASK;
    }
    if (posZ < terrainZ) {
      const color = passColor(resources, frame, passId, posX, posY, repeat);
      writePair(pixels, pixelWidth, frame.width, x, sy, packPixel(color[0], color[1], color[2]), startColumn, endColumn);
      sy = (sy - 1) | 0;
      posX = (posX - accX) | 0;
      posY = (posY - accY) | 0;
      posZ = (posZ - accZ) | 0;
      stepX = (stepX - deltaX) | 0;
      stepY = (stepY - deltaY) | 0;
      stepZ = (stepZ - deltaZ) | 0;
      posX = (posX - stepX) | 0;
      posY = (posY - stepY) | 0;
      posZ = (posZ - stepZ) | 0;
      accX = (accX - deltaX) | 0;
      accY = (accY - deltaY) | 0;
      accZ = (accZ - deltaZ) | 0;
      scanIndex = (scanIndex - 1) | 0;
      if (sy < 0) {
        done = true;
        break;
      }
      advance = false;
      fineSinceHelper = 0;
      helperPending = false;
      continue;
    }
    if (scanIndex > endScan) {
      break;
    }
    advance = true;
    if (fineSinceHelper >= helperPeriod) {
      helperPending = true;
    }
  }
  state.scanIndex = scanIndex;
  state.done = done ? 1 : 0;
  state.sy = sy;
  state.posX = posX;
  state.posY = posY;
  state.posZ = posZ;
  state.stepX = stepX;
  state.stepY = stepY;
  state.stepZ = stepZ;
  state.accX = accX;
  state.accY = accY;
  state.accZ = accZ;
}

export function renderRetailColumns(params) {
  const maps = params;
  const resources = buildRetailResources({
    heightMap: maps.heightMap,
    colorMap: maps.colorMap,
    width: (maps.mapW ?? maps.width) | 0,
    height: (maps.mapH ?? maps.height) | 0,
    generation: (maps.mapsGeneration ?? maps.generation ?? 0) | 0,
    skyColor: maps.skyColor >>> 0,
    applyFog: maps.applyFog,
  });
  resources.shift = Math.round(Math.log2(resources.width));
  const frame = params.retailFrame || buildRetailFrame({
    width: params.screenWidth | 0,
    height: params.screenHeight | 0,
    focalWidth: params.screenWidth | 0,
    fovDegrees: params.fovDegrees || params.fov || 90,
    quality: params.quality,
    lodBias: params.lodBias || 0,
    yawRadians: params.yawRadians != null ? params.yawRadians : params.angle || 0,
    pitchDegrees: params.pitchDegrees != null ? params.pitchDegrees : params.pitch || 0,
    cameraX: params.camX,
    cameraY: params.camY,
    cameraZ: params.camZ,
    altitude: params.altitude,
    frameCounter: params.frameCounter | 0,
    repeat: params.repeat,
    mapSize: resources.width,
    environment: resources.environment,
    detailLight: resources.detailLight,
    skyHeight: params.skyHeight,
    skyHorizon: params.skyHorizon,
  });
  const pixels = params.pixels;
  const pixelWidth = (params.pixelWidth ?? params.screenWidth) | 0;
  const startColumn = params.startColumn | 0;
  const endColumn = params.endColumn != null ? params.endColumn | 0 : frame.width;
  const pairStart = Math.max(0, startColumn >> 1);
  const pairEnd = Math.min((frame.width + 1) >> 1, (endColumn + 1) >> 1);
  for (let pair = pairStart; pair < pairEnd; pair++) {
    const x = pair * 2;
    for (let y = 0; y < frame.height; y++) {
      writePair(pixels, pixelWidth, frame.width, x, y, skyPixel(resources, frame, pair, y), startColumn, endColumn);
    }
  }
  const states = [];
  for (let pair = pairStart; pair < pairEnd; pair++) {
    states.push(createState(frame, pair * 2));
  }
  for (let passId = 0; passId < frame.passes.length; passId++) {
    for (let index = 0; index < states.length; index++) {
      terrainPass(
        resources,
        frame,
        states[index],
        passId,
        (pairStart + index) * 2,
        pixels,
        pixelWidth,
        startColumn,
        endColumn
      );
    }
  }
  return { descriptors: frame.passes, frame, resources };
}

export function renderRetailFrame(scene, output) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const provided = scene.frameCounter != null
    ? scene.frameCounter
    : scene.render && scene.render.frameCounter;
  const frameCounter = provided != null ? provided | 0 : advanceRetailGameClock(now);
  return renderRetailColumns({
    ...scene.terrain,
    ...scene.camera,
    ...scene.render,
    ...output,
    mapW: scene.terrain.mapW || scene.terrain.width,
    mapH: scene.terrain.mapH || scene.terrain.height,
    heightMap: scene.terrain.heightMap,
    colorMap: scene.terrain.colorMap,
    altitude: scene.render.altitude || scene.terrain.altitude,
    skyColor: scene.terrain.skyColor || scene.render.skyColor || 0xff87b5e8,
    applyFog: scene.render.applyFog,
    fovDegrees: scene.camera.fovDegrees || scene.camera.fov || 90,
    yawRadians: scene.camera.yawRadians != null ? scene.camera.yawRadians : scene.camera.angle || 0,
    pitchDegrees: scene.camera.pitchDegrees != null ? scene.camera.pitchDegrees : scene.camera.pitch || 0,
    camX: scene.camera.camX,
    camY: scene.camera.camY,
    camZ: scene.camera.camZ,
    quality: scene.render.quality,
    repeat: scene.render.repeat,
    frameCounter,
    screenWidth: output.screenWidth,
    screenHeight: output.screenHeight,
    pixels: output.pixels,
    pixelWidth: output.pixelWidth || output.screenWidth,
    startColumn: output.startColumn || 0,
    endColumn: output.endColumn != null ? output.endColumn : output.screenWidth,
    mapsGeneration: scene.terrain.mapsGeneration || scene.terrain.generation || 0,
  });
}
