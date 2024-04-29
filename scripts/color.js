function makeColor(r, g, b, a) { // 0-255 each component
    return a << 24 | r << 16 | g << 8 | b;
}

export { makeColor };