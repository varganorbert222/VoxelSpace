"use strict";

import { generateSphericalPanorama } from "./sphericalPanorama.js";
import { renderPanoramaView } from "./panoramaViewer.js";
import { renderClassicColumns } from "./classicmarch.js";
import ColumnPool from "./columnpool.js";
import {
  ALGORITHM_CLASSIC,
  ALGORITHM_PANORAMA,
  PANO_QUALITY_MAX,
  PANO_SIZE_BY_QUALITY,
  PANO_WIDTH,
  PANO_HEIGHT,
} from "./constants/renderer.js";
import { DEFAULT_MULTITHREAD } from "./constants/threading.js";

class Renderer {
  get applyFog() {
    return this._applyFog;
  }

  set applyFog(value) {
    this._applyFog = value;
  }

  get repeat() {
    return this._repeat;
  }

  set repeat(value) {
    this._repeat = value;
  }

  get algorithm() {
    return this._algorithm;
  }

  set algorithm(value) {
    if (this._algorithm !== value) {
      this._cancelJobs();
    }
    this._algorithm = value;
  }

  get multithread() {
    return this._multithread;
  }

  set multithread(value) {
    const next = !!value;
    if (this._multithread === next) {
      return;
    }
    this._multithread = next;
    this._cancelJobs();
    if (next) {
      this._ensurePool();
    }
  }

  constructor(camera, frameBuffer) {
    this._camera = camera;
    this._frameBuffer = frameBuffer;
    this._applyFog = true;
    this._repeat = true;
    this._algorithm = ALGORITHM_CLASSIC;
    this._multithread = DEFAULT_MULTITHREAD;
    this._pool = null;
    this._panoWidth = PANO_WIDTH;
    this._panoHeight = PANO_HEIGHT;
    this._panoramaPixels = null;
    this._panoramaHorizon = null;
    this._panoramaValid = false;
    this._panoramaDirty = true;
    this._panoCamX = 0;
    this._panoCamY = 0;
    this._panoCamZ = 0;
    this._panoFarClip = NaN;
    this._panoApplyFog = null;
    this._panoRepeat = null;
    this._panoMinDeltaZ = NaN;
    this._panoSkyColor = null;
    this._panoQuality = NaN;
    this._panoGen = 0;
  }

  _ensurePool() {
    if (!this._pool) {
      this._pool = new ColumnPool();
    }
    return this._pool;
  }

  _cancelJobs() {
    if (this._pool) {
      this._pool.cancel();
    }
  }

  onFrameBufferResized() {
    this._cancelJobs();
  }

  invalidatePanorama() {
    this._panoramaDirty = true;
    this._panoramaValid = false;
    this._cancelJobs();
  }

  drawBackground() {
    const dstToProjPlane = this._camera.calculateProjPlane();
    const screenHorizon = this._camera.calculateHorizon(dstToProjPlane);
    this._frameBuffer.drawBackground(screenHorizon);
  }

  writeToContext() {
    this._frameBuffer.writeToContext();
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
    const size = this._panoSizeForQuality(this._camera.quality);
    if (
      this._panoWidth !== size.width ||
      this._panoHeight !== size.height
    ) {
      this._panoWidth = size.width;
      this._panoHeight = size.height;
      this._panoramaPixels = null;
      this._panoramaHorizon = null;
      this.invalidatePanorama();
    }
  }

  _classicParams(maps) {
    const camera = this._camera;
    const halfFovX = camera.calculateFov().halfFovX;
    const dstToProjPlane = camera.calculateProjPlane();
    const screenHorizon = camera.calculateHorizon(dstToProjPlane);
    const cameraAngle = camera.angle;
    return {
      heightMap: maps.heightMap,
      colorMap: maps.colorMap,
      mapW: maps.width,
      mapH: maps.height,
      mapShift: maps.mapShift,
      altitude: maps.altitude,
      startColumn: 0,
      endColumn: this._frameBuffer.width,
      screenWidth: this._frameBuffer.width,
      screenHeight: this._frameBuffer.height,
      camX: camera.posX,
      camY: camera.posY,
      camZ: camera.posZ,
      sinAngle: Math.sin(cameraAngle),
      cosAngle: Math.cos(cameraAngle),
      tanHalfFovX: Math.tan(halfFovX),
      dstToProjPlane: dstToProjPlane,
      screenHorizon: screenHorizon,
      nearClip: camera.nearClip,
      farClip: camera.farClip,
      minDeltaZ: camera.minDeltaZ,
      quality: camera.quality,
      applyFog: this._applyFog,
      repeat: this._repeat,
    };
  }

