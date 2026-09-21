"use strict";

import { BACKEND_WEBGPU } from "./backend.js";

export const ALGORITHM_CLASSIC = "classic";
export const ALGORITHM_PANORAMA = "panorama";
export const ALGORITHM_CUBEMAP = "cubemap";
export const ALGORITHM_VOXEL = "voxel";

export function isAlgorithmAllowed(algorithm, backend) {
  return algorithm !== ALGORITHM_VOXEL || backend === BACKEND_WEBGPU;
}

export function algorithmsForBackend(algorithms, backend) {
  return algorithms.filter((algorithm) =>
    isAlgorithmAllowed(algorithm, backend)
  );
}

export function usesFreeLook(algorithm) {
  return (
    algorithm === ALGORITHM_PANORAMA ||
    algorithm === ALGORITHM_CUBEMAP ||
    algorithm === ALGORITHM_VOXEL
  );
}
