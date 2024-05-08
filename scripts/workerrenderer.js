"use strict";

import { Color } from "./color.js";
import Threading from "./threading.js";
import VMath from "./vmath.js";

class WorkerRenderer {
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
    this._randomColors = [];
  }

  render(terrain, renderMode) {
    if (this._workers.length === 0) {
      for (let i = 0; i < Threading.numberOfCores; i++) {
        const worker = new Worker("scripts/renderterrainworker.js", { type: "module" });
        this._workers.push(worker);
        this._randomColors.push(Color.randomColor());
        worker.onmessage = (e) => {
          const result = e.data;
          this._frameBuffer.copyFromBuffer(result.frameBuffer, result.startIndex, result.endIndex, this._frameBuffer.canvas.width, this._frameBuffer.canvas.height);
          this._frameBuffer.writeToContext();
        };
      }
    }
    for (let i = 0; i < this._workers.length; i++) {
      const worker = this._workers[i];
      worker.postMessage({
        workerIndex: i,
        totalWorkers: Threading.numberOfCores,
        camera: {
          nearClip: this._camera.nearClip,
          farClip: this._camera.farClip,
          pixelOffset: this._camera.pixelOffset,
          posX: this._camera.posX,
          posY: this._camera.posY,
          posZ: this._camera.posZ,
          pitch: this._camera.pitch,
          angle: this._camera.angle,
          minDeltaZ: this._camera.minDeltaZ,
          screenWidth: this._frameBuffer.canvas.width,
          screenHeight: this._frameBuffer.canvas.height
        },
        terrain: {
          width: terrain.width,
          height: terrain.height,
          altitude: terrain.altitude,
          skyColor: terrain.skyColor,
          // skyColor: this._randomColors[i],
          colorMap: terrain.colorMap,
          heightMap: terrain.heightMap,
          mapShift: terrain.mapShift
        },
        renderMode: renderMode,
        applyFog: this._applyFog 
      });
    }
  }
}

export default WorkerRenderer;
