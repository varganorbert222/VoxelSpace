"use strict";

import { renderClassicColumns as renderClassicColumnsJs } from "./classicmarch.js";
import { renderScanlineColumns as renderScanlineColumnsJs } from "./scanlinemarch.js";
import { bindRetailMaps } from "./retail/detail.js";
import { attachVMaxMips } from "./retail/vmax.js";
import { presentColumns } from "./retail/present.js";
import {
  MSG_INIT_MAPS,
  MSG_INIT_KERNEL,
  MSG_KERNEL_READY,
  MSG_RENDER_CLASSIC,
  MSG_RENDER_SCANLINE,
  MSG_RESULT_CLASSIC,
  MSG_RESULT_SCANLINE,
  MSG_WORKER_ERROR,
} from "./jobProtocol.js";
import { BACKEND_WASM } from "../constants/backend.js";

const workerState = {
  heightMap: null,
  colorMap: null,
  mapW: 0,
  mapH: 0,
  mapShift: 0,
  altitude: 0,
  maxHeight: 0,
  maxSlope: 0,
  mapsGeneration: 0,
  terrainMips: null,
};

let renderClassicColumns = renderClassicColumnsJs;
let renderScanlineColumns = renderScanlineColumnsJs;
let kernelBackend = null;

async function setKernelBackend(backend) {
  kernelBackend = backend;
  if (backend === BACKEND_WASM) {
    const { instantiateMarch } = await import("../wasm/instantiate.js");
    const { createWasmKernels } = await import("../wasm/kernels.js");
    const instance = await instantiateMarch();
    const kernels = createWasmKernels(instance);
    renderClassicColumns = kernels.renderClassicColumns;
    renderScanlineColumns = kernels.renderScanlineColumns;
    return;
  }
  renderClassicColumns = renderClassicColumnsJs;
  renderScanlineColumns = renderScanlineColumnsJs;
}

function initMaps(msg) {
  const shared = msg.shared | 0;
  if (shared) {
    workerState.heightMap = msg.heightMap;
    workerState.colorMap = msg.colorMap;
  } else {
    workerState.heightMap = new Uint8Array(msg.heightMap);
    workerState.colorMap = new Uint32Array(msg.colorMap);
  }
  workerState.mapW = msg.width;
  workerState.mapH = msg.height;
  workerState.mapShift = msg.mapShift;
  workerState.altitude = msg.altitude;
  workerState.maxHeight =
    msg.maxHeight == null ? workerState.altitude : msg.maxHeight;
  workerState.mapsGeneration = (workerState.mapsGeneration + 1) | 0;
  const mipCount = msg.mipCount | 0;
  const heightMaps = [workerState.heightMap];
  const colorMaps = [workerState.colorMap];
  const extraHeights = msg.mipHeightMaps;
  const extraColors = msg.mipColorMaps;
  if (extraHeights && extraColors) {
    const extraN = extraHeights.length;
    for (let m = 0; (m < extraN) | 0; m = (m + 1) | 0) {
      if (shared) {
        heightMaps.push(extraHeights[m]);
        colorMaps.push(extraColors[m]);
      } else {
        heightMaps.push(new Uint8Array(extraHeights[m]));
        colorMaps.push(new Uint32Array(extraColors[m]));
      }
    }
  }
  workerState.terrainMips = {
    count: mipCount > 0 ? mipCount : heightMaps.length,
    heightMaps: heightMaps,
    colorMaps: colorMaps,
    widths: msg.mipWidths || [workerState.mapW],
    heights: msg.mipHeights || [workerState.mapH],
    shifts: msg.mipShifts || [workerState.mapShift],
  };
  if (msg.retail) {
    bindRetailMaps({ retail: msg.retail });
  }
  attachVMaxMips(workerState.terrainMips, msg.retail || null);
  workerState.colorGrade = msg.colorGrade || null;
}

