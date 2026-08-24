"use strict";

import { renderCubemapFaces, stitchCubePolarSeams, fillCubePolarSky, mergeCubePolarSlice } from "./cubemapmarch.js";
import { renderCubemapView } from "./cubemapViewer.js";
import {
  CUBE_FACE_COUNT,
  CUBE_FACE_PZ,
  cubeFaceOffset,
  cubeSizeForQuality,
} from "../constants/cubemap.js";
import { farPlaneRayTMax } from "../constants/panorama.js";
import { blitRendererOverlay } from "./debugOverlay.js";
import { needsHeightBuf, needsIterBuf } from "../constants/debugView.js";

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
    this._horizonColor = null;
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
    const debugView = this._renderer.debugView;
    const needH = needsHeightBuf(debugView);
    const needI = needsIterBuf(debugView);
    if (!this._cubeColor || this._cubeColor.length !== count) {
      this._cubeColor = new Uint32Array(count);
      this._cubeDepth = new Float32Array(count);
      this._cubeValid = false;
    }
    if (needH) {
      if (!this._cubeHeight || this._cubeHeight.length !== count) {
        this._cubeHeight = new Uint32Array(count);
        this._cubeValid = false;
      }
    } else {
      this._cubeHeight = null;
    }
    if (needI) {
      if (!this._cubeIter || this._cubeIter.length !== count) {
        this._cubeIter = new Uint32Array(count);
        this._cubeValid = false;
      }
    } else {
      this._cubeIter = null;
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
      this._interp !== this._renderer.interpolateHeight ||
      this._filter !== this._renderer.filterColor ||
      this._minDeltaZ !== camera.minDeltaZ ||
      this._skyColor !== terrain.skyColor ||
      this._horizonColor !== camera.bottomColor ||
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
    this._interp = this._renderer.interpolateHeight;
    this._filter = this._renderer.filterColor;
    this._minDeltaZ = camera.minDeltaZ;
    this._skyColor = terrain.skyColor;
    this._horizonColor = camera.bottomColor;
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
      horizonColor: camera.bottomColor,
      initialStep: camera.minDeltaZ,
      quality: camera.quality,
      interpolateHeight: renderer.interpolateHeight ? 1 : 0,
      filterColor: renderer.filterColor ? 1 : 0,
      pixels: this._cubeColor,
      depth: this._cubeDepth,
      heightBuf: this._cubeHeight,
      iterBuf: this._cubeIter,
      panoMips: maps.panoMips,
      mapsGeneration: maps.generation,
    });
  }

  _copyGenerateSlices(slices, terrain) {
    const n = this._cubeN | 0;
    const faceN = (n * n) | 0;
    const polarN = (faceN << 1) | 0;
    const color = this._cubeColor;
    const depth = this._cubeDepth;
    const heightBuf = this._cubeHeight;
    const iterBuf = this._cubeIter;
    const polarSlices = [];
    for (let i = 0; (i < slices.length) | 0; i = (i + 1) | 0) {
      const slice = slices[i];
      if (!slice || !slice.pixels || !slice.depth) {
        return false;
      }
      if (slice.kind === "polar") {
        if (slice.pixels.length !== polarN || slice.depth.length !== polarN) {
          return false;
        }
        polarSlices.push(slice);
        continue;
      }
      const off = cubeFaceOffset(slice.face | 0, n);
      if (slice.pixels.length !== faceN) {
        return false;
      }
      color.set(slice.pixels, off);
      depth.set(slice.depth, off);
      if (heightBuf && slice.heightBuf) {
        heightBuf.set(slice.heightBuf, off);
      }
      if (iterBuf && slice.iter) {
        iterBuf.set(slice.iter, off);
      }
    }
    if (!polarSlices.length) {
      return false;
    }
    const camera = this._renderer.camera;
    fillCubePolarSky(
      color,
      depth,
      heightBuf,
      iterBuf,
      n,
      terrain.skyColor,
      camera.bottomColor
    );
    const polarOff = cubeFaceOffset(CUBE_FACE_PZ, n);
    for (let i = 0; (i < polarSlices.length) | 0; i = (i + 1) | 0) {
      const slice = polarSlices[i];
      mergeCubePolarSlice(
        color,
        depth,
        heightBuf,
        iterBuf,
        slice.pixels,
        slice.depth,
        slice.heightBuf,
        slice.iter,
        polarOff,
        polarN
      );
    }
    stitchCubePolarSeams(color, depth, heightBuf, iterBuf, n);
    return true;
  }

  async _generateMulti(terrain) {
    const renderer = this._renderer;
    const maps = terrain.exportMaps();
    const pool = renderer.ensurePool();
    pool.initMaps(maps);
    const camera = renderer.camera;
    const tMax = this._tMax();
    const token = {
      n: this._cubeN,
      quality: camera.quality,
      farClip: camera.farClip,
      tMax: tMax,
      repeat: renderer.repeat,
      minDeltaZ: camera.minDeltaZ,
      camX: camera.posX,
      camY: camera.posY,
      camZ: camera.posZ,
    };
    const slices = await pool.renderCubemapGenerate({
      n: this._cubeN,
      camX: camera.posX,
      camY: camera.posY,
      camZ: camera.posZ,
      farClip: camera.farClip,
      nearClip: camera.nearClip,
      tMax: tMax,
      repeat: renderer.repeat,
      skyColor: terrain.skyColor,
      horizonColor: camera.bottomColor,
      initialStep: camera.minDeltaZ,
      quality: camera.quality,
      interpolateHeight: renderer.interpolateHeight ? 1 : 0,
      filterColor: renderer.filterColor ? 1 : 0,
      wantHeight: needsHeightBuf(renderer.debugView),
      wantIter: needsIterBuf(renderer.debugView),
    });
    if (!slices) {
      return false;
    }
    if (
      this._cubeN !== token.n ||
      camera.quality !== token.quality ||
      camera.farClip !== token.farClip ||
      this._tMax() !== token.tMax ||
      renderer.repeat !== token.repeat ||
      camera.minDeltaZ !== token.minDeltaZ ||
      camera.posX !== token.camX ||
      camera.posY !== token.camY ||
      camera.posZ !== token.camZ
    ) {
      return false;
    }
    return this._copyGenerateSlices(slices, terrain);
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
      let generated = false;
      if (renderer.useWorkers()) {
        generated = await this._generateMulti(terrain);
      }
      if (!generated) {
        this._generateLocal(terrain);
      }
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
