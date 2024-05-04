class Color {
  static get WHITE() {
    return 0xFFFFFFFF;
  }

  static get BLACK() {
    return 0xFF000000;
  }

  static get RED() {
    return 0xFF0000FF;
  }

  static get GREEN() {
    return 0xFF00FF00;
  }

  static get BLUE() {
    return 0xFFFF0000;
  }
}

function makeColor(r, g, b, a) {
  // 0-255 each component
  return (a << 24) | (r << 16) | (g << 8) | b;
}

function unpackColor(color) {
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

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    b: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    r: parseInt(result[3], 16)
  } : null;
}

function hexToColor(hex) {
  const rgb = hexToRgb(hex);
  return makeColor(rgb.r, rgb.g, rgb.b, 255);
}

export { makeColor, unpackColor, hexToColor, Color };
