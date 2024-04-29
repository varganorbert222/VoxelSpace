"use strict";

import { makeColor } from "./color.js";
import { invLerp } from "./utils.js";

class Renderer {
  constructor(camera, frameBuffer, depthBuffer) {
    this._camera = camera;
    this._frameBuffer = frameBuffer;
    this._depthBuffer = depthBuffer;
  }

  drawBackground(renderMode) {
    switch (renderMode) {
      case "frame":
        this._frameBuffer.drawBackground();
        break;
      case "depth":
        this._depthBuffer.drawBackground();
        break;
      default:
        break;
    }
  }

  writeToContext(renderMode) {
    switch (renderMode) {
      case "frame":
        this._frameBuffer.writeToContext();
        break;
      case "depth":
        this._depthBuffer.writeToContext();
        break;
      default:
        break;
    }
  }

  renderTerrain(terrain) {
    const nearClip = this._camera.nearClip;
    const farClip = this._camera.farClip;
    const pixelOffset = this._camera.pixelOffset;
    const cameraPosX = this._camera.posX;
    const cameraPosY = this._camera.posY;
    const cameraPosZ = this._camera.posZ;
    let step = this._camera.minDeltaZ;

    const screenWidth = this._frameBuffer.canvas.width;
    const screenHeight = this._frameBuffer.canvas.height;
    const sinang = Math.sin(this._camera.angle);
    const cosang = Math.cos(this._camera.angle);

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
        const heightonscreen = this._camera.projectToScreen(terrainSDF, z) | 0;
        const terrainColor = terrain.terrainShading(plx, ply /*, z*/);
        const depth = invLerp(nearClip, farClip, z);
        const depthColor = makeColor(255 * depth, 255 * depth, 255 * depth, 255);

        this._frameBuffer.drawVerticalLine(
          i,
          heightonscreen,
          hiddenY[i],
          terrainColor,
          pixelOffset
        );

        this._depthBuffer.drawVerticalLine(
            i,
            heightonscreen,
            hiddenY[i],
            depthColor,
            pixelOffset
          );

        if (heightonscreen < hiddenY[i]) hiddenY[i] = heightonscreen;

        plx += dx * pixelOffset;
        ply += dy * pixelOffset;
      }

      // step += 0.005; // implement LOD (lerp or similar)
      step *= 1.005;
    }
  }

  render(terrain, renderMode) {
    this.drawBackground(renderMode);
    this.renderTerrain(terrain);
    this.writeToContext(renderMode);
  }
}

export default Renderer;
