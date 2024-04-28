"use strict";

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

  constructor() {
    this._width = 1024;
    this._height = 1024;
    this._altitude = 0;
    this._shift = 10; // power of two: 2^10 = 1024
    this._heightMap = new Uint8Array(1024 * 1024); // 1024 * 1024 byte array with height information
    this._colorMap = new Uint32Array(1024 * 1024); // 1024 * 1024 int array with RGB colors

    for (let i = 0; i < this._width * this._height; i++) {
      this._colorMap[i] = 0xff007050;
      this._heightMap[i] = 0;
    }
  }

  getMapOffset(x, y) {
    const mapWidthPeriod = this._width - 1;
    const mapHeightPeriod = this._height - 1;

    const mapOffset =
      (((Math.floor(y) & mapWidthPeriod) << this._shift) +
        (Math.floor(x) & mapHeightPeriod)) |
      0;

    return mapOffset;
  }

  getTerrainHeight(x, y) {
    const mapOffset = this.getMapOffset(x, y);
    return (this._heightMap[mapOffset] / 255.0) * this._altitude;
  }

  getTerrainSDF(x, y, z) {
    return z - this.getTerrainHeight(x, y);
  }

  applyFog(color, skyColor, depth) {
    let ca = (color >> 24) & 0xff;
    let cr = (color >> 16) & 0xff;
    let cg = (color >> 8) & 0xff;
    let cb = color & 0xff;

    let sa = (skyColor >>> 24) & 0xff;
    let sr = (skyColor >>> 16) & 0xff;
    let sg = (skyColor >>> 8) & 0xff;
    let sb = skyColor & 0xff;

    const p = depth / camera.farClip;

    ca = ca + (sa - ca) * p;
    cr = cr + (sr - cr) * p;
    cg = cg + (sg - cg) * p;
    cb = cb + (sb - cb) * p;

    return (ca << 24) | (cr << 16) | (cg << 8) | cb;
  }

  terrainShading(x, y) {
    const mapOffset = this.getMapOffset(x, y);
    let terrainColor = this._colorMap[mapOffset];
    // terrainColor = this.applyFog(terrainColor, screenData.backgroundcolor, depth);
    return terrainColor;
  }

  loadData(mapData, colorMap, heightMap) {
    this._width = mapData.width;
    this._height = mapData.height;
    this._altitude = mapData.altitude;

    for (let i = 0; i < this._width * this._height; i++) {
      this._colorMap[i] =
        0xff000000 |
        (colorMap[(i << 2) + 2] << 16) |
        (colorMap[(i << 2) + 1] << 8) |
        colorMap[(i << 2) + 0];
      this._heightMap[i] = heightMap[i << 2];
    }
  }

  collide(x, y, z) {
    return this.getTerrainSDF(x, y, z) < 10;
  }
}

export default Terrain;
