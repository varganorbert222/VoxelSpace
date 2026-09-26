"use strict";

import { BACKEND_WEBGPU } from "./backend.js";

export const ALGORITHM_CLASSIC = "classic";
export const ALGORITHM_FRUSTUM_SPACE = "frustum-space";
export const ALGORITHM_VOXEL = "voxel";

export function isAlgorithmAllowed(algorithm, backend) {
  if (algorithm === ALGORITHM_VOXEL) {
    return backend === BACKEND_WEBGPU;
  }
  return true;
}

export function algorithmsForBackend(algorithms, backend) {
  return algorithms.filter((algorithm) =>
    isAlgorithmAllowed(algorithm, backend)
  );
}

export function usesFreeLook(algorithm) {
  return algorithm === ALGORITHM_VOXEL;
}

export function usesHorizonHack(algorithm) {
  return algorithm === ALGORITHM_CLASSIC;
}

export function usesFrustumLook(algorithm) {
  return algorithm === ALGORITHM_FRUSTUM_SPACE;
}
