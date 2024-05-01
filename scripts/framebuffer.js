"use strict";

class FrameBuffer {
  get canvas() {
    return this._canvas;
  }

  get colorBuffer() {
    return this._colorBuffer;
  }

  constructor(backgroundColor) {
    this._canvas = null;
    this._contextForCanvas = null;
    this._imageDataForContext = null;

    this._colorBuffer = null; // color data
    this._buffer8bit = null; // the same array but with bytes
    this._buffer32bit = null; // the same array but with 32-Bit words
  }

  drawBackground(backgroundColor) {
    const buf32 = this._buffer32bit;
    const color = backgroundColor | 0;
    for (let i = 0; i < buf32.length; i++) {
      buf32[i] = color | 0;
    }
  }

  drawVerticalLine(x, ytop, ybottom, col, width = 1) {
    x = x | 0;
    ytop = ytop | 0;
    ybottom = ybottom | 0;
    col = col | 0;
    const screenwidth = this._canvas.width | 0;
    if (ytop < 0) ytop = 0;
    if (ytop > ybottom) return;

    // get offset on screen for the vertical line
    for (let j = 0; j <= width && x + j < screenwidth; j++) {
      let offset = (ytop * screenwidth + x + j) | 0;
      for (let k = ytop | 0; (k < ybottom) | 0; k = (k + 1) | 0) {
        this._buffer32bit[offset | 0] = col | 0;
        offset = (offset + screenwidth) | 0;
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
    this._canvas.width = Math.floor(bufferData.width * bufferData.renderScale);
    this._canvas.height = Math.floor(this._canvas.width / aspect);

    if (this._canvas.getContext) {
      this._contextForCanvas = this._canvas.getContext("2d");
      this._imageDataForContext = this._contextForCanvas.createImageData(
        this._canvas.width,
        this._canvas.height
      );
    }

    this._colorBuffer = new ArrayBuffer(
      this._imageDataForContext.width * this._imageDataForContext.height * 4
    );
    this._buffer8bit = new Uint8Array(this._colorBuffer);
    this._buffer32bit = new Uint32Array(this._colorBuffer);
  }
}

export default FrameBuffer;
