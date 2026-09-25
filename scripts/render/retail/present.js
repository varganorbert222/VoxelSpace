"use strict";

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
