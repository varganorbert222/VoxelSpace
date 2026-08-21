"use strict";

import { renderClassicColumns } from "./classicmarch.js";

function classicKernel(renderer) {
  return (
    (renderer.kernels && renderer.kernels.renderClassicColumns) ||
    renderClassicColumns
  );
}

function classicParams(renderer, maps) {
  const camera = renderer.camera;
  const frameBuffer = renderer.frameBuffer;
  const fov = camera.calculateFov();
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
    maxHeight: maps.maxHeight,
    startColumn: 0,
    endColumn: frameBuffer.width,
    screenWidth: frameBuffer.width,
    screenHeight: frameBuffer.height,
    camX: camera.posX,
    camY: camera.posY,
    camZ: camera.posZ,
    sinAngle: Math.sin(cameraAngle),
    cosAngle: Math.cos(cameraAngle),
    tanHalfFovX: fov.tanHalfX,
    dstToProjPlane: dstToProjPlane,
    screenHorizon: screenHorizon,
    nearClip: camera.nearClip,
    farClip: camera.farClip,
    minDeltaZ: camera.minDeltaZ,
    quality: camera.quality,
    applyFog: renderer.applyFog,
    repeat: renderer.repeat,
    panoMips: maps.panoMips,
    mapsGeneration: maps.generation,
  };
}

function isClassicTokenStale(token, renderer) {
  const camera = renderer.camera;
  const frameBuffer = renderer.frameBuffer;
  return (
    renderer.algorithm !== token.algorithm ||
    frameBuffer.width !== token.width ||
    frameBuffer.height !== token.height ||
    camera.quality !== token.quality ||
    camera.farClip !== token.farClip ||
    renderer.applyFog !== token.applyFog ||
    renderer.repeat !== token.repeat ||
    camera.minDeltaZ !== token.minDeltaZ ||
    camera.posX !== token.camX ||
    camera.posY !== token.camY ||
    camera.posZ !== token.camZ
  );
}

class ClassicRenderer {
  constructor(renderer) {
    this._renderer = renderer;
    this._rowColors = new Uint32Array(1);
  }

  renderLocal(terrain) {
    const maps = terrain.exportMaps();
    const params = classicParams(this._renderer, maps);
    const frameBuffer = this._renderer.frameBuffer;
    const extras = {
      pixels: frameBuffer.buffer32bit,
      pixelWidth: frameBuffer.width,
      fillUnfilled: 0,
    };
    if (this._renderer.kernels) {
      const height = frameBuffer.height | 0;
      if ((this._rowColors.length < height) | 0) {
        this._rowColors = new Uint32Array(height);
      }
      frameBuffer.copySkyRowColors(this._rowColors);
      extras.rowColors = this._rowColors;
    }
    classicKernel(this._renderer)({
      ...params,
      ...extras,
    });
  }

  async renderMulti(terrain) {
    const renderer = this._renderer;
    const maps = terrain.exportMaps();
    const pool = renderer.ensurePool();
    pool.initMaps(maps);
    renderer.drawBackground();
    const rowColors = renderer.frameBuffer.copySkyRowColors(
      new Uint32Array(renderer.frameBuffer.height)
    );
    const params = classicParams(renderer, maps);
    params.rowColors = rowColors;
    const camera = renderer.camera;
    const token = {
      algorithm: renderer.algorithm,
      width: renderer.frameBuffer.width,
      height: renderer.frameBuffer.height,
      quality: camera.quality,
      farClip: camera.farClip,
      applyFog: renderer.applyFog,
      repeat: renderer.repeat,
      minDeltaZ: camera.minDeltaZ,
      camX: camera.posX,
      camY: camera.posY,
      camZ: camera.posZ,
    };
    const slices = await pool.renderClassic(params);
    if (!slices) {
      return false;
    }
    if (isClassicTokenStale(token, renderer)) {
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

  async render(terrain) {
    const renderer = this._renderer;
    if (renderer.useWorkers()) {
      const ok = await this.renderMulti(terrain);
      if (ok) {
        renderer.writeToContext();
        return;
      }
    }
    renderer.drawBackground();
    this.renderLocal(terrain);
    renderer.writeToContext();
  }
}

export default ClassicRenderer;
