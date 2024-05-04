"use strict";

import { Color, makeColor, unpackColor } from "./color.js";
import VMath from "./vmath.js";

class Renderer {
  get applyFog() {
    return this._applyFog;
  }

  set applyFog(value) {
    this._applyFog = value;
  }

  constructor(camera, frameBuffer) {
    this._camera = camera;
    this._frameBuffer = frameBuffer;
    this._applyFog = true;
    this._workers = [];
  }

  drawBackground(renderMode, backgroundColor) {
    if (renderMode === "frame") {
      this._frameBuffer.drawBackground(backgroundColor);
    } else if (renderMode === "depth") {
      this._frameBuffer.drawBackground(Color.BLACK);
    }
  }

  writeToContext() {
    this._frameBuffer.writeToContext();
  }

  calculateFog(color, depth, skyColor) {
    let c = unpackColor(color);
    let s = unpackColor(skyColor);

    const cr = c.r + (s.r - c.r) * depth;
    const cg = c.g + (s.g - c.g) * depth;
    const cb = c.b + (s.b - c.b) * depth;
    const ca = c.a + (s.a - c.a) * depth;

    return makeColor(cr, cg, cb, ca);
  }

  renderTerrain(terrain, renderMode, skyColor) {
    const nearClip = this._camera.nearClip;
    const farClip = this._camera.farClip;
    const pixelOffset = this._camera.pixelOffset;
    const cameraPosX = this._camera.posX;
    const cameraPosY = this._camera.posY;
    const cameraPosZ = this._camera.posZ;
    
    const screenWidth = this._frameBuffer.canvas.width;
    const screenHeight = this._frameBuffer.canvas.height;
    const sinang = Math.sin(this._camera.angle);
    const cosang = Math.cos(this._camera.angle);
    
    const hiddenY = new Int32Array(screenWidth);
    for (let i = 0; (i < screenWidth) | 0; i = (i + 1) | 0) {
      hiddenY[i] = screenHeight;
    }
    
    let step = this._camera.minDeltaZ;
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
        const depth = VMath.invLerp(nearClip, farClip, z);
        let plotColor = Color.BLACK;

        if (renderMode === "frame") {
          plotColor = terrain.getTerrainColor(plx, ply /*, z*/);

          if (this._applyFog) {
            plotColor = this.calculateFog(plotColor, depth, skyColor);
          }
        } else if (renderMode === "depth") {
          plotColor = makeColor(depth * 255, depth * 255, depth * 255, 255);
        }

        this._frameBuffer.drawVerticalLine(
          i,
          heightonscreen,
          hiddenY[i],
          plotColor,
          pixelOffset
        );

        for (let j = i; j < (i + pixelOffset) && j < screenWidth; j++) {
          if (heightonscreen < hiddenY[j]){
            hiddenY[j] = heightonscreen;
          }
        }

        plx += dx * pixelOffset;
        ply += dy * pixelOffset;
      }

      step *= 1.005;
    }
  }

  render(terrain, renderMode) {
    this.drawBackground(renderMode, terrain.skyColor);
    this.renderTerrain(terrain, renderMode, terrain.skyColor);
    this.writeToContext();
  }
}

export default Renderer;
