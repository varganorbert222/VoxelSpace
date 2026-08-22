"use strict";

import ClassicRenderer from "../../render/classicRenderer.js";
import PanoramaRenderer from "../../render/panoramaRenderer.js";
import CubemapRenderer from "../../render/cubemapRenderer.js";
import WorkerPool from "../../render/workerPool.js";
import { ALGORITHM_CUBEMAP, ALGORITHM_PANORAMA } from "../../constants/algorithm.js";
import { BACKEND_WASM } from "../../constants/backend.js";
import { instantiateMarch, marchModuleSupported } from "../../wasm/instantiate.js";
import { createWasmKernels } from "../../wasm/kernels.js";

let availableCache = null;

class WasmBackend {
  static get id() {
    return BACKEND_WASM;
  }

  static async isAvailable() {
    if (availableCache !== null) {
      return availableCache;
    }
    try {
      availableCache = marchModuleSupported();
      return availableCache;
    } catch (err) {
      console.warn("WASM runtime unavailable:", err);
      availableCache = false;
      return false;
    }
  }

  constructor() {
    this._host = null;
    this._classic = null;
    this._panorama = null;
    this._cubemap = null;
    this._pool = null;
    this._maps = null;
    this._kernels = null;
  }

  get kernels() {
    return this._kernels;
  }

  async init(ctx) {
    const instance = await instantiateMarch();
    this._kernels = createWasmKernels(instance);
    this._host = ctx.renderer;
    this._classic = new ClassicRenderer(this);
    this._panorama = new PanoramaRenderer(this);
    this._cubemap = new CubemapRenderer(this);
  }

  get camera() {
    return this._host.camera;
  }

  get frameBuffer() {
    return this._host.frameBuffer;
  }

  get pool() {
    return this._pool;
  }

  get applyFog() {
    return this._host.applyFog;
  }

  get repeat() {
    return this._host.repeat;
  }

  get algorithm() {
    return this._host.algorithm;
  }

  get multithread() {
    return this._host.multithread;
  }

  ensurePool() {
    if (!this._pool) {
      this._pool = new WorkerPool({ kernelBackend: BACKEND_WASM });
      if (this._maps) {
        this._pool.initMaps(this._maps);
      }
    }
    return this._pool;
  }

  useWorkers() {
    return this._host.multithread && this.ensurePool().workerCount > 1;
  }

  cancelJobs() {
    if (this._pool) {
      this._pool.cancel();
    }
  }

  drawBackground() {
    this._host.drawBackground();
  }

  writeToContext() {
    this._host.writeToContext();
  }

  async setMaps(exportedMaps) {
    this._maps = exportedMaps;
    if (this._pool && exportedMaps) {
      this._pool.initMaps(exportedMaps);
    }
  }

  async resize() {
    this.cancelJobs();
  }

  invalidatePanorama() {
    if (this._panorama) {
      this._panorama.invalidate();
    }
    if (this._cubemap) {
      this._cubemap.invalidate();
    }
  }

  async render(frame) {
    if (frame.algorithm === ALGORITHM_PANORAMA) {
      await this._panorama.render(frame.terrain);
      return;
    }
    if (frame.algorithm === ALGORITHM_CUBEMAP) {
      await this._cubemap.render(frame.terrain);
      return;
    }
    await this._classic.render(frame.terrain);
  }

  dispose() {
    this.cancelJobs();
    if (this._pool) {
      this._pool.dispose();
      this._pool = null;
    }
    this._classic = null;
    this._panorama = null;
    this._cubemap = null;
    this._host = null;
    this._maps = null;
    this._kernels = null;
  }
}

export default WasmBackend;
