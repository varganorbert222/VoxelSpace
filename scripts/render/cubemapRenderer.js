"use strict";

import { renderCubemapFaces } from "./cubemapmarch.js";
import { renderCubemapView } from "./cubemapViewer.js";
import { CUBE_FACE_COUNT, cubeSizeForQuality } from "../constants/cubemap.js";
import { farPlaneRayTMax } from "../constants/panorama.js";
import { blitRendererOverlay } from "./debugOverlay.js";

function cubeGenerate(renderer) {
  return (
    (renderer.kernels && renderer.kernels.renderCubemapFaces) ||
    renderCubemapFaces
  );
}

function cubeView(renderer) {
  return (
    (renderer.kernels && renderer.kernels.renderCubemapView) ||
    renderCubemapView
  );
}

class CubemapRenderer {
  constructor(renderer) {
    this._renderer = renderer;
    this._cubeN = 0;
    this._cubeColor = null;
    this._cubeDepth = null;
    this._cubeHeight = null;
    this._cubeIter = null;
    this._cubeValid = false;
    this._cubeDirty = true;
    this._camX = 0;
    this._camY = 0;
    this._camZ = 0;
    this._farClip = NaN;
    this._repeat = null;
    this._minDeltaZ = NaN;
    this._skyColor = null;
    this._quality = NaN;
    this._fov = NaN;
    this._aspect = NaN;
    this._gen = 0;
  }

  invalidate() {
    this._cubeDirty = true;
    this._cubeValid = false;
    this._renderer.cancelJobs();
  }

  _tMax() {
    const renderer = this._renderer;
    const fb = renderer.frameBuffer;
    const aspect = fb.height ? fb.width / fb.height : 0;
    return farPlaneRayTMax(renderer.camera.farClip, renderer.camera.fov, aspect);
  }

  _syncSize() {
    const n = cubeSizeForQuality(this._renderer.camera.quality);
    if (this._cubeN !== n) {
      this._cubeN = n;
      this._cubeColor = null;
      this._cubeDepth = null;
      this._cubeHeight = null;
      this._cubeIter = null;
      this.invalidate();
    }
  }

  _ensureBuffers() {
    const count = (CUBE_FACE_COUNT * this._cubeN * this._cubeN) | 0;
    if (!this._cubeColor || this._cubeColor.length !== count) {
      this._cubeColor = new Uint32Array(count);
      this._cubeDepth = new Float32Array(count);
      this._cubeHeight = new Uint32Array(count);
      this._cubeIter = new Uint32Array(count);
      this._cubeValid = false;
    } else {
      if (!this._cubeHeight || this._cubeHeight.length !== count) {
        this._cubeHeight = new Uint32Array(count);
        this._cubeValid = false;
      }
      if (!this._cubeIter || this._cubeIter.length !== count) {
        this._cubeIter = new Uint32Array(count);
        this._cubeValid = false;
      }
    }
  }

  _shouldRegenerate(terrain) {
    if (!this._cubeValid || this._cubeDirty) {
      return true;
    }
    const camera = this._renderer.camera;
    const fb = this._renderer.frameBuffer;
    const aspect = fb.height ? fb.width / fb.height : 0;
    if (
      this._farClip !== camera.farClip ||
      this._fov !== camera.fov ||
      this._aspect !== aspect ||
      this._repeat !== this._renderer.repeat ||
      this._minDeltaZ !== camera.minDeltaZ ||
      this._skyColor !== terrain.skyColor ||
      this._quality !== camera.quality
    ) {
      return true;
    }
    return (
      camera.posX !== this._camX ||
      camera.posY !== this._camY ||
      camera.posZ !== this._camZ
    );
  }

  _commitCache(terrain) {
    const camera = this._renderer.camera;
    this._camX = camera.posX;
    this._camY = camera.posY;
    this._camZ = camera.posZ;
    this._farClip = camera.farClip;
    this._fov = camera.fov;
    this._aspect = this._renderer.frameBuffer.height
      ? this._renderer.frameBuffer.width / this._renderer.frameBuffer.height
      : 0;
    this._repeat = this._renderer.repeat;
    this._minDeltaZ = camera.minDeltaZ;
    this._skyColor = terrain.skyColor;
    this._quality = camera.quality;
    this._cubeValid = true;
    this._cubeDirty = false;
    this._gen = (this._gen + 1) | 0;
  }

