"use strict";

import { hexToColor } from "./color.js";
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
    this._skyColor = 0xffffffff;
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
    const offset = this.getMapOffset(x, y);
    return (this._heightMap[offset] / 255) * this._altitude;
  }

  getTerrainSDF(x, y, z) {
    return z - this.getTerrainHeight(x, y);
  }

  getTerrainColor(x, y) {
    const mapOffset = this.getMapOffset(x, y);
    return this._colorMap[mapOffset];
  }

  loadData(mapData, mapImages) {
    this._colorMap = loadRGBAImageToArray(mapImages.colorMap);
    this._heightMap = loadRImageToArray(mapImages.heightMap);
    this._altitude = mapData.altitude;
    this._skyColor = hexToColor(mapData.skyColor);
    this._mapShift = Math.log2(mapImages.colorMap.width);
    this._width = mapImages.colorMap.width;
    this._height = mapImages.colorMap.height;
  }

  collide(x, y, z) {
    return this.getTerrainSDF(x, y, z) <= 0;
  }
}

export default Terrain;
