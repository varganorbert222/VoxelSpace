"use strict";

import ColorPalette from "../math/colorPalette.js";
import {
  SKY_PALETTE_STEPS,
  skyPaletteT,
} from "../constants/framebuffer.js";
import { BYTES_PER_PIXEL } from "../constants/image.js";
import { HALF } from "../constants/vmath.js";

class FrameBuffer {
  get colorBuffer() {
    return this._colorBuffer;
  }

  get width() {
    return this._width;
  }

  get height() {
    return this._height;
  }

  get buffer32bit() {
    return this._buffer32bit;
  }

  constructor() {
    this._canvas = null;
    this._contextForCanvas = null;
    this._imageDataForContext = null;

    this._colorBuffer = null; // color data
    this._buffer8bit = null; // the same array but with bytes
    this._buffer32bit = null; // the same array but with 32-Bit words
    this._colorPalette = null;
    this._cachedBuffer32bit = null;
    this._mustBeRecalcBuffer32bit = true;

    this._width = 0;
    this._height = 0;
    this._cachedHorizon = NaN;
    this._topColor = NaN;
    this._bottomColor = NaN;
  }

  drawBackground(screenHorizon) {
    const h2 = this._height * HALF;
    const horizon = screenHorizon ?? h2;
    const horizonKey = horizon | 0;
    if (
      !this._mustBeRecalcBuffer32bit &&
      this._cachedHorizon === horizonKey
    ) {
      this._buffer32bit.set(this._cachedBuffer32bit);
      return;
    }
    this._mustBeRecalcBuffer32bit = false;
    this._cachedHorizon = horizonKey;

    const dest = this._buffer32bit;
    const cached = this._cachedBuffer32bit;
    const width = this._width;
    const height = this._height;
    for (let i = 0; (i < height) | 0; i = (i + 1) | 0) {
      const color = this._colorPalette.getColor(
        skyPaletteT((i - horizon) / h2 + 1)
      );
      const row = (i * width) | 0;
      dest.fill(color, row, row + width);
      cached.fill(color, row, row + width);
    }
  }

  fill(color) {
    if (this._buffer32bit) {
      this._buffer32bit.fill(color | 0);
    }
  }

  blitTerrainColumns(src, startColumn, endColumn) {
    const dest = this._buffer32bit;
    const w = this._width;
    const h = this._height;
    const sliceW = (endColumn - startColumn) | 0;
    for (let y = 0; (y < h) | 0; y = (y + 1) | 0) {
      const srcRow = (y * sliceW) | 0;
      dest.set(
        src.subarray(srcRow, srcRow + sliceW),
        (y * w + startColumn) | 0
      );
    }
  }

  copySkyRowColors(out) {
    const dest = out;
    const src = this._buffer32bit;
    const w = this._width;
    const h = this._height;
    for (let y = 0; (y < h) | 0; y = (y + 1) | 0) {
      dest[y] = src[(y * w) | 0];
    }
    return dest;
  }

  writeToContext() {
    this._contextForCanvas.putImageData(this._imageDataForContext, 0, 0);
  }

  set(bufferData) {
    if (
      bufferData.canvas &&
      bufferData.canvas.dataset &&
      bufferData.canvas.dataset.present === "webgpu"
    ) {
      return;
    }
    const width = (bufferData.width * bufferData.renderScale) | 0;
    const height = (bufferData.height * bufferData.renderScale) | 0;
    if (
      this._canvas === bufferData.canvas &&
      this._width === width &&
      this._height === height &&
      this._buffer32bit &&
      this._cachedBuffer32bit
    ) {
      return;
    }

    this._canvas = bufferData.canvas;
    this._width = width;
    this._height = height;
    this._canvas.width = this._width;
    this._canvas.height = this._height;

    if (this._canvas.getContext) {
      this._contextForCanvas = this._canvas.getContext("2d");
      if (!this._contextForCanvas) {
        return;
      }
    }

    const pixelCount = (this._width * this._height) | 0;
    this._colorBuffer = new ArrayBuffer(pixelCount * BYTES_PER_PIXEL);
    this._buffer8bit = new Uint8ClampedArray(this._colorBuffer);
    this._buffer32bit = new Uint32Array(this._colorBuffer);
    this._cachedBuffer32bit = new Uint32Array(pixelCount);
    this._imageDataForContext = new ImageData(
      this._buffer8bit,
      this._width,
      this._height
    );

    this._mustBeRecalcBuffer32bit = true;
    this._cachedHorizon = NaN;
  }

  setColors(topColor, bottomColor) {
    if (
      this._colorPalette &&
      this._topColor === topColor &&
      this._bottomColor === bottomColor
    ) {
      return;
    }
    this._topColor = topColor;
    this._bottomColor = bottomColor;
    this._colorPalette = new ColorPalette(topColor, bottomColor, SKY_PALETTE_STEPS);
    this._mustBeRecalcBuffer32bit = true;
    this._cachedHorizon = NaN;
  }
}

export default FrameBuffer;
