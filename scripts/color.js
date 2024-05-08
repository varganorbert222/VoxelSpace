class Color {
  static get WHITE() {
    return 0xffffffff;
  }

  static get BLACK() {
    return 0xff000000;
  }

  static get RED() {
    return 0xff0000ff;
  }

  static get GREEN() {
    return 0xff00ff00;
  }

  static get BLUE() {
    return 0xffff0000;
  }

  static makeColor(r, g, b, a) {
    // 0-255 each component
    return (a << 24) | (r << 16) | (g << 8) | b;
  }

  static unpackColor(color) {
    const a = (color >> 24) & 0xff;
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    return {
      a: a,
      r: r,
      g: g,
      b: b,
    };
  }

  static add4(color1, color2, color3, color4) {
    const c1 = Color.unpackColor(color1);
    const c2 = Color.unpackColor(color2);
    const c3 = Color.unpackColor(color3);
    const c4 = Color.unpackColor(color4);
    return Color.makeColor(
      c1.r + c2.r + c3.r + c4.r,
      c1.g + c2.g + c3.g + c4.g,
      c1.b + c2.b + c3.b + c4.b,
      c1.a + c2.a + c3.a + c4.a
    );
  }

  static multiply(color1, color2) {
    const c1 = Color.unpackColor(color1);
    const c2 = Color.unpackColor(color2);
    return Color.makeColor(c1.r * c2.r, c1.g * c2.g, c1.b * c2.b, c1.a * c2.a);
  }

  static multiplyWithValue(color1, value) {
    const c = Color.unpackColor(color1);
    return Color.makeColor(c.r * value, c.g * value, c.b * value, c.a * value);
  }

  static hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          b: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          r: parseInt(result[3], 16),
        }
      : null;
  }

  static hexToColor(hex) {
    const rgb = Color.hexToRgb(hex);
    return Color.makeColor(rgb.r, rgb.g, rgb.b, 255);
  }

  static randomColor() {
    return Color.makeColor(Math.random() * 255 | 0, Math.random() * 255 | 0, Math.random() * 255 | 0, 255);
  }
}

export { Color };