  _generateLocal(terrain) {
    const renderer = this._renderer;
    const camera = renderer.camera;
    const maps = terrain.exportMaps();
    cubeGenerate(renderer)({
      heightMap: maps.heightMap,
      colorMap: maps.colorMap,
      mapW: maps.width,
      mapH: maps.height,
      mapShift: maps.mapShift,
      altitude: maps.altitude,
      maxHeight: maps.maxHeight,
      camX: camera.posX,
      camY: camera.posY,
      camZ: camera.posZ,
      n: this._cubeN,
      farClip: camera.farClip,
      nearClip: camera.nearClip,
      tMax: this._tMax(),
      repeat: renderer.repeat,
      skyColor: terrain.skyColor,
      initialStep: camera.minDeltaZ,
      quality: camera.quality,
      pixels: this._cubeColor,
      depth: this._cubeDepth,
      heightBuf: this._cubeHeight,
      iterBuf: this._cubeIter,
      panoMips: maps.panoMips,
      mapsGeneration: maps.generation,
    });
  }

  _viewParams() {
    const renderer = this._renderer;
    const camera = renderer.camera;
    return {
      cubeColor: this._cubeColor,
      cubeDepth: this._cubeDepth,
      cubeHeight: this._cubeHeight,
      cubeIter: this._cubeIter,
      cubeN: this._cubeN,
      fovY: camera.fov,
      dstToProjPlane: camera.calculateProjPlane(),
      frameBuffer: renderer.frameBuffer,
      cubeGeneration: this._gen,
      skyColor: camera.topColor,
      horizonColor: camera.bottomColor,
      nearClip: camera.nearClip,
      farClip: camera.farClip,
      applyFog: renderer.applyFog,
      debugView: renderer.debugView,
      rightX: camera.rightX,
      rightY: camera.rightY,
      rightZ: camera.rightZ,
      upX: camera.upX,
      upY: camera.upY,
      upZ: camera.upZ,
      fwdX: camera.fwdX,
      fwdY: camera.fwdY,
      fwdZ: camera.fwdZ,
    };
  }

  _uploadToWorkers() {
    if (!this._cubeColor || !this._cubeDepth) {
      return;
    }
    this._renderer.ensurePool().setCubemap({
      color: this._cubeColor,
      depth: this._cubeDepth,
      heightBuf: this._cubeHeight,
      iter: this._cubeIter,
      n: this._cubeN,
      generation: this._gen,
    });
  }

  async _viewMulti() {
    this._uploadToWorkers();
    const renderer = this._renderer;
    const camera = renderer.camera;
    const token = {
      algorithm: renderer.algorithm,
      width: renderer.frameBuffer.width,
      height: renderer.frameBuffer.height,
    };
    const slices = await renderer.pool.renderCubemapView({
      screenWidth: renderer.frameBuffer.width,
      screenHeight: renderer.frameBuffer.height,
      cubeN: this._cubeN,
      fovY: camera.fov,
      dstToProjPlane: camera.calculateProjPlane(),
      skyColor: camera.topColor,
      horizonColor: camera.bottomColor,
      nearClip: camera.nearClip,
      farClip: camera.farClip,
      applyFog: renderer.applyFog,
      debugView: renderer.debugView,
      rightX: camera.rightX,
      rightY: camera.rightY,
      rightZ: camera.rightZ,
      upX: camera.upX,
      upY: camera.upY,
      upZ: camera.upZ,
      fwdX: camera.fwdX,
      fwdY: camera.fwdY,
      fwdZ: camera.fwdZ,
    });
    if (!slices) {
      return false;
    }
    if (
      renderer.algorithm !== token.algorithm ||
      renderer.frameBuffer.width !== token.width ||
      renderer.frameBuffer.height !== token.height
    ) {
      return false;
    }
    for (let i = 0; (i < slices.length) | 0; i = (i + 1) | 0) {
      const slice = slices[i];
      if (!slice || !slice.pixels) {
        return false;
      }
      renderer.frameBuffer.blitTerrainColumns(
        slice.pixels,
        slice.startColumn,
        slice.endColumn
      );
    }
    return true;
  }

  _viewLocal() {
    cubeView(this._renderer)(this._viewParams());
  }

  _blitOverlay() {
    blitRendererOverlay(this._renderer, {
      cubeColor: this._cubeColor,
      cubeDepth: this._cubeDepth,
      cubeHeight: this._cubeHeight,
      cubeIter: this._cubeIter,
      cubeN: this._cubeN,
    });
  }

  async _present() {
    const renderer = this._renderer;
    if (renderer.useWorkers && renderer.useWorkers()) {
      const ok = await this._viewMulti();
      if (!ok) {
        this._viewLocal();
      }
      this._blitOverlay();
      renderer.writeToContext();
      return;
    }
    this._viewLocal();
    this._blitOverlay();
    renderer.writeToContext();
  }

  async render(terrain) {
    const renderer = this._renderer;
    this._syncSize();
    this._ensureBuffers();
    if (this._shouldRegenerate(terrain)) {
      this._generateLocal(terrain);
      this._commitCache(terrain);
      this._viewLocal();
      this._blitOverlay();
      renderer.writeToContext();
      return;
    }
    await this._present();
  }
}

export default CubemapRenderer;
