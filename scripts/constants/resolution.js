"use strict";

// Delta Force / Voxel Space modes. Each entry is a landscape reference box.
// The framebuffer keeps the current viewport aspect and is the largest even
// size that fits inside that box. Portrait swaps the box, so neither axis
// can exceed the longest reference side.
export const RETRO_RESOLUTIONS = Object.freeze([
  Object.freeze({ width: 320, height: 240 }),
  Object.freeze({ width: 400, height: 300 }),
  Object.freeze({ width: 512, height: 384 }),
  Object.freeze({ width: 640, height: 480 }),
  Object.freeze({ width: 800, height: 600 }),
  Object.freeze({ width: 1024, height: 768 }),
  Object.freeze({ width: 1280, height: 1024 }),
]);

export const DEFAULT_RESOLUTION = 3;

export const RESOLUTION_VALUES = Object.freeze(
  RETRO_RESOLUTIONS.map((_, index) => index)
);

export const RESOLUTION_LABEL = Object.freeze(
  RETRO_RESOLUTIONS.reduce((labels, entry, index) => {
    labels[index] = entry.width + "×" + entry.height;
    return labels;
  }, {})
);

function longestReferenceSide() {
  let max = 1;
  for (let i = 0; i < RETRO_RESOLUTIONS.length; i++) {
    const entry = RETRO_RESOLUTIONS[i];
    if (entry.width > max) {
      max = entry.width;
    }
    if (entry.height > max) {
      max = entry.height;
    }
  }
  return max;
}

export const MAX_RENDER_DIMENSION = longestReferenceSide();
export const MAX_RENDER_WIDTH = MAX_RENDER_DIMENSION;
export const MAX_RENDER_HEIGHT = MAX_RENDER_DIMENSION;

function largestReferenceArea() {
  let max = 1;
  for (let i = 0; i < RETRO_RESOLUTIONS.length; i++) {
    const entry = RETRO_RESOLUTIONS[i];
    const area = entry.width * entry.height;
    if (area > max) {
      max = area;
    }
  }
  return max;
}

export const MAX_RENDER_PIXELS = largestReferenceArea();

export function resolutionIndex(resolution) {
  let index = resolution | 0;
  if (index < 0) {
    index = 0;
  }
  const last = RETRO_RESOLUTIONS.length - 1;
  if (index > last) {
    index = last;
  }
  return index;
}

export function resolutionLabel(resolution) {
  return RESOLUTION_LABEL[resolutionIndex(resolution)];
}

function evenFloor(value) {
  let n = value | 0;
  if (n & 1) {
    n = (n - 1) | 0;
  }
  if (n < 2) {
    n = 2;
  }
  return n;
}

export function fitRetroResolution(resolution, screenW, screenH) {
  const entry = RETRO_RESOLUTIONS[resolutionIndex(resolution)];
  let rw = entry.width | 0;
  let rh = entry.height | 0;
  let sw = screenW | 0;
  let sh = screenH | 0;
  if (sw < 1) {
    sw = 1;
  }
  if (sh < 1) {
    sh = 1;
  }
  if ((sw >= sh) !== (rw >= rh)) {
    const swapped = rw;
    rw = rh;
    rh = swapped;
  }
  const screenAspect = sw / sh;
  const refAspect = rw / rh;
  let width;
  let height;
  if (Math.abs(screenAspect - refAspect) < 1e-6) {
    width = rw;
    height = rh;
  } else if (screenAspect > refAspect) {
    width = rw;
    height = evenFloor(Math.round(rw / screenAspect));
    if (height > rh) {
      height = rh;
    }
  } else {
    height = rh;
    width = evenFloor(Math.round(rh * screenAspect));
    if (width > rw) {
      width = rw;
    }
  }
  if (width > MAX_RENDER_WIDTH) {
    width = MAX_RENDER_WIDTH;
  }
  if (height > MAX_RENDER_HEIGHT) {
    height = MAX_RENDER_HEIGHT;
  }
  if (width < 2) {
    width = 2;
  }
  if (height < 2) {
    height = 2;
  }
  return { width: width | 0, height: height | 0 };
}
