"use strict";

import ClassicRenderer from "./classicRenderer.js";
import PanoramaRenderer from "./panoramaRenderer.js";
import WorkerPool from "./workerPool.js";
import { ALGORITHM_CLASSIC, ALGORITHM_PANORAMA } from "../constants/algorithm.js";
import { DEFAULT_MULTITHREAD } from "../constants/threading.js";

class Renderer {
  constructor(frameBuffer) {
    this._frameBuffer = frameBuffer;
    this._camera = null;
    this._applyFog = true;
    this._repeat = true;
    this._algorithm = ALGORITHM_CLASSIC;
    this._multithread = DEFAULT_MULTITHREAD;
    this._pool = null;
    this._classic = new ClassicRenderer(this);
    this._panorama = new PanoramaRenderer(this);
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

  get pool() {
    return this._pool;
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

  set algorithm(value) {
    if (this._algorithm !== value) {
      this.cancelJobs();
    }
    this._algorithm = value;
  }

  set multithread(value) {
    const next = !!value;
    if (this._multithread === next) {
      return;
    }
    this._multithread = next;
    this.cancelJobs();
    if (next) {
      this.ensurePool();
    }
  }

  getOptions() {
    return {
      applyFog: this._applyFog,
      repeat: this._repeat,
      algorithm: this._algorithm,
      multithread: this._multithread,
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
  }

  ensurePool() {
    if (!this._pool) {
      this._pool = new WorkerPool();
    }
    return this._pool;
  }

  useWorkers() {
    return this._multithread && this.ensurePool().workerCount > 1;
  }

  cancelJobs() {
    if (this._pool) {
      this._pool.cancel();
    }
  }

  onFrameBufferResized() {
    this.cancelJobs();
  }

  invalidatePanorama() {
    this._panorama.invalidate();
  }

  drawBackground() {
    const dstToProjPlane = this._camera.calculateProjPlane();
    const screenHorizon = this._camera.calculateHorizon(dstToProjPlane);
    this._frameBuffer.drawBackground(screenHorizon);
  }

  writeToContext() {
    this._frameBuffer.writeToContext();
  }

  async render(terrain) {
    if (this._algorithm === ALGORITHM_PANORAMA) {
      await this._panorama.render(terrain);
      return;
    }
    await this._classic.render(terrain);
  }
}

export default Renderer;
