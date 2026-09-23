"use strict";

import { renderFrustumScanlineColumns } from "./frustumscanline.js";
import {
  renderFrustumScanlineCpu,
  renderFrustumScanlineFrame,
} from "./frustumScanlineCore.js";
import { Color } from "../math/color.js";
import { advanceRetailGameClock } from "./retail/frame.js";
import { isDebugColor } from "../constants/debugView.js";
import { canShareBuffers, ensureU32 } from "./sharedBuffers.js";

function frustumScanlineKernel(renderer) {
  return (
    (!renderer.useJsFrustumScanline &&
      renderer.kernels &&
      renderer.kernels.renderFrustumScanlineColumns) ||
    renderFrustumScanlineColumns
  );
}

function frustumScanlineParams(renderer, maps) {
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
    maxSlope: maps.maxSlope,
    terrainMips: maps.terrainMips || maps.panoMips,
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
    mipCount: renderer.mipCount,
    stepDivisor: renderer.stepDivisor,
    lodSpacingMode: renderer.lodSpacingMode,
    lodSpacing: renderer.lodSpacing,
    panoMips: maps.panoMips,
    mapsGeneration: maps.generation,
    skyColor: maps.skyColor != null ? maps.skyColor : renderer._terrainSky,
    fovDegrees: camera.fov,
    yawRadians: camera.angle,
    pitchDegrees: camera.pitch,
    angle: camera.angle,
    pitch: camera.pitch,
    fov: camera.fov,
    frameCounter: renderer._frustumFrameCounter | 0,
  };
}

function makeFrustumScanlineScene(maps, params, output) {
  return {
    terrain: {
      heightMap: maps.heightMap,
      colorMap: maps.colorMap,
      mapW: maps.width,
      mapH: maps.height,
      mapShift: maps.mapShift,
      altitude: maps.altitude,
      maxHeight: maps.maxHeight,
      maxSlope: maps.maxSlope,
      terrainMips: maps.terrainMips || maps.panoMips,
      panoMips: maps.panoMips,
      mapsGeneration: maps.generation,
      skyColor: params.skyColor,
    },
    camera: {
      camX: params.camX,
      camY: params.camY,
      camZ: params.camZ,
      rightX: params.rightX,
      rightY: params.rightY,
      rightZ: params.rightZ,
      upX: params.upX,
      upY: params.upY,
      upZ: params.upZ,
      fwdX: params.fwdX,
      fwdY: params.fwdY,
      fwdZ: params.fwdZ,
      tanHalfFovX: params.tanHalfFovX,
      dstToProjPlane: params.dstToProjPlane,
      focal: params.dstToProjPlane,
      nearClip: params.nearClip,
      fovDegrees: params.fovDegrees,
      fov: params.fov,
      yawRadians: params.yawRadians,
      pitchDegrees: params.pitchDegrees,
      angle: params.angle,
      pitch: params.pitch,
    },
    render: {
      altitude: maps.altitude,
      farClip: params.farClip,
      minDeltaZ: params.minDeltaZ,
      quality: params.quality,
      applyFog: params.applyFog,
      fogStart: params.fogStart,
      debugView: params.debugView,
      repeat: params.repeat,
      interpolateHeight: params.interpolateHeight,
      filterColor: params.filterColor,
      filterDistance: params.filterDistance,
      mipCount: params.mipCount,
      stepDivisor: params.stepDivisor,
      lodSpacingMode: params.lodSpacingMode,
      lodSpacing: params.lodSpacing,
      screenHorizon: params.screenHorizon,
      frameCounter: params.frameCounter,
      skyColor: params.skyColor,
    },
    output: {
      pixels: output.pixels,
      pixelWidth: output.pixelWidth,
      screenWidth: output.screenWidth,
      screenHeight: output.screenHeight,
      startColumn: output.startColumn,
      endColumn: output.endColumn,
      fillUnfilled: output.fillUnfilled,
      rowColors: output.rowColors,
    },
  };
}

function isFrustumScanlineTokenStale(token, renderer, mapsGeneration) {
  const camera = renderer.camera;
  const frameBuffer = renderer.frameBuffer;
  return (
    renderer.algorithm !== token.algorithm ||
    mapsGeneration !== token.mapsGeneration ||
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
    renderer.mipCount !== token.mipCount ||
    renderer.stepDivisor !== token.stepDivisor ||
    renderer.lodSpacingMode !== token.lodSpacingMode ||
    renderer.lodSpacing !== token.lodSpacing ||
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

class FrustumScanlineRenderer {
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
    const renderer = this._renderer;
    const maps = terrain.exportMaps();
    const params = frustumScanlineParams(renderer, maps);
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
    const output = {
      ...extras,
      screenWidth: frameBuffer.width,
      screenHeight: frameBuffer.height,
      startColumn: 0,
      endColumn: frameBuffer.width,
    };
    const scene = makeFrustumScanlineScene(maps, params, output);
    if (renderer.kernels) {
      renderFrustumScanlineFrame(scene, output, frustumScanlineKernel(renderer));
    } else {
      renderFrustumScanlineCpu(scene, output);
    }
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
    const params = frustumScanlineParams(renderer, maps);
    params.rowColors = rowColors;
    const camera = renderer.camera;
    const token = {
      algorithm: renderer.algorithm,
      mapsGeneration: maps.generation,
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
      mipCount: renderer.mipCount,
      stepDivisor: renderer.stepDivisor,
      lodSpacingMode: renderer.lodSpacingMode,
      lodSpacing: renderer.lodSpacing,
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
    const slices = await pool.renderFrustumScanline(params);
    if (!slices) {
      return false;
    }
    if (
      isFrustumScanlineTokenStale(
        token,
        renderer,
        terrain.exportMaps().generation
      )
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

  async render(terrain) {
    const renderer = this._renderer;
    renderer._frustumFrameCounter = advanceRetailGameClock(
      typeof performance !== "undefined" ? performance.now() : Date.now()
    );
    renderer._terrainSky = terrain.skyColor;
    if (renderer.useWorkers() && !renderer.useJsFrustumScanline) {
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

export default FrustumScanlineRenderer;
