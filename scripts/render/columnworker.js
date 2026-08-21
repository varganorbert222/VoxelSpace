"use strict";

import { renderClassicColumns } from "./classicmarch.js";
import { renderPanoramaColumns } from "./panoramamarch.js";
import { renderPanoramaViewColumns } from "./panoramaViewer.js";
import {
  MSG_INIT_MAPS,
  MSG_INIT_PANO,
  MSG_RENDER_CLASSIC,
  MSG_RENDER_PANORAMA,
  MSG_RENDER_PANO_VIEW,
  MSG_RESULT_CLASSIC,
  MSG_RESULT_PANORAMA,
  MSG_RESULT_PANO_VIEW,
  MSG_WORKER_ERROR,
} from "./jobProtocol.js";

const workerState = {
  heightMap: null,
  colorMap: null,
  mapW: 0,
  mapH: 0,
  mapShift: 0,
  altitude: 0,
  maxHeight: 0,
  panoMips: null,
  panoPixels: null,
  panoHorizon: null,
  panoDepth: null,
  panoWidth: 0,
  panoHeight: 0,
};

function initMaps(msg) {
  workerState.heightMap = new Uint8Array(msg.heightMap);
  workerState.colorMap = new Uint32Array(msg.colorMap);
  workerState.mapW = msg.width;
  workerState.mapH = msg.height;
  workerState.mapShift = msg.mapShift;
  workerState.altitude = msg.altitude;
  workerState.maxHeight =
    msg.maxHeight == null ? workerState.altitude : msg.maxHeight;
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
  workerState.panoWidth = msg.width;
  workerState.panoHeight = msg.height;
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
    repeat: msg.repeat,
    pixels,
    pixelWidth: localWidth,
    fillUnfilled: rowColors ? 0 : 1,
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
  renderPanoramaColumns({
    heightMap: workerState.heightMap,
    colorMap: workerState.colorMap,
    mapW: workerState.mapW,
    mapH: workerState.mapH,
    mapShift: workerState.mapShift,
    altitude: workerState.altitude,
    maxHeight: workerState.maxHeight,
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
    initialStep: msg.initialStep,
    quality: msg.quality,
    pixels,
    horizon,
    depth,
    panoMips: workerState.panoMips,
  });
  self.postMessage(
    {
      type: MSG_RESULT_PANORAMA,
      jobId: msg.jobId,
      startPx: msg.startPx,
      endPx: msg.endPx,
      pixels: pixels.buffer,
      horizon: horizon.buffer,
      depth: depth.buffer,
    },
    [pixels.buffer, horizon.buffer, depth.buffer]
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
    skyColor: msg.skyColor,
    horizonColor: msg.horizonColor,
    nearClip: msg.nearClip,
    farClip: msg.farClip,
    applyFog: msg.applyFog,
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

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === MSG_INIT_MAPS) {
      initMaps(msg);
      return;
    }
    if (msg.type === MSG_INIT_PANO) {
      initPano(msg);
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
    }
  } catch (err) {
    self.postMessage({
      type: MSG_WORKER_ERROR,
      jobId: msg && msg.jobId,
      message: String(err && err.message ? err.message : err),
      stack: err && err.stack ? String(err.stack) : "",
    });
  }
};
