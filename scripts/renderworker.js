"use strict";

function renderTerrain({ camera, frameBuffer, terrain, renderMode, applyFog }) {
  const nearClip = camera.nearClip;
  const farClip = camera.farClip;
  const pixelOffset = camera.pixelOffset;
  const cameraPosX = camera.posX;
  const cameraPosY = camera.posY;
  const cameraPosZ = camera.posZ;
  let step = camera.minDeltaZ;

  const screenWidth = frameBuffer.canvas.width;
  const screenHeight = frameBuffer.canvas.height;
  const sinang = Math.sin(camera.angle);
  const cosang = Math.cos(camera.angle);

  const hiddenY = new Int32Array(screenWidth);
  for (let i = 0; (i < screenWidth) | 0; i = (i + 1) | 0) {
    hiddenY[i] = screenHeight;
  }

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

    for (let i = 0; (i < screenWidth) | 0; i += pixelOffset) {
      const terrainSDF = terrain.getTerrainSDF(plx, ply, cameraPosZ);
      const heightonscreen = camera.projectToScreen(terrainSDF, z) | 0;
      const depth = invLerp(nearClip, farClip, z);

      switch (renderMode) {
        case "frame":
          let terrainColor = terrain.getTerrainColor(plx, ply /*, z*/);

          if (applyFog) {
            terrainColor = this.calculateFog(terrainColor, depth);
          }

          frameBuffer.drawVerticalLine(
            i,
            heightonscreen,
            hiddenY[i],
            terrainColor,
            pixelOffset
          );
          break;
        case "depth":
          const depthColor = makeColor(
            255 * depth,
            255 * depth,
            255 * depth,
            255
          );
          depthBuffer.drawVerticalLine(
            i,
            heightonscreen,
            hiddenY[i],
            depthColor,
            pixelOffset
          );
          break;
        default:
          break;
      }

      if (heightonscreen < hiddenY[i]) hiddenY[i] = heightonscreen;

      plx += dx * pixelOffset;
      ply += dy * pixelOffset;
    }

    // step += 0.005; // implement LOD (lerp or similar)
    step *= 1.005;
  }
}

onmessage = (e) => {
  const workerResult = {};
  renderTerrain(e.data[0]);
  postMessage(workerResult);
};
