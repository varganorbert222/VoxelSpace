function readColorFromImage(image, index) {
    const alpha = readAlphaFromImage(image, index);
    const red = readRedFromImage(image, index);
    const green = readGreenFromImage(image, index);
    const blue = readBlueFromImage(image, index);

  return  (alpha << 24) | (red << 16) | (green << 8) | blue;
}

function readAlphaFromImage(image, index){
    return image[(index << 2) + 3];
}

function readRedFromImage(image, index) {
    return image[(index << 2) + 2];
}

function readGreenFromImage(image, index) {
    return image[(index << 2) + 1];
}

function readBlueFromImage(image, index) {
    return image[(index << 2) + 0];
}

export { readAlphaFromImage, readRedFromImage, readGreenFromImage, readBlueFromImage, readColorFromImage };
