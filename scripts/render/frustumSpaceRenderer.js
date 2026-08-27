"use strict";

import { renderFrustumSpaceColumns } from "./frustumspacemarch.js";
import { Color } from "../math/color.js";
import { isDebugColor } from "../constants/debugView.js";
import { canShareBuffers, ensureU32 } from "./sharedBuffers.js";

function frustumSpaceKernel(renderer) {
  return (
    (renderer.kernels && renderer.kernels.renderFrustumSpaceColumns) ||
    renderFrustumSpaceColumns
  );
}

function frustumSpaceParams(renderer, maps) {
  const camera = renderer.camera;
  const frameBuffer = renderer.frameBuffer;
  const fov = camera.calculateFov();
  const dstToProjPlane = camera.calculateProjPlane();
  const screenHorizon = camera.calculateHorizon(dstToProjPlane);
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
    rightX: camera.rightX,
    rightY: camera.rightY,
    rightZ: camera.rightZ,
    upX: camera.upX,
    upY: camera.upY,
    upZ: camera.upZ,
    fwdX: camera.fwdX,
    fwdY: camera.fwdY,
    fwdZ: camera.fwdZ,
    tanHalfFovX: fov.tanHalfX,
    dstToProjPlane: dstToProjPlane,
    screenHorizon: screenHorizon,
    nearClip: camera.nearClip,
    farClip: renderer.effectiveFarClip,
    minDeltaZ: camera.minDeltaZ,
    quality: camera.quality,
    applyFog: renderer.applyFog,
    fogStart: renderer.fogStart,
    debugView: renderer.debugView,
    repeat: renderer.repeat,
    interpolateHeight: renderer.interpolateHeight ? 1 : 0,
    filterColor: renderer.filterColor ? 1 : 0,
    filterDistance: renderer.filterDistance,
    panoMips: maps.panoMips,
    mapsGeneration: maps.generation,
  };
}

function isFrustumSpaceTokenStale(token, renderer) {
  const camera = renderer.camera;
  const frameBuffer = renderer.frameBuffer;
  return (
    renderer.algorithm !== token.algorithm ||
    frameBuffer.width !== token.width ||
    frameBuffer.height !== token.height ||
    camera.quality !== token.quality ||
    camera.farClip !== token.camFarClip ||
    renderer.effectiveFarClip !== token.farClip ||
    renderer.applyFog !== token.applyFog ||
    renderer.fogStart !== token.fogStart ||
    renderer.debugView !== token.debugView ||
    renderer.repeat !== token.repeat ||
    renderer.interpolateHeight !== token.interpolateHeight ||
    renderer.filterColor !== token.filterColor ||
    renderer.filterDistance !== token.filterDistance ||
    camera.minDeltaZ !== token.minDeltaZ ||
    camera.posX !== token.camX ||
    camera.posY !== token.camY ||
    camera.posZ !== token.camZ ||
    camera.angle !== token.angle ||
    camera.pitch !== token.pitch ||
    camera.roll !== token.roll ||
    camera.rightX !== token.rightX ||
    camera.rightY !== token.rightY ||
    camera.rightZ !== token.rightZ ||
    camera.upX !== token.upX ||
    camera.upY !== token.upY ||
    camera.upZ !== token.upZ ||
    camera.fwdX !== token.fwdX ||
    camera.fwdY !== token.fwdY ||
    camera.fwdZ !== token.fwdZ
  );
}

class FrustumSpaceRenderer {
  constructor(renderer) {
    this._renderer = renderer;
    this._rowColors = new Uint32Array(1);
  }

  _fillBackground() {
    const renderer = this._renderer;
    renderer.drawBackground();
    if (!isDebugColor(renderer.debugView)) {
      renderer.frameBuffer.fill(Color.BLACK);
    }
  }

  renderLocal(terrain) {
    const maps = terrain.exportMaps();
    const params = frustumSpaceParams(this._renderer, maps);
    const frameBuffer = this._renderer.frameBuffer;
    const extras = {
      pixels: frameBuffer.buffer32bit,
      pixelWidth: frameBuffer.width,
      fillUnfilled: 0,
    };
    if (this._renderer.kernels) {
      const height = frameBuffer.height | 0;
      if ((this._rowColors.length < height) | 0) {
        this._rowColors = ensureU32(this._rowColors, height, canShareBuffers());
      }
      frameBuffer.copySkyRowColors(this._rowColors);
      extras.rowColors = this._rowColors;
    }
    frustumSpaceKernel(this._renderer)({
      ...params,
      ...extras,
    });
  }

  async renderMulti(terrain) {
    const renderer = this._renderer;
    const maps = terrain.exportMaps();
    const pool = renderer.ensurePool();
    pool.initMaps(maps);
    this._fillBackground();
    const height = renderer.frameBuffer.height | 0;
    if ((this._rowColors.length < height) | 0) {
      this._rowColors = ensureU32(this._rowColors, height, canShareBuffers());
    }
    const rowColors = renderer.frameBuffer.copySkyRowColors(this._rowColors);
    if (!isDebugColor(renderer.debugView)) {
      renderer.frameBuffer.fill(Color.BLACK);
      rowColors.fill(Color.BLACK);
    }
    const params = frustumSpaceParams(renderer, maps);
    params.rowColors = rowColors;
    const camera = renderer.camera;
    const token = {
      algorithm: renderer.algorithm,
      width: renderer.frameBuffer.width,
      height: renderer.frameBuffer.height,
      quality: camera.quality,
      camFarClip: camera.farClip,
      farClip: renderer.effectiveFarClip,
      applyFog: renderer.applyFog,
      fogStart: renderer.fogStart,
      debugView: renderer.debugView,
      repeat: renderer.repeat,
      interpolateHeight: renderer.interpolateHeight,
      filterColor: renderer.filterColor,
      filterDistance: renderer.filterDistance,
      minDeltaZ: camera.minDeltaZ,
      camX: camera.posX,
      camY: camera.posY,
      camZ: camera.posZ,
      angle: camera.angle,
      pitch: camera.pitch,
      roll: camera.roll,
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
    const slices = await pool.renderFrustumSpace(params);
    if (!slices) {
      return false;
    }
    if (isFrustumSpaceTokenStale(token, renderer)) {
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
    this._fillBackground();
    this.renderLocal(terrain);
    renderer.writeToContext();
  }
}

export default FrustumSpaceRenderer;
