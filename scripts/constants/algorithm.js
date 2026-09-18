"use strict";

export const ALGORITHM_CLASSIC = "classic";
export const ALGORITHM_PANORAMA = "panorama";
export const ALGORITHM_CUBEMAP = "cubemap";
export const ALGORITHM_VOXEL = "voxel";

export function usesFreeLook(algorithm) {
  return (
    algorithm === ALGORITHM_PANORAMA ||
    algorithm === ALGORITHM_CUBEMAP ||
    algorithm === ALGORITHM_VOXEL
  );
}
