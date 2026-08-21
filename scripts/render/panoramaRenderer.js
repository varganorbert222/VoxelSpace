"use strict";

import { renderPanoramaColumns } from "./panoramamarch.js";
import { renderPanoramaView } from "./panoramaViewer.js";
import {
  PANO_QUALITY_MAX,
  PANO_SIZE_BY_QUALITY,
  PANO_WIDTH,
  PANO_HEIGHT,
} from "../constants/quality.js";
import { farPlaneRayTMax } from "../constants/panorama.js";

class PanoramaRenderer {
  constructor(renderer) {
    this._renderer = renderer;
    this._panoWidth = PANO_WIDTH;
    this._panoHeight = PANO_HEIGHT;
    this._panoramaPixels = null;
    this._panoramaHorizon = null;
    this._panoramaDepth = null;
    this._panoramaValid = false;
    this._panoramaDirty = true;
    this._panoCamX = 0;
    this._panoCamY = 0;
    this._panoCamZ = 0;
    this._panoFarClip = NaN;
    this._panoRepeat = null;
    this._panoMinDeltaZ = NaN;
    this._panoSkyColor = null;
    this._panoQuality = NaN;
    this._panoFov = NaN;
    this._panoAspect = NaN;
    this._panoGen = 0;
  }

  invalidate() {
    this._panoramaDirty = true;
    this._panoramaValid = false;
    this._renderer.cancelJobs();
  }

  _panoTMax() {
    const renderer = this._renderer;
    const fb = renderer.frameBuffer;
    const aspect = fb.height ? fb.width / fb.height : 0;
    return farPlaneRayTMax(renderer.camera.farClip, renderer.camera.fov, aspect);
  }

  _panoSizeForQuality(quality) {
    const q = quality | 0;
    const size = PANO_SIZE_BY_QUALITY[q];
    if (size && size.width) {
      return size;
    }
    return PANO_SIZE_BY_QUALITY[PANO_QUALITY_MAX];
  }

  _syncPanoramaSize() {
    const renderer = this._renderer;
    const size = this._panoSizeForQuality(renderer.camera.quality);
    if (this._panoWidth !== size.width || this._panoHeight !== size.height) {
      this._panoWidth = size.width;
      this._panoHeight = size.height;
      this._panoramaPixels = null;
      this._panoramaHorizon = null;
      this._panoramaDepth = null;
      this.invalidate();
    }
  }

  _ensurePanoramaBuffers() {
    const n = (this._panoWidth * this._panoHeight) | 0;
    if (!this._panoramaPixels || this._panoramaPixels.length !== n) {
      this._panoramaPixels = new Uint32Array(n);
      this._panoramaHorizon = new Int32Array(this._panoWidth);
      this._panoramaDepth = new Float32Array(n);
      this._panoramaValid = false;
    } else if (!this._panoramaDepth || this._panoramaDepth.length !== n) {
      this._panoramaDepth = new Float32Array(n);
      this._panoramaValid = false;
    }
  }

  _shouldRegeneratePanorama(terrain) {
    if (!this._panoramaValid || this._panoramaDirty) {
      return true;
    }

    const camera = this._renderer.camera;
    const fb = this._renderer.frameBuffer;
    const aspect = fb.height ? fb.width / fb.height : 0;
    const settingsChanged =
      this._panoFarClip !== camera.farClip ||
      this._panoFov !== camera.fov ||
      this._panoAspect !== aspect ||
      this._panoRepeat !== this._renderer.repeat ||
      this._panoMinDeltaZ !== camera.minDeltaZ ||
      this._panoSkyColor !== terrain.skyColor ||
      this._panoQuality !== camera.quality;

    if (settingsChanged) {
      return true;
    }

    return (
      camera.posX !== this._panoCamX ||
      camera.posY !== this._panoCamY ||
      camera.posZ !== this._panoCamZ
    );
  }

  _commitPanoramaCache(terrain) {
    const camera = this._renderer.camera;
    this._panoCamX = camera.posX;
    this._panoCamY = camera.posY;
    this._panoCamZ = camera.posZ;
    this._panoFarClip = camera.farClip;
    this._panoFov = camera.fov;
    this._panoAspect = this._renderer.frameBuffer.height
      ? this._renderer.frameBuffer.width / this._renderer.frameBuffer.height
      : 0;
    this._panoRepeat = this._renderer.repeat;
    this._panoMinDeltaZ = camera.minDeltaZ;
    this._panoSkyColor = terrain.skyColor;
    this._panoQuality = camera.quality;
    this._panoramaValid = true;
    this._panoramaDirty = false;
    this._panoGen = (this._panoGen + 1) | 0;
  }

