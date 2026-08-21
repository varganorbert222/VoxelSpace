"use strict";

export const DEFAULT_WORKER_COUNT = 4;
export const MAX_WORKERS = 16;
export const DEFAULT_MULTITHREAD = false;

export const MSG_INIT_MAPS = "initMaps";
export const MSG_INIT_PANO = "initPano";
export const MSG_INIT_KERNEL = "initKernel";
export const MSG_KERNEL_READY = "kernelReady";
export const MSG_RENDER_CLASSIC = "renderClassic";
export const MSG_RENDER_PANORAMA = "renderPanorama";
export const MSG_RENDER_PANO_VIEW = "renderPanoView";
export const MSG_RESULT_CLASSIC = "resultClassic";
export const MSG_RESULT_PANORAMA = "resultPanorama";
export const MSG_RESULT_PANO_VIEW = "resultPanoView";
export const MSG_WORKER_ERROR = "workerError";
