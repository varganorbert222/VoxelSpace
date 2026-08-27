"use strict";

export const ALGORITHM_CLASSIC = "classic";
export const ALGORITHM_FRUSTUM_SPACE = "frustum-space";
export const ALGORITHM_PANORAMA = "panorama";
export const ALGORITHM_CUBEMAP = "cubemap";

export function usesFreeLook(algorithm) {
  return algorithm === ALGORITHM_PANORAMA || algorithm === ALGORITHM_CUBEMAP;
}

export function usesHorizonHack(algorithm) {
  return algorithm === ALGORITHM_CLASSIC;
}

export function usesFrustumLook(algorithm) {
  return algorithm === ALGORITHM_FRUSTUM_SPACE;
}