function renderClassic(msg) {
  const localWidth = (msg.endColumn - msg.startColumn) | 0;
  const pixels = new Uint32Array((localWidth * msg.screenHeight) | 0);
  const rowColors = msg.rowColors;
  if (rowColors) {
    for (let y = 0; (y < msg.screenHeight) | 0; y = (y + 1) | 0) {
      const row = (y * localWidth) | 0;
      pixels.fill(rowColors[y], row, row + localWidth);
    }
  }
  const renderClassic = renderClassicColumns;
  renderClassic({
    heightMap: workerState.heightMap,
    colorMap: workerState.colorMap,
    mapW: workerState.mapW,
    mapH: workerState.mapH,
    mapShift: workerState.mapShift,
    altitude: workerState.altitude,
    maxHeight: workerState.maxHeight,
    mapsGeneration: workerState.mapsGeneration,
    terrainMips: workerState.terrainMips,
    startColumn: msg.startColumn,
    endColumn: msg.endColumn,
    screenWidth: msg.screenWidth,
    screenHeight: msg.screenHeight,
    camX: msg.camX,
    camY: msg.camY,
    camZ: msg.camZ,
    sinAngle: msg.sinAngle,
    cosAngle: msg.cosAngle,
    tanHalfFovX: msg.tanHalfFovX,
    dstToProjPlane: msg.dstToProjPlane,
    screenHorizon: msg.screenHorizon,
    nearClip: msg.nearClip,
    farClip: msg.farClip,
    quality: msg.quality,
    fov: msg.fov,
    showDetails: msg.showDetails,
    debugView: msg.debugView,
    repeat: msg.repeat,
    retailWidth: msg.retailWidth,
    fov: msg.fov,
    filterDistance: msg.filterDistance,
    mipCount: msg.mipCount,
    lodSpacingMode: msg.lodSpacingMode,
    lodSpacing: msg.lodSpacing,
    lodBias: msg.lodBias,
    fwdX: msg.fwdX,
    fwdY: msg.fwdY,
    pixels,
    pixelWidth: localWidth,
    fillUnfilled: 0,
    rowColors: rowColors || null,
  });
  presentColumns(
    pixels,
    localWidth,
    msg.screenHeight | 0,
    msg.startColumn | 0,
    msg.present,
    workerState.colorGrade
  );
  self.postMessage(
    {
      type: MSG_RESULT_CLASSIC,
      jobId: msg.jobId,
      startColumn: msg.startColumn,
      endColumn: msg.endColumn,
      pixels: pixels.buffer,
    },
    [pixels.buffer]
  );
}

function renderScanline(msg) {
  const localWidth = (msg.endColumn - msg.startColumn) | 0;
  const pixels = new Uint32Array((localWidth * msg.screenHeight) | 0);
  const rowColors = msg.rowColors;
  if (rowColors) {
    for (let y = 0; (y < msg.screenHeight) | 0; y = (y + 1) | 0) {
      const row = (y * localWidth) | 0;
      pixels.fill(rowColors[y], row, row + localWidth);
    }
  }
  const renderScanlineColumnRange = renderScanlineColumns;
  renderScanlineColumnRange({
    heightMap: workerState.heightMap,
    colorMap: workerState.colorMap,
    mapW: workerState.mapW,
    mapH: workerState.mapH,
    mapShift: workerState.mapShift,
    altitude: workerState.altitude,
    maxHeight: workerState.maxHeight,
    maxSlope: workerState.maxSlope,
    terrainMips: workerState.terrainMips,
    mapsGeneration: workerState.mapsGeneration,
    startColumn: msg.startColumn,
    endColumn: msg.endColumn,
    screenWidth: msg.screenWidth,
    screenHeight: msg.screenHeight,
    camX: msg.camX,
    camY: msg.camY,
    camZ: msg.camZ,
    rightX: msg.rightX,
    rightY: msg.rightY,
    rightZ: msg.rightZ,
    upX: msg.upX,
    upY: msg.upY,
    upZ: msg.upZ,
    fwdX: msg.fwdX,
    fwdY: msg.fwdY,
    fwdZ: msg.fwdZ,
    tanHalfFovX: msg.tanHalfFovX,
    dstToProjPlane: msg.dstToProjPlane,
    nearClip: msg.nearClip,
    farClip: msg.farClip,
    minDeltaZ: msg.minDeltaZ,
    quality: msg.quality,
    fov: msg.fov,
    showDetails: msg.showDetails,
    debugView: msg.debugView,
    repeat: msg.repeat,
    filterDistance: msg.filterDistance,
    mipCount: msg.mipCount,
    lodSpacingMode: msg.lodSpacingMode,
    lodSpacing: msg.lodSpacing,
    lodBias: msg.lodBias,
    pixels,
    pixelWidth: localWidth,
    fillUnfilled: 0,
    rowColors: rowColors || null,
  });
  presentColumns(
    pixels,
    localWidth,
    msg.screenHeight | 0,
    msg.startColumn | 0,
    msg.present,
    workerState.colorGrade
  );
  self.postMessage(
    {
      type: MSG_RESULT_SCANLINE,
      jobId: msg.jobId,
      startColumn: msg.startColumn,
      endColumn: msg.endColumn,
      pixels: pixels.buffer,
    },
    [pixels.buffer]
  );
}

async function handleMessage(msg) {
  if (msg.type === MSG_INIT_KERNEL) {
    await setKernelBackend(msg.backend);
    self.postMessage({ type: MSG_KERNEL_READY });
    return;
  }
  if (msg.type === MSG_INIT_MAPS) {
    initMaps(msg);
    return;
  }
  if (msg.type === MSG_RENDER_CLASSIC) {
    renderClassic(msg);
    return;
  }
  if (msg.type === MSG_RENDER_SCANLINE) {
    renderScanline(msg);
    return;
  }
}

let chain = Promise.resolve();

self.onmessage = (e) => {
  const msg = e.data;
  chain = chain
    .then(() => handleMessage(msg))
    .catch((err) => {
      self.postMessage({
        type: MSG_WORKER_ERROR,
        jobId: msg && msg.jobId,
        message: String(err && err.message ? err.message : err),
        stack: err && err.stack ? String(err.stack) : "",
      });
    });
};
