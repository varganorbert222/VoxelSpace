"use strict";

import { applyColorGrade } from "./colorGrade.js";
import { compositeSky, skyPackView } from "./skybox.js";
import { compositeWater } from "./water.js";

export function compositePresentedWater(frameBuffer, camera, maps) {
  const water = maps && maps.retail && maps.retail.water;
  if (!water || !(water.height > 0) || !frameBuffer || !frameBuffer._buffer32bit) {
    return;
  }
  const width = frameBuffer._width | 0;
  const height = frameBuffer._height | 0;
  const cached = frameBuffer._cachedBuffer32bit;
  const skyRows = cached ? new Uint32Array(height) : null;
  if (skyRows) {
    for (let y = 0; y < height; y++) {
      skyRows[y] = cached[y * width];
    }
  }
  compositeWater(frameBuffer._buffer32bit, width, height, camera, water, skyRows);
  frameBuffer._mustBeRecalcBuffer32bit = true;
}

// March slices are independent columns. Sky and water run here, on the
// worker, so the full-frame pass does not pile up on the main thread when
// the framebuffer grows. originX is the slice's first screen column. The
// buffer width is the slice, not the screen.
export function presentColumns(buffer32, sliceWidth, height, originX, present, grade) {
  if (!present) {
    return;
  }
  const screenW = present.screenWidth | 0;
  const camera = present.camera;
  if (present.water && camera) {
    const skyRows = new Uint32Array(height);
    const map = present.water.map;
    compositeWater(
      buffer32,
      sliceWidth,
      height,
      camera,
      {
        height: present.water.height,
        opacity: present.water.opacity,
        table: present.water.table,
        mips: map ? [map] : null,
      },
      skyRows,
      screenW
    );
  }
  const words = present.words;
  if (words) {
    const pack = skyPackView(words, screenW, height, present.cloudBytes | 0);
    compositeSky(
      buffer32,
      sliceWidth,
      height,
      pack,
      present.overlay,
      present.pair | 0,
      originX | 0,
      screenW
    );
  }
  if (present.overlay && grade) {
    applyColorGrade(buffer32, grade);
  }
}
