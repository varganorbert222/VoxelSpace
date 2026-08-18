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
} from "./constants/threading.js";

let heightMap = null;
let colorMap = null;
let mapW = 0;
let mapH = 0;
let mapShift = 0;
let altitude = 0;
let panoPixels = null;
let panoHorizon = null;
let panoWidth = 0;
let panoHeight = 0;

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === MSG_INIT_MAPS) {
      heightMap = new Uint8Array(msg.heightMap);
      colorMap = new Uint32Array(msg.colorMap);
      mapW = msg.width;
      mapH = msg.height;
      mapShift = msg.mapShift;
      altitude = msg.altitude;
      return;
    }

    if (msg.type === MSG_INIT_PANO) {
      panoPixels = new Uint32Array(msg.pixels);
      panoHorizon = new Int32Array(msg.horizon);
      panoWidth = msg.width;
      panoHeight = msg.height;
      return;
    }

    if (msg.type === MSG_RENDER_CLASSIC) {
      const localWidth = (msg.endColumn - msg.startColumn) | 0;
      const pixels = new Uint32Array(msg.pixels);
      renderClassicColumns({
        heightMap,
        colorMap,
        mapW,
        mapH,
        mapShift,
        altitude,
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
        fillUnfilled: 1,
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
      return;
    }

    if (msg.type === MSG_RENDER_PANORAMA) {
      const pixels = new Uint32Array(msg.pixels);
      const horizon = new Int32Array(msg.horizon);
      renderPanoramaColumns({
        heightMap,
        colorMap,
        mapW,
        mapH,
        mapShift,
        altitude,
        camX: msg.camX,
        camY: msg.camY,
        camZ: msg.camZ,
        width: msg.width,
        height: msg.height,
        startPx: msg.startPx,
        endPx: msg.endPx,
        farClip: msg.farClip,
        nearClip: msg.nearClip,
        applyFog: msg.applyFog,
        repeat: msg.repeat,
        skyColor: msg.skyColor,
        initialStep: msg.initialStep,
        pixels,
        horizon,
      });
      self.postMessage(
        {
          type: MSG_RESULT_PANORAMA,
          jobId: msg.jobId,
          startPx: msg.startPx,
          endPx: msg.endPx,
          pixels: pixels.buffer,
          horizon: horizon.buffer,
        },
        [pixels.buffer, horizon.buffer]
      );
      return;
    }

    if (msg.type === MSG_RENDER_PANO_VIEW) {
      const localWidth = (msg.endColumn - msg.startColumn) | 0;
      const pixels = new Uint32Array(msg.pixels);
      renderPanoramaViewColumns({
        panorama: panoPixels,
        panoramaWidth: panoWidth,
        panoramaHeight: panoHeight,
        fovY: msg.fovY,
        screenWidth: msg.screenWidth,
        screenHeight: msg.screenHeight,
        startColumn: msg.startColumn,
        endColumn: msg.endColumn,
        pixels,
        pixelWidth: localWidth,
        fillUnfilled: 1,
        horizon: panoHorizon,
        skyColor: msg.skyColor,
        horizonColor: msg.horizonColor,
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
  } catch (err) {
    self.postMessage({
      type: MSG_WORKER_ERROR,
      jobId: msg && msg.jobId,
      message: String(err && err.message ? err.message : err),
      stack: err && err.stack ? String(err.stack) : "",
    });
  }
};
