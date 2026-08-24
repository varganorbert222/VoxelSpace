"use strict";

import { renderClassicColumns as renderClassicColumnsJs } from "./classicmarch.js";
import { renderPanoramaColumns as renderPanoramaColumnsJs } from "./panoramamarch.js";
import { renderPanoramaViewColumns as renderPanoramaViewColumnsJs } from "./panoramaViewer.js";
import { renderCubemapViewColumns as renderCubemapViewColumnsJs } from "./cubemapViewer.js";
import {
  renderCubemapHorizonColumns,
  renderCubemapPolarAzimuths,
} from "./cubemapmarch.js";
import {
  MSG_INIT_MAPS,
  MSG_INIT_PANO,
  MSG_INIT_CUBE,
  MSG_INIT_KERNEL,
  MSG_KERNEL_READY,
  MSG_RENDER_CLASSIC,
  MSG_RENDER_PANORAMA,
  MSG_RENDER_PANO_VIEW,
  MSG_RENDER_CUBE_VIEW,
  MSG_RENDER_CUBE_GENERATE,
  MSG_RESULT_CLASSIC,
  MSG_RESULT_PANORAMA,
  MSG_RESULT_PANO_VIEW,
  MSG_RESULT_CUBE_VIEW,
  MSG_RESULT_CUBE_GENERATE,
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
  mapsGeneration: 0,
  panoMips: null,
  panoPixels: null,
  panoHorizon: null,
  panoDepth: null,
  panoHeightBuf: null,
  panoIter: null,
  panoWidth: 0,
  panoHeight: 0,
  panoGeneration: 0,
  cubeColor: null,
  cubeDepth: null,
  cubeHeight: null,
  cubeIter: null,
  cubeN: 0,
  cubeGeneration: 0,
};

let renderClassicColumns = renderClassicColumnsJs;
let renderPanoramaColumns = renderPanoramaColumnsJs;
let renderPanoramaViewColumns = renderPanoramaViewColumnsJs;

async function setKernelBackend(backend) {
  if (backend === BACKEND_WASM) {
    const { instantiateMarch } = await import("../wasm/instantiate.js");
    const { createWasmKernels } = await import("../wasm/kernels.js");
    const instance = await instantiateMarch();
    const kernels = createWasmKernels(instance);
    renderClassicColumns = kernels.renderClassicColumns;
    renderPanoramaColumns = kernels.renderPanoramaColumns;
    renderPanoramaViewColumns = kernels.renderPanoramaViewColumns;
    return;
  }
  renderClassicColumns = renderClassicColumnsJs;
  renderPanoramaColumns = renderPanoramaColumnsJs;
  renderPanoramaViewColumns = renderPanoramaViewColumnsJs;
}

function initMaps(msg) {
  workerState.heightMap = new Uint8Array(msg.heightMap);
  workerState.colorMap = new Uint32Array(msg.colorMap);
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
      heightMaps.push(new Uint8Array(extraHeights[m]));
      colorMaps.push(new Uint32Array(extraColors[m]));
    }
  }
  workerState.panoMips = {
    count: mipCount > 0 ? mipCount : heightMaps.length,
    heightMaps: heightMaps,
    colorMaps: colorMaps,
    widths: msg.mipWidths || [workerState.mapW],
    heights: msg.mipHeights || [workerState.mapH],
    shifts: msg.mipShifts || [workerState.mapShift],
  };
}

function initPano(msg) {
  workerState.panoPixels = new Uint32Array(msg.pixels);
  workerState.panoHorizon = new Int32Array(msg.horizon);
  workerState.panoDepth = msg.depth ? new Float32Array(msg.depth) : null;
  workerState.panoHeightBuf = msg.heightBuf ? new Uint32Array(msg.heightBuf) : null;
  workerState.panoIter = msg.iter ? new Uint32Array(msg.iter) : null;
  workerState.panoWidth = msg.width;
  workerState.panoHeight = msg.height;
  workerState.panoGeneration = msg.generation | 0;
}

