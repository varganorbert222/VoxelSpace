"use strict";

import ClassicRenderer from "../../render/classicRenderer.js";
import ScanlineRenderer from "../../render/scanlineRenderer.js";
import WorkerPool from "../../render/workerPool.js";
import { ALGORITHM_SCANLINE } from "../../constants/algorithm.js";
import { BACKEND_JS } from "../../constants/backend.js";
import { bindRetailMaps } from "../../render/retail/detail.js";
class JsBackend {
  static get id() {
    return BACKEND_JS;
  }

  static async isAvailable() {
    return true;
  }

  constructor() {
    this._host = null;
    this._classic = null;
    this._scanline = null;
    this._pool = null;
    this._maps = null;
  }

  async init(ctx) {
    this._host = ctx.renderer;
    this._classic = new ClassicRenderer(this);
    this._scanline = new ScanlineRenderer(this);
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

  get repeat() {
    return this._host.repeat;
  }

  get showDetails() {
    return this._host.showDetails;
  }

  get filterDistance() {
    return this._host.filterDistance;
  }

  get mipCount() {
    return this._host.mipCount;
  }

  get lodSpacingMode() {
    return this._host.lodSpacingMode;
  }

  get lodSpacing() {
    return this._host.lodSpacing;
  }

  get lodBias() {
    return this._host.lodBias;
  }

  get debugView() {
    return this._host.debugView;
  }

  get retailSkyPass() {
    return this._host.retailSkyPass;
  }

  get algorithm() {
    return this._host.algorithm;
  }

  get multithread() {
    return this._host.multithread;
  }

  ensurePool() {
    if (!this._pool) {
      this._pool = new WorkerPool();
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

  skyFill(color) {
    return this._host.skyFill(color);
  }

  drawBackground() {
    this._host.drawBackground();
  }

  writeToContext() {
    this._host.writeToContext();
  }

  prepareSlicePresent() {
    return this._host.prepareSlicePresent();
  }

  consumeSlicePresent() {
    this._host.consumeSlicePresent();
  }

  async setMaps(exportedMaps) {
    this._maps = exportedMaps;
    bindRetailMaps(exportedMaps);
    if (this._pool && exportedMaps) {
      this._pool.initMaps(exportedMaps);
    }
  }

  async resize() {
    this.cancelJobs();
  }

  async render(frame) {
    bindRetailMaps(this._maps);
    if (frame.algorithm === ALGORITHM_SCANLINE) {
      await this._scanline.render(frame.terrain);
    } else {
      await this._classic.render(frame.terrain);
    }
  }

  dispose() {
    this.cancelJobs();
    if (this._pool) {
      this._pool.dispose();
      this._pool = null;
    }
    this._classic = null;
    this._scanline = null;
    this._host = null;
    this._maps = null;
  }
}

export default JsBackend;
