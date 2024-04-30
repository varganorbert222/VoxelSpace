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

export { makeColor, unpackColor };
