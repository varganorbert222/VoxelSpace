"use strict";

import { Color } from "./color.js";

class ColorPalette {
  getColor(time) {
    let index = (time * this._colorCount) | 0;
    if (index < 0) {
      index = 0;
    } else if (index >= this._colorCount) {
      index = this._colorCount - 1;
    }
    return this._palette[index];
  }

  constructor(color1, color2, stepCount) {
    this._colorCount = stepCount;
    this._palette = new Array(this._colorCount);

    for (let i = 0; i < this._colorCount; i++) {
      this._palette[i] = Color.lerp(color1, color2, i / this._colorCount);
    }
  }
}

export default ColorPalette;