function initCube(msg) {
  workerState.cubeColor = new Uint32Array(msg.color);
  workerState.cubeDepth = msg.depth ? new Float32Array(msg.depth) : null;
  workerState.cubeHeight = msg.heightBuf ? new Uint32Array(msg.heightBuf) : null;
  workerState.cubeIter = msg.iter ? new Uint32Array(msg.iter) : null;
  workerState.cubeN = msg.n | 0;
  workerState.cubeGeneration = msg.generation | 0;
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
  renderClassicColumns({
    heightMap: workerState.heightMap,
    colorMap: workerState.colorMap,
    mapW: workerState.mapW,
    mapH: workerState.mapH,
    mapShift: workerState.mapShift,
    altitude: workerState.altitude,
    maxHeight: workerState.maxHeight,
    mapsGeneration: workerState.mapsGeneration,
    panoMips: workerState.panoMips,
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
    minDeltaZ: msg.minDeltaZ,
    quality: msg.quality,
    applyFog: msg.applyFog,
    debugView: msg.debugView,
    repeat: msg.repeat,
    interpolateHeight: msg.interpolateHeight,
    filterColor: msg.filterColor,
    pixels,
    pixelWidth: localWidth,
    fillUnfilled: rowColors ? 0 : 1,
    rowColors: rowColors || null,
  });
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

function renderPanorama(msg) {
  const localWidth = (msg.endPx - msg.startPx) | 0;
  const pixels = new Uint32Array((localWidth * msg.height) | 0);
  const horizon = new Int32Array(localWidth);
  const depth = new Float32Array((localWidth * msg.height) | 0);
  const pixN = (localWidth * msg.height) | 0;
  const heightBuf = msg.wantHeight ? new Uint32Array(pixN) : null;
  const iterBuf = msg.wantIter ? new Uint32Array(pixN) : null;
  renderPanoramaColumns({
    heightMap: workerState.heightMap,
    colorMap: workerState.colorMap,
    mapW: workerState.mapW,
    mapH: workerState.mapH,
    mapShift: workerState.mapShift,
    altitude: workerState.altitude,
    maxHeight: workerState.maxHeight,
    mapsGeneration: workerState.mapsGeneration,
    camX: msg.camX,
    camY: msg.camY,
    camZ: msg.camZ,
    width: msg.width,
    height: msg.height,
    startPx: msg.startPx,
    endPx: msg.endPx,
    farClip: msg.farClip,
    nearClip: msg.nearClip,
    tMax: msg.tMax,
    repeat: msg.repeat,
    skyColor: msg.skyColor,
    horizonColor: msg.horizonColor,
    initialStep: msg.initialStep,
    quality: msg.quality,
    interpolateHeight: msg.interpolateHeight,
    filterColor: msg.filterColor,
    pixels,
    horizon,
    depth,
    heightBuf,
    iterBuf,
    panoMips: workerState.panoMips,
  });
  const transfer = [pixels.buffer, horizon.buffer, depth.buffer];
  if (heightBuf) {
    transfer.push(heightBuf.buffer);
  }
  if (iterBuf) {
    transfer.push(iterBuf.buffer);
  }
  self.postMessage(
    {
      type: MSG_RESULT_PANORAMA,
      jobId: msg.jobId,
      startPx: msg.startPx,
      endPx: msg.endPx,
      pixels: pixels.buffer,
      horizon: horizon.buffer,
      depth: depth.buffer,
      heightBuf: heightBuf ? heightBuf.buffer : null,
      iter: iterBuf ? iterBuf.buffer : null,
    },
    transfer
  );
}

function renderPanoView(msg) {
  const localWidth = (msg.endColumn - msg.startColumn) | 0;
  const pixels = new Uint32Array((localWidth * msg.screenHeight) | 0);
  renderPanoramaViewColumns({
    panorama: workerState.panoPixels,
    panoramaWidth: workerState.panoWidth,
    panoramaHeight: workerState.panoHeight,
    fovY: msg.fovY,
    dstToProjPlane: msg.dstToProjPlane,
    screenWidth: msg.screenWidth,
    screenHeight: msg.screenHeight,
    startColumn: msg.startColumn,
    endColumn: msg.endColumn,
    pixels,
    pixelWidth: localWidth,
    fillUnfilled: 1,
    horizon: workerState.panoHorizon,
    depth: workerState.panoDepth,
    heightBuf: workerState.panoHeightBuf,
    iterBuf: workerState.panoIter,
    panoGeneration: workerState.panoGeneration,
    skyColor: msg.skyColor,
    horizonColor: msg.horizonColor,
    nearClip: msg.nearClip,
    farClip: msg.farClip,
    applyFog: msg.applyFog,
    debugView: msg.debugView,
    rightX: msg.rightX,
    rightY: msg.rightY,
    rightZ: msg.rightZ,
    upX: msg.upX,
    upY: msg.upY,
    upZ: msg.upZ,
    fwdX: msg.fwdX,
    fwdY: msg.fwdY,
    fwdZ: msg.fwdZ,
  });
  self.postMessage(
    {
      type: MSG_RESULT_PANO_VIEW,
      jobId: msg.jobId,
      startColumn: msg.startColumn,
      endColumn: msg.endColumn,
      pixels: pixels.buffer,
    },
    [pixels.buffer]
  );
}

function renderCubeView(msg) {
  const localWidth = (msg.endColumn - msg.startColumn) | 0;
  const pixels = new Uint32Array((localWidth * msg.screenHeight) | 0);
  renderCubemapViewColumnsJs({
    cubeColor: workerState.cubeColor,
    cubeDepth: workerState.cubeDepth,
    cubeHeight: workerState.cubeHeight,
    cubeIter: workerState.cubeIter,
    cubeN: workerState.cubeN,
    fovY: msg.fovY,
    dstToProjPlane: msg.dstToProjPlane,
    screenWidth: msg.screenWidth,
    screenHeight: msg.screenHeight,
    startColumn: msg.startColumn,
    endColumn: msg.endColumn,
    pixels,
    pixelWidth: localWidth,
    fillUnfilled: 1,
    skyColor: msg.skyColor,
    horizonColor: msg.horizonColor,
    nearClip: msg.nearClip,
    farClip: msg.farClip,
    applyFog: msg.applyFog,
    debugView: msg.debugView,
    rightX: msg.rightX,
    rightY: msg.rightY,
    rightZ: msg.rightZ,
    upX: msg.upX,
    upY: msg.upY,
    upZ: msg.upZ,
    fwdX: msg.fwdX,
    fwdY: msg.fwdY,
    fwdZ: msg.fwdZ,
  });
  self.postMessage(
    {
      type: MSG_RESULT_CUBE_VIEW,
      jobId: msg.jobId,
      startColumn: msg.startColumn,
      endColumn: msg.endColumn,
      pixels: pixels.buffer,
    },
    [pixels.buffer]
  );
}

function renderCubeGenerate(msg) {
  const n = msg.n | 0;
  const polar = msg.kind === "polar";
  const faceCount = polar ? 2 : 1;
  const count = (faceCount * n * n) | 0;
  const pixels = new Uint32Array(count);
  const depth = new Float32Array(count);
  const heightBuf = msg.wantHeight ? new Uint32Array(count) : null;
  const iterBuf = msg.wantIter ? new Uint32Array(count) : null;
  const shared = {
    heightMap: workerState.heightMap,
    colorMap: workerState.colorMap,
    mapW: workerState.mapW,
    mapH: workerState.mapH,
    mapShift: workerState.mapShift,
    altitude: workerState.altitude,
    maxHeight: workerState.maxHeight,
    mapsGeneration: workerState.mapsGeneration,
    camX: msg.camX,
    camY: msg.camY,
    camZ: msg.camZ,
    n: n,
    farClip: msg.farClip,
    nearClip: msg.nearClip,
    tMax: msg.tMax,
    repeat: msg.repeat,
    skyColor: msg.skyColor,
    horizonColor: msg.horizonColor,
    initialStep: msg.initialStep,
    quality: msg.quality,
    interpolateHeight: msg.interpolateHeight,
    filterColor: msg.filterColor,
    pixels: pixels,
    depth: depth,
    heightBuf: heightBuf,
    iterBuf: iterBuf,
    panoMips: workerState.panoMips,
  };
  if (polar) {
    const azCount = n << 2;
    renderCubemapPolarAzimuths({
      ...shared,
      startAz: msg.startAz | 0,
      endAz: msg.endAz > 0 ? msg.endAz | 0 : azCount,
      azCount: azCount,
      fillSky: msg.fillSky | 0,
      pzOff: 0,
      nzOff: n * n,
    });
  } else {
    renderCubemapHorizonColumns({
      ...shared,
      face: msg.face,
      startCol: 0,
      endCol: n,
      faceOff: 0,
    });
  }
  const transfer = [pixels.buffer, depth.buffer];
  if (heightBuf) {
    transfer.push(heightBuf.buffer);
  }
  if (iterBuf) {
    transfer.push(iterBuf.buffer);
  }
  self.postMessage(
    {
      type: MSG_RESULT_CUBE_GENERATE,
      jobId: msg.jobId,
      kind: msg.kind,
      face: msg.face,
      n: n,
      pixels: pixels.buffer,
      depth: depth.buffer,
      heightBuf: heightBuf ? heightBuf.buffer : null,
      iter: iterBuf ? iterBuf.buffer : null,
    },
    transfer
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
  if (msg.type === MSG_INIT_PANO) {
    initPano(msg);
    return;
  }
  if (msg.type === MSG_INIT_CUBE) {
    initCube(msg);
    return;
  }
  if (msg.type === MSG_RENDER_CLASSIC) {
    renderClassic(msg);
    return;
  }
  if (msg.type === MSG_RENDER_PANORAMA) {
    renderPanorama(msg);
    return;
  }
  if (msg.type === MSG_RENDER_PANO_VIEW) {
    renderPanoView(msg);
    return;
  }
  if (msg.type === MSG_RENDER_CUBE_VIEW) {
    renderCubeView(msg);
    return;
  }
  if (msg.type === MSG_RENDER_CUBE_GENERATE) {
    renderCubeGenerate(msg);
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
