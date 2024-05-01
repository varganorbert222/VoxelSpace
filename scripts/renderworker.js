"use strict";

import { makeColor, unpackColor } from "./color.js";
import { invLerp } from "./utils.js";
import VMath from "./vmath.js";

function calculateFog(color, depth) {
  const skyColor = 0xffffe2b3;

  let c = unpackColor(color);
  let s = unpackColor(skyColor);

  const cr = c.r + (s.r - c.r) * depth;
  const cg = c.g + (s.g - c.g) * depth;
  const cb = c.b + (s.b - c.b) * depth;
  const ca = c.a + (s.a - c.a) * depth;

  return makeColor(cr, cg, cb, ca);
}

function calculateIndexes(width, workerIndex, totalWorkers) {
  const slice = width / totalWorkers;
  const startIndex = slice * workerIndex;
  const endIndex = startIndex + slice;
  return {
    slice: slice,
    startIndex: startIndex,
    endIndex: endIndex,
  };
}

function projectToScreen(y, z, width, horizon, renderScale) {
  const dstToProjPlane =
    (width * 0.5) / Math.tan(VMath.degToRad(this._fov * 0.5));
  const projected = (y / z) * dstToProjPlane;
  const scaledHorizon = horizon * renderScale;
  const drawHeight = Math.floor(projected + scaledHorizon);

  return drawHeight;
}

function renderTerrain({
  camera,
  terrain,
  renderMode,
  applyFog,
  workerIndex,
  totalWorkers,
}) {
  const cameraNearClip = camera.nearClip;
  const cameraFarClip = camera.farClip;
  const cameraPixelOffset = camera.pixelOffset;
  const cameraPosX = camera.posX;
  const cameraPosY = camera.posY;
  const cameraPosZ = camera.posZ;
  const cameraScreenWidth = camera.screenWidth;
  const cameraScreenHeight = camera.screenHeight;
  const cameraHorizon = camera.horizon;
  const indexes = calculateIndexes(screenWidth, workerIndex, totalWorkers);
  const screenWidth = indexes.endIndex;
  const screenHeight = cameraScreenHeight;
  let cameraDeltaZ = camera.minDeltaZ;

  const frameBuffer = new Uint32Array(new ArrayBuffer(
    screenWidth * screenHeight * 4
  ));

  const sinang = Math.sin(camera.angle);
  const cosang = Math.cos(camera.angle);

  const hiddenY = new Int32Array(screenWidth);
  for (let i = 0; (i < screenWidth) | 0; i = (i + 1) | 0) {
    hiddenY[i] = screenHeight;
  }

  // Draw from front to back
  for (let z = cameraNearClip; z < cameraFarClip; z += cameraDeltaZ) {
    // 90 degree field of view (TODO: variable fov)
    let plx = -cosang * z - sinang * z;
    let ply = sinang * z - cosang * z;
    let prx = cosang * z - sinang * z;
    let pry = -sinang * z - cosang * z;

    const dx = (prx - plx) / cameraScreenWidth;
    const dy = (pry - ply) / cameraScreenWidth;
    plx += cameraPosX;
    ply += cameraPosY;

    for (
      let i = 0;
      (i < indexes.slice) | 0;
      i += cameraPixelOffset
    ) {
      const terrainSDF = terrain.getTerrainSDF(plx, ply, cameraPosZ);
      const heightonscreen =
        projectToScreen(terrainSDF, z, cameraScreenWidth, cameraHorizon) | 0;
      const depth = invLerp(cameraNearClip, cameraFarClip, z);

      switch (renderMode) {
        case "frame":
          let terrainColor = terrain.getTerrainColor(plx, ply /*, z*/);

          if (applyFog) {
            terrainColor = calculateFog(terrainColor, depth);
          }

          frameBuffer.drawVerticalLine(
            i,
            heightonscreen,
            hiddenY[i],
            terrainColor,
            cameraPixelOffset
          );
          break;
        case "depth":
          const depthColor = makeColor(
            255 * depth,
            255 * depth,
            255 * depth,
            255
          );
          frameBuffer.drawVerticalLine(
            i,
            heightonscreen,
            hiddenY[i],
            depthColor,
            cameraPixelOffset
          );
          break;
        default:
          break;
      }

      if (heightonscreen < hiddenY[i]) hiddenY[i] = heightonscreen;

      plx += dx * cameraPixelOffset;
      ply += dy * cameraPixelOffset;
    }

    // cameraDeltaZ += 0.005; // implement LOD (lerp or similar)
    cameraDeltaZ *= 1.005;
  }

  return {
    frameBuffer: frameBuffer,
    startIndex: indexes.startIndex,
    endIndex: indexes.endIndex
  }
}

onmessage = (e) => {
  const workerResult = renderTerrain(e.data);
  postMessage(workerResult);
};
