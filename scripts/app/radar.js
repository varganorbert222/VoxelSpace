"use strict";

import { DEBUG_VIEW_HEIGHT } from "../constants/debugView.js";
import {
  RADAR_CANVAS_ID,
  RADAR_FOV_RADIUS,
  RADAR_MARK_SIZE,
  RADAR_TEX_SIZE,
} from "../constants/radar.js";

function wrap(value, size) {
  const n = Number(size);
  if (!(n > 0)) {
    return 0;
  }
  return ((Number(value) % n) + n) % n;
}

function isHeightMode(debugView) {
  return debugView === DEBUG_VIEW_HEIGHT;
}

class Radar {
  constructor() {
    this._visible = true;
    this._canvas = null;
    this._ctx = null;
    this._bake = null;
    this._bakeCtx = null;
    this._terrain = null;
    this._bakedView = null;
    this._bakedGen = -1;
  }

  init() {
    this._canvas = document.getElementById(RADAR_CANVAS_ID);
    if (!this._canvas) {
      return;
    }
    this._ctx = this._canvas.getContext("2d");
    this._bake = document.createElement("canvas");
    this._bake.width = RADAR_TEX_SIZE;
    this._bake.height = RADAR_TEX_SIZE;
    this._bakeCtx = this._bake.getContext("2d");
  }

  setVisible(open) {
    this._visible = !!open;
  }

  get visible() {
    return this._visible;
  }

  invalidate() {
    this._bakedGen = -1;
    this._bakedView = null;
  }

  sync(app) {
    if (!this._ctx || !this._visible || !app || !app.terrain || !app.camera) {
      return;
    }
    const debugView = app.renderer ? app.renderer.debugView : null;
    this._ensureBake(app.terrain, debugView);
    this._draw(app.camera);
  }

  _ensureBake(terrain, debugView) {
    const gen = terrain.peekExportedMaps()
      ? terrain.peekExportedMaps().generation
      : 0;
    const heightMode = isHeightMode(debugView);
    if (
      this._terrain === terrain &&
      this._bakedView === heightMode &&
      this._bakedGen === gen
    ) {
      return;
    }
    this._terrain = terrain;
    this._bakedView = heightMode;
    this._bakedGen = gen;
    this._bakeMap(terrain, heightMode);
  }

  _bakeMap(terrain, heightMode) {
    const srcW = terrain.width | 0;
    const srcH = terrain.height | 0;
    const dst = RADAR_TEX_SIZE;
    if ((srcW < 1) | (srcH < 1)) {
      return;
    }
    const img = this._bakeCtx.createImageData(dst, dst);
    const pixels = img.data;
    const colors = terrain.colorMap;
    const colorBytes = new Uint8Array(
      colors.buffer,
      colors.byteOffset,
      colors.byteLength
    );
    const heights = terrain.heightMap;
    for (let j = 0; j < dst; j++) {
      const y = ((j * srcH) / dst) | 0;
      for (let i = 0; i < dst; i++) {
        const x = ((i * srcW) / dst) | 0;
        const off = terrain.getMapOffset(x, y);
        const p = ((j * dst + i) * 4) | 0;
        if (heightMode) {
          const h = heights[off] | 0;
          pixels[p] = h;
          pixels[p + 1] = h;
          pixels[p + 2] = h;
          pixels[p + 3] = 255;
        } else {
          const src = (off * 4) | 0;
          pixels[p] = colorBytes[src];
          pixels[p + 1] = colorBytes[src + 1];
          pixels[p + 2] = colorBytes[src + 2];
          pixels[p + 3] = 255;
        }
      }
    }
    this._bakeCtx.putImageData(img, 0, 0);
  }

  _draw(camera) {
    const ctx = this._ctx;
    const canvas = this._canvas;
    const w = canvas.width;
    const h = canvas.height;
    const mapW = this._terrain.width;
    const mapH = this._terrain.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this._bake, 0, 0, w, h);

    const px = (wrap(camera.posX, mapW) / mapW) * w;
    const py = (wrap(camera.posY, mapH) / mapH) * h;
    const heading = Math.atan2(camera.fwdY, camera.fwdX);
    const halfFov = ((camera.fov || 90) * Math.PI) / 180 / 2;
    const radius = Math.min(w, h) * RADAR_FOV_RADIUS;

    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, heading - halfFov, heading + halfFov);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 191, 60, 0.28)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 191, 60, 0.85)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#9dff4a";
    ctx.strokeStyle = "#140f00";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(
      -RADAR_MARK_SIZE / 2,
      -RADAR_MARK_SIZE / 2,
      RADAR_MARK_SIZE,
      RADAR_MARK_SIZE
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export default Radar;
