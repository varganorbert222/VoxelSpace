"use strict";

import ColorPalette from "./colorpalette.js";
import { Color } from "./color.js";

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
  }

  drawBackground() {
    if (!this._mustBeRecalcBuffer32bit) {
      for (let i = 0; i < this._width * this._height; i++) {
        this._buffer32bit[i] = this._cachedBuffer32bit[i];
      }
      return;
    }
    this._mustBeRecalcBuffer32bit = false;

    const h2 = this._height * 0.5;
    let t = 0;
    let color = Color.BLACK;
    for (let i = 0; (i < this._height) | 0; i = (i + 1) | 0) {
      t = i / h2;
      color = this._colorPalette.getColor(t);
      this._buffer32bit[i * this._width] = color;
      this._cachedBuffer32bit[i * this._width] = color;
    }
    for (let i = 0; (i < this._height) | 0; i = (i + 1) | 0) {
      for (let j = 1; (j < this._width) | 0; j = (j + 1) | 0) {
        this._buffer32bit[i * this._width + j] = this._buffer32bit[i * this._width];
        this._cachedBuffer32bit[i * this._width + j] = this._buffer32bit[i * this._width];
      }
    }
  } 

  drawVerticalLine(x, ytop, ybottom, col, width = 1) {
    x = x | 0;
    ytop = ytop | 0;
    ybottom = ybottom | 0;
    col = col | 0;
    if ((ytop < 0) | 0) ytop = 0;
    if ((ytop > ybottom) | 0) return;

    const screenwidth = this._width | 0;
    let offset = 0;
    // get offset on screen for the vertical line
    for (
      let j = 0;
      ((j < width) | 0) & ((x + j < screenwidth) | 0);
      j = (j + 1) | 0
    ) {
      offset = (ytop * screenwidth + x + j) | 0;
      for (let k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
        this._buffer32bit[offset] = col;
        offset = (offset + screenwidth) | 0;
      }
    }
  }

  copyFromBuffer(frameBuffer, startIndex, endIndex, width, height) {
    const slice = (endIndex - startIndex) | 0;
    let offsetTo = 0;
    let offsetFrom = 0;
    for (let x = startIndex; (x < endIndex) | 0; x = (x + 1) | 0) {
      offsetTo = x | 0;
      offsetFrom = (x - slice) | 0;
      for (let y = 0; (y < height) | 0; y = (y + 1) | 0) {
        this._buffer32bit[offsetTo] = frameBuffer[offsetFrom];
        offsetTo = (offsetTo + width) | 0;
        offsetFrom = offsetFrom | slice | 0;
      }
    }
  }

  // Show the back buffer on screen
  writeToContext() {
    this._imageDataForContext.data.set(this._buffer8bit);
    this._contextForCanvas.putImageData(this._imageDataForContext, 0, 0);
  }

  set(bufferData) {
    const aspect = bufferData.width / bufferData.height;

    this._canvas = bufferData.canvas;
    this._width = (bufferData.width * bufferData.renderScale) | 0;
    this._height = (this._width / aspect) | 0;
    this._canvas.width = this._width;
    this._canvas.height = this._height;

    if (this._canvas.getContext) {
      this._contextForCanvas = this._canvas.getContext("2d");
      this._imageDataForContext = this._contextForCanvas.createImageData(
        this._width,
        this._height
      );
    }

    this._colorBuffer = new ArrayBuffer(
      this._imageDataForContext.width * this._imageDataForContext.height * 4
    );
    this._buffer8bit = new Uint8Array(this._colorBuffer);
    this._buffer32bit = new Uint32Array(this._colorBuffer);
    this._cachedBuffer32bit = new ArrayBuffer(
      this._imageDataForContext.width * this._imageDataForContext.height * 4
    );

    this._mustBeRecalcBuffer32bit = true;
  }

  setColors(topColor, bottomColor) {
    this._colorPalette = new ColorPalette(topColor, bottomColor, 24);
    this._mustBeRecalcBuffer32bit = true;
  }
}

export default FrameBuffer;
