import { Color } from "./color.js";

class ColorPalette {
  getColor(time) {
    const index = (time * this._colorCount) | 0;
    return this._palette[index];
  }

  constructor(color1, color2, bit) {
    this._colorCount = bit;
    this._palette = new Array(this._colorCount);

    for (let i = 0; i < this._colorCount; i++) {
      this._palette[i] = Color.lerp(color1, color2, i / this._colorCount);
    }
  }
}

export default ColorPalette;
