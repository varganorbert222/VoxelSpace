"use strict";

import { Color } from "./color.js";
import { loadRGBAImageToArray, loadRImageToArray } from "./imageutil.js";
import {
  DEFAULT_MAP_SIZE,
  DEFAULT_MAP_SHIFT,
  HEIGHTMAP_MAX,
} from "./constants/terrain.js";

export function mapOffsetAt(x, y, width, height, shift) {
  const mapWidthPeriod = width - 1;
  const mapHeightPeriod = height - 1;
  return (
    ((((y | 0) & mapWidthPeriod) << shift) + ((x | 0) & mapHeightPeriod)) |
    0
  );
}

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

  get colorMap() {
    return this._colorMap;
  }

  get heightMap() {
    return this._heightMap;
  }

  get mapShift() {
    return this._mapShift;
  }

  constructor() {
    this._width = DEFAULT_MAP_SIZE;
    this._height = DEFAULT_MAP_SIZE;
    this._altitude = 0;
    this._mapShift = DEFAULT_MAP_SHIFT;
    this._colorMap = new Uint32Array(this._width * this._height);
    this._heightMap = new Uint8Array(this._width * this._height);
    this._skyColor = Color.WHITE;
    this._exportedMaps = null;
    this._mapsGeneration = 0;
  }

  getOffset(x, y, width, height, shift) {
    return mapOffsetAt(x, y, width, height, shift);
  }

  getMapOffset(x, y) {
    return mapOffsetAt(x, y, this._width, this._height, this._mapShift);
  }

  getTerrainHeight(x, y) {
    return (this._heightMap[this.getMapOffset(x, y)] / HEIGHTMAP_MAX) *
      this._altitude;
  }

  getTerrainHeightAndColor(x, y, out) {
    const offset = this.getMapOffset(x, y);
    out.height = (this._heightMap[offset] / HEIGHTMAP_MAX) * this._altitude;
    out.color = this._colorMap[offset];
  }

  exportMaps() {
    if (this._exportedMaps) {
      return this._exportedMaps;
    }
    const n = (this._width * this._height) | 0;
    const heights = new Uint8Array(n);
    const colors = new Uint32Array(n);
    const w = this._width;
    const h = this._height;
    for (let y = 0; (y < h) | 0; y = (y + 1) | 0) {
      for (let x = 0; (x < w) | 0; x = (x + 1) | 0) {
        const offset = this.getMapOffset(x, y);
        heights[offset] = this._heightMap[offset];
        colors[offset] = this._colorMap[offset];
      }
    }
    this._mapsGeneration = (this._mapsGeneration + 1) | 0;
    this._exportedMaps = {
      heightMap: heights,
      colorMap: colors,
      width: w,
      height: h,
      mapShift: this._mapShift,
      altitude: this._altitude,
      generation: this._mapsGeneration,
    };
    return this._exportedMaps;
  }

  getTerrainSDF(x, y, z) {
    return z - this.getTerrainHeight(x, y);
  }

  getTerrainColor(x, y) {
    return this._colorMap[this.getMapOffset(x, y)];
  }

  getTerrainHeightBilinear(x, y) {
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

    return (h / HEIGHTMAP_MAX) * this._altitude;
  }

  getTerrainColorBilinear(x, y) {
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

  getTerrainSDFBilinear(x, y, z) {
    return z - this.getTerrainHeightBilinear(x, y);
  }

  loadData(mapData, mapImages) {
    this._colorMap = loadRGBAImageToArray(mapImages.colorMap);
    this._heightMap = loadRImageToArray(mapImages.heightMap);
    this._altitude = mapData.altitude;
    this._skyColor = Color.hexToColor(mapData.skyColor);
    this._mapShift = Math.log2(mapImages.colorMap.width);
    this._width = mapImages.colorMap.width;
    this._height = mapImages.colorMap.height;
    this._exportedMaps = null;
  }

  collide(x, y, z) {
    return this.getTerrainSDF(x, y, z) <= 0 | 0;
  }
}

export default Terrain;
