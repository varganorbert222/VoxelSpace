"use strict";

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
} from "../constants/threading.js";

export {
  MSG_INIT_MAPS,
  MSG_INIT_PANO,
  MSG_RENDER_CLASSIC,
  MSG_RENDER_PANORAMA,
  MSG_RENDER_PANO_VIEW,
  MSG_RESULT_CLASSIC,
  MSG_RESULT_PANORAMA,
  MSG_RESULT_PANO_VIEW,
  MSG_WORKER_ERROR,
};

export function classicRenderPayload(jobId, range, params) {
  return {
    type: MSG_RENDER_CLASSIC,
    jobId: jobId,
    startColumn: range.start,
    endColumn: range.end,
    screenWidth: params.screenWidth,
    screenHeight: params.screenHeight,
    camX: params.camX,
    camY: params.camY,
    camZ: params.camZ,
    sinAngle: params.sinAngle,
    cosAngle: params.cosAngle,
    tanHalfFovX: params.tanHalfFovX,
    dstToProjPlane: params.dstToProjPlane,
    screenHorizon: params.screenHorizon,
    nearClip: params.nearClip,
    farClip: params.farClip,
    minDeltaZ: params.minDeltaZ,
    quality: params.quality,
    applyFog: params.applyFog,
    repeat: params.repeat,
    rowColors: params.rowColors,
  };
}

export function panoramaViewPayload(jobId, range, params) {
  return {
    type: MSG_RENDER_PANO_VIEW,
    jobId: jobId,
    startColumn: range.start,
    endColumn: range.end,
    screenWidth: params.screenWidth,
    screenHeight: params.screenHeight,
    fovY: params.fovY,
    skyColor: params.skyColor,
    horizonColor: params.horizonColor,
    nearClip: params.nearClip,
    farClip: params.farClip,
    applyFog: params.applyFog,
    rightX: params.rightX,
    rightY: params.rightY,
    rightZ: params.rightZ,
    upX: params.upX,
    upY: params.upY,
    upZ: params.upZ,
    fwdX: params.fwdX,
    fwdY: params.fwdY,
    fwdZ: params.fwdZ,
  };
}

export function panoramaGeneratePayload(jobId, range, params) {
  return {
    type: MSG_RENDER_PANORAMA,
    jobId: jobId,
    startPx: range.start,
    endPx: range.end,
    width: params.width,
    height: params.height,
    camX: params.camX,
    camY: params.camY,
    camZ: params.camZ,
    farClip: params.farClip,
    nearClip: params.nearClip,
    tMax: params.tMax,
    repeat: params.repeat,
    skyColor: params.skyColor,
    initialStep: params.initialStep,
    quality: params.quality,
  };
}
