"use strict";

import { Color } from "./color.js";
import { loadRGBAImageToArray, loadRImageToArray } from "./imageutil.js";

class Terrain {
  get width() {
    return this._width;
  }

  get height() {
    return this._height;
  }

  get altitude() {
    return this._altitude;
  }

  get skyColor() {
    return this._skyColor;
  }

  constructor() {
    this._width = 1024;
    this._height = 1024;
    this._altitude = 0;
    this._mapShift = 10; // power of two: 2^10 = 1024
    this._colorMap = new Uint32Array(this._width * this._height); // 1024 * 1024 int array with RGB colors
    this._heightMap = new Uint8Array(this._width * this._height); // 1024 * 1024 byte array with height information
    this._skyColor = Color.WHITE;
  }

  getOffset(x, y, width, height, shift) {
    const mapWidthPeriod = width - 1;
    const mapHeightPeriod = height - 1;

    const mapOffset =
      (((Math.floor(y) & mapWidthPeriod) << shift) +
        (Math.floor(x) & mapHeightPeriod)) |
      0;

    return mapOffset;
  }

  getMapOffset(x, y) {
    return this.getOffset(x, y, this._width, this._height, this._mapShift);
  }

  getTerrainHeight(x, y) {
    // return this._heightMap[this.getMapOffset(x, y)] / 255 * this._altitude;

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const dx = x - x0;
    const dy = y - y0;

    const h00 = this._heightMap[this.getMapOffset(x0, y0)];
    const h01 = this._heightMap[this.getMapOffset(x0, y1)];
    const h10 = this._heightMap[this.getMapOffset(x1, y0)];
    const h11 = this._heightMap[this.getMapOffset(x1, y1)];

    const h =
        (1 - dx) * (1 - dy) * h00 +
        dx * (1 - dy) * h10 +
        (1 - dx) * dy * h01 +
        dx * dy * h11;

    return (h / 255) * this._altitude;
  }

  getTerrainSDF(x, y, z) {
    return z - this.getTerrainHeight(x, y);
  }

  getTerrainColor(x, y) {
    // return this._colorMap[this.getMapOffset(x, y)];

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const dx = x - x0;
    const dy = y - y0;

    const c00 = this._colorMap[this.getMapOffset(x0, y0)];
    const c01 = this._colorMap[this.getMapOffset(x0, y1)];
    const c10 = this._colorMap[this.getMapOffset(x1, y0)];
    const c11 = this._colorMap[this.getMapOffset(x1, y1)];

    const c1 = Color.multiplyWithValue(c00, (1 - dx) * (1 - dy));
    const c2 = Color.multiplyWithValue(c10, dx * (1 - dy));
    const c3 = Color.multiplyWithValue(c01, (1 - dx) * dy);
    const c4 = Color.multiplyWithValue(c11, dx * dy);

    const c = Color.add4(c1, c2, c3, c4);

    return c;
  }

  loadData(mapData, mapImages) {
    this._colorMap = loadRGBAImageToArray(mapImages.colorMap);
    this._heightMap = loadRImageToArray(mapImages.heightMap);
    this._altitude = mapData.altitude;
    this._skyColor = Color.hexToColor(mapData.skyColor);
    this._mapShift = Math.log2(mapImages.colorMap.width);
    this._width = mapImages.colorMap.width;
    this._height = mapImages.colorMap.height;
  }

  collide(x, y, z) {
    return this.getTerrainSDF(x, y, z) <= 0;
  }
}

export default Terrain;
