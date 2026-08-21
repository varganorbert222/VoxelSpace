"use strict";

import {
  BACKEND_CHIP,
  BACKEND_JS,
  usesWorkers,
} from "../constants/backend.js";
import { ALGORITHM_CLASSIC } from "../constants/algorithm.js";
import { DEFAULT_MULTITHREAD } from "../constants/threading.js";
import { createBackend, listBackends } from "../backends/contract.js";

class Renderer {
  constructor(frameBuffer, surface) {
    this._frameBuffer = frameBuffer;
    this._surface = surface;
    this._camera = null;
    this._applyFog = true;
    this._repeat = true;
    this._algorithm = ALGORITHM_CLASSIC;
    this._multithread = DEFAULT_MULTITHREAD;
    this._multithreadWanted = DEFAULT_MULTITHREAD;
    this._backendId = BACKEND_JS;
    this._backend = null;
  }

  setCamera(camera) {
    this._camera = camera;
  }

  get camera() {
    return this._camera;
  }

  get frameBuffer() {
    return this._frameBuffer;
  }

  get surface() {
    return this._surface;
  }

  get applyFog() {
    return this._applyFog;
  }

  get repeat() {
    return this._repeat;
  }

  get algorithm() {
    return this._algorithm;
  }

  get multithread() {
    return this._multithread;
  }

  get backend() {
    return this._backendId;
  }

  get backendChip() {
    return BACKEND_CHIP[this._backendId] || this._backendId;
  }

  set algorithm(value) {
    if (this._algorithm !== value) {
      this.cancelJobs();
    }
    this._algorithm = value;
  }

  set multithread(value) {
    const next = !!value;
    this._multithreadWanted = next;
    if (!usesWorkers(this._backendId)) {
      return;
    }
    if (this._multithread === next) {
      return;
    }
    this._multithread = next;
    this.cancelJobs();
  }

  getOptions() {
    return {
      applyFog: this._applyFog,
      repeat: this._repeat,
      algorithm: this._algorithm,
      multithread: this._multithreadWanted,
      backend: this._backendId,
    };
  }

  setOptions(options) {
    if (options.applyFog !== undefined) {
      this._applyFog = options.applyFog;
    }
    if (options.repeat !== undefined) {
      this._repeat = options.repeat;
    }
    if (options.algorithm !== undefined) {
      this.algorithm = options.algorithm;
    }
    if (options.multithread !== undefined) {
      this.multithread = options.multithread;
    }
    if (options.backend !== undefined && !this._backend) {
      this._backendId = options.backend;
    }
  }

  cancelJobs() {
    if (this._backend && this._backend.cancelJobs) {
      this._backend.cancelJobs();
    }
  }

  onFrameBufferResized() {
    this.cancelJobs();
    if (this._backend && this._backend.resize) {
      this._backend.resize(this._surface);
    }
  }

  invalidatePanorama() {
    if (this._backend) {
      this._backend.invalidatePanorama();
    }
  }

  async setMaps(exportedMaps) {
    if (this._backend && exportedMaps) {
      await this._backend.setMaps(exportedMaps);
    }
  }

  drawBackground() {
    const dstToProjPlane = this._camera.calculateProjPlane();
    const screenHorizon = this._camera.calculateHorizon(dstToProjPlane);
    this._frameBuffer.drawBackground(screenHorizon);
  }

  writeToContext() {
    this._frameBuffer.writeToContext();
  }

  _syncWorkerFlag() {
    if (usesWorkers(this._backendId)) {
      this._multithread = this._multithreadWanted;
      return;
    }
    this._multithread = false;
  }

  async setBackend(id) {
    if (id === this._backendId && this._backend) {
      return true;
    }

    const listed = listBackends();
    const meta = listed.find((b) => b.id === id);
    if (!meta || !meta.available) {
      console.warn("Render runtime unavailable:", id);
      if (!this._backend) {
        if (id !== BACKEND_JS) {
          return this.setBackend(BACKEND_JS);
        }
        return false;
      }
      return false;
    }

    const created = createBackend(id);
    try {
      await created.init({
        renderer: this,
        camera: this._camera,
        frameBuffer: this._frameBuffer,
        surface: this._surface,
      });
    } catch (err) {
      console.warn("Render runtime init failed:", id, err);
      if (created.dispose) {
        created.dispose();
      }
      if (id !== BACKEND_JS) {
        return this.setBackend(BACKEND_JS);
      }
      return false;
    }

    const prev = this._backend;
    this._backend = created;
    this._backendId = id;
    this._syncWorkerFlag();
    if (prev && prev.dispose) {
      try {
        prev.dispose();
      } catch (err) {
        console.warn("Render runtime dispose failed:", err);
      }
    }
    this.invalidatePanorama();
    if (this._backend.resize) {
      await this._backend.resize(this._surface);
    }
    return true;
  }

  async render(terrain) {
    if (!this._backend) {
      return;
    }
    await this._backend.render({
      algorithm: this._algorithm,
      camera: this._camera,
      terrain,
      applyFog: this._applyFog,
      repeat: this._repeat,
      screenWidth: this._frameBuffer.width,
      screenHeight: this._frameBuffer.height,
    });
  }
}

export default Renderer;
