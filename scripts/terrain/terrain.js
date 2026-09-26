"use strict";

import { Color } from "../math/color.js";
import { loadRGBAImageToArray, loadRImageToArray } from "../assets/imageLoader.js";
import { mapOffsetAt } from "./mapOffset.js";
import { buildTerrainMips } from "./mipChain.js";
import {
  DEFAULT_MAP_SIZE,
  DEFAULT_MAP_SHIFT,
  HEIGHTMAP_MAX,
} from "../constants/terrain.js";

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

  get horizonColor() {
    return this._horizonColor;
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
    this._horizonColor = Color.WHITE;
    this._exportedMaps = null;
    this._mapsGeneration = 0;
  }

  getMapOffset(x, y) {
    return mapOffsetAt(x, y, this._width, this._height, this._mapShift);
  }

  getTerrainHeight(x, y) {
    return (
      (this._heightMap[this.getMapOffset(x, y)] / HEIGHTMAP_MAX) *
      this._altitude
    );
  }

  peekExportedMaps() {
    return this._exportedMaps;
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
    let maxByte = 0;
    for (let y = 0; (y < h) | 0; y = (y + 1) | 0) {
      for (let x = 0; (x < w) | 0; x = (x + 1) | 0) {
        const offset = this.getMapOffset(x, y);
        const byte = this._heightMap[offset];
        heights[offset] = byte;
        colors[offset] = this._colorMap[offset];
        if ((byte > maxByte) | 0) {
          maxByte = byte;
        }
      }
    }
    // Steepest neighbour step of the map. Marchers use it to bound how fast
    // the terrain can rise, which turns "can the surface reappear further
    // along this line?" into a closed-form row skip.
    let maxSlope = 0;
    for (let y = 0; (y < h) | 0; y = (y + 1) | 0) {
      for (let x = 0; (x < w) | 0; x = (x + 1) | 0) {
        const byte = heights[mapOffsetAt(x, y, w, h, this._mapShift)];
        let dx = heights[mapOffsetAt(x + 1, y, w, h, this._mapShift)] - byte;
        let dy = heights[mapOffsetAt(x, y + 1, w, h, this._mapShift)] - byte;
        if ((dx < 0) | 0) {
          dx = -dx;
        }
        if ((dy < 0) | 0) {
          dy = -dy;
        }
        if ((dx > maxSlope) | 0) {
          maxSlope = dx;
        }
        if ((dy > maxSlope) | 0) {
          maxSlope = dy;
        }
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
      maxHeight: (maxByte / HEIGHTMAP_MAX) * this._altitude,
      maxSlope: (maxSlope / HEIGHTMAP_MAX) * this._altitude,
      generation: this._mapsGeneration,
      terrainMips: buildTerrainMips(heights, colors, w, h, this._mapShift),
    };
    return this._exportedMaps;
  }

  getTerrainSDF(x, y, z) {
    return z - this.getTerrainHeight(x, y);
  }

  loadData(mapData, mapImages) {
    this._colorMap = loadRGBAImageToArray(mapImages.colorMap);
    this._heightMap = loadRImageToArray(mapImages.heightMap);
    this._altitude = mapData.altitude;
    this._skyColor = Number.isInteger(mapData.skyColor)
      ? mapData.skyColor
      : Color.hexToColor(mapData.skyColor);
    this._horizonColor = Number.isInteger(mapData.horizonColor)
      ? mapData.horizonColor
      : Color.WHITE;
    this._mapShift = Math.log2(mapImages.colorMap.width);
    this._width = mapImages.colorMap.width;
    this._height = mapImages.colorMap.height;
    this._exportedMaps = null;
  }

  collide(x, y, z) {
    return (this.getTerrainSDF(x, y, z) <= 0) | 0;
  }
}

export default Terrain;
