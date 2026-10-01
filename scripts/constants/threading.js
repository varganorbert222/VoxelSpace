"use strict";

export const DEFAULT_WORKER_COUNT = 4;
export const MAX_WORKERS = 16;
export const DEFAULT_MULTITHREAD = true;

export const MSG_INIT_MAPS = "initMaps";
export const MSG_INIT_KERNEL = "initKernel";
export const MSG_KERNEL_READY = "kernelReady";
export const MSG_RENDER_CLASSIC = "renderClassic";
export const MSG_RENDER_SCANLINE = "renderScanline";
export const MSG_RESULT_CLASSIC = "resultClassic";
export const MSG_RESULT_SCANLINE = "resultScanline";
export const MSG_WORKER_ERROR = "workerError";
