"use strict";

import { renderVoxelTexels } from "./voxelmarch.js";
import { Color } from "../math/color.js";
import { isDebugColor } from "../constants/debugView.js";

function voxelKernel(renderer) {
  return (
    (renderer.kernels && renderer.kernels.renderVoxelTexels) ||
    renderVoxelTexels
  );
}

function voxelParams(renderer, maps) {
  const camera = renderer.camera;
  const frameBuffer = renderer.frameBuffer;
  const fov = camera.calculateFov();
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
    fovY: camera.fov,
    dstToProjPlane: camera.calculateProjPlane(),
    nearClip: camera.nearClip,
    farClip: renderer.effectiveFarClip,
    quality: camera.quality,
    applyFog: renderer.applyFog,
    fogStart: renderer.fogStart,
    fogEnd: renderer.fogEnd,
    debugView: renderer.debugView,
    repeat: renderer.repeat,
    interpolateHeight: renderer.interpolateHeight ? 1 : 0,
    filterColor: renderer.filterColor ? 1 : 0,
    filterDistance: renderer.filterDistance,
    lod0Refine: renderer.lod0Refine ? 1 : 0,
    lod0RefineCurve: renderer.lod0RefineCurve,
    stepDivisor: renderer.stepDivisor,
    mipCount: renderer.mipCount,
    lodSpacingMode: renderer.lodSpacingMode,
    lodSpacing: renderer.lodSpacing,
    skyColor: maps.skyColor,
    horizonColor: camera.bottomColor,
    panoMips: maps.panoMips,
    terrainMips: maps.terrainMips || maps.panoMips,
    mapsGeneration: maps.generation,
  };
}

function isVoxelTokenStale(token, renderer) {
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
    renderer.fogEnd !== token.fogEnd ||
    renderer.debugView !== token.debugView ||
    renderer.repeat !== token.repeat ||
    renderer.interpolateHeight !== token.interpolateHeight ||
    renderer.filterColor !== token.filterColor ||
    renderer.filterDistance !== token.filterDistance ||
    renderer.lod0Refine !== token.lod0Refine ||
    renderer.lod0RefineCurve !== token.lod0RefineCurve ||
    renderer.stepDivisor !== token.stepDivisor ||
    renderer.mipCount !== token.mipCount ||
    renderer.lodSpacingMode !== token.lodSpacingMode ||
    renderer.lodSpacing !== token.lodSpacing ||
    camera.posX !== token.camX ||
    camera.posY !== token.camY ||
    camera.posZ !== token.camZ ||
    camera.rightX !== token.rightX ||
    camera.rightY !== token.rightY ||
    camera.rightZ !== token.rightZ ||
    camera.upX !== token.upX ||
    camera.upY !== token.upY ||
    camera.upZ !== token.upZ ||
    camera.fwdX !== token.fwdX ||
    camera.fwdY !== token.fwdY ||
    camera.fwdZ !== token.fwdZ ||
    camera.fov !== token.fovY
  );
}

class VoxelRenderer {
  constructor(renderer) {
    this._renderer = renderer;
  }

  renderLocal(terrain) {
    const maps = terrain.exportMaps();
    const params = voxelParams(this._renderer, maps);
    params.skyColor = terrain.skyColor;
    const frameBuffer = this._renderer.frameBuffer;
    voxelKernel(this._renderer)({
      ...params,
      pixels: frameBuffer.buffer32bit,
      pixelWidth: frameBuffer.width,
      fillUnfilled: 0,
    });
  }

  async renderMulti(terrain) {
    const renderer = this._renderer;
    const maps = terrain.exportMaps();
    const pool = renderer.ensurePool();
    pool.initMaps(maps);
    const params = voxelParams(renderer, maps);
    params.skyColor = terrain.skyColor;
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
      fogEnd: renderer.fogEnd,
      debugView: renderer.debugView,
      repeat: renderer.repeat,
      interpolateHeight: renderer.interpolateHeight,
      filterColor: renderer.filterColor,
      filterDistance: renderer.filterDistance,
      lod0Refine: renderer.lod0Refine,
      lod0RefineCurve: renderer.lod0RefineCurve,
      stepDivisor: renderer.stepDivisor,
      mipCount: renderer.mipCount,
      lodSpacingMode: renderer.lodSpacingMode,
      lodSpacing: renderer.lodSpacing,
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
      fovY: camera.fov,
    };
    const slices = await pool.renderVoxel(params);
    if (!slices) {
      return false;
    }
    if (isVoxelTokenStale(token, renderer)) {
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
    if (!isDebugColor(renderer.debugView)) {
      renderer.frameBuffer.fill(Color.BLACK);
    }
    this.renderLocal(terrain);
    renderer.writeToContext();
  }
}

export default VoxelRenderer;