  _viewPanoramaLocal() {
    const renderer = this._renderer;
    const camera = renderer.camera;
    renderPanoramaView({
      panorama: this._panoramaPixels,
      panoramaWidth: this._panoWidth,
      panoramaHeight: this._panoHeight,
      fovY: camera.fov,
      frameBuffer: renderer.frameBuffer,
      horizon: this._panoramaHorizon,
      depth: this._panoramaDepth,
      skyColor: camera.topColor,
      horizonColor: camera.bottomColor,
      nearClip: camera.nearClip,
      farClip: camera.farClip,
      applyFog: renderer.applyFog,
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
  }

  _uploadPanoramaToWorkers() {
    if (!this._panoramaPixels || !this._panoramaHorizon || !this._panoramaDepth) {
      return;
    }
    this._renderer.ensurePool().setPanorama({
      pixels: this._panoramaPixels,
      horizon: this._panoramaHorizon,
      depth: this._panoramaDepth,
      width: this._panoWidth,
      height: this._panoHeight,
      generation: this._panoGen,
    });
  }

  async _viewPanoramaMulti() {
    this._uploadPanoramaToWorkers();
    const renderer = this._renderer;
    const camera = renderer.camera;
    const token = {
      algorithm: renderer.algorithm,
      width: renderer.frameBuffer.width,
      height: renderer.frameBuffer.height,
    };
    const slices = await renderer.pool.renderPanoramaView({
      screenWidth: renderer.frameBuffer.width,
      screenHeight: renderer.frameBuffer.height,
      fovY: camera.fov,
      skyColor: camera.topColor,
      horizonColor: camera.bottomColor,
      nearClip: camera.nearClip,
      farClip: camera.farClip,
      applyFog: renderer.applyFog,
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

  async _presentPanorama() {
    const renderer = this._renderer;
    if (renderer.useWorkers()) {
      const ok = await this._viewPanoramaMulti();
      if (!ok) {
        this._viewPanoramaLocal();
      }
      renderer.writeToContext();
      return;
    }
    this._viewPanoramaLocal();
    renderer.writeToContext();
  }

  _copyPanoSlices(slices) {
    const width = this._panoWidth;
    const height = this._panoHeight;
    const dest = this._panoramaPixels;
    const destH = this._panoramaHorizon;
    const destD = this._panoramaDepth;
    for (let i = 0; (i < slices.length) | 0; i = (i + 1) | 0) {
      const slice = slices[i];
      if (!slice || !slice.pixels || !slice.horizon || !slice.depth) {
        return false;
      }
      const startPx = slice.startPx;
      const localWidth = (slice.endPx - startPx) | 0;
      destH.set(slice.horizon, startPx);
      for (let y = 0; (y < height) | 0; y = (y + 1) | 0) {
        const srcRow = (y * localWidth) | 0;
        const dstRow = (y * width + startPx) | 0;
        dest.set(slice.pixels.subarray(srcRow, srcRow + localWidth), dstRow);
        destD.set(slice.depth.subarray(srcRow, srcRow + localWidth), dstRow);
      }
    }
    return true;
  }

  _generatePanoramaLocal(terrain) {
    const renderer = this._renderer;
    const camera = renderer.camera;
    const maps = terrain.exportMaps();
    renderPanoramaColumns({
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
      width: this._panoWidth,
      height: this._panoHeight,
      startPx: 0,
      endPx: this._panoWidth,
      farClip: camera.farClip,
      nearClip: camera.nearClip,
      tMax: this._panoTMax(),
      repeat: renderer.repeat,
      skyColor: terrain.skyColor,
      initialStep: camera.minDeltaZ,
      quality: camera.quality,
      pixels: this._panoramaPixels,
      horizon: this._panoramaHorizon,
      depth: this._panoramaDepth,
      panoMips: maps.panoMips,
    });
  }

  async _generatePanoramaMulti(terrain) {
    const renderer = this._renderer;
    const maps = terrain.exportMaps();
    const pool = renderer.ensurePool();
    pool.initMaps(maps);
    const camera = renderer.camera;
    const tMax = this._panoTMax();
    const token = {
      algorithm: renderer.algorithm,
      width: this._panoWidth,
      height: this._panoHeight,
      quality: camera.quality,
      farClip: camera.farClip,
      tMax: tMax,
      repeat: renderer.repeat,
      minDeltaZ: camera.minDeltaZ,
      camX: camera.posX,
      camY: camera.posY,
      camZ: camera.posZ,
      skyColor: terrain.skyColor,
    };
    const slices = await pool.renderPanorama({
      width: this._panoWidth,
      height: this._panoHeight,
      camX: camera.posX,
      camY: camera.posY,
      camZ: camera.posZ,
      farClip: camera.farClip,
      nearClip: camera.nearClip,
      tMax: tMax,
      repeat: renderer.repeat,
      skyColor: terrain.skyColor,
      initialStep: camera.minDeltaZ,
      quality: camera.quality,
    });
    if (!slices) {
      return false;
    }
    if (
      renderer.algorithm !== token.algorithm ||
      this._panoWidth !== token.width ||
      this._panoHeight !== token.height ||
      camera.quality !== token.quality ||
      camera.farClip !== token.farClip ||
      this._panoTMax() !== token.tMax ||
      renderer.repeat !== token.repeat ||
      camera.minDeltaZ !== token.minDeltaZ ||
      camera.posX !== token.camX ||
      camera.posY !== token.camY ||
      camera.posZ !== token.camZ ||
      terrain.skyColor !== token.skyColor
    ) {
      return false;
    }
    if (!this._copyPanoSlices(slices)) {
      return false;
    }
    return true;
  }

  async render(terrain) {
    const renderer = this._renderer;
    this._syncPanoramaSize();
    this._ensurePanoramaBuffers();

    if (this._shouldRegeneratePanorama(terrain)) {
      let generated = false;
      if (renderer.useWorkers()) {
        generated = await this._generatePanoramaMulti(terrain);
      }
      if (!generated) {
        this._generatePanoramaLocal(terrain);
      }
      this._commitPanoramaCache(terrain);
      this._viewPanoramaLocal();
      renderer.writeToContext();
      return;
    }

    await this._presentPanorama();
  }
}

export default PanoramaRenderer;
