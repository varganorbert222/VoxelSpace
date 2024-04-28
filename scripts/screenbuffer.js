"use strict";

class ScreenBuffer { // Camera'ba kell tenni, mert annak a felelőssége
  get canvas() {
    return this._canvas;
  }

  constructor() {
    this._canvas = null;
    this._context = null;
    this._imagedata = null;

    this._bufarray = null; // color data
    this._buf8 = null; // the same array but with bytes
    this._buf32 = null; // the same array but with 32-Bit words

    this._backgroundcolor = 0xffffe2b3; // ABGR (alpha, blue, green, red) 32-bit color
  }

  drawBackground() {
    const buf32 = this._buf32;
    const color = this._backgroundcolor | 0;
    for (let i = 0; i < buf32.length; i++) buf32[i] = color | 0;
  }

  drawVerticalLine(x, ytop, ybottom, col, width = 1) {
    x = x | 0;
    ytop = ytop | 0;
    ybottom = ybottom | 0;
    col = col | 0;
    const buf32 = this._buf32;
    const screenwidth = this._canvas.width | 0;
    if (ytop < 0) ytop = 0;
    if (ytop > ybottom) return;

    // get offset on screen for the vertical line
    for (let j = 0; j <= width && x + j < screenwidth; j++) {
      let offset = (ytop * screenwidth + x + j) | 0;
      for (let k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
        buf32[offset | 0] = col | 0;
        offset = (offset + screenwidth) | 0;
      }
    }
  }

  // Show the back buffer on screen
  flip() {
    this._imagedata.data.set(this._buf8);
    this._context.putImageData(this._imagedata, 0, 0);
  }

  set(bufferData) {
    const aspect = bufferData.width / bufferData.height;

    this._canvas = bufferData.canvas;
    this._canvas.width = Math.floor(bufferData.width * bufferData.renderScale);
    this._canvas.height = Math.floor(this._canvas.width / aspect);

    if (this._canvas.getContext) {
      this._context = this._canvas.getContext("2d");
      this._imagedata = this._context.createImageData(
        this._canvas.width,
        this._canvas.height
      );
    }

    this._bufarray = new ArrayBuffer(
      this._imagedata.width * this._imagedata.height * 4
    );
    this._buf8 = new Uint8Array(this._bufarray);
    this._buf32 = new Uint32Array(this._bufarray);
  }
}

export default ScreenBuffer;
