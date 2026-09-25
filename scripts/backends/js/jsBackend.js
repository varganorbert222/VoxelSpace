"use strict";

import ClassicRenderer from "../../render/classicRenderer.js";
import FrustumSpaceRenderer from "../../render/frustumSpaceRenderer.js";
import PanoramaRenderer from "../../render/panoramaRenderer.js";
import CubemapRenderer from "../../render/cubemapRenderer.js";
import VoxelRenderer from "../../render/voxelRenderer.js";
import WorkerPool from "../../render/workerPool.js";
import {
  ALGORITHM_CUBEMAP,
  ALGORITHM_FRUSTUM_SPACE,
  ALGORITHM_PANORAMA,
  ALGORITHM_VOXEL,
} from "../../constants/algorithm.js";
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
    this._frustumSpace = null;
    this._panorama = null;
    this._cubemap = null;
    this._voxel = null;
    this._pool = null;
    this._maps = null;
  }

  async init(ctx) {
    this._host = ctx.renderer;
    this._classic = new ClassicRenderer(this);
    this._frustumSpace = new FrustumSpaceRenderer(this);
    this._panorama = new PanoramaRenderer(this);
    this._cubemap = new CubemapRenderer(this);
    this._voxel = new VoxelRenderer(this);
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

  get fogStart() {
    return this._host.fogStart;
  }

  get fogEnd() {
    return this._host.fogEnd;
  }

  get effectiveFarClip() {
    return this._host.effectiveFarClip;
  }

  get repeat() {
    return this._host.repeat;
  }

  get interpolateHeight() {
    return this._host.interpolateHeight;
  }

  get filterColor() {
    return this._host.filterColor;
  }

  get lod0Refine() {
    return this._host.lod0Refine;
  }

  get nearRefine() {
    return this._host.nearRefine;
  }

  get showDetails() {
    return this._host.showDetails;
  }

  get lod0RefineCurve() {
    return this._host.lod0RefineCurve;
  }

  get stepDivisor() {
    return this._host.stepDivisor;
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

  get debugView() {
    return this._host.debugView;
  }

  get debugOverlay() {
    return this._host.debugOverlay;
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

  invalidatePanorama() {
    if (this._panorama) {
      this._panorama.invalidate();
    }
    if (this._cubemap) {
      this._cubemap.invalidate();
    }
  }

  async render(frame) {
    bindRetailMaps(this._maps);
    if (frame.algorithm === ALGORITHM_PANORAMA) {
      await this._panorama.render(frame.terrain);
    } else if (frame.algorithm === ALGORITHM_CUBEMAP) {
      await this._cubemap.render(frame.terrain);
    } else if (frame.algorithm === ALGORITHM_FRUSTUM_SPACE) {
      await this._frustumSpace.render(frame.terrain);
    } else if (frame.algorithm === ALGORITHM_VOXEL) {
      await this._voxel.render(frame.terrain);
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
    this._frustumSpace = null;
    this._panorama = null;
    this._cubemap = null;
    this._voxel = null;
    this._host = null;
    this._maps = null;
  }
}

export default JsBackend;