  renderTerrain(terrain) {
    const maps = terrain.exportMaps();
    const params = this._classicParams(maps);
    renderClassicColumns({
      ...params,
      pixels: this._frameBuffer.buffer32bit,
      pixelWidth: this._frameBuffer.width,
      fillUnfilled: 0,
    });
  }

  async _renderTerrainMulti(terrain) {
    const maps = terrain.exportMaps();
    const pool = this._ensurePool();
    pool.initMaps(maps);
    const params = this._classicParams(maps);
    const token = {
      algorithm: this._algorithm,
      width: this._frameBuffer.width,
      height: this._frameBuffer.height,
      quality: this._camera.quality,
      farClip: this._camera.farClip,
      applyFog: this._applyFog,
      repeat: this._repeat,
      minDeltaZ: this._camera.minDeltaZ,
      camX: this._camera.posX,
      camY: this._camera.posY,
      camZ: this._camera.posZ,
    };
    const slices = await pool.renderClassic(params);
    if (!slices) {
      return false;
    }
    if (
      this._algorithm !== token.algorithm ||
      this._frameBuffer.width !== token.width ||
      this._frameBuffer.height !== token.height ||
      this._camera.quality !== token.quality ||
      this._camera.farClip !== token.farClip ||
      this._applyFog !== token.applyFog ||
      this._repeat !== token.repeat ||
      this._camera.minDeltaZ !== token.minDeltaZ ||
      this._camera.posX !== token.camX ||
      this._camera.posY !== token.camY ||
      this._camera.posZ !== token.camZ
    ) {
      return false;
    }
    this.drawBackground();
    for (let i = 0; (i < slices.length) | 0; i = (i + 1) | 0) {
      const slice = slices[i];
      this._frameBuffer.blitTerrainColumns(
        slice.pixels,
        slice.startColumn,
        slice.endColumn
      );
    }
    return true;
  }

  _ensurePanoramaBuffers() {
    const n = (this._panoWidth * this._panoHeight) | 0;
    if (!this._panoramaPixels || this._panoramaPixels.length !== n) {
      this._panoramaPixels = new Uint32Array(n);
      this._panoramaHorizon = new Int32Array(this._panoWidth);
      this._panoramaValid = false;
    }
  }

  _shouldRegeneratePanorama(terrain) {
    if (!this._panoramaValid || this._panoramaDirty) {
      return true;
    }

    const camera = this._camera;
    const settingsChanged =
      this._panoFarClip !== camera.farClip ||
      this._panoApplyFog !== this._applyFog ||
      this._panoRepeat !== this._repeat ||
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
    const camera = this._camera;
    this._panoCamX = camera.posX;
    this._panoCamY = camera.posY;
    this._panoCamZ = camera.posZ;
    this._panoFarClip = camera.farClip;
    this._panoApplyFog = this._applyFog;
    this._panoRepeat = this._repeat;
    this._panoMinDeltaZ = camera.minDeltaZ;
    this._panoSkyColor = terrain.skyColor;
    this._panoQuality = camera.quality;
    this._panoramaValid = true;
    this._panoramaDirty = false;
    this._panoGen = (this._panoGen + 1) | 0;
  }

