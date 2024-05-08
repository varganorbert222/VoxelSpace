"use strict";

import { Color } from "./color.js";
import VMath from "./vmath.js";

let frameBuffer;
let heightMap;
let colorMap;

function calculateIndexes(width, workerIndex, totalWorkers) {
  const slice = Math.floor(width / totalWorkers);
  const startIndex = slice * workerIndex;
  const endIndex = startIndex + slice;

  return {
    startIndex: startIndex,
    endIndex: endIndex,
    slice: slice,
  };
}

function calculateFog(color, depth, skyColor) {
  let c = Color.unpackColor(color);
  let s = Color.unpackColor(skyColor);

  const cr = c.r + (s.r - c.r) * depth;
  const cg = c.g + (s.g - c.g) * depth;
  const cb = c.b + (s.b - c.b) * depth;
  const ca = c.a + (s.a - c.a) * depth;

  return Color.makeColor(cr, cg, cb, ca);
}

function drawBackgroundToBuffer(backgroundColor) {
  for (let i = 0; i < frameBuffer.length; i++) {
    frameBuffer[i] = backgroundColor;
  }
}

function drawBackground(renderMode, backgroundColor) {
  if (renderMode === "frame") {
    drawBackgroundToBuffer(backgroundColor);
  } else if (renderMode === "depth") {
    drawBackgroundToBuffer(Color.BLACK);
  }
}

function drawVerticalLine(x, ytop, ybottom, col, screenWidth, pixelOffset = 1) {
  x = x | 0;
  ytop = ytop | 0;
  ybottom = ybottom | 0;
  col = col | 0;
  if (ytop < 0) ytop = 0;
  if (ytop > ybottom) return;

  // get offset on screen for the vertical line
  for (let j = 0; j < pixelOffset && x + j < screenWidth; j++) {
    let offset = (ytop * screenWidth + x + j) | 0;
    for (let k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
      frameBuffer[offset | 0] = col | 0;
      offset = (offset + screenWidth) | 0;
    }
  }
}

function getOffset(x, y, width, height, shift) {
  const mapWidthPeriod = width - 1;
  const mapHeightPeriod = height - 1;

  const mapOffset =
    ((Math.floor(y) & mapWidthPeriod) << shift) +
    (Math.floor(x) & mapHeightPeriod);

  return mapOffset;
}

function getMapOffset(x, y, width, height, mapShift) {
  return getOffset(x, y, width, height, mapShift);
}

function getTerrainHeight(x, y, width, height, mapShift, altitude) {
  const offset = getMapOffset(x, y, width, height, mapShift);
  return (heightMap[offset] / 255) * altitude;
}

function getTerrainSDF(x, y, z, width, height, mapShift, altitude) {
  return z - getTerrainHeight(x, y, width, height, mapShift, altitude);
}

function getTerrainColor(x, y, width, height, mapShift) {
  const offset = getMapOffset(x, y, width, height, mapShift);
  return colorMap[offset];
}

function projectToScreen(y, z, pitch, width, height) {
  const screenWidth = width;
  const screenHeight = height;
  const dstToProjPlane = screenWidth * 0.5;
  const terrainProjectedHeight = (y / z) * dstToProjPlane;
  const horizon =
    Math.tan(VMath.degToRad(-pitch)) * screenHeight + screenHeight * 0.5;
  const drawHeight = Math.floor(terrainProjectedHeight + horizon);
  return drawHeight;
}

function renderTerrain(camera, terrain, renderMode, applyFog, slicedWidth) {
  const nearClip = camera.nearClip;
  const farClip = camera.farClip;
  const pixelOffset = camera.pixelOffset;
  const cameraPosX = camera.posX;
  const cameraPosY = camera.posY;
  const cameraPosZ = camera.posZ;
  const cameraPitch = camera.pitch;
  const screenWidth = camera.screenWidth;
  const screenHeight = camera.screenHeight;
  const slicedScreenWidth = slicedWidth;
  const sinang = Math.sin(camera.angle);
  const cosang = Math.cos(camera.angle);

  const hiddenY = new Int32Array(slicedScreenWidth);
  for (let i = 0; i < slicedScreenWidth; i++) {
    hiddenY[i] = screenHeight;
  }

  let step = camera.minDeltaZ;
  // Draw from front to back
  for (let z = nearClip; z < farClip; z += step) {
    // 90 degree field of view (TODO: variable fov)
    let plx = -cosang * z - sinang * z;
    let ply = sinang * z - cosang * z;
    let prx = cosang * z - sinang * z;
    let pry = -sinang * z - cosang * z;

    const dx = (prx - plx) / screenWidth;
    const dy = (pry - ply) / screenWidth;
    plx += cameraPosX;
    ply += cameraPosY;

    for (let i = 0; i < slicedScreenWidth; i += pixelOffset) {
      const terrainSDF = getTerrainSDF(
        plx,
        ply,
        cameraPosZ,
        terrain.width,
        terrain.height,
        terrain.mapShift,
        terrain.altitude
      );
      const heightonscreen = projectToScreen(
        terrainSDF,
        z,
        cameraPitch,
        screenWidth,
        screenHeight
      );
      const depth = VMath.invLerp(nearClip, farClip, z);
      let plotColor = Color.BLACK;

      if (renderMode === "frame") {
        plotColor = getTerrainColor(
          plx,
          ply,
          terrain.width,
          terrain.height,
          terrain.mapShift
        );

        if (applyFog) {
          plotColor = calculateFog(plotColor, depth, terrain.skyColor);
        }
      } else if (renderMode === "depth") {
        plotColor = Color.makeColor(depth * 255, depth * 255, depth * 255, 255);
      }

      drawVerticalLine(
        i,
        heightonscreen,
        hiddenY[i],
        plotColor,
        slicedScreenWidth,
        pixelOffset
      );

      for (let j = i; j < i + pixelOffset && j < slicedScreenWidth; j++) {
        if (heightonscreen < hiddenY[j]) {
          hiddenY[j] = heightonscreen;
        }
      }

      plx += dx * pixelOffset;
      ply += dy * pixelOffset;
    }

    step *= 1.005;
  }
}

onmessage = (e) => {
  const data = e.data;
  const workerIndex = data.workerIndex;
  const totalWorkers = data.totalWorkers;
  const camera = data.camera;
  const width = camera.screenWidth;
  const height = camera.screenHeight;
  const indexes = calculateIndexes(width, workerIndex, totalWorkers);
  const slicedWidth = indexes.slice;
  const terrain = data.terrain;
  const renderMode = data.renderMode;
  const applyFog = data.applyFog;

  frameBuffer = new Uint32Array(new ArrayBuffer(slicedWidth * height * 4));
  colorMap = new Uint32Array(terrain.colorMap);
  heightMap = new Uint8Array(terrain.heightMap);

  drawBackground(renderMode, terrain.skyColor);
  renderTerrain(camera, terrain, renderMode, applyFog, slicedWidth);

  const result = {
    frameBuffer: frameBuffer,
    startIndex: indexes.startIndex,
    endIndex: indexes.endIndex,
    slice: indexes.slice,
  };

  postMessage(result);
};
