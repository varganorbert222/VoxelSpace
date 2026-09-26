"use strict";

export const DEFAULT_WORKER_COUNT = 4;
export const MAX_WORKERS = 16;
export const DEFAULT_MULTITHREAD = true;

export const MSG_INIT_MAPS = "initMaps";
export const MSG_INIT_KERNEL = "initKernel";
export const MSG_KERNEL_READY = "kernelReady";
export const MSG_RENDER_CLASSIC = "renderClassic";
export const MSG_RENDER_FRUSTUM_SPACE = "renderFrustumSpace";
export const MSG_RENDER_VOXEL = "renderVoxel";
export const MSG_RESULT_CLASSIC = "resultClassic";
export const MSG_RESULT_FRUSTUM_SPACE = "resultFrustumSpace";
export const MSG_RESULT_VOXEL = "resultVoxel";
export const MSG_WORKER_ERROR = "workerError";