  _viewPanoramaLocal() {
    const camera = this._camera;
    renderPanoramaView({
      panorama: this._panoramaPixels,
      panoramaWidth: this._panoWidth,
      panoramaHeight: this._panoHeight,
      fovY: camera.fov,
      frameBuffer: this._frameBuffer,
      horizon: this._panoramaHorizon,
      skyColor: camera.topColor,
      horizonColor: camera.bottomColor,
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
    if (!this._panoramaPixels || !this._panoramaHorizon) {
      return;
    }
    this._ensurePool().setPanorama({
      pixels: this._panoramaPixels,
      horizon: this._panoramaHorizon,
      width: this._panoWidth,
      height: this._panoHeight,
      generation: this._panoGen,
    });
  }

  async _viewPanoramaMulti() {
    this._uploadPanoramaToWorkers();
    const camera = this._camera;
    const token = {
      algorithm: this._algorithm,
      width: this._frameBuffer.width,
      height: this._frameBuffer.height,
    };
    const slices = await this._pool.renderPanoramaView({
      screenWidth: this._frameBuffer.width,
      screenHeight: this._frameBuffer.height,
      fovY: camera.fov,
      skyColor: camera.topColor,
      horizonColor: camera.bottomColor,
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
      this._algorithm !== token.algorithm ||
      this._frameBuffer.width !== token.width ||
      this._frameBuffer.height !== token.height
    ) {
      return false;
    }
    for (let i = 0; (i < slices.length) | 0; i = (i + 1) | 0) {
      const slice = slices[i];
      this._frameBuffer.blitTerrainColumns(
        slice.pixels,
        slice.startColumn,
        slice.endColumn
      );
    }
    return true;
  }

  async _presentPanorama() {
    if (this._multithread) {
      const ok = await this._viewPanoramaMulti();
      if (!ok) {
        this._viewPanoramaLocal();
      }
      this.writeToContext();
      return;
    }
    this._viewPanoramaLocal();
    this.writeToContext();
  }

  _copyPanoSlices(slices) {
    const width = this._panoWidth;
    const height = this._panoHeight;
    const dest = this._panoramaPixels;
    const destH = this._panoramaHorizon;
    for (let i = 0; (i < slices.length) | 0; i = (i + 1) | 0) {
      const slice = slices[i];
      const startPx = slice.startPx;
      const localWidth = (slice.endPx - startPx) | 0;
      destH.set(slice.horizon, startPx);
      for (let y = 0; (y < height) | 0; y = (y + 1) | 0) {
        const srcRow = (y * localWidth) | 0;
        const dstRow = (y * width + startPx) | 0;
        dest.set(slice.pixels.subarray(srcRow, srcRow + localWidth), dstRow);
      }
    }
  }

  async _generatePanoramaMulti(terrain) {
    const maps = terrain.exportMaps();
    const pool = this._ensurePool();
    pool.initMaps(maps);
    const camera = this._camera;
    const token = {
      algorithm: this._algorithm,
      width: this._panoWidth,
      height: this._panoHeight,
      quality: camera.quality,
      farClip: camera.farClip,
      applyFog: this._applyFog,
      repeat: this._repeat,
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
      applyFog: this._applyFog,
      repeat: this._repeat,
      skyColor: terrain.skyColor,
      initialStep: camera.minDeltaZ,
    });
    if (!slices) {
      return false;
    }
    if (
      this._algorithm !== token.algorithm ||
      this._panoWidth !== token.width ||
      this._panoHeight !== token.height ||
      camera.quality !== token.quality ||
      camera.farClip !== token.farClip ||
      this._applyFog !== token.applyFog ||
      this._repeat !== token.repeat ||
      camera.minDeltaZ !== token.minDeltaZ ||
      camera.posX !== token.camX ||
      camera.posY !== token.camY ||
      camera.posZ !== token.camZ ||
      terrain.skyColor !== token.skyColor
    ) {
      return false;
    }
    this._copyPanoSlices(slices);
    return true;
  }

  async _renderPanorama(terrain) {
    this._syncPanoramaSize();
    this._ensurePanoramaBuffers();

    if (this._shouldRegeneratePanorama(terrain)) {
      if (this._multithread) {
        const ok = await this._generatePanoramaMulti(terrain);
        if (!ok) {
          await this._presentPanorama();
          return;
        }
      } else {
        const camera = this._camera;
        generateSphericalPanorama({
          terrain,
          camX: camera.posX,
          camY: camera.posY,
          camZ: camera.posZ,
          width: this._panoWidth,
          height: this._panoHeight,
          farClip: camera.farClip,
          nearClip: camera.nearClip,
          applyFog: this._applyFog,
          repeat: this._repeat,
          skyColor: terrain.skyColor,
          initialStep: camera.minDeltaZ,
          pixels: this._panoramaPixels,
          horizon: this._panoramaHorizon,
        });
      }
      this._commitPanoramaCache(terrain);
    }

    await this._presentPanorama();
  }

  async render(terrain) {
    if (this._algorithm === ALGORITHM_PANORAMA) {
      await this._renderPanorama(terrain);
      return;
    }
    if (this._multithread) {
      const ok = await this._renderTerrainMulti(terrain);
      if (!ok) {
        return;
      }
      this.writeToContext();
      return;
    }
    this.drawBackground();
    this.renderTerrain(terrain);
    this.writeToContext();
  }
}

export default Renderer;
