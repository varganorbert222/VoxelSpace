"use strict";

import { makeColor, unpackColor } from "./color.js";
import Threading from "./threading.js";
import { invLerp } from "./utils.js";

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
      this._frameBuffer.drawBackground(0xff000000);
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

  renderTerrain(terrain, renderMode) {
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
        const depth = invLerp(nearClip, farClip, z);
        let plotColor = 0xff000000;

        if (renderMode === "frame") {
          plotColor = terrain.getTerrainColor(plx, ply /*, z*/);

          if (this._applyFog) {
            plotColor = this.calculateFog(plotColor, depth, terrain.skyColor); // itt baj van a skycolorral, mert brutálisan lelassul a program (lehet nem jó a konverzió)
          }
        } else if (renderMode === "depth") {
          plotColor = makeColor(255 * depth, 255 * depth, 255 * depth, 255);
        }

        this._frameBuffer.drawVerticalLine(
          i,
          heightonscreen,
          hiddenY[i],
          plotColor,
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

  renderTerrainWithWorkers(terrain, renderMode, numberOfCores) {
    if (this._workers.length === 0) {
      for (let index = 0; index < Threading.numberOfCores; index++) {
        const worker = new Worker("./renderworker.js");
        worker.onmessage = (e) => {};
        this._workers.push(worker);
      }
    }

    for (let index = 0; index < Threading.numberOfCores; index++) {
      this._workers[index].postMessage({
        camera: this._camera,
        frameBuffer: this._frameBuffer,
        terrain: terrain,
        renderMode: renderMode,
        applyFog: this._applyFog,
        workerIndex: index,
        totalWorkers: Threading.numberOfCores,
      });
    }
  }

  render(terrain, renderMode) {
    this.drawBackground(renderMode, terrain.skyColor);
    this.renderTerrain(terrain, renderMode);
    // this.renderTerrainWithWorkers(terrain, renderMode, Threading.numberOfCores);
    this.writeToContext();
  }
}

export default Renderer;
